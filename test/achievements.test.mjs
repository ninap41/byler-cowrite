import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// setAchievements() WRITES the pack file, so this file runs against a temp
// copy of content/ — the repo's achievements.json is never touched.
const contentDir = join(mkdtempSync(join(tmpdir(), "cowrite-ach-")), "content");
cpSync(new URL("../content", import.meta.url), contentDir, { recursive: true });
process.env.COWRITE_CONTENT_DIR = contentDir;
const {
  WORD_TIERS, USAGE, badgeName, isUsageId, usageMatches,
  awardWordBadges, nextTierFor, migrateBadges,
  FEATURE_UNLOCKS, FEATURE_LABELS, tierForFeature, canUseFeature, unlockedFeatures, featureLocks,
  rewardsForTier, describeRewards, validateAchievements,
} = await import("../lib/achievements.js");

test("features are rank rewards like themes: the reference palette gates at puppymike, admins pass, unknown ids are free", () => {
  assert.deepEqual(FEATURE_UNLOCKS, { reference: "puppymike" });
  assert.equal(tierForFeature("reference"), "puppymike");
  assert.equal(tierForFeature("nope"), null);
  assert.equal(canUseFeature({ badges: [] }, "reference"), false);
  assert.equal(canUseFeature({ badges: ["puppymike"] }, "reference"), true);
  assert.equal(canUseFeature({ admin: true, badges: [] }, "reference"), true);
  assert.equal(canUseFeature(null, "nope"), true);
  assert.deepEqual(unlockedFeatures({ badges: [] }), []);
  assert.deepEqual(unlockedFeatures({ badges: ["puppymike"] }), ["reference"]);
  assert.equal(featureLocks().reference.min, 5000);
  const r = rewardsForTier("puppymike");
  assert.deepEqual(r.features, [{ id: "reference", name: FEATURE_LABELS.reference }]);
  assert.match(describeRewards(r), /and the Writers' reference palette$/);
  assert.equal(validateAchievements({ wordTiers: WORD_TIERS, featureUnlocks: "x" }).filter((e) => e.startsWith("featureUnlocks")).length, 1);
});

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

test("usage matcher: combos need every word of one combination, any order", () => {
  assert.deepEqual(usageMatches("this is crazy"), [], "half a combo is nothing");
  assert.deepEqual(usageMatches("we stick together"), [], "the other half alone is nothing too");
  assert.deepEqual(usageMatches("crazier altogether"), [], "whole words only");
  assert.deepEqual(usageMatches("If we're both going CRAZY, we go crazy together."), ["crazycombo"]);
  assert.deepEqual(usageMatches("together, then, and a little crazy"), ["crazycombo"], "order-free");
});

test("usage matcher: combos and plain triggers can fire from the same line", () => {
  assert.deepEqual(usageMatches("the puppy went crazy together with Will").sort(), ["crazycombo", "omega"]);
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

// ---- the live catalogue ----
test("validateAchievements: ids are slugs and unique, ranks need a 0 rung and word counts, trigger lists are lists", async () => {
  const { validateAchievements, getAchievements } = await import("../lib/achievements.js");
  const base = structuredClone(getAchievements());
  assert.deepEqual(validateAchievements(base), [], "the shipped catalogue validates");
  assert.ok(validateAchievements(null).length);
  assert.ok(validateAchievements({ ...base, wordTiers: [] }).some((e) => /at least one rank/.test(e)));
  assert.ok(validateAchievements({ ...base, wordTiers: base.wordTiers.filter((t) => t.min !== 0) }).some((e) => /start at 0/.test(e)));
  assert.ok(validateAchievements({ ...base, wordTiers: [...base.wordTiers, { id: "Bad Id", name: "x", min: 1 }] }).some((e) => /valid id/.test(e)));
  assert.ok(validateAchievements({ ...base, wordTiers: [...base.wordTiers, { id: base.wordTiers[0].id, name: "x", min: 1 }] }).some((e) => /used twice/.test(e)));
  assert.ok(validateAchievements({ ...base, wordTiers: [...base.wordTiers, { id: "newrank", name: "x", min: "lots" }] }).some((e) => /word count/.test(e)));
  assert.deepEqual(validateAchievements({ ...base, usage: [...base.usage, { id: "quiet", name: "🤫 Quiet" }] }), [], "a trigger-less badge is legal, it can be awarded by an event");
  assert.ok(validateAchievements({ ...base, usage: [...base.usage, { id: "quiet", name: "🤫 Quiet", triggers: "shh" }] }).some((e) => /list of words/.test(e)));
  assert.ok(validateAchievements({ ...base, usage: [...base.usage, { id: "nameless", triggers: ["x"] }] }).some((e) => /needs a name/.test(e)));
});

test("setAchievements swaps the catalogue in live: a new trigger matches at once, a new rank is on the ladder, and a bad document changes nothing", async () => {
  const lib = await import("../lib/achievements.js");
  const before = structuredClone(lib.getAchievements());
  try {
    assert.deepEqual(lib.usageMatches("the demogorgon is loose"), []);
    const next = structuredClone(before);
    next.usage.push({ id: "demogorgon", name: "👾 Demogorgon", triggers: ["demogorgon"], desc: "Name the monster." });
    next.wordTiers.push({ id: "eleven", name: "🧇 Eleven", min: 11, desc: "Eleven words." });
    assert.deepEqual(lib.setAchievements(next), []);
    assert.deepEqual(lib.usageMatches("the demogorgon is loose"), ["demogorgon"], "the matcher was rebuilt");
    assert.equal(lib.badgeName("demogorgon"), "👾 Demogorgon");
    assert.ok(lib.isUsageId("demogorgon"));
    assert.ok(lib.WORD_TIERS.some((t) => t.id === "eleven"), "the exported binding is live");
    const u = { wordCount: 12, badges: [] };
    lib.awardWordBadges(u);
    assert.ok(u.badges.includes("eleven"), "a new rank awards from the word count");
    assert.deepEqual(lib.WORD_TIERS.map((t) => t.min), [...lib.WORD_TIERS.map((t) => t.min)].sort((a, b) => a - b), "ranks are kept in ladder order");
    // a bad document is refused and the live catalogue is untouched
    const bad = structuredClone(lib.getAchievements());
    bad.usage.push({ id: "nope" });
    assert.ok(lib.setAchievements(bad).length);
    assert.ok(lib.isUsageId("demogorgon") && !lib.isUsageId("nope"));
  } finally {
    lib.setAchievements(before);
    assert.deepEqual(lib.usageMatches("the demogorgon is loose"), []);
  }
});
