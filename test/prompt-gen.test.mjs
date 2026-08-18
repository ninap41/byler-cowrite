// The pure prompt-generation rules (lib/prompt-gen.js) plus a validation pass
// over the hand-edited component library in prompts.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateSimplePrompt, generateIntermediatePrompt, generatePrompt, BULLET, unbullet,
  createSeededRandom, pickWeighted, isCompatible, validateIntermediateData, INTENSITIES,
} from "../lib/prompt-gen.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = JSON.parse(readFileSync(join(ROOT, "prompts.json"), "utf-8"));
const INT = DATA.intermediate;

test("the curated array still generates on its own", () => {
  const r = generateSimplePrompt(DATA.prompts);
  assert.equal(r.mode, "simple");
  assert.ok(DATA.prompts.includes(r.prompt)); // never rewritten
  assert.equal(DATA.prompts[r.sourceIndex], r.prompt);
  assert.throws(() => generateSimplePrompt([]), /No curated prompts/);
});

test("simple mode avoids what it just dealt", () => {
  const recent = [DATA.prompts[0]];
  for (let i = 0; i < 40; i++)
    assert.notEqual(generateSimplePrompt(DATA.prompts, { recent }).prompt, DATA.prompts[0]);
  // ...but a fully exhausted pool still returns something rather than failing.
  assert.equal(generateSimplePrompt([DATA.prompts[0]], { recent }).prompt, DATA.prompts[0]);
});

test("prompts.json's intermediate library validates", () => {
  assert.deepEqual(validateIntermediateData(INT), []);
  assert.ok(INT.timePeriods.length >= 8 && INT.locations.length >= 20 && INT.tensions.length >= 25);
});

test("the same seed and options rebuild the same prompt", () => {
  const opts = { seed: "abc123", tensionIntensity: "high", includeCatalyst: true };
  const a = generateIntermediatePrompt(INT, opts);
  const b = generateIntermediatePrompt(INT, opts);
  assert.equal(a.prompt, b.prompt);
  assert.deepEqual(a.selections, b.selections);
  assert.notEqual(generateIntermediatePrompt(INT, { ...opts, seed: "zzz" }).prompt, a.prompt);
});

test("explicit and locked ids are honored, everything else is random", () => {
  const r = generateIntermediatePrompt(INT, {
    timePeriodId: "post-vecna",
    toneId: "nostalgic",
    locked: { locationId: "wheeler-basement" },
    tensionIntensity: "medium",
  });
  assert.equal(r.selections.timePeriodId, "post-vecna");
  assert.equal(r.selections.toneId, "nostalgic");
  assert.equal(r.selections.locationId, "wheeler-basement");
  assert.ok(r.prompt.includes(INT.locations.find((l) => l.id === "wheeler-basement").text));
  assert.equal(r.labels.location, "Wheeler basement");
});

test("the chosen intensity variant is the one rendered", () => {
  for (const level of INTENSITIES) {
    const r = generateIntermediatePrompt(INT, { seed: "s1", locked: { tensionId: "hidden-drawing" }, tensionIntensity: level });
    assert.ok(r.prompt.includes(INT.tensions.find((t) => t.id === "hidden-drawing").variants[level]));
  }
  // An unknown level falls back to medium rather than rendering nothing.
  const bad = generateIntermediatePrompt(INT, { locked: { tensionId: "hidden-drawing" }, tensionIntensity: "extreme" });
  assert.equal(bad.intensity, "medium");
});

test("period compatibility and age safety hold over many draws", () => {
  const period = (id) => INT.timePeriods.find((p) => p.id === id);
  for (let i = 0; i < 300; i++) {
    const r = generateIntermediatePrompt(INT, { seed: "run" + i });
    const p = period(r.selections.timePeriodId);
    const loc = INT.locations.find((l) => l.id === r.selections.locationId);
    const rel = INT.relationshipContexts.find((x) => x.id === r.selections.relationshipContextId);
    const ten = INT.tensions.find((t) => t.id === r.selections.tensionId);
    for (const item of [loc, rel, ten]) {
      if (item.compatiblePeriods) assert.ok(item.compatiblePeriods.includes(p.id), `${item.id} vs ${p.id}`);
      if (item.compatibleAgeGroups) assert.ok(item.compatibleAgeGroups.includes(p.ageGroup));
      if (item.adultOnly) assert.equal(p.ageGroup, "adult");
    }
    assert.ok(r.prompt.split(" ").length > 30);
  }
});

test("a guided prompt is a bulleted clause per line, not a paragraph", () => {
  const r = generateIntermediatePrompt(INT, { seed: "lines", tensionIntensity: "medium" });
  const lines = r.prompt.split("\n");
  assert.equal(lines.length, 6); // universe, period, location, relationship, tension, tone
  for (const ln of lines) {
    assert.ok(ln.startsWith(BULLET), "every section is bulleted: " + ln);
    const text = ln.slice(BULLET.length);
    assert.equal(text, text.trim(), "no stray padding around a clause");
    assert.ok(text.length > 10);
    assert.ok(!text.includes(BULLET.trim()), "one bullet per line, not one per sentence");
  }
  // the sections are the components' own text, in scene order
  assert.equal(lines[0].slice(2), INT.universes.find((x) => x.id === r.selections.universeId).text);
  assert.equal(lines[1].slice(2), INT.timePeriods.find((x) => x.id === r.selections.timePeriodId).text);
  assert.equal(lines.at(-1).slice(2), INT.tones.find((x) => x.id === r.selections.toneId).text);
  // a catalyst adds its own bullet rather than crowding another
  const withCat = generateIntermediatePrompt(INT, { seed: "lines", tensionIntensity: "medium", includeCatalyst: true });
  assert.equal(withCat.prompt.split("\n").length, 7);
  // and a curated prompt is still a single untouched line, never bulleted
  const simple = generateSimplePrompt(DATA.prompts).prompt;
  assert.ok(!simple.includes("\n") && !simple.includes(BULLET.trim()));
});

test("a bulleted prompt collapses back to one line for titles", () => {
  const r = generateIntermediatePrompt(INT, { seed: "flat", includeCatalyst: true });
  const flat = unbullet(r.prompt);
  assert.ok(!flat.includes("\n") && !flat.includes(BULLET.trim()));
  for (const ln of r.prompt.split("\n")) assert.ok(flat.includes(ln.slice(2)), "no clause is lost");
  // it is a no-op on a curated prompt and safe on nothing at all
  const simple = generateSimplePrompt(DATA.prompts).prompt;
  assert.equal(unbullet(simple), simple);
  assert.equal(unbullet(""), "");
  assert.equal(unbullet(null), "");
});

test("a catalyst is opt-in", () => {
  assert.equal(generateIntermediatePrompt(INT, { seed: "x" }).selections.catalystId, undefined);
  const on = generateIntermediatePrompt(INT, { seed: "x", includeCatalyst: true });
  assert.ok(on.selections.catalystId);
  assert.ok(on.prompt.includes(INT.catalysts.find((c) => c.id === on.selections.catalystId).text));
});

test("a scenario category steers the tension", () => {
  for (let i = 0; i < 20; i++) {
    const r = generateIntermediatePrompt(INT, { seed: "c" + i, scenarioCategory: "confession" });
    const t = INT.tensions.find((x) => x.id === r.selections.tensionId);
    assert.ok(t.category === "confession" || t.tags.includes("confession"));
  }
});

test("selection helpers: weights bias without guaranteeing, filters can be exhausted", () => {
  const rng = createSeededRandom("w");
  const items = [{ id: "a", weight: 10 }, { id: "b" }];
  const counts = { a: 0, b: 0 };
  for (let i = 0; i < 500; i++) counts[pickWeighted(items, rng).id]++;
  assert.ok(counts.a > counts.b && counts.b > 0);
  assert.equal(pickWeighted([], rng), null);
  const minor = { timePeriod: { id: "post-vecna", ageGroup: "minor" }, activeTags: new Set(["canon"]) };
  assert.equal(isCompatible({ id: "x", adultOnly: true }, minor), false);
  assert.equal(isCompatible({ id: "x", incompatibleTags: ["canon"] }, minor), false);
  assert.equal(isCompatible({ id: "x", compatiblePeriods: ["modern-au"] }, minor), false);
  assert.equal(isCompatible({ id: "x", tags: [] }, minor), true);
});

test("generatePrompt dispatches by mode and refuses missing pools", () => {
  assert.equal(generatePrompt("simple", DATA).mode, "simple");
  assert.equal(generatePrompt("intermediate", DATA, { seed: "q" }).mode, "intermediate");
  assert.throws(() => generatePrompt("intermediate", { prompts: DATA.prompts }), /unavailable/);
});

test("a universe frames the scene: nothing canon-shaped wanders into an AU", () => {
  const idOf = (list, id) => list.find((x) => x.id === id);
  for (const u of INT.universes) {
    for (let i = 0; i < 40; i++) {
      const r = generateIntermediatePrompt(INT, { seed: `${u.id}-${i}`, universeId: u.id, includeCatalyst: i % 2 === 0 });
      assert.equal(r.selections.universeId, u.id);
      const period = idOf(INT.timePeriods, r.selections.timePeriodId);
      const loc = idOf(INT.locations, r.selections.locationId);
      // the period admits this universe, and the place belongs to it
      if (period.compatibleUniverses?.length) assert.ok(period.compatibleUniverses.includes(u.id), `${period.id} vs ${u.id}`);
      if (loc.compatibleUniverses?.length) assert.ok(loc.compatibleUniverses.includes(u.id), `${loc.id} vs ${u.id}`);
      // an AU never gets a component that opted out of AUs
      const chosen = [loc, idOf(INT.tensions, r.selections.tensionId), idOf(INT.catalysts, r.selections.catalystId)].filter(Boolean);
      for (const c of chosen)
        for (const bad of c.incompatibleTags || [])
          assert.ok(!(u.tags || []).includes(bad), `${c.id} carries ${bad} into ${u.id}`);
      assert.equal(r.prompt.split("\n")[0].slice(2), u.text);
    }
  }
});

test("every universe is reachable, and the canon one is not the only one dealt", () => {
  assert.deepEqual(validateIntermediateData(INT), []);
  const seen = new Set();
  for (let i = 0; i < 300; i++) seen.add(generateIntermediatePrompt(INT, { seed: "u" + i }).selections.universeId);
  assert.ok(seen.size > 5, "the ballot roams the multiverse: " + [...seen].join(","));
  assert.ok(seen.has("hawkins-canon"));
});

test("a universe with no periods behind it is a data error, not a silent dud", () => {
  const broken = { ...INT, universes: [...INT.universes, { id: "nowhere", label: "Nowhere", text: "x" }] };
  assert.ok(validateIntermediateData(broken).some((e) => /nowhere: no time period/.test(e)));
  const dangling = { ...INT, locations: [{ ...INT.locations[0], compatibleUniverses: ["not-a-universe"] }] };
  assert.ok(validateIntermediateData(dangling).some((e) => /unknown universe/.test(e)));
});

test("a prompts.json with no universes pool still generates", () => {
  const { universes, ...noU } = INT;
  const r = generateIntermediatePrompt(noU, { seed: "old" });
  assert.equal(r.selections.universeId, undefined);
  assert.ok(r.prompt.split("\n").length >= 5);
});
