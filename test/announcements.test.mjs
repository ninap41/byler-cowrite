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
  const denied = await ctx.api("/api/admin/announcements", { markdown: "# Nope" }, normie.token);
  assert.equal(denied.status, 403);
  const first = await ctx.api("/api/admin/announcements", { markdown: '## Welcome *all*\n\nHello **world**\n<img src=x onerror=1><script>x()</script>' }, admin.token);
  assert.equal(first.status, 200);
  assert.equal(first.data.post.title, "Welcome all", "the first heading, as text, is the title");
  assert.ok(first.data.post.html.includes("<h2>") && first.data.post.html.includes("<b>world</b>"), "markdown rendered");
  assert.ok(first.data.post.markdown.startsWith("## Welcome"), "the markdown source is kept for the Discord bot");
  assert.ok(!first.data.post.html.includes("<img") && !first.data.post.html.includes("<script>"), "raw html in the markdown is inert");
  assert.equal(first.data.post.byName, "ninaadmin");
  const second = await ctx.api("/api/admin/announcements", { markdown: "Second" }, admin.token);
  assert.equal(second.status, 200);
  const r = await ctx.api("/api/announcements", undefined, normie.token);
  assert.deepEqual(r.data.posts.map((p) => p.title), ["Second", "Welcome all"]);
  assert.ok(r.data.posts.every((p) => /^[0-9a-f-]{36}$/.test(p.id) && p.at > 0));
  // persisted: the file is the store under test
  const doc = JSON.parse(readFileSync(join(ctx.dataDir, "announcements.json"), "utf-8"));
  assert.equal(doc.posts.length, 2);
  // and every account got a note about each post
  const ib = await ctx.api("/api/inbox", undefined, normie.token);
  const notes = ib.data.messages.filter((m) => m.type === "system" && /New announcement/.test(m.text));
  assert.equal(notes.length, 2);
  assert.match(notes[0].text, /“Second”/);
});

test("a post needs words; without a heading the opening words become the title", async () => {
  const empty = await ctx.api("/api/admin/announcements", { markdown: "  \n\n" }, admin.token);
  assert.equal(empty.status, 400, "markup with no text is empty");
  const r = await ctx.api("/api/admin/announcements", { markdown: "No heading here,\n\njust a paragraph or two." }, admin.token);
  assert.equal(r.data.post.title, "No heading here, just a paragraph or two.");
  const long = await ctx.api("/api/admin/announcements", { markdown: "word ".repeat(60) }, admin.token);
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

test("an admin can edit a post in place (same id and date, re-rendered and re-sanitized, marked edited); a normal account can't", async () => {
  const normie = await signup(ctx, "annednormie", "annednormie@x.com");
  const made = await ctx.api("/api/admin/announcements", { markdown: "# First\n\nhello" }, admin.token);
  const id = made.data.post.id;
  const denied = await ctx.api("/api/admin/announcements/" + id, { markdown: "# Hijack" }, normie.token, "PUT");
  assert.equal(denied.status, 403);
  const edited = await ctx.api("/api/admin/announcements/" + id, { markdown: "# Second\n\n**bold** <script>x()</script>" }, admin.token, "PUT");
  assert.equal(edited.status, 200);
  assert.equal(edited.data.post.id, id);
  assert.equal(edited.data.post.at, made.data.post.at, "the date is the original's");
  assert.equal(edited.data.post.title, "Second");
  assert.ok(edited.data.post.html.includes("<b>bold</b>") && !edited.data.post.html.includes("<script>"));
  assert.ok(edited.data.post.editedAt > 0);
  const empty = await ctx.api("/api/admin/announcements/" + id, { markdown: "   " }, admin.token, "PUT");
  assert.equal(empty.status, 400);
  assert.equal((await ctx.api("/api/admin/announcements/nope", { markdown: "x" }, admin.token, "PUT")).status, 404);
  const list = await ctx.api("/api/announcements", undefined, normie.token);
  assert.equal(list.data.posts.find((p) => p.id === id).title, "Second");
});
