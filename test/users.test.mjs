import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, signup } from "./helpers.mjs";

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
