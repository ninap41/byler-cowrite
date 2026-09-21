// lib/doc-history.js — which copies of a story are kept. Pure rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { keepReason, pruneHistory, RECENT_GAP_MS, RECENT_KEEP, KEEP_DAYS, DROP_KEEP, DROP_WORDS } from "../lib/doc-history.js";

const MIN = 60 * 1000, DAY = 24 * 60 * MIN;
const NOW = Date.UTC(2026, 8, 21, 18, 0, 0);
const e = (agoMs, reason = "time", words = 1000) => ({ at: NOW - agoMs, reason, words, chapters: 1 });

test("history is spaced by time: thirty-second autosaves don't each leave a copy", () => {
  const prev = { words: 1000, chapters: 1 }, next = { words: 1010, chapters: 1 };
  assert.equal(keepReason([], prev, next, NOW), "time", "the first save of a story with words in it");
  assert.equal(keepReason([e(30 * 1000)], prev, next, NOW), null, "thirty seconds later: no");
  assert.equal(keepReason([e(RECENT_GAP_MS - 1)], prev, next, NOW), null);
  assert.equal(keepReason([e(RECENT_GAP_MS)], prev, next, NOW), "time");
  assert.equal(keepReason([], { words: 0, chapters: 1 }, next, NOW), null, "an empty story is nothing to go back to");
});

test("a save that loses a lot of words, or a chapter, always keeps the copy before it", () => {
  const justKept = [e(5 * 1000)];
  assert.equal(keepReason(justKept, { words: 17000, chapters: 3 }, { words: 14000, chapters: 3 }, NOW), "drop", "the incident: 3k words gone in one save");
  assert.equal(keepReason(justKept, { words: 1000, chapters: 3 }, { words: 1000, chapters: 2 }, NOW), "drop", "a chapter went");
  assert.equal(keepReason(justKept, { words: 1000, chapters: 1 }, { words: 1000 - DROP_WORDS, chapters: 1 }, NOW), null, "ordinary cutting is not an accident");
  assert.equal(keepReason(justKept, { words: 1000, chapters: 1 }, { words: 1000 - DROP_WORDS - 1, chapters: 1 }, NOW), "drop");
});

test("pruning keeps a few hours copy by copy, then one a day, and nothing past the window", () => {
  // a copy every ten minutes for three days
  const entries = Array.from({ length: 3 * 24 * 6 }, (_, i) => e(i * 10 * MIN));
  const kept = pruneHistory(entries, NOW);
  const recent = kept.filter((x) => NOW - x.at < RECENT_KEEP * 10 * MIN);
  assert.equal(recent.length, RECENT_KEEP);
  const older = kept.filter((x) => NOW - x.at >= RECENT_KEEP * 10 * MIN);
  assert.ok(older.length >= 2 && older.length <= 4, `one a day behind the recent run, got ${older.length}`);
  assert.deepEqual(kept.map((x) => x.at), [...kept.map((x) => x.at)].sort((a, b) => a - b), "oldest first");
  assert.deepEqual(pruneHistory([e((KEEP_DAYS + 1) * DAY)], NOW), [], "past the window: gone");
});

test("pruning never lets ordinary copies push out the one from before an accident", () => {
  const accident = e(6 * DAY + 3 * 60 * MIN, "drop", 17000);
  const sameDayLater = e(6 * DAY, "time", 14000); // the day's LAST copy is the damaged one
  const busy = Array.from({ length: 200 }, (_, i) => e(i * 10 * MIN));
  const kept = pruneHistory([accident, sameDayLater, ...busy], NOW);
  assert.ok(kept.includes(accident), "the daily tier alone would have kept only the damaged copy");
  const many = Array.from({ length: DROP_KEEP + 5 }, (_, i) => e(i * 60 * MIN + 13 * DAY / 2, "drop"));
  assert.equal(pruneHistory(many, NOW).filter((x) => x.reason === "drop").length >= DROP_KEEP, true);
});
