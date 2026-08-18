// Prompt generation: the pure rules half. No I/O, no DOM, no sockets — the
// data comes from prompts.json (curated `prompts` array + the `intermediate`
// component pools) and both the server and the tests call these directly.
//
// Two modes ship today (docs/PROMPT_GENERATION.md):
//   simple       — one curated complete prompt, untouched.
//   intermediate — compatible clauses assembled into a multi-sentence prompt.
// Advanced mode is deliberately not here yet; MODES is the list that exists.

export const MODES = ["simple", "intermediate"];
export const INTENSITIES = ["low", "medium", "high"];
export const DEFAULT_WEIGHT = 1;

// ---- Seeded randomness -----------------------------------------------------
// A seed makes a generated prompt reproducible, so a shared/saved prompt can be
// rebuilt from its ids without storing the prose.

export function hashSeed(seed) {
  let h = 2166136261 >>> 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// mulberry32 — small, fast, and deterministic across platforms.
export function createSeededRandom(seed) {
  let a = hashSeed(seed == null ? "byler" : seed);
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeSeed(rng = Math.random) {
  return Math.floor(rng() * 0xffffffff).toString(36);
}

// ---- Weighted selection ----------------------------------------------------

const weightOf = (item) => {
  const w = Number(item?.weight);
  return Number.isFinite(w) && w > 0 ? w : DEFAULT_WEIGHT;
};

// Recently used ids are damped, not banned: variety without dead pools.
export function effectiveWeight(item, recentIds = []) {
  let w = weightOf(item);
  for (const id of recentIds) if (id === item.id) w /= 3;
  return Math.max(w, 0.05);
}

export function pickWeighted(items, rng = Math.random, recentIds = []) {
  if (!items?.length) return null;
  const weights = items.map((it) => effectiveWeight(it, recentIds));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

// ---- Compatibility ---------------------------------------------------------

export function isCompatible(item, context = {}) {
  const period = context.timePeriod;
  // The universe is chosen first and frames everything after it: a component
  // that names its universes belongs to those and nowhere else, so the Wheeler
  // basement never turns up on a ship and the crow's nest never turns up in
  // Hawkins. A component that names none is universal by design (most feelings
  // are); the ones that are canon-specific opt out of AUs with the "au" tag,
  // which every non-canon universe carries.
  const universe = context.universe;
  if (item.compatibleUniverses?.length && universe && !item.compatibleUniverses.includes(universe.id))
    return false;
  if (item.compatiblePeriods?.length && period && !item.compatiblePeriods.includes(period.id))
    return false;
  if (item.compatibleAgeGroups?.length && period && !item.compatibleAgeGroups.includes(period.ageGroup))
    return false;
  // Age safety is a generation rule, not a UI one: adult-only components never
  // reach a period where Mike and Will are minors.
  if (item.adultOnly && period?.ageGroup !== "adult") return false;
  const active = context.activeTags instanceof Set ? context.activeTags : new Set(context.activeTags || []);
  if (item.incompatibleTags?.some((t) => active.has(t))) return false;
  if (context.category && context.category !== "random") {
    const cats = [item.category, ...(item.tags || [])];
    if (item.categoryStrict !== false && !cats.includes(context.category)) return false;
  }
  return true;
}

const byId = (list, id) => (id ? list.find((x) => x.id === id) || null : null);

// Explicit id wins; "random"/missing falls through to a weighted pick over the
// compatible pool. Filtering that empties the pool falls back to the unfiltered
// one rather than failing the whole generation.
function resolve(list, wanted, context, rng, recentIds) {
  const chosen = byId(list, wanted && wanted !== "random" ? wanted : null);
  if (chosen) return chosen;
  const pool = list.filter((it) => isCompatible(it, context));
  return pickWeighted(pool.length ? pool : list.filter((it) => isCompatible(it, { ...context, category: null })), rng, recentIds)
    || pickWeighted(list, rng, recentIds);
}

const addTags = (set, item) => {
  for (const t of item?.tags || []) set.add(t);
  return set;
};

// ---- Simple mode -----------------------------------------------------------

export function generateSimplePrompt(prompts, { recent = [], rng = Math.random } = {}) {
  if (!prompts?.length) throw new Error("No curated prompts available.");
  // Never repeat something from the recent history while anything else exists.
  const fresh = prompts.filter((p) => !recent.includes(p));
  const pool = fresh.length ? fresh : prompts;
  const prompt = pool[Math.floor(rng() * pool.length)];
  return { mode: "simple", prompt, sourceIndex: prompts.indexOf(prompt) };
}

// ---- Intermediate mode -----------------------------------------------------

export function intensityText(tension, intensity) {
  const v = tension?.variants || {};
  return v[intensity] || v.medium || v.low || v.high || "";
}

const PART_KEYS = ["universe", "timePeriod", "location", "relationshipContext", "tension", "catalyst", "tone"];

// An assembled prompt is a stack of distinct decisions, so it renders as one
// bulleted clause per LINE — run together it reads as a wall of prose. It stays
// PLAIN TEXT (the bullet is a character, not markup): the surfaces that show a
// whole prompt set `white-space: pre-line` with a hanging indent, so nothing
// downstream — snapshot, archive, export, PDF — has to learn a format.
export const BULLET = "\u2022 ";
export const bulletList = (parts) => parts.map((p) => BULLET + p).join("\n");
// The reverse, for anywhere a prompt has to collapse back to one line.
export const unbullet = (prompt) =>
  String(prompt || "").split("\n").map((l) => l.replace(/^\u2022 /, "")).join(" ").trim();

export function generateIntermediatePrompt(data, options = {}) {
  const seed = options.seed || makeSeed();
  const rng = createSeededRandom(seed);
  const recent = options.recentIds || [];
  const locked = options.locked || {};
  const intensity = INTENSITIES.includes(options.tensionIntensity) ? options.tensionIntensity : "medium";
  const category = options.scenarioCategory && options.scenarioCategory !== "random"
    ? options.scenarioCategory : null;

  const ctx = { activeTags: new Set() };
  // Universe first — it decides which periods, and through them which places,
  // are even thinkable. An older prompts.json with no universes pool still
  // generates: everything downstream treats a missing universe as "anywhere".
  const universe = data.universes?.length
    ? resolve(data.universes, locked.universeId ?? options.universeId, ctx, rng, recent)
    : null;
  ctx.universe = universe;
  addTags(ctx.activeTags, universe);

  const timePeriod = resolve(data.timePeriods, locked.timePeriodId ?? options.timePeriodId, ctx, rng, recent);
  ctx.timePeriod = timePeriod;
  addTags(ctx.activeTags, timePeriod);

  const relationshipContext = resolve(
    data.relationshipContexts, locked.relationshipContextId ?? options.relationshipContextId, ctx, rng, recent);
  addTags(ctx.activeTags, relationshipContext);

  const location = resolve(data.locations, locked.locationId, { ...ctx, category }, rng, recent);
  addTags(ctx.activeTags, location);

  const tension = resolve(data.tensions, locked.tensionId, { ...ctx, category }, rng, recent);
  addTags(ctx.activeTags, tension);

  const tone = resolve(data.tones, locked.toneId ?? options.toneId, ctx, rng, recent);

  const wantCatalyst = options.includeCatalyst ?? !!locked.catalystId;
  const catalyst = wantCatalyst && data.catalysts?.length
    ? resolve(data.catalysts, locked.catalystId, ctx, rng, recent) : null;

  const picked = { universe, timePeriod, location, relationshipContext, tension, tone, catalyst };
  const template = (data.templates || []).find((t) => t.id === options.templateId)
    || pickWeighted((data.templates || []).filter((t) => !!catalyst === t.parts.includes("catalyst")), rng)
    || null;
  const parts = (template?.parts || PART_KEYS)
    .filter((k) => PART_KEYS.includes(k))
    .map((k) => (k === "tension" ? intensityText(tension, intensity) : picked[k]?.text))
    .filter(Boolean);

  return {
    mode: "intermediate",
    prompt: bulletList(parts),
    seed,
    intensity,
    selections: {
      ...(universe ? { universeId: universe.id } : {}),
      timePeriodId: timePeriod?.id,
      relationshipContextId: relationshipContext?.id,
      toneId: tone?.id,
      locationId: location?.id,
      tensionId: tension?.id,
      ...(catalyst ? { catalystId: catalyst.id } : {}),
    },
    // Labels ride along so the UI can show chips without re-reading the pools.
    labels: {
      ...(universe ? { universe: universe.label } : {}),
      timePeriod: timePeriod?.label,
      relationshipContext: relationshipContext?.label,
      tone: tone?.label,
      location: location?.label,
      tension: tension?.label,
      ...(catalyst ? { catalyst: catalyst.label } : {}),
    },
  };
}

// ---- Dispatch --------------------------------------------------------------

export function generatePrompt(mode, data, options = {}) {
  if (mode === "intermediate") {
    if (!data.intermediate) throw new Error("Intermediate prompt data is unavailable.");
    return generateIntermediatePrompt(data.intermediate, options);
  }
  return generateSimplePrompt(data.prompts, options);
}

// ---- Data validation -------------------------------------------------------
// Run by test/prompt-gen.test.mjs so a hand-edited prompts.json can't ship a
// dangling period id, a tension missing an intensity, or a duplicate id.

export function validateIntermediateData(data) {
  const errors = [];
  if (!data) return ["missing intermediate data"];
  const pools = ["universes", "timePeriods", "relationshipContexts", "tones", "locations", "tensions", "catalysts"];
  const periodIds = new Set((data.timePeriods || []).map((p) => p.id));
  const universeIds = new Set((data.universes || []).map((u) => u.id));

  for (const key of pools) {
    const list = data[key];
    if (!Array.isArray(list) || !list.length) { errors.push(`${key}: empty pool`); continue; }
    const seen = new Set();
    for (const it of list) {
      if (!it.id) errors.push(`${key}: item with no id`);
      else if (seen.has(it.id)) errors.push(`${key}: duplicate id ${it.id}`);
      seen.add(it.id);
      if (!it.label) errors.push(`${key}/${it.id}: no label`);
      if (key !== "tensions" && !it.text?.trim()) errors.push(`${key}/${it.id}: no text`);
      if (it.weight != null && !(Number(it.weight) > 0)) errors.push(`${key}/${it.id}: weight must be positive`);
      for (const pid of it.compatiblePeriods || [])
        if (!periodIds.has(pid)) errors.push(`${key}/${it.id}: unknown period ${pid}`);
      for (const uid of it.compatibleUniverses || [])
        if (!universeIds.has(uid)) errors.push(`${key}/${it.id}: unknown universe ${uid}`);
    }
  }
  // Every universe must be reachable: a universe no period admits could never
  // be generated, which is a data bug that would only show as a dull ballot.
  for (const u of data.universes || [])
    if (!(data.timePeriods || []).some((p) => !p.compatibleUniverses?.length || p.compatibleUniverses.includes(u.id)))
      errors.push(`universes/${u.id}: no time period admits it`);
  for (const p of data.timePeriods || [])
    if (p.ageGroup !== "minor" && p.ageGroup !== "adult")
      errors.push(`timePeriods/${p.id}: ageGroup must be minor or adult`);
  for (const t of data.tensions || [])
    for (const lvl of INTENSITIES)
      if (!t.variants?.[lvl]?.trim()) errors.push(`tensions/${t.id}: missing ${lvl} variant`);
  for (const t of data.templates || []) {
    if (!t.parts?.length) errors.push(`templates/${t.id}: no parts`);
    for (const part of t.parts || [])
      if (!PART_KEYS.includes(part)) errors.push(`templates/${t.id}: unknown part ${part}`);
  }
  return errors;
}
