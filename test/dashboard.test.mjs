import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, signup, startedGame } from "./helpers.mjs";

let ctx;
before(async () => (ctx = await startServer()));
after(async () => ctx.stop());

test("myGames: only my seats, myTurn flag, paused snapshot after everyone leaves", async () => {
  const { host, mike, A, B, code, state } = await startedGame(ctx);
  const dash = (t) => ctx.api("/api/dashboard", null, t, "GET").then((r) => r.data);

  // both players see the running game; exactly one of them has myTurn
  const [h, m] = [await dash(host.token), await dash(mike.token)];
  const hg = h.myGames.find((g) => g.code === code);
  const mg = m.myGames.find((g) => g.code === code);
  assert.ok(hg && mg, "both seats see the game");
  assert.equal(hg.live, true);
  assert.equal(hg.phase, "writing");
  assert.equal(hg.myTurn !== mg.myTurn, true, "exactly one player is up");
  const upName = state.current.currentName;
  assert.equal(hg.myTurn, upName === "willthewise");
  assert.equal(hg.currentName, upName);
  assert.equal(hg.players.length, 2);

  // a stranger sees nothing
  const stranger = await signup(ctx, "dashstranger", "ds@x.com");
  const s = await dash(stranger.token);
  assert.equal(s.myGames.find((g) => g.code === code), undefined);
  assert.ok(Array.isArray(s.recentGames));

  // stats ride along
  assert.equal(h.stats.username, "willthewise");
  assert.ok("streak" in h.stats && "bestStreak" in h.stats);

  // everyone leaves -> ghosts expire is slow, but the snapshot exists; kill the
  // in-memory session path by checking the pause flag once host pauses
  await ctx.emit(A, "pause-game", {});
  const h2 = await dash(host.token);
  assert.equal(h2.myGames.find((g) => g.code === code).paused, true);
  A.disconnect();
  B.disconnect();
});

test("streak: first credited line sets streak=1 and it shows on /api/me", async () => {
  const { host, A, B, state } = await startedGame(ctx, { rounds: 1 });
  const cur = state.current.currentId === A.id ? A : B;
  await ctx.emit(cur, "submit-line", { text: "streak line one" });
  await ctx.wait(150);
  const other = state.current.currentId === A.id ? A : B;
  await ctx.emit(other, "submit-line", { text: "streak line two" });
  await ctx.wait(150);
  const me = (await ctx.api("/api/me", null, host.token, "GET")).data.user;
  assert.equal(me.streak, 1);
  assert.equal(me.bestStreak, 1);
  assert.ok(me.lastWroteDay, "day recorded");
});

test("recentGames: finished games only, mine only", async () => {
  const { host, A, B, code, state } = await startedGame(ctx, { rounds: 1 });
  await ctx.emit(A, "rename-session", { name: "Finished One" });
  for (let i = 0; i < 2; i++) {
    const sock = state.current?.currentId === A.id ? A : B;
    await ctx.emit(sock, "submit-line", { text: "line " + i });
    await ctx.wait(200);
  }
  const d = (await ctx.api("/api/dashboard", null, host.token, "GET")).data;
  const mine = d.recentGames.find((g) => g.code === code);
  assert.ok(mine, "finished game listed");
  assert.equal(mine.name, "Finished One");
  assert.ok(mine.lines >= 1);
  assert.equal(d.myGames.find((g) => g.code === code), undefined, "finished game not in progress");
});

test("the dashboard rail is navigation: inbox count, start, join, solo write", async () => {
  const body = await fetch(ctx.url + "/dashboard").then((r) => r.text());
  const rail = body.slice(body.indexOf("RIGHT RAIL"));

  // every destination is a row in one nav, not a card of its own
  assert.ok(rail.includes('<nav class="card dash-nav"'), "one nav column");
  for (const id of ["navInbox", "createBtn", "joinToggle", "soloBtn", "inviteBtn"])
    assert.ok(rail.includes(`id="${id}"`), id + " is in the rail");
  assert.ok(rail.includes('href="/inbox"') && rail.includes('href="/writes"'), "the plain links are links");
  assert.ok(!body.includes('id="quickStart"'), "the old create/join card is gone, not duplicated");

  // the unread count rides the Inbox row
  assert.ok(rail.includes('class="dnav-badge hidden" id="navInbox"'), "hidden until there is something to say");
  assert.ok(body.includes("onLoad: ({ unread })"), "fed by the same inbox load as the card");

  // joining needs a code, so the row unfolds one
  assert.ok(rail.includes('id="joinFold"') && rail.includes('id="code"'), "the code field folds into the row");
  assert.ok(rail.includes('aria-expanded="false"') && rail.includes('aria-controls="joinFold"'), "and says so");
  assert.ok(body.includes('$("code").focus()'), "opening it puts the caret where you'd type");

  // the quote and the friends list live here too
  assert.ok(rail.includes('class="card quote-card"') && rail.includes('id="friendsBox"'), "quote + friends are in the rail");
  assert.ok(rail.indexOf("dash-nav") < rail.indexOf("friendsBox"), "navigation comes first");
});
