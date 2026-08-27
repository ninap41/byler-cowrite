import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, signup, startedGame } from "./helpers.mjs";

let ctx;
before(async () => (ctx = await startServer()));
after(async () => ctx.stop());

test("there is no cap on stories in progress, they can all run at once", async () => {
  const capCtx = await startServer();
  try {
    const u = await signup(capCtx, "caphost1", "cap@x.com");
    const codes = new Set();
    for (let i = 0; i < 15; i++) {
      const s = await capCtx.conn();
      const r = await capCtx.emit(s, "create-session", { auth: u.token });
      assert.equal(r.ok, true, "story " + (i + 1) + " created");
      codes.add(r.code);
    }
    assert.equal(codes.size, 15, "every story got its own code");
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
  spec.emit("chat", { text: "spectator noise", name: "Demodog #1" });
  await ctx.wait(150);
  const noise = chats.find((m) => m.text === "spectator noise");
  assert.ok(noise && noise.spec === true && noise.name === "Demodog #1", "a spectator chats under their own name, flagged");

  // …but real play streams to them
  const cur = state.current.currentId === A.id ? A : B;
  await ctx.emit(cur, "submit-line", { text: "a line the spectator sees" });
  await ctx.wait(200);
  assert.ok(specState.current.story.some((l) => l.html.includes("a line the spectator sees")));
  assert.equal((await ctx.emit(spec, "spectate-session", { code: "ZZZZ" })).ok, false, "unknown code refused");
  spec.disconnect();
});

test("one chat for the whole table: writers and spectators share it, spectator lines are flagged, and the history replays to a late watcher", async () => {
  const { A, B, code } = await startedGame(ctx);
  const spec = await ctx.conn(); // no auth
  const specChats = [], aChats = [];
  spec.on("chat", (m) => specChats.push(m));
  A.on("chat", (m) => aChats.push(m));
  const hist = new Promise((r) => spec.on("chat-history", r));
  await ctx.emit(spec, "spectate-session", { code });
  await hist;

  // a writer's line reaches the spectator too
  B.emit("chat", { text: "writer line" });
  await ctx.wait(150);
  assert.ok(aChats.some((m) => m.text === "writer line"), "writers see it");
  const seen = specChats.find((m) => m.text === "writer line");
  assert.ok(seen && !seen.spec && ["willthewise", "mikewheeler"].includes(seen.name), "so does the spectator, with the seat identity");

  // the spectator talks under their client-minted Stranger Things name
  spec.emit("chat", { text: "go byler go", name: "Demodog #42" });
  await ctx.wait(150);
  const mine = specChats.find((m) => m.text === "go byler go");
  assert.equal(mine.name, "Demodog #42");
  assert.equal(mine.spec, true);
  assert.ok(mine.color, "palette color assigned server-side");
  assert.ok(aChats.some((m) => m.text === "go byler go" && m.spec), "writers see spectator lines, flagged");

  // spectator names are stripped of markup server-side
  spec.emit("chat", { text: "hi", name: "<script>x</script>Vecna #7" });
  await ctx.wait(150);
  assert.equal(specChats.find((m) => m.text === "hi").name, "xVecna #7");

  // one history: a late spectator replays writer AND spectator lines
  const spec2 = await ctx.conn();
  const hist2 = await new Promise((r) => {
    spec2.on("chat-history", r);
    spec2.emit("spectate-session", { code });
  });
  assert.ok(hist2.some((m) => m.text === "go byler go") && hist2.some((m) => m.text === "writer line"));
  spec.disconnect();
  spec2.disconnect();
});
