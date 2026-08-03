import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WORD_TIERS, USAGE, badgeName, isUsageId, usageMatches,
  awardWordBadges, nextTierFor, migrateBadges,
} from "../lib/achievements.js";

// ---- trigger matcher ----
test("usage matcher: word boundaries block cocktail/peacock", () => {
  assert.deepEqual(usageMatches("a cocktail at the peacock lounge"), []);
  assert.deepEqual(usageMatches("just the cock crowing at dawn"), ["justthetip"]);
});

test("usage matcher: case-insensitive, phrase forms, rich-text-stripped input", () => {
  assert.deepEqual(usageMatches("PUPPY Mike padded closer"), ["omega"]);
  assert.deepEqual(usageMatches("a soft moan escaped"), ["smuttybuddy"]);
  assert.deepEqual(usageMatches("he was moaning about chores"), ["smuttybuddy"]);
  assert.deepEqual(usageMatches("moans everywhere"), [], "only the listed forms count");
});

test('usage matcher: "Michael?" requires the question mark', () => {
  assert.deepEqual(usageMatches("Michael? Will whispered."), ["ughmike"]);
  assert.deepEqual(usageMatches("Michael walked in."), []);
  assert.deepEqual(usageMatches("michael?!"), ["ughmike"]);
});

test("usage matcher: one line can earn several", () => {
  assert.deepEqual(usageMatches('"Michael?" the puppy moaning softly'), ["omega", "smuttybuddy", "ughmike"]);
});

// ---- word ladder ----
test("ladder: tiers award at thresholds, currentBadge is the highest", () => {
  const u = { wordCount: 0, badges: [] };
  awardWordBadges(u);
  assert.equal(badgeName(u.currentBadge), "🔫 There. Out Loud.", "starter badge at 0 words");
  u.wordCount = 4999;
  awardWordBadges(u);
  assert.equal(badgeName(u.currentBadge), "🔫 There. Out Loud.", "no new tier before 5000");
  u.wordCount = 5000;
  awardWordBadges(u);
  assert.equal(badgeName(u.currentBadge), "🐶 Puppy Mike");
  u.wordCount = 100000;
  awardWordBadges(u);
  assert.equal(badgeName(u.currentBadge), '💛 A Best "Friend"');
  u.wordCount = 150000;
  awardWordBadges(u);
  assert.equal(badgeName(u.currentBadge), "🌀 Crazy Together");
  assert.equal(u.badges.length, WORD_TIERS.length, "every tier collected on the way");
  assert.equal(nextTierFor(u), null, "ladder topped out");
});

test("usage ids are distinct from word tiers and flagged", () => {
  for (const b of USAGE) assert.equal(isUsageId(b.id), true);
  for (const t of WORD_TIERS) assert.equal(isUsageId(t.id), false);
});

// ---- migration ----
test("migrateBadges drops legacy ids and recomputes from wordCount", () => {
  const u = { wordCount: 12000, badges: ["inkling", "scribbler", "legend"], currentBadge: "legend" };
  assert.equal(migrateBadges(u), true);
  assert.deepEqual(u.badges, ["outloud", "puppymike", "practice"]);
  assert.equal(badgeName(u.currentBadge), "🪄 Practice");
  // keeps already-earned usage badges
  const v = { wordCount: 0, badges: ["omega", "wordsmith"], currentBadge: "wordsmith" };
  migrateBadges(v);
  assert.deepEqual(v.badges, ["omega", "outloud"]);
  assert.equal(badgeName(v.currentBadge), "🔫 There. Out Loud.");
  // idempotent
  assert.equal(migrateBadges(v), false);
});
