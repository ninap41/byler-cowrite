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
  const historyP = new Promise((r) => spec.on("chat-history", r));
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
