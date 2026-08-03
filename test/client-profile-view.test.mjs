import { test } from "node:test";
import assert from "node:assert/strict";
import { ladderHtml, usageCaseHtml } from "../public/js/profile-view.js";

const TIERS = [
  { name: "🐶 Puppy Mike", min: 5000 },
  { name: "🪄 Practice", min: 10000 },
  { name: "🧙 Sorcerer", min: 20000 },
];

test("ladderHtml: earned/current/next-with-progress/locked states", () => {
  const out = ladderHtml(TIERS, {
    wordCount: 12000,
    wordBadges: ["🐶 Puppy Mike", "🪄 Practice"],
    currentBadge: "🪄 Practice",
  });
  const rows = out.split('<div class="tier').slice(1);
  assert.ok(rows[0].includes("earned") && rows[0].includes(">earned<"));
  assert.ok(rows[1].includes("current") && rows[1].includes("current rank"));
  assert.ok(rows[2].includes("60%"), "12000/20000 toward Sorcerer");
  assert.ok(rows[2].includes('width:60%'));
  assert.ok(out.includes("5,000 words"));
});

test("ladderHtml: fresh account shows first tier progress, rest locked", () => {
  const out = ladderHtml(TIERS, { wordCount: 0, wordBadges: [], currentBadge: null });
  assert.ok(out.includes("0%"));
  assert.equal((out.match(/>locked</g) || []).length, 2);
});

test("usageCaseHtml: earned chips + mystery slots, never reveals triggers", () => {
  const out = usageCaseHtml(["🐺 Omega Badge"], 4);
  assert.ok(out.includes("🐺 Omega Badge"));
  assert.equal((out.match(/hidden badge/g) || []).length, 3);
  assert.ok(!/puppy|cock|moan|michael/i.test(out));
});
