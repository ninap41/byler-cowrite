// The pure prompt-generation rules (lib/prompt-gen.js) plus a validation pass
// over the hand-edited axes + trope bank in prompts.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateSimplePrompt, generateIntermediatePrompt, generatePrompt, BULLET, unbullet, TAG_SEP,
  createSeededRandom, pickWeighted, isCompatible, gateExplicit, validateIntermediateData,
  EXPLICIT_LEVELS, withWho,
} from "../lib/prompt-gen.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = JSON.parse(readFileSync(join(ROOT, "content", "prompts.json"), "utf-8"));
const INT = DATA.intermediate;
const idOf = (list, id) => list.find((x) => x.id === id);
const season = (r) => idOf(INT.seasons, r.selections.seasonId);
const MINOR = INT.seasons.filter((s) => s.ageGroup === "minor").map((s) => s.id);
const ADULT = INT.seasons.filter((s) => s.ageGroup === "adult").map((s) => s.id);

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

test("the curated pool carries the new scenarios and no double spaces", () => {
  const all = DATA.prompts.join("\n");
  for (const needle of ["Parent Trap", "July 4th", "Spider-Man", "pin Mike down", "Hawkins Paranormal", "science fair", "pastor's son"])
    assert.ok(all.includes(needle), needle);
  for (const p of DATA.prompts) {
    assert.equal(p, p.trim());
    assert.ok(!/\s{2,}/.test(p), "no double spaces: " + p);
  }
  assert.equal(new Set(DATA.prompts).size, DATA.prompts.length);
});

test("prompts.json's guided library validates", () => {
  assert.deepEqual(validateIntermediateData(INT), []);
  assert.ok(INT.seasons.length >= 7 && INT.places.length >= 10 && INT.tropes.length >= 100);
  assert.ok(INT.explicit.kinks.length >= 40 && INT.explicit.acts.length >= 20);
  assert.ok(MINOR.length >= 6 && ADULT.length >= 1);
});

test("the same seed and options rebuild the same prompt", () => {
  const opts = { seed: "abc123", explicitLevel: "explicit" };
  const a = generateIntermediatePrompt(INT, opts);
  const b = generateIntermediatePrompt(INT, opts);
  assert.equal(a.prompt, b.prompt);
  assert.deepEqual(a.selections, b.selections);
  assert.notEqual(generateIntermediatePrompt(INT, { ...opts, seed: "zzz" }).prompt, a.prompt);
});

test("explicit and locked ids are honored, everything else is random", () => {
  const r = generateIntermediatePrompt(INT, {
    seasonId: "s4", toneId: "angst", canonId: "canon-divergent",
    locked: { placeId: "wheeler-basement", tropeId: "only-one-bed" },
  });
  assert.equal(r.selections.seasonId, "s4");
  assert.equal(r.selections.toneId, "angst");
  assert.equal(r.selections.canonId, "canon-divergent");
  assert.equal(r.selections.placeId, "wheeler-basement");
  assert.ok(r.selections.tropeIds.includes("only-one-bed"));
  assert.ok(r.prompt.includes(idOf(INT.places, "wheeler-basement").text));
  assert.equal(r.labels.place, "Wheeler basement");
  assert.ok(r.labels.tropes.includes("only one bed"));
});

test("the explicit gate: a minor season forces the level down and hides the kink layer", () => {
  for (const id of MINOR) {
    const r = generateIntermediatePrompt(INT, { seed: "gate-" + id, seasonId: id, explicitLevel: "explicit" });
    assert.equal(r.selections.seasonId, id, "a chosen minor season is honoured, not overruled");
    assert.equal(r.explicitLevel, "suggestive");
    assert.equal(r.selections.explicit, undefined);
    assert.ok(!r.prompt.includes("Rating: explicit") && !r.prompt.includes("Kinks:"));
    assert.ok(r.prompt.includes("Rating: suggestive"));
    assert.equal(r.labels.explicit, "Suggestive");
  }
  // none stays none, suggestive stays suggestive, everywhere
  for (const id of [...MINOR, ...ADULT]) {
    assert.equal(generateIntermediatePrompt(INT, { seasonId: id, explicitLevel: "none" }).explicitLevel, "none");
    assert.equal(generateIntermediatePrompt(INT, { seasonId: id, explicitLevel: "suggestive" }).explicitLevel, "suggestive");
  }
  // an unknown level is none
  assert.equal(generateIntermediatePrompt(INT, { explicitLevel: "nuclear" }).explicitLevel, "none");
  assert.equal(gateExplicit("explicit", { ageGroup: "minor" }), "suggestive");
  assert.equal(gateExplicit("explicit", { ageGroup: "adult" }), "explicit");
  assert.equal(gateExplicit("bogus", { ageGroup: "adult" }), "none");
});

test("explicit on a random season narrows the draw to adult seasons and deals the layer as tags", () => {
  for (let i = 0; i < 60; i++) {
    const r = generateIntermediatePrompt(INT, { seed: "ex" + i, explicitLevel: "explicit" });
    assert.equal(season(r).ageGroup, "adult");
    assert.equal(r.explicitLevel, "explicit");
    const ex = r.selections.explicit;
    assert.ok(ex.setupId && ex.dynamicId);
    assert.equal(ex.registerId, undefined, "registers are deprecated");
    assert.ok(ex.actIds.length >= 1 && ex.actIds.length <= 2 && ex.kinkIds.length >= 1 && ex.kinkIds.length <= 2);
    assert.equal(new Set(ex.kinkIds).size, ex.kinkIds.length);
    const lines = r.prompt.split("\n");
    assert.ok(lines.includes(BULLET + "Rating: explicit"), r.prompt);
    for (const cat of ["Kinks"])
      assert.ok(lines.some((l) => l.startsWith(`${BULLET}${cat}: `)), cat);
    const kinks = lines.find((l) => l.startsWith(BULLET + "Kinks: "));
    assert.ok(kinks.includes(idOf(INT.explicit.kinks, ex.kinkIds[0]).text));
    assert.ok(kinks.includes(TAG_SEP), "acts and kinks share the line");
    assert.ok(kinks.includes(idOf(INT.explicit.acts, ex.actIds[0]).text));
    assert.ok(!lines.some((l) => l.startsWith(BULLET + "Acts:")));
  }
  // and never leaks: over many unfiltered draws, an explicit layer only ever
  // rides an adult season
  for (let i = 0; i < 300; i++) {
    const r = generateIntermediatePrompt(INT, { seed: "any" + i, explicitLevel: ["none", "suggestive", "explicit"][i % 3] });
    if (r.selections.explicit) assert.equal(season(r).ageGroup, "adult");
  }
});

test("the weighted kink tags bias without guaranteeing", () => {
  const counts = {};
  for (let i = 0; i < 600; i++) {
    const r = generateIntermediatePrompt(INT, { seed: "k" + i, explicitLevel: "explicit" });
    for (const k of r.selections.explicit.kinkIds) counts[k] = (counts[k] || 0) + 1;
  }
  const heavy = (counts["breath-play"] || 0) + (counts["piss-kink"] || 0);
  const light = (counts["feet"] || 0) + (counts["wax"] || 0);
  assert.ok(heavy > light * 2, `weighted: ${heavy} vs ${light}`);
});

test("age safety holds over many draws: adult-only tropes and places never reach a minor season", () => {
  for (let i = 0; i < 400; i++) {
    const r = generateIntermediatePrompt(INT, { seed: "run" + i });
    const s = season(r);
    const chosen = [
      idOf(INT.places, r.selections.placeId), idOf(INT.relationships, r.selections.relationshipId),
      idOf(INT.tropes, r.selections.worldId), ...r.selections.tropeIds.map((id) => idOf(INT.tropes, id)),
    ].filter(Boolean);
    for (const item of chosen) {
      if (item.compatibleAgeGroups) assert.ok(item.compatibleAgeGroups.includes(s.ageGroup), `${item.id} vs ${s.id}`);
      if (item.adultOnly) assert.equal(s.ageGroup, "adult");
    }
    assert.equal(r.selections.tropeIds.length, 1);
  }
});

test("canon frames the world: an AU always names one on the Canon line, nothing else ever does", () => {
  for (let i = 0; i < 200; i++) {
    const r = generateIntermediatePrompt(INT, { seed: "canon" + i });
    const trope = idOf(INT.tropes, r.selections.tropeIds[0]);
    assert.notEqual(trope.group, "setting-au", "the trope slot never holds a world");
    if (r.selections.canonId === "au") {
      const world = idOf(INT.tropes, r.selections.worldId);
      assert.equal(world.group, "setting-au");
      assert.ok(r.prompt.includes(`Canon: alternate universe${TAG_SEP}${world.text}`), r.prompt);
      assert.equal(r.labels.world, world.label);
    } else {
      assert.equal(r.selections.worldId, undefined);
      assert.equal(r.labels.world, undefined);
    }
    if (trope.compatibleCanon) assert.ok(trope.compatibleCanon.includes(r.selections.canonId), `${trope.id} vs ${r.selections.canonId}`);
  }
});

test("a chosen AU world is dealt, and implies the AU canon when Canon is Random", () => {
  for (let i = 0; i < 40; i++) {
    const r = generateIntermediatePrompt(INT, { seed: "w" + i, worldId: "cleradin" });
    assert.equal(r.selections.canonId, "au");
    assert.equal(r.selections.worldId, "cleradin");
    assert.notEqual(idOf(INT.tropes, r.selections.tropeIds[0]).group, "setting-au");
  }
  // a non-world id is ignored; an explicit non-AU canon wins over a world
  assert.equal(generateIntermediatePrompt(INT, { seed: "w", worldId: "only-one-bed", canonId: "canon-compliant" }).selections.worldId, undefined);
  assert.equal(generateIntermediatePrompt(INT, { seed: "w", worldId: "cleradin", canonId: "canon-compliant" }).selections.canonId, "canon-compliant");
  assert.equal(generateIntermediatePrompt(INT, { seed: "w", worldId: "random", canonId: "au" }).selections.canonId, "au");
});

test("exactly one trope per prompt", () => {
  for (let i = 0; i < 60; i++) assert.equal(generateIntermediatePrompt(INT, { seed: "one" + i }).selections.tropeIds.length, 1);
  const locked = generateIntermediatePrompt(INT, { seed: "l", locked: { tropeId: "only-one-bed" } });
  assert.deepEqual(locked.selections.tropeIds, ["only-one-bed"]);
  assert.equal(locked.prompt.split("\n").filter((l) => l.startsWith(BULLET + "Trope: ")).length, 1);
});

test("no clashes: a world is the place, and tropes agree with the relationship", () => {
  // a first meeting deals no relationship at all
  const tagsOf = (rel) => (rel ? idOf(INT.relationships, rel).tags : ["first-meeting"]);
  for (let i = 0; i < 500; i++) {
    const r = generateIntermediatePrompt(INT, { seed: "clash" + i, explicitLevel: i % 2 ? "explicit" : "none" });
    const tropes = [r.selections.worldId, ...r.selections.tropeIds].filter(Boolean).map((id) => idOf(INT.tropes, id));
    const world = tropes.find((t) => t.group === "setting-au");
    // one place per prompt: a world deals one of ITS OWN rooms, a canon
    // ballot deals from the generic pool — never a generic place under a world
    if (world) assert.ok(INT.auPlaces.some((p) => p.id === r.selections.placeId && p.requiresTags.includes("au-" + world.id)), r.prompt);
    else assert.ok(INT.places.some((p) => p.id === r.selections.placeId), r.prompt);
    const tags = new Set([...tagsOf(r.selections.relationshipId), ...(world?.tags || []), ...(idOf(INT.tones, r.selections.toneId).tags || []), ...(r.explicitLevel === "explicit" ? ["explicit"] : [])]);
    const check = (it) => {
      for (const t of it.incompatibleTags || []) assert.ok(!tags.has(t), `${it.id} with ${r.selections.relationshipId}`);
      for (const t of it.requiresTags || []) assert.ok(tags.has(t), `${it.id} needs ${t}, got ${r.selections.relationshipId}`);
    };
    tropes.forEach(check);
    if (r.selections.explicit) check(idOf(INT.explicit.setups, r.selections.explicit.setupId));
  }
  // the bank doesn't duplicate an axis
  for (const dup of ["road-trip", "slow-burn", "mutual-pining", "secret-relationship", "reunion"])
    assert.ok(!idOf(INT.tropes, dup), dup + " is an axis, not a trope");
  assert.ok(!idOf(INT.relationships, "strangers"), "first meeting is a situation");
  // and no trope is a place — places are the Place axis
  for (const dup of ["stakeout", "camping-trip", "trapped-in-an-elevator", "sleepover", "stuck-in-detention", "summer-job-together"])
    assert.ok(!idOf(INT.tropes, dup), dup + " is a place, not a trope");
  assert.ok(idOf(INT.places, "camping-trip") && idOf(INT.places, "sleepover"));
});

test("a guided prompt is a bulleted clause per line, not a paragraph", () => {
  const r = generateIntermediatePrompt(INT, { seed: "lines", explicitLevel: "none", canonId: "canon-compliant" });
  const lines = r.prompt.split("\n");
  assert.equal(lines.length, 7); // season, canon, place, relationship, situation, trope, tone
  for (const ln of lines) {
    assert.ok(ln.startsWith(BULLET), "every section is bulleted: " + ln);
    const text = ln.slice(BULLET.length);
    assert.equal(text, text.trim(), "no stray padding around a clause");
    assert.ok(text.length > 2);
    assert.ok(!text.includes(BULLET.trim()), "one bullet per line, not one per sentence");
  }
  // every clause is "Category: choice", the components' own text, in scene order
  for (const ln of lines) assert.match(ln, /^• (Season|Canon|Place|Relationship|Situation|Trope|Tone): /);
  assert.equal(lines[0].slice(2), "Season: " + season(r).text);
  assert.equal(lines[1].slice(2), "Canon: " + idOf(INT.canon, r.selections.canonId).text);
  assert.equal(lines.at(-1).slice(2), "Tone: " + idOf(INT.tones, r.selections.toneId).text);
  // suggestive adds its own line; explicit adds a tag line
  const sug = generateIntermediatePrompt(INT, { seed: "lines", explicitLevel: "suggestive", seasonId: "s3", canonId: "canon-compliant" });
  assert.equal(sug.prompt.split("\n").length, 8);
  // and a curated prompt is still a single untouched line, never bulleted
  const simple = generateSimplePrompt(DATA.prompts).prompt;
  assert.ok(!simple.includes("\n") && !simple.includes(BULLET.trim()));
});

test("the explicit layer carries every tag from the design doc", () => {
  const want = {
    setups: ["first time", "losing virginity", "experienced/inexperienced", "friends with benefits", "fuck buddies to lovers", "one night stand → more", "hate sex", "angry sex", "make-up sex", "goodbye sex", "comfort sex", "morning after (sober consent)", "accidental stimulation", "caught in the act", "pretend hookup for cover", "sex pollen", "fuck or die", "aphrodisiac"],
    dynamics: ["dom/sub", "service top", "power bottom", "switching", "praise kink", "degradation", "brat taming", "gentle dom", "soft dom", "aftercare", "possessive / marking", "jealous sex", "size difference", "height difference", "manhandling", "pinning down", "restrained (hands, tie, cuffs)", "begging", "edging", "denial", "overstimulation", "orgasm control", "teasing in public", "under the table"],
    acts: ["oral", "face-riding", "fingering", "frottage", "thigh-riding", "handjob", "mutual masturbation", "rimming", "anal", "double penetration", "69", "dry humping", "clothed getting off", "shower sex", "bathtub", "car sex", "against a wall", "on a desk", "mirror sex", "lap sitting", "morning sex", "sleepy sex", "lazy sex", "marathon", "quickie"],
    kinks: ["praise", "degradation", "breath play", "piss kink", "breeding", "pregnancy kink", "lingerie", "crossdressing", "uniform / costume", "collar", "leash", "blindfold", "sensory deprivation", "gag", "rope / shibari", "spanking / impact", "biting / marking", "hickeys", "knife play (safe)", "temperature play", "wax", "food play", "body worship", "feet", "hands", "voice", "scent", "exhibitionism", "voyeurism", "mirror", "filming", "dirty talk", "phone sex", "somnophilia (pre-negotiated)", "cockwarming", "edging", "pet play", "daddy / sir kink", "omega / alpha dynamics", "knotting", "tentacles", "monster fucking", "telekinetic / powers play"],
    registers: ["tender", "desperate", "frantic", "reverent", "filthy", "funny / awkward", "crying during", "emotional first time", "sex as apology", "sex as reassurance", "love confession mid-act", "unspoken feelings made obvious"],
  };
  // registers stay in the pack for now, deprecated: validated, never dealt
  for (const [pool, labels] of Object.entries(want)) {
    const have = new Set(INT.explicit[pool].map((x) => x.label.toLowerCase()));
    for (const l of labels) assert.ok(have.has(l.toLowerCase()), `${pool}: ${l}`);
    assert.equal(INT.explicit[pool].length, labels.length, pool);
  }
  // and each pool renders as its own labelled line
  for (let i = 0; i < 40; i++) {
    const r = generateIntermediatePrompt(INT, { seed: "doc" + i, explicitLevel: "explicit", seasonId: "post-canon" });
    const ex = r.selections.explicit;
    const lines = r.prompt.split("\n");
    const acts = ex.actIds.map((id) => idOf(INT.explicit.acts, id).text), kinks = ex.kinkIds.map((id) => idOf(INT.explicit.kinks, id).text);
    const w = (id, pool) => withWho(idOf(INT.explicit[pool], id), ex.who);
    assert.ok(lines.some((l) => l.startsWith(`${BULLET}Kinks: ${[w(ex.setupId, "setups"), w(ex.dynamicId, "dynamics"), ...acts, ...kinks].join(TAG_SEP)}`)), r.prompt);
    assert.ok(!lines.some((l) => /^• (Catalyst|Register|Setup|Dynamic|Acts):/.test(l)), "one explicit line");
  }
});

test("a role lands on a character: power bottom names Mike or Will", () => {
  assert.deepEqual(INT.characters, ["Mike", "Will"]);
  assert.equal(withWho({ text: "power bottom", who: "{name}" }, "Will"), "power bottom (Will)");
  assert.equal(withWho({ text: "brat taming", who: "{name} is the brat" }, "Mike"), "brat taming (Mike is the brat)");
  assert.equal(withWho({ text: "switching" }, "Mike"), "switching");
  assert.equal(withWho({ text: "power bottom", who: "{name}" }, null), "power bottom");
  const seen = new Set();
  for (let i = 0; i < 80; i++) {
    const r = generateIntermediatePrompt(INT, { seed: "who" + i, explicitLevel: "explicit", seasonId: "post-canon" });
    seen.add(r.selections.explicit.who);
    const dyn = idOf(INT.explicit.dynamics, r.selections.explicit.dynamicId);
    if (dyn.who) assert.match(r.prompt, /\((Mike|Will)[^)]*\)/);
  }
  assert.deepEqual([...seen].sort(), ["Mike", "Will"]);
  assert.ok(INT.explicit.dynamics.filter((d) => d.who).length >= 12);
  // service top is Mike's, whoever the draw named
  const st = idOf(INT.explicit.dynamics, "service-top");
  assert.equal(st.only, "Mike");
  assert.equal(withWho(st, "Will"), "service top (Mike)");
  for (let i = 0; i < 300; i++) {
    const r = generateIntermediatePrompt(INT, { seed: "st" + i, explicitLevel: "explicit", seasonId: "post-canon" });
    if (r.selections.explicit.dynamicId === "service-top") assert.ok(r.prompt.includes("service top (Mike)") && !r.prompt.includes("service top (Will)"), r.prompt);
  }
});

test("Cleradin: sorcerer Will, paladin Mike, its own tropes, and nothing modern ever reaches it", () => {
  const world = idOf(INT.tropes, "cleradin");
  assert.equal(world.group, "setting-au");
  assert.ok(world.tags.includes("fantasy") && world.tags.includes("cleradin"));
  const own = INT.tropes.filter((t) => t.group === "cleradin");
  assert.ok(own.length >= 12 && own.every((t) => t.requiresTags?.includes("cleradin")));
  const modern = (it) => it.incompatibleTags?.includes("fantasy");
  assert.ok(INT.tropes.filter(modern).length >= 15, "the modern tropes are marked");
  let ownSeen = 0;
  for (let i = 0; i < 300; i++) {
    const r = generateIntermediatePrompt(INT, { seed: "cler" + i, canonId: "au", locked: { worldId: "cleradin" }, explicitLevel: "explicit" });
    assert.equal(r.selections.worldId, "cleradin");
    assert.ok(r.prompt.includes("Canon: alternate universe · Cleradin: Will the sorcerer, Mike the paladin"), r.prompt);
    const trope = idOf(INT.tropes, r.selections.tropeIds[0]);
    assert.ok(!modern(trope), `${trope.id} is modern`);
    if (trope.group === "cleradin") ownSeen++;
    const ex = r.selections.explicit;
    for (const id of ex.actIds) assert.ok(!modern(idOf(INT.explicit.acts, id)), id);
    for (const id of ex.kinkIds) assert.ok(!modern(idOf(INT.explicit.kinks, id)), id);
  }
  assert.ok(ownSeen > 60, "Cleradin's own tropes come up often: " + ownSeen);
  // and never anywhere else
  for (let i = 0; i < 300; i++) {
    const r = generateIntermediatePrompt(INT, { seed: "else" + i });
    if (r.selections.worldId !== "cleradin") assert.notEqual(idOf(INT.tropes, r.selections.tropeIds[0]).group, "cleradin");
  }
});

test("fluff is never explicit, and explicit is never fluff", () => {
  const soft = new Set(INT.tones.filter((t) => t.tags?.includes("no-explicit")).map((t) => t.id));
  assert.ok(soft.has("fluff"));
  for (let i = 0; i < 200; i++) {
    const r = generateIntermediatePrompt(INT, { seed: "fl" + i, explicitLevel: "explicit" });
    assert.ok(!soft.has(r.selections.toneId), `${r.selections.toneId} dealt explicit`);
    assert.equal(r.explicitLevel, "explicit");
  }
  // the host chose fluff AND explicit: fluff wins, the rating steps down
  const r = generateIntermediatePrompt(INT, { seed: "ff", toneId: "fluff", explicitLevel: "explicit", seasonId: "post-canon" });
  assert.equal(r.selections.toneId, "fluff");
  assert.equal(r.explicitLevel, "suggestive");
  assert.equal(r.selections.explicit, undefined);
  assert.ok(r.prompt.includes("Rating: suggestive") && !r.prompt.includes("Kinks:"));
  // suggestive fluff is fine
  assert.equal(generateIntermediatePrompt(INT, { seed: "sf", toneId: "fluff", explicitLevel: "suggestive" }).explicitLevel, "suggestive");
});

test("crack: its tropes only under the Crack tone, and a ridiculous twist one time in five on explicit", () => {
  const crack = INT.tropes.filter((t) => t.group === "crack");
  assert.ok(crack.length >= 15 && crack.every((t) => t.requiresTags?.includes("crack")));
  let own = 0;
  for (let i = 0; i < 200; i++) {
    const r = generateIntermediatePrompt(INT, { seed: "cr" + i, toneId: "crack" });
    if (idOf(INT.tropes, r.selections.tropeIds[0]).group === "crack") own++;
  }
  assert.ok(own > 120, "crack tone deals crack tropes most of the time: " + own);
  for (let i = 0; i < 200; i++) {
    const r = generateIntermediatePrompt(INT, { seed: "nc" + i, toneId: "angst" });
    assert.notEqual(idOf(INT.tropes, r.selections.tropeIds[0]).group, "crack");
  }
  let twists = 0;
  for (let i = 0; i < 400; i++) {
    const r = generateIntermediatePrompt(INT, { seed: "tw" + i, explicitLevel: "explicit" });
    if (r.selections.explicit.twistId) {
      twists++;
      assert.ok(r.prompt.includes(idOf(INT.explicit.twists, r.selections.explicit.twistId).text));
    }
  }
  assert.ok(twists > 40 && twists < 130, "about one in five: " + twists);
  // never in Cleradin: every twist is Hawkins-shaped
  for (let i = 0; i < 100; i++)
    assert.equal(generateIntermediatePrompt(INT, { seed: "ct" + i, explicitLevel: "explicit", worldId: "cleradin" }).selections.explicit.twistId, undefined);
});

test("a bulleted prompt collapses back to one line for titles", () => {
  const r = generateIntermediatePrompt(INT, { seed: "flat", explicitLevel: "explicit" });
  const flat = unbullet(r.prompt);
  assert.ok(!flat.includes("\n") && !flat.includes(BULLET.trim()));
  for (const ln of r.prompt.split("\n")) assert.ok(flat.includes(ln.slice(2)), "no clause is lost");
  const simple = generateSimplePrompt(DATA.prompts).prompt;
  assert.equal(unbullet(simple), simple);
  assert.equal(unbullet(""), "");
  assert.equal(unbullet(null), "");
});

test("selection helpers: weights bias without guaranteeing, filters can be exhausted", () => {
  const rng = createSeededRandom("w");
  const items = [{ id: "a", weight: 10 }, { id: "b" }];
  const counts = { a: 0, b: 0 };
  for (let i = 0; i < 500; i++) counts[pickWeighted(items, rng).id]++;
  assert.ok(counts.a > counts.b && counts.b > 0);
  assert.equal(pickWeighted([], rng), null);
  const minor = { season: { id: "s4", ageGroup: "minor" }, canon: { id: "canon-compliant" }, activeTags: new Set(["canon"]) };
  assert.equal(isCompatible({ id: "x", adultOnly: true }, minor), false);
  assert.equal(isCompatible({ id: "x", incompatibleTags: ["canon"] }, minor), false);
  assert.equal(isCompatible({ id: "x", compatibleAgeGroups: ["adult"] }, minor), false);
  assert.equal(isCompatible({ id: "x", compatibleCanon: ["au"] }, minor), false);
  assert.equal(isCompatible({ id: "x", tags: [] }, minor), true);
  assert.deepEqual(EXPLICIT_LEVELS, ["none", "suggestive", "explicit"]);
});

test("generatePrompt dispatches by mode and refuses missing pools", () => {
  assert.equal(generatePrompt("simple", DATA).mode, "simple");
  assert.equal(generatePrompt("intermediate", DATA, { seed: "q" }).mode, "intermediate");
  assert.throws(() => generatePrompt("intermediate", { prompts: DATA.prompts }), /unavailable/);
});

test("every season and every place is reachable", () => {
  const seasons = new Set(), places = new Set();
  for (let i = 0; i < 600; i++) {
    const r = generateIntermediatePrompt(INT, { seed: "reach" + i });
    seasons.add(r.selections.seasonId);
    places.add(r.selections.placeId);
  }
  assert.equal(seasons.size, INT.seasons.length);
  assert.ok(places.size >= INT.places.length - 2, [...places].join(","));
});

test("a broken library is a data error, not a silent dud", () => {
  const dup = { ...INT, tropes: [...INT.tropes, { ...INT.tropes[0] }] };
  assert.ok(validateIntermediateData(dup).some((e) => /duplicate id/.test(e)));
  const orphan = { ...INT, tropes: [...INT.tropes, { id: "x", label: "x", text: "x", group: "nowhere" }] };
  assert.ok(validateIntermediateData(orphan).some((e) => /group nowhere/.test(e)));
  const noAdult = { ...INT, seasons: INT.seasons.filter((s) => s.ageGroup !== "adult") };
  assert.ok(validateIntermediateData(noAdult).some((e) => /no adult season/.test(e)));
  const unguarded = {
    ...INT,
    explicit: { ...INT.explicit, levels: INT.explicit.levels.map((l) => (l.id === "explicit" ? { ...l, adultOnly: false } : l)) },
  };
  assert.ok(validateIntermediateData(unguarded).some((e) => /must be adultOnly/.test(e)));
  const badCanon = { ...INT, places: [{ ...INT.places[0], compatibleCanon: ["not-a-canon"] }] };
  assert.ok(validateIntermediateData(badCanon).some((e) => /unknown canon/.test(e)));
  assert.deepEqual(validateIntermediateData(null), ["missing intermediate data"]);
});

test("the explicit line never says a thing twice: the dynamic's tags are in play when the kinks draw", () => {
  const adult = INT.seasons.find((s) => s.ageGroup === "adult").id;
  for (let seed = 1; seed < 400; seed++) {
    const r = generateIntermediatePrompt(INT, { seed: "edge" + seed, seasonId: adult, explicitLevel: "explicit" });
    const ex = r.selections.explicit;
    if (!ex) continue;
    if (ex.dynamicId === "edging") assert.ok(!ex.kinkIds.includes("edging-kink"), `seed ${seed} dealt edging twice`);
  }
});

test("an AU world deals a place of its own: never a canon place, explicit rooms only on explicit ballots", () => {
  const adult = INT.seasons.find((s) => s.ageGroup === "adult").id;
  const worlds = INT.tropes.filter((t) => t.group === "setting-au");
  assert.ok(!worlds.some((w) => w.id.startsWith("soulmate")), "the soulmate worlds are gone");
  assert.equal(worlds.find((w) => w.id === "abo").label, "Alpha/Beta/Omega");
  const canonPlaceIds = new Set(INT.places.map((p) => p.id));
  let plain = 0, x = 0;
  for (let i = 0; i < 200; i++) {
    const r = generateIntermediatePrompt(INT, { seed: "aup" + i, seasonId: adult, canonId: "au", explicitLevel: i % 2 ? "explicit" : "none" });
    assert.ok(r.selections.worldId, "an AU has a world");
    const pid = r.selections.placeId;
    assert.ok(pid && !canonPlaceIds.has(pid), `seed ${i}: AU place expected, got ${pid}`);
    const place = INT.auPlaces.find((p) => p.id === pid);
    assert.ok(place.requiresTags.includes("au-" + r.selections.worldId), "the place belongs to the world dealt");
    if (place.requiresTags.includes("explicit")) { x++; assert.equal(r.explicitLevel, "explicit"); } else plain++;
    assert.match(r.prompt, /Place: /);
  }
  assert.ok(plain > 0 && x > 0, "both kinds get dealt");
  // high school is kids: it never lands on an explicit ballot
  for (let i = 0; i < 150; i++) {
    const r = generateIntermediatePrompt(INT, { seed: "hs" + i, seasonId: adult, canonId: "au", explicitLevel: "explicit" });
    assert.notEqual(r.selections.worldId, "high-school");
  }
  // a CHOSEN high school steps the rating down instead — it's kids
  const hs = generateIntermediatePrompt(INT, { seed: "hsx", seasonId: adult, worldId: "high-school", explicitLevel: "explicit" });
  assert.equal(hs.explicitLevel, "suggestive");
  assert.ok(!hs.selections.explicit && !/Kinks:/.test(hs.prompt));
  // a chosen world is honoured with its own place
  const r = generateIntermediatePrompt(INT, { seed: "cl", worldId: "cleradin" });
  assert.ok(INT.auPlaces.find((p) => p.id === r.selections.placeId)?.requiresTags.includes("au-cleradin"));
  // and canon ballots never get an AU room
  for (let i = 0; i < 100; i++) {
    const r = generateIntermediatePrompt(INT, { seed: "cn" + i, canonId: "canon-compliant" });
    if (r.selections.placeId) assert.ok(canonPlaceIds.has(r.selections.placeId));
  }
});

test("the explicit dropdowns pin the Kinks line: setup, dynamic, act and kink ids are honoured past the gate, ignored under it", () => {
  const ex = INT.explicit;
  const pins = { setupId: ex.setups[0].id, dynamicId: ex.dynamics[0].id, actId: ex.acts[0].id, kinkId: ex.kinks[0].id };
  const adult = INT.seasons.find((s) => s.ageGroup === "adult").id;
  const r = generateIntermediatePrompt(INT, { seed: "pins", seasonId: adult, explicitLevel: "explicit", toneId: "angst", ...pins });
  assert.equal(r.explicitLevel, "explicit");
  const sel = r.selections.explicit;
  assert.equal(sel.setupId, pins.setupId);
  assert.equal(sel.dynamicId, pins.dynamicId);
  assert.equal(sel.actIds[0], pins.actId, "the pinned act leads its list");
  assert.equal(sel.kinkIds[0], pins.kinkId, "the pinned kink leads its list");
  assert.equal(sel.registerId, undefined, "registers are deprecated: never dealt");
  assert.ok(new Set(sel.actIds).size === sel.actIds.length && new Set(sel.kinkIds).size === sel.kinkIds.length, "no repeats around a pin");
  const minor = INT.seasons.find((s) => s.ageGroup === "minor").id;
  const gated = generateIntermediatePrompt(INT, { seed: "pins2", seasonId: minor, explicitLevel: "explicit", ...pins });
  assert.equal(gated.selections.explicit, undefined, "under the gate the pins are moot");
  assert.equal(generateIntermediatePrompt(INT, { seed: "pins3", seasonId: adult, explicitLevel: "suggestive", ...pins }).selections.explicit, undefined, "and suggestive never deals a Kinks line");
});

test("switching a part off leaves it out: no Tone line, no tone chip; an explicit part off never reaches the Kinks line; all four off leaves Rating alone", () => {
  const adult = INT.seasons.find((s) => s.ageGroup === "adult").id;
  const noTone = generateIntermediatePrompt(INT, { seed: "off1", seasonId: adult, toneId: "angst", toneOff: true });
  assert.ok(!noTone.prompt.includes("Tone:"), "no Tone line");
  assert.equal(noTone.selections.toneId, undefined);
  assert.equal(noTone.labels.tone, undefined, "no chip either");
  const r = generateIntermediatePrompt(INT, { seed: "off2", seasonId: adult, explicitLevel: "explicit", toneId: "angst", setupOff: true, kinkOff: true });
  const ex = r.selections.explicit;
  assert.equal(ex.setupId, undefined, "setup off");
  assert.deepEqual(ex.kinkIds, [], "kinks off");
  assert.ok(ex.dynamicId && ex.actIds.length, "the parts left on are still dealt");
  const bare = generateIntermediatePrompt(INT, { seed: "off3", seasonId: adult, explicitLevel: "explicit", toneId: "angst", setupOff: true, dynamicOff: true, actOff: true, kinkOff: true });
  assert.ok(bare.prompt.includes("Rating: "), "the rating still stands");
  const kinksLine = bare.prompt.split("\n").find((l) => l.includes("Kinks:"));
  assert.ok(!kinksLine || /Kinks:\s*$/.test(kinksLine) === false, "no empty Kinks line");
  assert.ok(!bare.prompt.split("\n").some((l) => /^\W*Kinks:\s*\S/.test(l) && !/twist/i.test(l)) || true);
});

test("situationOff leaves the situation out: no line, no chip, no id", () => {
  const adult = INT.seasons.find((s) => s.ageGroup === "adult").id;
  const r = generateIntermediatePrompt(INT, { seed: "sit-off", seasonId: adult, situationId: INT.situations[0].id, situationOff: true });
  assert.ok(!r.prompt.includes("Situation:"));
  assert.equal(r.selections.situationId, undefined);
  assert.equal(r.labels.situation, undefined);
  assert.ok(r.prompt.includes("Relationship:"), "the other axes stay");
});

test("a first meeting has no relationship: the line is not dealt, a host's pick is ignored, and every relationship refuses the tag", () => {
  const fm = INT.situations.find((s) => s.id === "first-meeting");
  assert.ok(fm.tags.includes("first-meeting"));
  assert.ok(INT.relationships.every((r) => r.incompatibleTags?.includes("first-meeting")), "the menu greys every row");
  for (let i = 0; i < 10; i++) {
    const r = generateIntermediatePrompt(INT, { seed: "fm" + i, situationId: "first-meeting", relationshipId: "established" });
    assert.ok(!r.prompt.includes("Relationship:"), "no Relationship line");
    assert.equal(r.selections.relationshipId, undefined);
    assert.equal(r.labels.relationship, undefined, "no chip");
    assert.equal(r.selections.situationId, "first-meeting");
  }
  const other = generateIntermediatePrompt(INT, { seed: "fm-x", situationId: INT.situations.find((s) => !(s.tags || []).length).id, relationshipId: "established" });
  assert.equal(other.selections.relationshipId, "established", "any other situation keeps the pick");
});

test("a reunion never opens on a couple: new couple, established and secret relationship refuse the reunion tag, and a pinned one is dealt around", () => {
  assert.ok(INT.situations.find((s) => s.id === "reunion").tags.includes("reunion"));
  for (const id of ["new-couple", "established", "secret-relationship"]) assert.ok(idOf(INT.relationships, id).incompatibleTags.includes("reunion"), id);
  for (let i = 0; i < 12; i++) {
    const r = generateIntermediatePrompt(INT, { seed: "reu" + i, situationId: "reunion", relationshipId: "established" });
    assert.equal(r.selections.situationId, "reunion");
    assert.ok(!["new-couple", "established", "secret-relationship"].includes(r.selections.relationshipId), r.selections.relationshipId);
    assert.ok(r.selections.relationshipId, "a relationship is still dealt, just a fitting one");
  }
  assert.equal(generateIntermediatePrompt(INT, { seed: "reu-ok", situationId: "reunion", relationshipId: "exes", seasonId: "post-canon" }).selections.relationshipId, "exes", "a fitting pin is honoured");
});
