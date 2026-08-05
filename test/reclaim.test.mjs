import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, signup, startedGame } from "./helpers.mjs";

let ctx;
before(async () => (ctx = await startServer()));
after(async () => ctx.stop());

test("seat-token rejoin swaps the socket into the same seat", async () => {
  const { B, code, mikeSeatToken } = await startedGame(ctx);
  B.disconnect();
  const B2 = await ctx.conn();
  const r = await ctx.emit(B2, "rejoin-session", { code, token: mikeSeatToken });
  assert.equal(r.ok, true);
  assert.equal(r.name, "mikewheeler");
  assert.equal(r.phase, "writing");
});

test("account reclaim: join by code alone restores seat + host role", async () => {
  const { host, code } = await startedGame(ctx);
  const A2 = await ctx.conn();
  const r = await ctx.emit(A2, "join-session", { code, auth: host.token });
  assert.equal(r.ok, true);
  assert.equal(r.pending, undefined, "true host is never gated");
  assert.equal(r.name, "willthewise");
  assert.equal(r.hostId, A2.id, "host role restored");
});

test("signed-out sockets cannot join at all", async () => {
  const { code } = await startedGame(ctx);
  const D = await ctx.conn();
  const r = await ctx.emit(D, "join-session", { code });
  assert.equal(r.ok, false);
  assert.match(r.error, /Sign in to join/);
});

test("new accounts cannot enter a started game without approval; approval seats them", async () => {
  const { A, code, state } = await startedGame(ctx);
  const dustin = await signup(ctx, "dustinh", "dustin@x.com", "#facc15");
  const D = await ctx.conn();
  const reqP = new Promise((r) => A.on("join-request", r));
  const apprP = new Promise((r) => D.on("join-approved", r));
  const r = await ctx.emit(D, "join-session", { code, auth: dustin.token });
  assert.equal(r.pending, true);
  const req = await reqP;
  assert.equal(req.name, "dustinh");
  await ctx.emit(A, "approve-join", { id: req.id, allow: true });
  const appr = await apprP;
  assert.equal(appr.name, "dustinh");
  assert.ok(appr.token);
  await ctx.wait(150);
  assert.ok(state.current.players.includes("dustinh"), "joined the rotation");
});

test("deny starts a 5-minute cooldown keyed by account (socket-hopping does not evade it)", async () => {
  const { A, code } = await startedGame(ctx);
  const lucas = await signup(ctx, "lucassin", "lucas@x.com", "#3ddc84");
  const D = await ctx.conn();
  const reqP = new Promise((r) => A.on("join-request", r));
  const deniedP = new Promise((r) => D.on("join-denied", r));
  await ctx.emit(D, "join-session", { code, auth: lucas.token });
  const req = await reqP;
  await ctx.emit(A, "approve-join", { id: req.id, allow: false });
  await deniedP;
  const retry = await ctx.emit(D, "join-session", { code, auth: lucas.token });
  assert.equal(retry.ok, false);
  assert.match(retry.error, /ask again in 5 minutes/);
  const D2 = await ctx.conn(); // fresh socket, same account
  const retry2 = await ctx.emit(D2, "join-session", { code, auth: lucas.token });
  assert.equal(retry2.ok, false, "cooldown keyed to the account, not the socket");
});

test("approve-join is host-only and requests expire with the requester", async () => {
  const { A, B, code } = await startedGame(ctx);
  const erica = await signup(ctx, "ericasin", "erica@x.com", "#e879c9");
  const D = await ctx.conn();
  const cancelP = new Promise((r) => A.on("join-request-cancel", r));
  const reqP = new Promise((r) => A.on("join-request", r));
  await ctx.emit(D, "join-session", { code, auth: erica.token });
  const req = await reqP;
  const r = await ctx.emit(B, "approve-join", { id: req.id, allow: true });
  assert.equal(r.ok, false, "non-host cannot approve");
  D.disconnect();
  const cancel = await cancelP;
  assert.equal(cancel.id, req.id, "host popup told to drop the request");
  const late = await ctx.emit(A, "approve-join", { id: req.id, allow: true });
  assert.equal(late.ok, false, "request gone after disconnect");
});

test("save + restart: rehydrated game gates returning writers, host continues freely", async () => {
  const { A, code, mikeSeatToken } = await startedGame(ctx);
  await ctx.emit(A, "pause-game", {}); // snapshot to disk
  // simulate restart with a second isolated server sharing the same dirs
  const port2 = 4100 + Math.floor(Math.random() * 3000);
  const { spawn } = await import("node:child_process");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  const child = spawn("node", ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port2), COWRITE_DATA_DIR: ctx.dataDir, COWRITE_SAVE_DIR: ctx.saveDir },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((res) => child.stdout.on("data", (d) => String(d).includes("running") && res()));
  const { io } = await import("socket.io-client");
  const conn2 = async () => {
    const s = io(`http://localhost:${port2}`, { transports: ["websocket"], forceNew: true });
    await new Promise((r) => s.on("connect", r));
    return s;
  };
  try {
    const login = await fetch(`http://localhost:${port2}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: "willthewise", password: "1234" }),
    }).then((r) => r.json());
    const H = await conn2();
    const r1 = await ctx.emit(H, "join-session", { code, auth: login.token });
    assert.equal(r1.ok, true);
    assert.equal(r1.pending, undefined, "true host enters a continued game directly");
    assert.equal(r1.hostId, H.id);
    // returning writer is now gated
    const B2 = await conn2();
    const reqP = new Promise((r) => H.on("join-request", r));
    const r2 = await ctx.emit(B2, "rejoin-session", { code, token: mikeSeatToken });
    assert.equal(r2.pending, true, "continued game gates returning writers");
    const req = await reqP;
    assert.equal(req.returning, true);
    const apprP = new Promise((r) => B2.on("join-approved", r));
    await ctx.emit(H, "approve-join", { id: req.id, allow: true });
    const appr = await apprP;
    assert.equal(appr.name, "mikewheeler");
    // once approved, the next rejoin is frictionless
    const B3 = await conn2();
    const r3 = await ctx.emit(B3, "rejoin-session", { code, token: appr.token });
    assert.equal(r3.ok, true);
    assert.equal(r3.pending, undefined);
    B2.disconnect();
    B3.disconnect();
    H.disconnect();
  } finally {
    child.kill("SIGKILL");
  }
});

test("pending join request survives host churn: handoff + host rejoin replay it", async () => {
  const { A, B, code, hostSeatToken } = await startedGame(ctx);
  const nancy = await signup(ctx, "nancywheeler", "nancy@wheeler.com", "#f59e0b");
  const D = await ctx.conn();
  const firstReq = new Promise((r) => A.on("join-request", r));
  const r = await ctx.emit(D, "join-session", { code, auth: nancy.token });
  assert.equal(r.pending, true);
  await firstReq;
  // host drops: the stand-in host inherits the open request
  const handoffReq = new Promise((r) => B.on("join-request", r));
  A.disconnect();
  const inherited = await handoffReq;
  assert.equal(inherited.name, "nancywheeler");
  // the true host returns on a fresh socket: the request is replayed again
  const A2 = await ctx.conn();
  const replayReq = new Promise((r) => A2.on("join-request", r));
  const back = await ctx.emit(A2, "rejoin-session", { code, token: hostSeatToken });
  assert.equal(back.ok, true);
  const replayed = await replayReq;
  assert.equal(replayed.name, "nancywheeler");
  // and the requester still gets the verdict — denial notifies them
  const deniedP = new Promise((r) => D.on("join-denied", r));
  await ctx.emit(A2, "approve-join", { id: replayed.id, allow: false });
  await deniedP;
  A2.disconnect();
  D.disconnect();
});
