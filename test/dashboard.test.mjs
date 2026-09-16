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

test("the dashboard rail is navigation: inbox count, then Cowrite / Solo writes / Account flyouts, AO3, Admin, Other games, Invite", async () => {
  const body = await fetch(ctx.url + "/dashboard").then((r) => r.text());
  const script = await fetch(ctx.url + "/js/pages/dashboard.js").then((r) => r.text()); // the page's script, emitted from client/pages/dashboard.ts
  const rail = body.slice(body.indexOf("============ RAIL"));

  // every destination is a row in one nav, not a card of its own
  assert.ok(rail.includes('<nav class="card dash-nav" id="railNav"'), "one nav column");
  for (const id of ["navInbox", "railCowrite", "railSolo", "railAccount", "createBtn", "joinOpen", "soloBtn", "railAdmin", "inviteBtn", "joinModal", "code", "joinBtn", "lobbyErr", "joinLive"])
    assert.ok(rail.includes(`id="${id}"`), id + " is in the rail");
  assert.ok(rail.includes('href="/inbox"'), "the plain links are links");
  assert.ok(!body.includes('id="quickStart"'), "the old create/join card is gone, not duplicated");
  const at = (needle) => { const i = rail.indexOf(needle); assert.ok(i >= 0, needle + " present"); return i; };
  assert.ok(at('id="railCowrite"') < at('id="railSolo"') && at('id="railSolo"') < at('id="railAccount"') && at('id="railAccount"') < at("dnav-glow") && at("dnav-glow") < at('id="railAdmin"') && at('id="railAdmin"') < at('href="/games"') && at('href="/games"') < at('id="inviteBtn"'), "Inbox, Cowrite, Solo writes, Account, AO3, Admin, Other games, Invite");

  // a parent row is a menu button; its panel is a menu (components/nav-flyout.js)
  assert.match(rail, /id="railCowrite" aria-haspopup="menu" aria-expanded="false" aria-controls="railCowriteMenu"/);
  assert.ok(rail.includes('id="railCowriteMenu" role="menu"'));
  assert.match(rail, /<span class="dnav-ico" aria-hidden="true">👥<\/span><span class="dnav-label">Cowrite<\/span>/, "Cowrite wears a people icon: this is the co-writing mode");
  for (const href of ["/game?new=1", "/archive", "/stories?kind=game", "/writes", "/profile", "/settings"]) assert.ok(rail.includes(`href="${href}"`), href + " is a submenu item");
  assert.ok(rail.includes('class="dnav hidden" id="railAdmin"'), "Admin is hidden until the account says so");
  assert.match(script, /admin: !!me\?\.admin/, "and the page reveals it for an admin");

  // the unread count rides the Inbox row
  assert.ok(rail.includes('class="dnav-badge hidden" id="navInbox"'), "hidden until there is something to say");
  assert.match(script, /b\.classList\.toggle\("hidden", !unread\)/, "the badge appears only when something is waiting");

  // joining needs a code, so it opens a modal — the code field plus the games running now
  const modal = rail.slice(rail.indexOf('id="joinModal"'), rail.indexOf('class="card friends-card"'));
  assert.ok(modal.includes('id="code"') && modal.includes('id="joinBtn"') && modal.includes('id="joinLive"'), "the code field and the live list are in the modal");
  assert.ok(!rail.includes('id="joinFold"'), "the inline fold is gone");
  assert.ok(script.includes('$("code").focus()'), "opening it puts the caret where you'd type");
  assert.match(script, /lastLive = d\.liveGames/, "the modal's list is the dashboard poll's");

  // the flyout CSS follows the .hidden source-order rule and never animates forever
  const css = await fetch(ctx.url + "/css/dashboard.css").then((r) => r.text());
  for (const twin of [".dnav.hidden {", ".dnav-sub.hidden {", ".dnav-wrap.hidden {"]) assert.ok(css.includes(twin), twin + " twin");
  assert.ok(!/\.dnav-sub[^{]*\{[^}]*infinite/.test(css), "a flyout entrance is finite");

  // the friends card sits between the nav and the quote in the rail; the
  // writers directory is a full-width card of its own in the main column
  assert.ok(rail.includes('class="card quote-card"'), "the quote is in the rail");
  assert.ok(rail.includes('id="friendsBox"'), "and so are friends");
  assert.ok(rail.indexOf('class="card dash-nav"') < rail.indexOf('class="card friends-card"') && rail.indexOf('class="card friends-card"') < rail.indexOf('class="card quote-card"'), "nav, friends, quote");
  const main = body.slice(0, body.indexOf("============ RAIL"));
  assert.ok(main.includes('id="writerSearch"') && !main.includes("writers-split"), "writers span their own card");
});
