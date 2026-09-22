// A publish or a VM restart sends SIGTERM. The server answers reads from
// memory and queues its database writes, so it must flush before it goes —
// exiting on the spot is how a saved story rolls back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startServer, signup } from "./helpers.mjs";

test("SIGTERM: the server flushes storage, then exits cleanly, and what was saved is on disk", async () => {
  const ctx = await startServer();
  const alice = await signup(ctx, "aliceauthor", "alice@byers.com");
  const doc = (await ctx.api("/api/docs", { title: "Last words" }, alice.token)).data.doc;
  const saved = await ctx.api("/api/docs/" + doc.id, { html: "<p>the last thing I wrote</p>" }, alice.token, "PUT");
  assert.equal(saved.status, 200);
  const { code, out } = await ctx.term();
  assert.equal(code, 0);
  assert.match(out, /SIGTERM: flushing storage before exit/);
  assert.ok(readFileSync(`${ctx.dataDir}/docs/${doc.id}.json`, "utf-8").includes("the last thing I wrote"));
  await ctx.stop();
});

test("server.js: both signals are handled, the flush is awaited, and a database that never answers can't hold the exit forever", () => {
  const src = readFileSync(new URL("../server.js", import.meta.url), "utf-8");
  assert.match(src, /process\.on\("SIGTERM"/);
  assert.match(src, /process\.on\("SIGINT"/);
  assert.match(src, /await storage\.flush\(\)/);
  assert.match(src, /setTimeout\([\s\S]{0,200}process\.exit\(1\)[\s\S]{0,40}, 8000\)/);
});
