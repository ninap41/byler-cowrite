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

test("the host deletes a game in progress from the dashboard: it leaves everyone's dashboard and the other writers get an inbox note naming who did it", async () => {
  const { host, mike, A, B, code } = await startedGame(ctx, { rounds: 3 });
  await ctx.emit(A, "rename-session", { name: "Basement Tapes" });
  await ctx.wait(100);
  // both dashboards list it; only the host's card is `hosted`
  const hostDash = await ctx.api("/api/dashboard", null, host.token, "GET");
  const mikeDash = await ctx.api("/api/dashboard", null, mike.token, "GET");
  assert.equal(hostDash.data.myGames.find((g) => g.code === code)?.hosted, true);
  assert.equal(mikeDash.data.myGames.find((g) => g.code === code)?.hosted, false);
  // a non-host writer can't delete it
  assert.equal((await ctx.api(`/api/games/${code}`, null, mike.token, "DELETE")).status, 403);
  const gone = new Promise((r) => B.on("game-deleted", r));
  assert.equal((await ctx.api(`/api/games/${code}`, null, host.token, "DELETE")).status, 200);
  await gone;
  await ctx.wait(100);
  const after = await ctx.api("/api/dashboard", null, mike.token, "GET");
  assert.equal(after.data.myGames.find((g) => g.code === code), undefined, "off Mike's dashboard too");
  const inbox = await ctx.api("/api/inbox", null, mike.token, "GET");
  const note = (inbox.data.messages || inbox.data).find?.((m) => /Basement Tapes/.test(m.text)) ?? null;
  assert.ok(note, "Mike was told");
  assert.equal(note.type, "system");
  assert.equal(note.text, `🗑 “Basement Tapes” (${code}) has been deleted by ${host.user.username}.`);
  const mine = await ctx.api("/api/inbox", null, host.token, "GET");
  assert.equal((mine.data.messages || mine.data).find?.((m) => /Basement Tapes/.test(m.text)), undefined, "the deleter isn't notified about themselves");
});

test("the host ends a game from the dashboard's card menu: the reveal fires, the snapshot goes 'over' (and a paused, unloaded one is revived to end it); non-hosts get 403, an ended one 409", async () => {
  const { host, mike, A, B, code } = await startedGame(ctx, { rounds: 3 });
  const over = new Promise((r) => B.on("game-over", r));
  const chat = [];
  B.on("chat", (m) => chat.push(m));
  assert.equal((await ctx.api(`/api/games/${code}/end`, {}, mike.token)).status, 403, "not the host");
  assert.equal((await ctx.api(`/api/games/ZZZZ/end`, {}, host.token)).status, 404);
  assert.equal((await ctx.api(`/api/games/${code}/end`, {}, host.token)).status, 200);
  await over;
  await ctx.wait(100);
  assert.ok(chat.some((m) => m.sys && /ended this story/.test(m.text) && m.name === host.user.username), "the host is named, not 'Admin'");
  const detail = await ctx.api(`/api/games/${code}`, null, host.token, "GET");
  assert.equal(detail.data.phase, "over");
  assert.equal((await ctx.api(`/api/games/${code}/end`, {}, host.token)).status, 409, "already over");
  const dash = await ctx.api("/api/dashboard", null, host.token, "GET");
  assert.equal(dash.data.myGames.find((g) => g.code === code), undefined, "an ended game leaves 'in progress'");
});

test("a dashboard card's `hosted` flag also rides on a paused snapshot with no live session", async () => {
  const { host, A, B, code } = await startedGame(ctx, { rounds: 3 });
  await ctx.emit(A, "pause-game", {});
  A.disconnect();
  B.disconnect();
  await ctx.wait(200);
  // the session may still be in memory as ghosts; either way the card is hosted, paused, not active
  const dash = await ctx.api("/api/dashboard", null, host.token, "GET");
  const card = dash.data.myGames.find((g) => g.code === code);
  assert.ok(card);
  assert.equal(card.hosted, true);
  assert.equal(card.paused, true);
});

test("the host invites a friend to a live session: friends-only, host-only, an inbox game-invite with the code; strangers and non-hosts refused", async () => {
  const { host, mike, A, B, code } = await startedGame(ctx, { rounds: 3 });
  const carol = await signup(ctx, "carolstranger", "carol.s@x.com");
  // not a friend yet
  assert.equal((await ctx.api(`/api/games/${code}/invite`, { username: "carolstranger" }, host.token)).status, 403);
  // a non-host writer can't invite
  assert.equal((await ctx.api(`/api/games/${code}/invite`, { username: "carolstranger" }, mike.token)).status, 403);
  // make host+carol friends
  await ctx.api("/api/friends/request", { username: "carolstranger" }, host.token);
  const req = (await ctx.api("/api/inbox", null, carol.token, "GET")).data.messages.find((m) => m.type === "friend-request");
  await ctx.api("/api/friends/respond", { id: req.id, accept: true }, carol.token);
  // now the host may invite; carol gets a game-invite carrying the code
  assert.equal((await ctx.api(`/api/games/${code}/invite`, { username: "carolstranger" }, host.token)).status, 200);
  const inv = (await ctx.api("/api/inbox", null, carol.token, "GET")).data.messages.find((m) => m.type === "game-invite" && m.code === code);
  assert.ok(inv, "invite landed with the code");
  assert.match(inv.text, /invited you to come write/);
  // already in it → 409; unknown game → 404
  assert.equal((await ctx.api(`/api/games/${code}/invite`, { username: "mikewheeler" }, host.token)).status, 409);
  assert.equal((await ctx.api(`/api/games/ZZZZ/invite`, { username: "carolstranger" }, host.token)).status, 404);
});
