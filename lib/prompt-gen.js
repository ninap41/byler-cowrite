// Prompt generation: the pure rules half. No I/O, no DOM, no sockets — the
// data comes from prompts.json (curated `prompts` array + the `intermediate`
// component pools) and both the server and the tests call these directly.
//
// Two modes ship today (docs/PROMPT_GENERATION.md):
//   simple       — one curated complete prompt, untouched.
//   intermediate — a prompt assembled from AXES (season, canon, place,
//                  situation, relationship, tone) plus ONE weighted trope
//                  from the trope bank and, when the season allows, the
//                  explicit layer. Tags are short strings, weighted and
//                  combined the way AO3 tags are.
// Advanced mode is deliberately not here yet; MODES is the list that exists.

export const MODES = ["simple", "intermediate"];
export const EXPLICIT_LEVELS = ["none", "suggestive", "explicit"];
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

// Age comes from the SEASON and nowhere else: post-canon / future-fic is the
// adult one, every on-screen season is minors.
export const isAdult = (season) => season?.ageGroup === "adult";

export function isCompatible(item, context = {}) {
  const season = context.season;
  const canon = context.canon;
  if (item.compatibleAgeGroups?.length && season && !item.compatibleAgeGroups.includes(season.ageGroup))
    return false;
  // Age safety is a generation rule, not a UI one: adult-only components never
  // reach a season where Mike and Will are minors.
  if (item.adultOnly && season && !isAdult(season)) return false;
  // A setting AU belongs to the AU canon; a fix-it belongs to a divergence.
  if (item.compatibleCanon?.length && canon && !item.compatibleCanon.includes(canon.id)) return false;
  const active = context.activeTags instanceof Set ? context.activeTags : new Set(context.activeTags || []);
  if (item.incompatibleTags?.some((t) => active.has(t))) return false;
  if (item.requiresTags?.some((t) => !active.has(t))) return false;
  if (context.group && item.group !== context.group) return false;
  return true;
}

const byId = (list, id) => (id ? (list || []).find((x) => x.id === id) || null : null);

// Explicit id wins; "random"/missing falls through to a weighted pick over the
// compatible pool. A filter that empties the pool falls back to the whole
// list rather than failing the generation.
function resolve(list, wanted, context, rng, recentIds) {
  const chosen = byId(list, wanted && wanted !== "random" ? wanted : null);
  if (chosen) return chosen;
  const pool = (list || []).filter((it) => isCompatible(it, context));
  return pickWeighted(pool, rng, recentIds) || pickWeighted(list || [], rng, recentIds);
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

// An assembled prompt is a stack of distinct decisions, so it renders as one
// bulleted clause per LINE — run together it reads as a wall of prose. It stays
// PLAIN TEXT (the bullet is a character, not markup): the surfaces that show a
// whole prompt set `white-space: pre-line` with a hanging indent, so nothing
// downstream — snapshot, archive, export, PDF — has to learn a format.
export const BULLET = "• ";
export const bulletList = (parts) => parts.map((p) => BULLET + p).join("\n");
// The reverse, for anywhere a prompt has to collapse back to one line.
export const unbullet = (prompt) =>
  String(prompt || "").split("\n").map((l) => l.replace(/^• /, "")).join(" ").trim();
// Tags inside one line join AO3-style.
export const TAG_SEP = " · ";
// The category names a clause can open with, in prompt order.
export const CATEGORIES = ["Season", "Canon", "Place", "Relationship", "Situation", "Trope", "Tone", "Rating", "Kinks"];

// The explicit gate. It runs BEFORE any tag weighting: a season where they are
// minors forces the level down to none/suggestive and hides the kink layer
// entirely; it is not a filter applied to a dealt result.
export function gateExplicit(level, season) {
  const want = EXPLICIT_LEVELS.includes(level) ? level : "none";
  if (want === "explicit" && !isAdult(season)) return "suggestive";
  return want;
}

// "power bottom" + who → "power bottom (Will)"; a `who` template names the
// role ("{name} is the brat"). A tag with `only` always lands on that one
// character (service top is Mike's). A tag with no role, or no character, is bare.
export function withWho(tag, who) {
  const name = tag?.only || who;
  if (!tag?.who || !name) return tag?.text || "";
  return `${tag.text} (${String(tag.who).replace(/\{name\}/g, name)})`;
}

// Draw `n` distinct items from a pool, weighted, without replacement.
function drawDistinct(list, n, context, rng, recentIds, taken = new Set()) {
  const out = [];
  let pool = (list || []).filter((it) => isCompatible(it, context) && !taken.has(it.id));
  while (out.length < n && pool.length) {
    const pick = pickWeighted(pool, rng, recentIds);
    out.push(pick);
    taken.add(pick.id);
    pool = pool.filter((it) => it.id !== pick.id);
  }
  return out;
}

export function generateIntermediatePrompt(data, options = {}) {
  const seed = options.seed || makeSeed();
  const rng = createSeededRandom(seed);
  const recent = options.recentIds || [];
  const locked = options.locked || {};
  const want = (key) => locked[key] ?? options[key];

  const ctx = { activeTags: new Set() };

  // Season first — it fixes the age, and the age decides whether the explicit
  // layer even exists for this prompt. Asking for explicit with the season on
  // Random means an adult season: the host's ask is honoured by narrowing the
  // pool, never by dealing something the gate would have to undo.
  const askedLevel = EXPLICIT_LEVELS.includes(options.explicitLevel) ? options.explicitLevel : "none";
  const seasonWanted = want("seasonId");
  const seasonPicked = seasonWanted && seasonWanted !== "random";
  const seasonPool = !seasonPicked && askedLevel === "explicit" && (data.seasons || []).some(isAdult)
    ? data.seasons.filter(isAdult) : data.seasons;
  const season = resolve(seasonPool, seasonWanted, ctx, rng, recent);
  ctx.season = season;
  addTags(ctx.activeTags, season);
  let explicitLevel = gateExplicit(askedLevel, season);
  // The rating is a tag too, so a tone that can't be explicit (fluff, crack)
  // steps aside when explicit was asked for…
  if (explicitLevel === "explicit") ctx.activeTags.add("explicit");

  // Canon second — it decides whether a setting AU is thinkable at all. A
  // chosen world implies the AU canon: picking Cleradin with Canon on Random
  // means Cleradin, not a coin toss.
  const worldWanted = want("worldId");
  const worldPicked = byId(data.tropes, worldWanted)?.group === "setting-au" ? byId(data.tropes, worldWanted) : null;
  const canonWanted = worldPicked && (!want("canonId") || want("canonId") === "random") ? "au" : want("canonId");
  const canon = resolve(data.canon, canonWanted, ctx, rng, recent);
  ctx.canon = canon;
  addTags(ctx.activeTags, canon);

  const relationship = resolve(data.relationships, want("relationshipId"), ctx, rng, recent);
  addTags(ctx.activeTags, relationship);
  const situation = resolve(data.situations, want("situationId"), ctx, rng, recent);
  addTags(ctx.activeTags, situation);
  const tone = resolve(data.tones, want("toneId"), ctx, rng, recent);
  addTags(ctx.activeTags, tone);
  // …and vice versa: a tone the host CHOSE that can't be explicit brings the
  // rating down to suggestive rather than dealing explicit fluff.
  if (explicitLevel === "explicit" && tone?.tags?.includes("no-explicit")) {
    explicitLevel = "suggestive";
    ctx.activeTags.delete("explicit");
  }

  // In an AU the world comes first — "alternate universe" on its own says
  // nothing about which — and it rides the Canon line, not a trope slot.
  const world = canon?.id === "au"
    ? worldPicked || drawDistinct(data.tropes, 1, { ...ctx, group: "setting-au" }, rng, recent)[0] || null
    : null;
  addTags(ctx.activeTags, world);
  // ONE trope per prompt, from every group but the worlds.
  const rest = (data.tropes || []).filter((t) => t.group !== "setting-au");
  const lockedTrope = byId(rest, locked.tropeId);
  const tropes = lockedTrope ? [lockedTrope] : drawDistinct(rest, 1, ctx, rng, recent);
  for (const t of tropes) addTags(ctx.activeTags, t);

  // A setting AU IS the place — "road trip" beside "summer camp" is two
  // places — so the Place axis only deals when no world was drawn.
  const place = world ? null : resolve(data.places, want("placeId"), ctx, rng, recent);
  addTags(ctx.activeTags, place);

  // The explicit layer: only past the gate, and dealt as tags on one line.
  const ex = data.explicit || {};
  let explicit = null;
  if (explicitLevel === "explicit" && isAdult(season)) {
    const one = (list) => drawDistinct(list, 1, ctx, rng, recent)[0] || null;
    const setup = one(ex.setups);
    addTags(ctx.activeTags, setup);
    const dynamic = one(ex.dynamics);
    // the dynamic's tags are in play for the rest of the line, so a kink
    // that duplicates it ("edging" twice) can rule itself out
    addTags(ctx.activeTags, dynamic);
    const acts = drawDistinct(ex.acts, 1 + Math.floor(rng() * 2), ctx, rng, recent);
    for (const a of acts) addTags(ctx.activeTags, a);
    const kinks = drawDistinct(ex.kinks, 1 + Math.floor(rng() * 2), ctx, rng, recent);
    const register = one(ex.registers);
    // one time in five, a ridiculous twist rides the line too
    const twist = ex.twists?.length && rng() < 0.2 ? one(ex.twists) : null;
    // A role lands on somebody: a tag with `who` names one of the pack's
    // characters ("power bottom (Will)") — the pick is seeded like the rest.
    const names = data.characters?.length ? data.characters : [];
    const who = names.length ? names[Math.floor(rng() * names.length)] : null;
    explicit = { setup, dynamic, acts, kinks, register, twist, who };
  }
  const levelItem = byId(ex.levels, explicitLevel);

  // Every clause is "Category: choice" — the category names are fixed
  // (CATEGORIES) so the client can colour each one consistently.
  const line = (cat, text) => (text ? `${cat}: ${text}` : null);
  const parts = [
    line("Season", season?.text),
    line("Canon", [canon, world].filter(Boolean).map((t) => t.text).join(TAG_SEP)),
    line("Place", place?.text),
    line("Relationship", relationship?.text), line("Situation", situation?.text),
    ...tropes.map((t) => line("Trope", t.text)),
    line("Tone", tone?.text),
  ].filter(Boolean);
  if (explicitLevel === "suggestive") parts.push(line("Rating", levelItem?.text || "suggestive"));
  if (explicit) {
    parts.push(line("Rating", levelItem?.text || "explicit"));
    // the whole layer is one line — setup, dynamic, acts, kinks, register —
    // read together as the tags on the work
    parts.push(line("Kinks", [explicit.setup, explicit.dynamic, ...explicit.acts, ...explicit.kinks, explicit.register, explicit.twist]
      .filter(Boolean).map((t) => withWho(t, explicit.who)).join(TAG_SEP)));
  }

  const idsOf = (list) => list.map((t) => t.id);
  const labelsOf = (list) => list.map((t) => t.label);
  return {
    mode: "intermediate",
    prompt: bulletList(parts),
    seed,
    explicitLevel,
    selections: {
      seasonId: season?.id,
      canonId: canon?.id,
      ...(place ? { placeId: place.id } : {}),
      relationshipId: relationship?.id,
      situationId: situation?.id,
      toneId: tone?.id,
      ...(world ? { worldId: world.id } : {}),
      tropeIds: idsOf(tropes),
      explicitLevel,
      ...(explicit ? {
        explicit: {
          setupId: explicit.setup?.id, dynamicId: explicit.dynamic?.id,
          actIds: idsOf(explicit.acts), kinkIds: idsOf(explicit.kinks), registerId: explicit.register?.id,
          ...(explicit.who ? { who: explicit.who } : {}),
          ...(explicit.twist ? { twistId: explicit.twist.id } : {}),
        },
      } : {}),
    },
    // Labels ride along so the UI can show chips without re-reading the pools.
    labels: {
      season: season?.label,
      canon: canon?.label,
      ...(world ? { world: world.label } : {}),
      ...(place ? { place: place.label } : {}),
      relationship: relationship?.label,
      situation: situation?.label,
      tropes: labelsOf(tropes),
      tone: tone?.label,
      ...(explicitLevel !== "none" ? { explicit: levelItem?.label || explicitLevel } : {}),
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
// duplicate id, an empty clause, a trope in a group nobody named, or an
// explicit level that forgot to be adult-only.

export const AXIS_POOLS = ["seasons", "canon", "places", "situations", "relationships", "tones", "tropes"];
export const EXPLICIT_POOLS = ["levels", "setups", "dynamics", "acts", "kinks", "registers"];

function validatePool(errors, key, list, { needText = true } = {}) {
  if (!Array.isArray(list) || !list.length) { errors.push(`${key}: empty pool`); return; }
  const seen = new Set();
  for (const it of list) {
    if (!it.id) errors.push(`${key}: item with no id`);
    else if (seen.has(it.id)) errors.push(`${key}: duplicate id ${it.id}`);
    else if (!/^[a-z0-9-]+$/.test(it.id)) errors.push(`${key}: id ${it.id} is not a slug`);
    seen.add(it.id);
    if (!it.label) errors.push(`${key}/${it.id}: no label`);
    if (needText && !it.text?.trim()) errors.push(`${key}/${it.id}: no text`);
    if (it.weight != null && !(Number(it.weight) > 0)) errors.push(`${key}/${it.id}: weight must be positive`);
    for (const g of it.compatibleAgeGroups || [])
      if (g !== "minor" && g !== "adult") errors.push(`${key}/${it.id}: unknown age group ${g}`);
  }
}

export function validateIntermediateData(data) {
  const errors = [];
  if (!data) return ["missing intermediate data"];
  for (const key of AXIS_POOLS) validatePool(errors, key, data[key]);
  for (const s of data.seasons || [])
    if (s.ageGroup !== "minor" && s.ageGroup !== "adult") errors.push(`seasons/${s.id}: ageGroup must be minor or adult`);
  if (!(data.seasons || []).some(isAdult)) errors.push("seasons: no adult season, the explicit layer is unreachable");
  const canonIds = new Set((data.canon || []).map((c) => c.id));
  for (const key of AXIS_POOLS)
    for (const it of data[key] || [])
      for (const c of it.compatibleCanon || [])
        if (!canonIds.has(c)) errors.push(`${key}/${it.id}: unknown canon ${c}`);
  for (const t of data.tropes || []) {
    if (!t.group) errors.push(`tropes/${t.id}: no group`);
    else if (!data.tropeGroups?.[t.group]?.trim()) errors.push(`tropes/${t.id}: group ${t.group} has no tropeGroups entry`);
  }
  if (!(data.tropes || []).some((t) => t.group === "setting-au")) errors.push("tropes: no setting-au group, AUs would have no world");
  const ex = data.explicit;
  if (!ex) { errors.push("explicit: missing layer"); return errors; }
  for (const key of EXPLICIT_POOLS) validatePool(errors, "explicit/" + key, ex[key], { needText: key !== "levels" });
  if (ex.twists) validatePool(errors, "explicit/twists", ex.twists); // optional pool
  for (const lvl of EXPLICIT_LEVELS)
    if (!(ex.levels || []).some((l) => l.id === lvl)) errors.push(`explicit/levels: missing ${lvl}`);
  if (!(ex.levels || []).find((l) => l.id === "explicit")?.adultOnly) errors.push("explicit/levels: explicit must be adultOnly");
  return errors;
}
