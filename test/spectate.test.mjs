import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, signup, startedGame } from "./helpers.mjs";

let ctx;
before(async () => (ctx = await startServer()));
after(async () => ctx.stop());

test("at most 5 stories can run at once; a finished one frees a slot", async () => {
  // dedicated server with the real production cap
  const capCtx = await startServer({ COWRITE_MAX_ACTIVE: "5" });
  try {
    const u = await signup(capCtx, "caphost1", "cap@x.com");
    const socks = [];
    for (let i = 0; i < 5; i++) {
      const s = await capCtx.conn();
      socks.push(s);
      const r = await capCtx.emit(s, "create-session", { auth: u.token });
      assert.equal(r.ok, true, "session " + (i + 1) + " created");
    }
    const extra = await capCtx.conn();
    const denied = await capCtx.emit(extra, "create-session", { auth: u.token });
    assert.equal(denied.ok, false, "sixth story refused");
    assert.match(denied.error, /5 stories are already running/);
    // finishing one frees the slot
    await capCtx.emit(socks[0], "end-game", {});
    const again = await capCtx.emit(extra, "create-session", { auth: u.token });
    assert.equal(again.ok, true, "slot freed after a reveal");
  } finally {
    await capCtx.stop();
  }
});

test("/api/live is public and leaks no tokens or story content", async () => {
  const { code } = await startedGame(ctx);
  const r = await fetch(ctx.url + "/api/live").then((x) => x.json());
  const g = r.games.find((x) => x.code === code);
  assert.ok(g, "running game listed without auth");
  assert.equal(g.players, 2);
  assert.equal(g.hostName, "willthewise");
  const raw = JSON.stringify(r);
  assert.ok(!raw.includes("token"), "no seat tokens");
  assert.ok(!raw.includes("story"), "no story content");
});

test("spectators watch live but cannot contribute", async () => {
  const { A, B, code, state } = await startedGame(ctx);
  const spec = await ctx.conn(); // no auth at all
  const specState = { current: null };
  const chats = [];
  spec.on("game-state", (st) => (specState.current = st));
  spec.on("chat", (m) => chats.push(m));
  const historyP = new Promise((r) => spec.on("spec-chat-history", r));
  const ok = await ctx.emit(spec, "spectate-session", { code });
  assert.equal(ok.ok, true);
  await historyP;
  await ctx.wait(150);
  assert.equal(specState.current.phase, "writing", "sees the live state");
  assert.equal(specState.current.spectators, 1, "watcher count is broadcast");

  // read-only: every contribution path no-ops
  assert.equal((await ctx.emit(spec, "submit-line", { text: "sneaky" })).ok, false);
  assert.equal((await ctx.emit(spec, "vote", { prompt: "x" })).ok, false);
  assert.equal((await ctx.emit(spec, "pause-game", {})).ok, false);
  assert.equal((await ctx.emit(spec, "end-game", {})).ok ?? false, false);
  spec.emit("chat", { text: "spectator noise" });
  await ctx.wait(150);
  assert.ok(!chats.some((m) => m.text === "spectator noise"), "spectator chat goes nowhere");

  // …but real play streams to them
  const cur = state.current.currentId === A.id ? A : B;
  await ctx.emit(cur, "submit-line", { text: "a line the spectator sees" });
  await ctx.wait(200);
  assert.ok(specState.current.story.some((l) => l.html.includes("a line the spectator sees")));
  assert.equal((await ctx.emit(spec, "spectate-session", { code: "ZZZZ" })).ok, false, "unknown code refused");
  spec.disconnect();
});

test("two chat channels: writers chat is private; spectator chat is shared and ephemeral", async () => {
  const { A, B, code } = await startedGame(ctx);
  const spec = await ctx.conn(); // no auth
  const specWriterChats = [], specSpecChats = [], aSpecChats = [], aChats = [];
  spec.on("chat", (m) => specWriterChats.push(m));
  spec.on("spec-chat", (m) => specSpecChats.push(m));
  A.on("chat", (m) => aChats.push(m));
  A.on("spec-chat", (m) => aSpecChats.push(m));
  const hist = new Promise((r) => spec.on("spec-chat-history", r));
  await ctx.emit(spec, "spectate-session", { code });
  await hist;

  // writers chat never reaches the spectator
  B.emit("chat", { text: "writer secret" });
  await ctx.wait(150);
  assert.ok(aChats.some((m) => m.text === "writer secret"), "writers still see writers chat");
  assert.equal(specWriterChats.length, 0, "spectator receives NO writers chat");

  // the spectator talks under their client-minted Stranger Things name
  spec.emit("spec-chat", { text: "go byler go", name: "Demodog #42" });
  await ctx.wait(150);
  assert.equal(specSpecChats.length, 1, "spectator sees their own message");
  assert.equal(specSpecChats[0].name, "Demodog #42");
  assert.ok(specSpecChats[0].color, "palette color assigned server-side");
  assert.ok(aSpecChats.some((m) => m.text === "go byler go" && m.spec), "writers see spectator chat");

  // a writer answers in the spectator channel under their real name, flagged
  B.emit("spec-chat", { text: "thanks demodog" });
  await ctx.wait(150);
  const reply = specSpecChats.find((m) => m.text === "thanks demodog");
  assert.ok(reply, "writer reply reaches the spectator");
  assert.equal(reply.writer, true);
  assert.ok(["willthewise", "mikewheeler"].includes(reply.name), "writer identity comes from the seat");

  // spectator names are stripped of markup server-side
  spec.emit("spec-chat", { text: "hi", name: "<script>x</script>Vecna #7" });
  await ctx.wait(150);
  assert.equal(specSpecChats.find((m) => m.text === "hi").name, "xVecna #7");

  // ephemeral: spectator chat never lands in the save snapshot
  await ctx.emit(A, "pause-game", {}); // pause forces a snapshot write
  await ctx.wait(150);
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const snap = readFileSync(join(ctx.saveDir, code + ".json"), "utf-8");
  assert.ok(snap.includes("writer secret"), "writers chat is persisted");
  assert.ok(!snap.includes("go byler go") && !snap.includes("specChat"), "spectator chat is never persisted");

  // a late spectator still gets the in-memory spec history, not writers chat
  const spec2 = await ctx.conn();
  const hist2 = await new Promise((r) => {
    spec2.on("spec-chat-history", r);
    spec2.emit("spectate-session", { code });
  });
  assert.ok(hist2.some((m) => m.text === "go byler go"), "in-memory spec history replays");
  assert.ok(!hist2.some((m) => m.text === "writer secret"), "no writers chat in it");
  spec.disconnect();
  spec2.disconnect();
});
