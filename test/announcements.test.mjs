// /announcements — the admin's blog. Reading needs an account; posting and
// deleting need admin, and every admin power is paired with the "a normal
// account can't" assertion, like admin.test.mjs.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startServer, signup } from "./helpers.mjs";

const ADMIN_EMAIL = "admin@cowrite.test";
let ctx, admin, normie;
before(async () => {
  ctx = await startServer();
  admin = await signup(ctx, "ninaadmin", ADMIN_EMAIL);
  normie = await signup(ctx, "lucassinclair", "lucas@sinclair.com");
});
after(async () => ctx.stop());

test("reading needs an account; the payload says whether the reader is an admin", async () => {
  const anon = await ctx.api("/api/announcements", undefined);
  assert.equal(anon.status, 401);
  const r = await ctx.api("/api/announcements", undefined, normie.token);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { posts: [], admin: false });
  const a = await ctx.api("/api/announcements", undefined, admin.token);
  assert.equal(a.data.admin, true);
});

test("an admin posts; a normal account can't; everyone then reads it, newest first", async () => {
  const denied = await ctx.api("/api/admin/announcements", { html: "<h1>Nope</h1>" }, normie.token);
  assert.equal(denied.status, 403);
  const first = await ctx.api("/api/admin/announcements", { html: '<h2>  Welcome <i>all</i> </h2><p>Hello <b>world</b></p><img src=x onerror=1><script>x()</script>' }, admin.token);
  assert.equal(first.status, 200);
  assert.equal(first.data.post.title, "Welcome all", "the first heading, as text, is the title");
  assert.ok(first.data.post.html.includes("<h2>") && first.data.post.html.includes("<b>world</b>"), "formatting kept");
  assert.ok(!first.data.post.html.includes("<img") && !first.data.post.html.includes("<script>"), "sanitizeRich ran");
  assert.equal(first.data.post.byName, "ninaadmin");
  const second = await ctx.api("/api/admin/announcements", { html: "<p>Second</p>" }, admin.token);
  assert.equal(second.status, 200);
  const r = await ctx.api("/api/announcements", undefined, normie.token);
  assert.deepEqual(r.data.posts.map((p) => p.title), ["Second", "Welcome all"]);
  assert.ok(r.data.posts.every((p) => /^[0-9a-f-]{36}$/.test(p.id) && p.at > 0));
  // persisted: the file is the store under test
  const doc = JSON.parse(readFileSync(join(ctx.dataDir, "announcements.json"), "utf-8"));
  assert.equal(doc.posts.length, 2);
});

test("a post needs words; without a heading the opening words become the title", async () => {
  const empty = await ctx.api("/api/admin/announcements", { html: "<p> </p><br><h2></h2>" }, admin.token);
  assert.equal(empty.status, 400, "markup with no text is empty");
  const r = await ctx.api("/api/admin/announcements", { html: "<p>No heading here,</p><p>just a paragraph or two.</p>" }, admin.token);
  assert.equal(r.data.post.title, "No heading here, just a paragraph or two.");
  const long = await ctx.api("/api/admin/announcements", { html: "<p>" + "word ".repeat(60) + "</p>" }, admin.token);
  assert.ok(long.data.post.title.length <= 120 && long.data.post.title.endsWith("…"), "cut on a word with an ellipsis");
  await ctx.api(`/api/admin/announcements/${r.data.post.id}`, null, admin.token, "DELETE");
  await ctx.api(`/api/admin/announcements/${long.data.post.id}`, null, admin.token, "DELETE");
});

test("an admin deletes; a normal account can't; an unknown id is a 404", async () => {
  const list = await ctx.api("/api/announcements", undefined, admin.token);
  const id = list.data.posts[0].id;
  const denied = await ctx.api(`/api/admin/announcements/${id}`, null, normie.token, "DELETE");
  assert.equal(denied.status, 403);
  assert.equal((await ctx.api("/api/announcements", undefined, normie.token)).data.posts.length, 2, "still there");
  const ok = await ctx.api(`/api/admin/announcements/${id}`, null, admin.token, "DELETE");
  assert.equal(ok.status, 200);
  assert.equal((await ctx.api("/api/announcements", undefined, normie.token)).data.posts.length, 1);
  const gone = await ctx.api(`/api/admin/announcements/${id}`, null, admin.token, "DELETE");
  assert.equal(gone.status, 404);
});

test("the page is served at /announcements with the site name filled in", async () => {
  const html = await fetch(ctx.url + "/announcements").then((r) => r.text());
  assert.ok(html.includes("announcements-view.js"));
  assert.ok(!html.includes("{{SITE_NAME}}"));
});
