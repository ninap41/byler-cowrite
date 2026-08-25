// Random story titles: the pure generator and the content pack's bank.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomTitle, MAX_TITLE } from "../lib/titles.js";
import { createSeededRandom } from "../lib/prompt-gen.js";

const BANK = JSON.parse(readFileSync(new URL("../content/titles.json", import.meta.url), "utf-8"));

test("every title is non-empty, tidy, and at most 40 characters", () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const t = randomTitle(BANK, createSeededRandom("t" + i));
    assert.ok(t.length > 0 && t.length <= MAX_TITLE, t);
    assert.equal(t, t.trim());
    assert.ok(!/\{|\}|\s{2}/.test(t), "no unfilled slot or double space: " + t);
    seen.add(t);
  }
  assert.ok(seen.size > 300, "plenty of variety: " + seen.size);
  assert.equal(MAX_TITLE, 40);
});

test("a long pattern is cut on a word; a missing bank still names the story", () => {
  const bank = { patterns: ["{noun} {noun} {noun} {noun} {noun}"], noun: ["Extraordinary"] };
  const t = randomTitle(bank, () => 0);
  assert.ok(t.length <= 40 && !t.endsWith(" ") && t.endsWith("Extraordinary"), t);
  assert.equal(randomTitle(null), "Untitled");
  assert.equal(randomTitle({ patterns: ["{nope} thing"] }), "thing");
});
