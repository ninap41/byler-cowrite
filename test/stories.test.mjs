// Admin flag + the all-stories read-only listing endpoints.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startServer, signup, startedGame } from "./helpers.mjs";

let ctx;
before(async () => {
  ctx = await startServer();
});
after(async () => ctx.stop());

test("admin boolean: only the two listed emails get it, at signup", async () => {
  const admin = await ctx.api("/api/signup", {
    email: "admin2@cowrite.test", username: "kipthedev", password: "1234",
  });
  assert.equal(admin.status, 200);
  assert.equal(admin.data.user.admin, true);
  const normie = await signup(ctx, "dustinbun", "dustin@henderson.com");
  assert.equal(normie.user.admin, false);
});

test("admin email can't be claimed via the email-change route", async () => {
  const u = await signup(ctx, "steveharrington", "steve@harrington.com");
  const r = await ctx.api("/api/account/email", { email: "admin@cowrite.test", password: "1234" }, u.token);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /reserved/i);
});

test("all-stories listing: auth-gated, visible to non-participants, tags array, word count, pagination", async () => {
  const { code } = await startedGame(ctx);
  const anon = await ctx.api("/api/stories");
  assert.equal(anon.status, 401);

  // an account with NO seat in the game can still list and read it
  const reader = await signup(ctx, "readeronly", "reader@only.com");
  const r = await ctx.api("/api/stories?limit=1&page=1", undefined, reader.token);
  assert.equal(r.status, 200);
  assert.equal(r.data.stories.length, 1);
  assert.ok(r.data.total >= 1);
  assert.equal(r.data.page, 1);
  const g = r.data.stories.find((s) => s.code === code) ||
    (await ctx.api("/api/stories?limit=50", undefined, reader.token)).data.stories.find((s) => s.code === code);
  assert.ok(g, "the started game is listed");
  assert.deepEqual(g.tags, []);
  assert.equal(typeof g.wordCount, "number");
  assert.ok(g.createdAt > 0);

  const detail = await ctx.api("/api/stories/" + code, undefined, reader.token);
  assert.equal(detail.status, 200);
  assert.ok(Array.isArray(detail.data.story));

  // search by title: garbage query matches nothing
  const none = await ctx.api("/api/stories?q=zzzznotitle", undefined, reader.token);
  assert.equal(none.data.total, 0);

  // the snapshot on disk carries the tags field
  const snap = JSON.parse(readFileSync(join(ctx.saveDir, code + ".json"), "utf-8"));
  assert.deepEqual(snap.tags, []);
});

test("tags: writers can set them, cleaned + deduped; outsiders can't", async () => {
  const { host, mike, code } = await startedGame(ctx);
  // a writer (not just the host) can tag; #s strip, dupes collapse, blanks drop
  const r = await ctx.api("/api/games/" + code + "/tags",
    { tags: ["#fluff", "fluff", "FLUFF", "  ", "slow burn", "<b>angst</b>"] }, mike.token);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.tags, ["fluff", "slow burn", "angst"]);
  // persisted: the listing carries them and the tag filter finds them
  const listed = (await ctx.api("/api/stories?tag=fluff&limit=50", undefined, host.token)).data;
  assert.ok(listed.stories.some((s) => s.code === code));
  // an account with no seat is refused
  const outsider = await signup(ctx, "nottheauthor", "not@author.com");
  const deny = await ctx.api("/api/games/" + code + "/tags", { tags: ["hax"] }, outsider.token);
  assert.equal(deny.status, 403);
});

test("word-count sort direction is respected", async () => {
  const reader = await ctx.api("/api/login", { user: "readeronly", password: "1234" });
  const asc = await ctx.api("/api/stories?sort=words&dir=asc&limit=50", undefined, reader.data.token);
  const counts = asc.data.stories.map((s) => s.wordCount);
  assert.deepEqual(counts, [...counts].sort((a, b) => a - b));
});
