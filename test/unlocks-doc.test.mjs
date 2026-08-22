// UNLOCKS.md is documentation-as-data, like fonts.json: the real unlock
// order lives in achievements.json (wordTiers + themeUnlocks) and
// lib/gimmicks.js (a gimmick rides its theme). This test re-derives the
// doc's two tables from the data and fails if the two drift — change the
// data and update UNLOCKS.md in the same commit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GIMMICKS } from "../lib/gimmicks.js";
import { WORD_TIERS, THEME_UNLOCKS } from "../lib/achievements.js";
import { THEMES } from "../public/js/theme.js";

const DOC = readFileSync(new URL("../UNLOCKS.md", import.meta.url), "utf-8");

// every `| a | b | c |` row of the section that starts at `heading`
function tableRows(heading) {
  const start = DOC.indexOf(heading);
  assert.ok(start !== -1, `UNLOCKS.md still has the section ${heading}`);
  const section = DOC.slice(start, DOC.indexOf("\n## ", start + heading.length));
  return section
    .split("\n")
    .filter((l) => l.trim().startsWith("|"))
    .slice(2) // header + divider
    .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
}
const codes = (cell) => [...cell.matchAll(/`([a-z0-9]+)`/g)].map((m) => m[1]);

test("the rank ladder table matches wordTiers: same ids, same order, same names, same word counts", () => {
  const rows = tableRows("## Rank ladder");
  assert.equal(rows.length, WORD_TIERS.length, "one row per tier");
  rows.forEach((row, i) => {
    const tier = WORD_TIERS[i];
    assert.deepEqual(codes(row[1]), [tier.id], `row ${i + 1} is ${tier.id}`);
    assert.equal(row[2], tier.name, `${tier.id} badge name`);
    assert.equal(Number(row[3].replace(/,/g, "")), tier.min, `${tier.id} word count`);
  });
});

test("the unlocks table matches themeUnlocks: each rank row names exactly the themes gated at that tier", () => {
  const rows = tableRows("## What each rank unlocks");
  assert.equal(rows.length, WORD_TIERS.length, "one row per tier");
  for (const row of rows) {
    const [tierId] = codes(row[0]);
    const tier = WORD_TIERS.find((t) => t.id === tierId);
    assert.ok(tier, `${row[0]} names a real tier`);
    assert.equal(Number(row[1].replace(/,/g, "")), tier.min, `${tierId} word count`);
    const documented = codes(row[2]);
    const gated = Object.entries(THEME_UNLOCKS).filter(([, t]) => t === tierId).map(([id]) => id);
    assert.deepEqual(documented.sort(), gated.sort(), `${tierId} themes`);
    for (const id of documented) assert.ok(THEMES.includes(id), `${id} is a real theme`);
  }
});

test("every BUILT gimmick appears in its own theme's rank row (future gimmick ideas in the doc are fine)", () => {
  const rows = tableRows("## What each rank unlocks");
  for (const g of Object.values(GIMMICKS)) {
    const tierId = THEME_UNLOCKS[g.theme];
    if (!tierId) continue; // a gimmick on a free theme is free — no row to sit in
    const row = rows.find((r) => codes(r[0])[0] === tierId);
    assert.ok(row, `${g.id}'s tier ${tierId} has a row`);
    assert.ok(codes(row[3] ?? "").includes(g.id), `${g.id} is documented in the ${tierId} row's gimmick cell`);
  }
});

test("the free-themes list matches: every theme not in themeUnlocks, and no gated one", () => {
  const start = DOC.indexOf("## Free themes");
  const section = DOC.slice(start, DOC.indexOf("\n## ", start + 1));
  const listed = codes(section.split("\nNote:")[0]);
  const free = THEMES.filter((id) => !THEME_UNLOCKS[id]);
  assert.deepEqual(listed.sort(), free.sort());
});
