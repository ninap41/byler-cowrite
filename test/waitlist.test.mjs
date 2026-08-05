// Account cap + waiting list: signup closes at COWRITE_MAX_USERS and the
// waitlist endpoint records emails for later invites.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startServer, signup } from "./helpers.mjs";

let ctx;
before(async () => {
  ctx = await startServer({ COWRITE_MAX_USERS: "1" });
});
after(async () => ctx.stop());

const readStore = () => JSON.parse(readFileSync(join(ctx.dataDir, "users.json"), "utf-8"));

test("signup under the cap works; at the cap it refuses with capReached", async () => {
  await signup(ctx); // fills the only seat
  const r = await ctx.api("/api/signup", {
    email: "mike@wheeler.com", username: "mikewheeler", password: "1234",
  });
  assert.equal(r.status, 403);
  assert.equal(r.data.capReached, true);
  assert.match(r.data.error, /waiting list/i);
});

test("waitlist stores the entry shape: accessGranted false, signupLink null", async () => {
  const r = await ctx.api("/api/waitlist", { email: "Mike@Wheeler.com" });
  assert.equal(r.status, 200);
  const entry = readStore().waitlist.find((w) => w.email === "mike@wheeler.com");
  assert.ok(entry, "entry saved, email lowercased");
  assert.equal(entry.accessGranted, false);
  assert.equal(entry.signupLink, null);
});

test("duplicate waitlist emails are a no-op, not a second entry", async () => {
  const r = await ctx.api("/api/waitlist", { email: "mike@wheeler.com" });
  assert.equal(r.status, 200);
  const entries = readStore().waitlist.filter((w) => w.email === "mike@wheeler.com");
  assert.equal(entries.length, 1);
});

test("waitlist rejects invalid emails and emails that already have accounts", async () => {
  const bad = await ctx.api("/api/waitlist", { email: "not-an-email" });
  assert.equal(bad.status, 400);
  const has = await ctx.api("/api/waitlist", { email: "will@byers.com" }); // the signup fixture's account
  assert.equal(has.status, 400);
  assert.match(has.data.error, /already has an account/i);
});
