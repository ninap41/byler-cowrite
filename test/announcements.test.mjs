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
  const denied = await ctx.api("/api/admin/announcements", { title: "Nope", body: "no" }, normie.token);
  assert.equal(denied.status, 403);
  const first = await ctx.api("/api/admin/announcements", { title: "  Welcome  ", body: "Hello\n\n\n\nworld <b>bold</b>" }, admin.token);
  assert.equal(first.status, 200);
  assert.equal(first.data.post.title, "Welcome", "title is trimmed");
  assert.equal(first.data.post.body, "Hello\n\nworld bold", "tags stripped, blank-line runs collapsed");
  assert.equal(first.data.post.byName, "ninaadmin");
  const second = await ctx.api("/api/admin/announcements", { title: "Second", body: "Later." }, admin.token);
  assert.equal(second.status, 200);
  const r = await ctx.api("/api/announcements", undefined, normie.token);
  assert.deepEqual(r.data.posts.map((p) => p.title), ["Second", "Welcome"]);
  assert.ok(r.data.posts.every((p) => /^[0-9a-f-]{36}$/.test(p.id) && p.at > 0));
  // persisted: the file is the store under test
  const doc = JSON.parse(readFileSync(join(ctx.dataDir, "announcements.json"), "utf-8"));
  assert.equal(doc.posts.length, 2);
});

test("a post needs a title and a body; markup in a title is stripped, never stored", async () => {
  const noTitle = await ctx.api("/api/admin/announcements", { title: " ", body: "x" }, admin.token);
  assert.equal(noTitle.status, 400);
  const noBody = await ctx.api("/api/admin/announcements", { title: "x", body: "<img src=x>" }, admin.token);
  assert.equal(noBody.status, 400, "a body that is only markup is empty");
  const r = await ctx.api("/api/admin/announcements", { title: "<script>alert(1)</script>Hi", body: "ok" }, admin.token);
  assert.equal(r.data.post.title, "alert(1)Hi");
  await ctx.api(`/api/admin/announcements/${r.data.post.id}`, null, admin.token, "DELETE");
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
