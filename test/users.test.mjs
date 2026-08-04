import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startServer, signup, startedGame } from "./helpers.mjs";

let ctx;
before(async () => (ctx = await startServer()));
after(async () => ctx.stop());

test("profile content: about html sanitized (only http img embeds survive), links, avatar", async () => {
  const u = await signup(ctx, "aboutuser1", "a1@x.com");
  const evil = await ctx.api("/api/account/profile", {
    about: "hi", links: [{ label: "x", url: "javascript:alert(1)" }],
  }, u.token);
  assert.equal(evil.status, 400, "javascript: links rejected");
  const badPic = await ctx.api("/api/account/profile", { avatar: "data:text/html,<script>" }, u.token);
  assert.equal(badPic.status, 400, "non-http profile pics rejected");

  const ok = await ctx.api("/api/account/profile", {
    about:
      'I write <b>byler</b> fics & art.\n<img src="https://img.example.com/1.png">\n' +
      '<img src="javascript:alert(1)"> <script>x()</script>',
    links: [
      { label: "AO3", url: "https://archiveofourown.org/u/me" },
      { label: "", url: "http://example.com" },
      { label: "extra", url: "https://a.com" },
      { label: "fourth", url: "https://dropped.com" },
    ],
    avatar: "https://img.example.com/me.png",
  }, u.token);
  assert.equal(ok.status, 200);
  const p = ok.data.user;
  assert.ok(p.about.includes("&lt;b&gt;byler&lt;/b&gt;"), "non-img html shows as text");
  assert.ok(p.about.includes("&amp; art"), "escaped once");
  assert.ok(p.about.includes('<img class="about-img" src="https://img.example.com/1.png"'), "http img embed survives");
  assert.ok(p.about.includes("&lt;img src=&quot;javascript:"), "javascript: img stays inert text");
  assert.ok(p.about.includes("&lt;script&gt;"), "script inert");
  assert.equal(p.avatar, "https://img.example.com/me.png");
  assert.equal(p.links.length, 3, "max three links");
  assert.equal(p.links[1].label, "http://example.com", "empty label falls back to url");
  assert.ok(!p.links.some((l) => l.url.includes("dropped")), "fourth link dropped");
});

test("avatar + fit ride everywhere: directory, profile, roster, chat, snapshot", async () => {
  const host = await signup(ctx, "avatarhost", "ah@x.com");
  const pal = await signup(ctx, "avatarpal", "ap@x.com");
  await ctx.api("/api/account/profile", {
    avatar: "https://img.example.com/host.png", avatarFit: "contain",
  }, host.token);
  const badFit = (await ctx.api("/api/account/profile", {
    avatar: "https://img.example.com/host.png", avatarFit: "sideways",
  }, host.token)).data.user;
  assert.equal(badFit.avatarFit, "cover", "unknown fit falls back to cover");
  await ctx.api("/api/account/profile", {
    avatar: "https://img.example.com/host.png", avatarFit: "contain",
  }, host.token);

  // directory + public profile carry it
  const dir = (await ctx.api("/api/users", null, pal.token, "GET")).data.users
    .find((x) => x.username === "avatarhost");
  assert.equal(dir.avatar, "https://img.example.com/host.png");
  assert.equal(dir.avatarFit, "contain");
  const prof = (await ctx.api("/api/users/avatarhost", null, pal.token, "GET")).data.user;
  assert.equal(prof.avatarFit, "contain");

  // in-game: roster (game-state) and chat messages carry it
  const A = await ctx.conn();
  const B = await ctx.conn();
  const state = { current: null };
  A.on("game-state", (st) => (state.current = st));
  const rosterP = new Promise((r) => A.on("roster", r));
  const c = await ctx.emit(A, "create-session", { auth: host.token });
  const ros = await rosterP;
  const seat = ros.writers.find((w) => w.name === "avatarhost");
  assert.equal(seat.avatar, "https://img.example.com/host.png", "roster carries the pic");
  assert.equal(seat.avatarFit, "contain");
  await ctx.emit(B, "join-session", { code: c.code, auth: pal.token });
  const chatP = new Promise((r) => B.on("chat", (m) => !m.sys && r(m)));
  A.emit("chat", { text: "look at my face" });
  const msg = await chatP;
  assert.equal(msg.avatar, "https://img.example.com/host.png", "chat messages carry the pic");
  assert.equal(msg.avatarFit, "contain");

  // snapshots persist it (rehydrated seats keep their pictures)
  const snap = JSON.parse(readFileSync(join(ctx.saveDir, c.code + ".json"), "utf-8"));
  const saved = snap.writers.find((w) => w.name === "avatarhost");
  assert.equal(saved.avatar, "https://img.example.com/host.png");
  assert.equal(saved.avatarFit, "contain");
  A.disconnect();
  B.disconnect();
});

test("writers directory: auth-gated, everyone listed with online flags", async () => {
  assert.equal((await ctx.api("/api/users")).status, 401);
  const a = await signup(ctx, "diruser1", "d1@x.com");
  await signup(ctx, "diruser2", "d2@x.com");
  const S = await ctx.conn();
  S.emit("identify", { auth: a.token });
  await ctx.wait(150);
  const { users } = (await ctx.api("/api/users", null, a.token, "GET")).data;
  const me = users.find((x) => x.username === "diruser1");
  const other = users.find((x) => x.username === "diruser2");
  assert.ok(me && other, "everyone in the database listed");
  assert.equal(me.online, true);
  assert.equal(other.online, false);
  assert.equal(users.findIndex((x) => x.online) < users.findIndex((x) => x.username === "diruser2"), true,
    "online writers sort first");
  assert.equal(JSON.stringify(users).includes("email"), false, "no emails in the directory");
  S.disconnect();
});

test("public profile: full public shape, no email/id/game codes; 404 unknown", async () => {
  const a = await signup(ctx, "profuser1", "p1@x.com");
  const viewer = await signup(ctx, "profviewer", "pv@x.com");
  await ctx.api("/api/account/profile", { about: "hello", links: [{ label: "L", url: "https://l.com" }] }, a.token);
  assert.equal((await ctx.api("/api/users/profuser1")).status, 401, "sign in to view profiles");
  assert.equal((await ctx.api("/api/users/nobody9999", null, viewer.token, "GET")).status, 404);
  const p = (await ctx.api("/api/users/PROFUSER1", null, viewer.token, "GET")).data.user;
  assert.equal(p.username, "profuser1", "lookup is case-insensitive");
  assert.equal(p.about, "hello");
  assert.equal(p.links[0].url, "https://l.com");
  assert.equal(p.currentBadge, "🔫 There. Out Loud.");
  assert.equal(p.stories, 0);
  assert.equal(p.email, undefined, "email never exposed");
  assert.equal(p.id, undefined, "account id never exposed");
  assert.equal(p.games, undefined, "game codes stay private");
});

test("profile hosted stories: running games glow-flagged, finished ones included", async () => {
  const { host, mike, A, code } = await startedGame(ctx);
  const live = (await ctx.api("/api/users/willthewise", null, mike.token, "GET")).data.hosted;
  const g1 = live.find((g) => g.code === code);
  assert.ok(g1, "hosted story listed while running");
  assert.equal(g1.inProgress, true, "running game is flagged in progress");
  await ctx.emit(A, "end-game", {});
  await ctx.wait(150);
  const done = (await ctx.api("/api/users/willthewise", null, mike.token, "GET")).data.hosted;
  const g2 = done.find((g) => g.code === code);
  assert.ok(g2, "FINISHED hosted stories stay listed");
  assert.equal(g2.phase, "over");
  assert.equal(g2.inProgress, false, "no glow once revealed");
  // the co-writer hosts nothing
  const mikes = (await ctx.api("/api/users/mikewheeler", null, host.token, "GET")).data.hosted;
  assert.ok(!mikes.some((g) => g.code === code), "only the ORIGINAL host lists it");
});
