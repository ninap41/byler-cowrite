// The fandom content pack is one directory behind one env var, so an alternate
// fandom swaps prompts/achievements/quotes without touching code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { startServer } from "./helpers.mjs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const FILES = ["prompts.json", "achievements.json", "quotes.json"];

test("the default pack is <root>/content and holds all three files", async () => {
  const { CONTENT_DIR, contentPath } = await import("../src/content.js");
  assert.equal(resolve(CONTENT_DIR), join(ROOT, "content"));
  for (const f of FILES) assert.ok(existsSync(contentPath(f)), `${f} is in the pack`);
});

test("COWRITE_CONTENT_DIR points the pack elsewhere", () => {
  const out = execFileSync(process.execPath, [
    "--input-type=module", "-e",
    'import { CONTENT_DIR, contentPath } from "./src/content.js"; console.log(CONTENT_DIR, contentPath("quotes.json"));',
  ], { cwd: ROOT, env: { ...process.env, COWRITE_CONTENT_DIR: "/tmp/otherpack" }, encoding: "utf-8" });
  assert.equal(out.trim(), "/tmp/otherpack /tmp/otherpack/quotes.json");
});

test("the app's name derives from the fandom when the pack doesn't name it", async () => {
  const { mkdtempSync, writeFileSync, cpSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "pack-"));
  cpSync(new URL("../content/", import.meta.url), dir, { recursive: true });
  writeFileSync(join(dir, "site.json"), JSON.stringify({ fandom: "Heated Rivalry", tagline: "t", blurb: "b" }));
  const ctx = await startServer({ COWRITE_CONTENT_DIR: dir });
  try {
    const html = await fetch(ctx.url + "/").then((r) => r.text());
    assert.ok(html.includes('<meta name="site-name" content="Heated Rivalry Cowrite"'), "Heated Rivalry Cowrite");
    assert.ok(html.includes('y="110">Heated Rivalry<'), "the hero writes the fandom");
  } finally {
    await ctx.stop();
  }
});
