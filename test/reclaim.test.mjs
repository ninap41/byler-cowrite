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

test("the original host whose seat expired re-enters a started game directly, as host", async () => {
  // a short ghost window so the host's seat is really gone, not a ghost
  const ctx2 = await startServer({ COWRITE_GHOST_MS: "150" });
  try {
    const { host, A, B, code } = await startedGame(ctx2);
    A.disconnect(); // host leaves; the seat ghosts, then is removed
    await new Promise((r) => setTimeout(r, 600));
    const H = await ctx2.conn();
    const r = await ctx2.emit(H, "join-session", { code, auth: host.token });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.pending, undefined, "never asked to let themselves in");
    assert.equal(r.hostId, H.id, "and hosts again");
    H.disconnect();
    B.disconnect();
  } finally {
    await ctx2.stop?.();
  }
});

test("a revealed story is continuable by whoever may end it — and by anyone seated once no host is here", async () => {
  const ctx2 = await startServer({ COWRITE_GHOST_MS: "150" });
  try {
    const { A, B, code, mike } = await startedGame(ctx2);
    A.disconnect(); // the true host drops out; Mike becomes acting host
    await new Promise((r) => setTimeout(r, 600));
    const over = new Promise((r) => B.on("game-over", r));
    const e = await ctx2.emit(B, "end-game", {});
    assert.equal(e.ok, true, "the acting host may end");
    await over;
    // the acting host may also continue — the same authority both ways
    const c = await ctx2.emit(B, "continue-writing", { turnSeconds: 30, rounds: 1 });
    assert.equal(c.ok, true, "the acting host continues");
    // …and if the acting host leaves after a reveal, a seated writer can
    await ctx2.emit(B, "end-game", {});
    const C = await ctx2.conn();
    // a third writer seated via the host's approval
    const reqP = new Promise((r) => B.on("join-request", r));
    const dustin = await signup(ctx2, "dustinhenderson", "dustin@hawkins.net");
    const j = ctx2.emit(C, "join-session", { code, auth: dustin.token });
    const req = await reqP;
    await ctx2.emit(B, "approve-join", { id: req.id, allow: true });
    await j;
    B.disconnect();
    await new Promise((r) => setTimeout(r, 600));
    const c2 = await ctx2.emit(C, "continue-writing", { turnSeconds: 30, rounds: 1 });
    assert.equal(c2.ok, true, "no connected host: a seated writer continues and hosts");
    C.disconnect();
  } finally {
    await ctx2.stop?.();
  }
});

test("continuing a story that is already being continued is harmless", async () => {
  const ctx2 = await startServer({ COWRITE_GHOST_MS: "150" });
  try {
    const { host, mike, A, B, code, state } = await startedGame(ctx2);
    const first = state.current.currentId === A.id ? A : B;
    await ctx2.emit(first, "submit-line", { text: "a line" });
    B.disconnect(); // Mike's seat expires; he stays a contributor by his line
    await new Promise((r) => setTimeout(r, 600));
    await ctx2.emit(A, "end-game", {});
    // the host continues; a second continue (a double click, another tab)
    // finds the game already writing and is refused, changing nothing
    const c1 = await ctx2.emit(A, "continue-writing", { turnSeconds: 30, rounds: 2 });
    assert.equal(c1.ok, true);
    const stateP = new Promise((r) => A.once("game-state", r));
    const c2 = await ctx2.emit(A, "continue-writing", { turnSeconds: 5, rounds: 1 });
    assert.equal(c2.ok, false, "already continued");
    const st = await Promise.race([stateP, new Promise((r) => setTimeout(() => r(null), 300))]);
    if (st) assert.equal(st.phase, "writing");
    const g = await ctx2.api("/api/games/" + code, null, host.token, "GET");
    assert.equal(g.data.phase, "writing");
    assert.equal(g.data.story.length, 1, "no line lost, none duplicated");

    // Mike, seeing the story in his archive, presses Continue → join by code:
    // the game is already running with the host present, so he becomes a
    // join request for the host to approve, then writes again as himself
    const M = await ctx2.conn();
    const reqP = new Promise((r) => A.on("join-request", r));
    const j = ctx2.emit(M, "join-session", { code, auth: mike.token });
    const req = await reqP;
    assert.equal(req.name, "mikewheeler");
    const apprP = new Promise((r) => M.on("join-approved", r));
    await ctx2.emit(A, "approve-join", { id: req.id, allow: true });
    const jr = await j;
    assert.equal(jr.ok, true);
    assert.equal(jr.pending, true);
    await apprP;
    const after = await ctx2.api("/api/games/" + code, null, host.token, "GET");
    assert.equal(after.data.phase, "writing", "still one running game");
    assert.equal(after.data.writers.filter((w) => w.name === "mikewheeler").length, 1, "one seat for Mike, not two");
    M.disconnect();
    A.disconnect();
  } finally {
    await ctx2.stop?.();
  }
});

test("two writers racing to continue a reveal: exactly one continues, the other is refused", async () => {
  const ctx2 = await startServer({ COWRITE_GHOST_MS: "150" });
  try {
    const { A, B, code, host } = await startedGame(ctx2);
    A.disconnect(); // host gone: Mike is acting host
    await new Promise((r) => setTimeout(r, 600));
    await ctx2.emit(B, "end-game", {});
    // the original host comes back to the reveal; both may continue now
    const H = await ctx2.conn();
    const r = await ctx2.emit(H, "join-session", { code, auth: host.token });
    assert.equal(r.ok, true);
    const [x, y] = await Promise.all([
      ctx2.emit(H, "continue-writing", { turnSeconds: 30, rounds: 1 }),
      ctx2.emit(B, "continue-writing", { turnSeconds: 30, rounds: 1 }),
    ]);
    assert.equal([x.ok, y.ok].filter(Boolean).length, 1, "one wins");
    const g = await ctx2.api("/api/games/" + code, null, host.token, "GET");
    assert.equal(g.data.phase, "writing");
    assert.equal(new Set(g.data.writers.map((w) => w.name)).size, g.data.writers.length, "no duplicate seats");
    H.disconnect();
    B.disconnect();
  } finally {
    await ctx2.stop?.();
  }
});

test("make-host hands the game — and the original-host rights — to another writer", async () => {
  const { host, mike, A, B, code } = await startedGame(ctx);
  const stranger = await signup(ctx, "erica1", "erica@sinclair.com");
  const S = await ctx.conn();
  // only the host may
  const no = await ctx.emit(B, "make-host", { id: B.id });
  assert.equal(no.ok, false);
  const bad = await ctx.emit(A, "make-host", { id: "nope" });
  assert.equal(bad.ok, false, "must be a seated writer");
  const stP = new Promise((r) => B.once("game-state", r));
  const ok = await ctx.emit(A, "make-host", { id: B.id });
  assert.equal(ok.ok, true);
  assert.equal(ok.hostId, B.id);
  const st = await stP;
  assert.equal(st.hostId, B.id);
  assert.equal(st.hostName, "mikewheeler");
  const mikeMe = await ctx.api("/api/me", null, mike.token, "GET");
  assert.equal(st.hostUserId, mikeMe.data.user.id, "the original-host rights moved too");
  // the old host is now an ordinary writer: no host powers
  assert.equal((await ctx.emit(A, "pause-game", {})).ok, false);
  assert.equal((await ctx.emit(B, "pause-game", {})).ok, true);
  // and the dashboard/archive agree on who hosts
  const mine = await ctx.api("/api/games", null, mike.token, "GET");
  assert.equal(mine.data.find((g) => g.code === code).hosted, true);
  const old = await ctx.api("/api/games", null, host.token, "GET");
  assert.equal(old.data.find((g) => g.code === code).hosted, false);
  S.disconnect();
});
