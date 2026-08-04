import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, signup, startedGame } from "./helpers.mjs";

let ctx;
before(async () => (ctx = await startServer()));
after(async () => ctx.stop());

test("archive is private per account; host identity exposed", async () => {
  const { host, A, B, code, state } = await startedGame(ctx, { rounds: 1 });
  await ctx.emit(A, "rename-session", { name: "Paint Lessons" });
  const cur = state.current.currentId === A.id ? A : B;
  await ctx.emit(cur, "submit-line", { text: "one line" });
  await ctx.emit(A, "pause-game", {});

  assert.equal((await ctx.api("/api/games")).status, 401, "unauthenticated blocked");
  const stranger = await signup(ctx, "stranger1", "s@x.com");
  const theirList = await ctx.api("/api/games", null, stranger.token, "GET");
  assert.equal(theirList.data.find((g) => g.code === code), undefined, "not their game");
  assert.equal((await ctx.api("/api/games/" + code, null, stranger.token, "GET")).status, 403);

  const mine = (await ctx.api("/api/games", null, host.token, "GET")).data.find((g) => g.code === code);
  assert.ok(mine);
  assert.equal(mine.name, "Paint Lessons");
  assert.equal(mine.hostName, "willthewise");
  assert.ok(mine.writers.find((w) => w.name === "willthewise" && w.isHost));
  assert.equal(mine.lines, 1);
  assert.equal(mine.hosted, true, "the original host's listing is flagged hosted");
  const mikeTok = (await ctx.api("/api/login", { user: "mikewheeler", password: "1234" })).data.token;
  const joined = (await ctx.api("/api/games", null, mikeTok, "GET")).data.find((g) => g.code === code);
  assert.equal(joined.hosted, false, "a co-writer's listing groups under joined games");

  const detail = await ctx.api("/api/games/" + code, null, host.token, "GET");
  assert.equal(detail.data.story.length, 1);
  assert.equal((await ctx.api("/api/games/zz!!", null, host.token, "GET")).status, 400);
  assert.equal((await ctx.api("/api/games/QQQQ", null, host.token, "GET")).status, 404);
});

test("dashboard: auth-gated, presence via identify, live games listing", async () => {
  assert.equal((await ctx.api("/api/dashboard")).status, 401);
  const el = await signup(ctx, "eldashboard", "eld@x.com");
  const S = await ctx.conn();
  S.emit("identify", { auth: el.token });
  await ctx.wait(150);
  let d = (await ctx.api("/api/dashboard", null, el.token, "GET")).data;
  const me = d.onlineUsers.find((u) => u.username === "eldashboard");
  assert.ok(me, "identified socket shows online");
  assert.equal(me.me, true);
  assert.ok(d.liveGames.find((g) => g.name === "Paint Lessons"), "running game listed");
  S.disconnect();
  await ctx.wait(200);
  d = (await ctx.api("/api/dashboard", null, el.token, "GET")).data;
  assert.equal(d.onlineUsers.find((u) => u.username === "eldashboard"), undefined, "presence drops");
});

test("game-state carries per-writer connected flags for status dots", async () => {
  const { B, state } = await startedGame(ctx);
  assert.ok(Array.isArray(state.current.writers));
  assert.ok(state.current.writers.every((w) => w.connected === true));
  assert.ok(state.current.writers.find((w) => w.name === "mikewheeler"));
  B.disconnect();
  await ctx.wait(250);
  assert.equal(state.current.writers.find((w) => w.name === "mikewheeler").connected, false);
});
