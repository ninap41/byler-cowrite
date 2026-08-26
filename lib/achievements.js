// Achievements: two types.
//  - "words":  a ladder earned by total words written (currentBadge = highest tier)
//  - "usage":  collectible badges earned the FIRST time a committed story line
//              contains a trigger word/phrase (matched on sanitized, tag-stripped
//              text; never chat).
// The whole catalogue — names, thresholds, triggers, descriptions — lives in
// content/achievements.json (the fandom content pack), deliberately hand-editable.
// This ladder REPLACES the old Inkling→Living Legend one; migrateBadges()
// drops the legacy ids and recomputes tiers from wordCount.
//
// The catalogue is LIVE: /admin's badge editor PUTs a new document through
// setAchievements(), which validates it, writes the pack file (a Postgres row
// on Replit) and calls applyCatalogue() — every export below is a `let`
// binding recomputed there, so store.js/game.js/routes.js see the new ladder
// at once and usageMatches() awards a freshly added badge on the very next
// committed line. No restart.
import { readContent, writeContent } from "../src/content.js";
// The theme registry is the client's (public/js/theme.js has no DOM at top
// level, so the server can import it too) — one list of labels, not two.
import { THEME_LABELS } from "../public/js/theme.js";
// The gimmick registry: each entry names the THEME it belongs to, which is
// what gates it (see the gimmicks section below).
import { GIMMICKS } from "./gimmicks.js";

let CFG = {};

export let WORD_TIERS = [];
export let USAGE = []; // secret: triggers AND descriptions hidden until earned
export let USAGE_OPEN = []; // regular: descriptions always visible
let ALL_USAGE = [];
let ALL = [];
let MATCHERS = [];
let TIER_IDS = [];
export let THEME_UNLOCKS = {};
export let GIMMICK_UNLOCKS = {};

export const getAchievements = () => CFG;
export const badgeName = (id) => ALL.find((b) => b.id === id)?.name ?? null;
export const badgeDesc = (id) => ALL.find((b) => b.id === id)?.desc ?? null;
export const isUsageId = (id) => ALL_USAGE.some((b) => b.id === id);
export const isOpenUsageId = (id) => USAGE_OPEN.some((b) => b.id === id);

// Word-boundary matcher that tolerates non-word edges in the trigger itself
// ("michael?" needs the literal ? and no trailing boundary).
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const triggerRe = (t) => {
  const pre = /^\w/.test(t) ? "\\b" : "";
  const post = /\w$/.test(t) ? "\\b" : "";
  return new RegExp(pre + escapeRe(t) + post, "i");
};
// Two trigger kinds per usage badge, either or both:
//  - triggers: award when ANY listed word/phrase appears in the line
//  - combos:   award when EVERY word of one listed combination appears in the
//              same line (order-free — ["crazy","together"] matches
//              "together we go crazy" too)
// The json is hand-edited, so be forgiving: a combo written as a bare string
// acts like a single trigger, and empty/garbage entries are dropped instead
// of crashing the server at boot.
const cleanWords = (list) => (Array.isArray(list) ? list : [list]).filter((t) => typeof t === "string" && t.trim());
const buildMatchers = () =>
  ALL_USAGE.map((b) => ({
    id: b.id,
    res: cleanWords(b.triggers ?? []).map(triggerRe),
    combos: (b.combos ?? [])
      .map((c) => cleanWords(c).map(triggerRe))
      .filter((c) => c.length),
  }));

// ids of usage achievements whose trigger appears in the (plain-text) line
export const usageMatches = (text) =>
  MATCHERS.filter(
    (m) => m.res.some((re) => re.test(text)) || m.combos.some((c) => c.every((re) => re.test(text))),
  ).map((m) => m.id);

// Push any newly crossed word tiers; currentBadge is the highest earned tier.
export function awardWordBadges(u) {
  for (const t of WORD_TIERS) if (u.wordCount >= t.min && !u.badges.includes(t.id)) u.badges.push(t.id);
  u.currentBadge = [...WORD_TIERS].reverse().find((t) => u.badges.includes(t.id))?.id ?? null;
}

export const nextTierFor = (u) => WORD_TIERS.find((t) => u.wordCount < t.min) ?? null;

// ---- Themes as rank rewards -------------------------------------------------
// achievements.json's themeUnlocks maps a theme id to the wordTiers id that
// earns it. A theme that isn't listed is free; so is one pointing at a tier
// that no longer exists (the json is hand-edited — a typo must not lock a
// theme away forever). Admins get the whole set.
// The tier a theme needs, or null when anyone may wear it.
export const tierForTheme = (themeId) => THEME_UNLOCKS[themeId] ?? null;
// What the theme menu needs to explain a lock: the tier's name and its cost.
export const themeLocks = () =>
  Object.fromEntries(
    Object.entries(THEME_UNLOCKS).map(([theme, tierId]) => {
      const t = WORD_TIERS.find((x) => x.id === tierId);
      return [theme, { tier: tierId, name: t.name, min: t.min }];
    }),
  );

// Is this account's rank at or past the tier a theme asks for?
export function canUseTheme(u, themeId) {
  const tierId = tierForTheme(themeId);
  if (!tierId) return true;
  if (u?.admin === true) return true;
  return (u?.badges || []).includes(tierId);
}
// ---- Gimmicks as rank rewards (the same shape, one pool over) -------------
// A gimmick BELONGS to a theme (`theme` in its GIMMICKS registry entry,
// lib/gimmicks.js) and unlocks with it: its tier is read straight off
// themeUnlocks, so there is no second map to keep in sync — retier the theme
// in achievements.json and its gimmick moves with it. A gimmick whose theme
// is free (or unknown) is free; labels come from the registry names.
const GIMMICK_LABELS = Object.fromEntries(Object.entries(GIMMICKS).map(([id, g]) => [id, g.name]));
export const tierForGimmick = (id) => GIMMICK_UNLOCKS[id] ?? null;
export const gimmickLocks = () =>
  Object.fromEntries(
    Object.entries(GIMMICK_UNLOCKS).map(([id, tierId]) => {
      const t = WORD_TIERS.find((x) => x.id === tierId);
      return [id, { tier: tierId, name: t.name, min: t.min }];
    }),
  );
export function canUseGimmick(u, id) {
  const tierId = tierForGimmick(id);
  if (!tierId) return true;
  if (u?.admin === true) return true;
  return (u?.badges || []).includes(tierId);
}
// Every gated gimmick this account may start (admins: all; signed out: none).
export const unlockedGimmicks = (u) => Object.keys(GIMMICK_UNLOCKS).filter((id) => canUseGimmick(u, id));

// What crossing a tier hands out — the themes and gimmicks it unlocks, each
// as {id, name} so an announcement can name them. Empty lists when a rank is
// just a rank; the caller decides whether that's worth a sentence.
export function rewardsForTier(tierId) {
  const pick = (map, labels) =>
    Object.entries(map).filter(([, t]) => t === tierId).map(([id]) => ({ id, name: labels[id] || id }));
  return { themes: pick(THEME_UNLOCKS, THEME_LABELS), gimmicks: pick(GIMMICK_UNLOCKS, GIMMICK_LABELS) };
}
// Everything a set of freshly earned tiers unlocks, merged — a single big
// line can cross two tiers at once and the writer should hear about both.
export function rewardsForTiers(tierIds) {
  const out = { themes: [], gimmicks: [] };
  for (const id of tierIds) {
    const r = rewardsForTier(id);
    out.themes.push(...r.themes);
    out.gimmicks.push(...r.gimmicks);
  }
  return out;
}
// "the Upside Down theme" / "the Upside Down and Starcourt themes and the
// Foo gimmick" — the sentence fragment an announcement appends.
export function describeRewards(r) {
  const list = (xs) => xs.map((x) => x.name).reduce((acc, n, i, a) =>
    i === 0 ? n : i === a.length - 1 ? `${acc} and ${n}` : `${acc}, ${n}`, "");
  const parts = [];
  if (r.themes.length) parts.push(`the ${list(r.themes)} theme${r.themes.length > 1 ? "s" : ""}`);
  if (r.gimmicks.length) parts.push(`the ${list(r.gimmicks)} gimmick${r.gimmicks.length > 1 ? "s" : ""}`);
  return parts.join(" and ");
}

// Every theme this account may wear, gated ones included. Admins are handed
// the lot; a signed-out visitor gets only the free ones.
export function unlockedThemes(u, themes = Object.keys(THEME_UNLOCKS)) {
  const all = [...new Set([...themes, ...Object.keys(THEME_UNLOCKS)])];
  return all.filter((t) => canUseTheme(u, t));
}

// Swap the whole catalogue in: recompute every derived binding from `cfg`.
export function applyCatalogue(cfg) {
  CFG = cfg || {};
  WORD_TIERS = Array.isArray(CFG.wordTiers) ? CFG.wordTiers : [];
  USAGE = Array.isArray(CFG.usage) ? CFG.usage : [];
  USAGE_OPEN = Array.isArray(CFG.usageOpen) ? CFG.usageOpen : [];
  ALL_USAGE = [...USAGE, ...USAGE_OPEN];
  ALL = [...WORD_TIERS, ...ALL_USAGE];
  MATCHERS = buildMatchers();
  TIER_IDS = WORD_TIERS.map((t) => t.id);
  THEME_UNLOCKS = Object.fromEntries(
    Object.entries(CFG.themeUnlocks || {}).filter(([, tierId]) => TIER_IDS.includes(tierId)),
  );
  GIMMICK_UNLOCKS = Object.fromEntries(
    Object.entries(GIMMICKS)
      .map(([id, g]) => [id, THEME_UNLOCKS[g.theme]])
      .filter(([, tierId]) => TIER_IDS.includes(tierId)),
  );
}
applyCatalogue(readContent("achievements.json"));

// The admin editor's validation. Returns a list of errors; an empty list
// means `next` is a catalogue the rest of this module can run on. Ids are
// slugs (they end up in every account's `badges`), names carry the emoji,
// tiers need a word count. A usage badge with no triggers is legal — some
// are awarded by an event in the code (💩 Resume it, Stupid), not by words.
export const BADGE_ID_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const isStr = (s) => typeof s === "string" && s.trim().length > 0;
export function validateAchievements(next) {
  const errors = [];
  if (!next || typeof next !== "object") return ["The catalogue must be an object."];
  const seen = new Set();
  const checkId = (b, where) => {
    if (!BADGE_ID_RE.test(String(b?.id ?? ""))) errors.push(`${where}: "${b?.id}" isn't a valid id (lowercase slug).`);
    else if (seen.has(b.id)) errors.push(`${where}: the id "${b.id}" is used twice.`);
    seen.add(b?.id);
    if (!isStr(b?.name)) errors.push(`${where}: "${b?.id}" needs a name.`);
  };
  if (!Array.isArray(next.wordTiers) || !next.wordTiers.length) errors.push("wordTiers: need at least one rank.");
  else {
    for (const t of next.wordTiers) {
      checkId(t, "wordTiers");
      if (!Number.isInteger(t?.min) || t.min < 0) errors.push(`wordTiers: "${t?.id}" needs a whole-number word count (min).`);
    }
    if (!next.wordTiers.some((t) => t?.min === 0)) errors.push("wordTiers: one rank must start at 0 words — it's the badge every account wears.");
  }
  for (const pool of ["usage", "usageOpen"]) {
    const list = next[pool] ?? [];
    if (!Array.isArray(list)) { errors.push(`${pool}: must be a list.`); continue; }
    for (const b of list) {
      checkId(b, pool);
      if (b?.triggers != null && !Array.isArray(b.triggers)) errors.push(`${pool}: "${b?.id}" triggers must be a list of words.`);
      if (b?.combos != null && !Array.isArray(b.combos)) errors.push(`${pool}: "${b?.id}" combos must be a list of word lists.`);
    }
  }
  if (next.themeUnlocks && typeof next.themeUnlocks !== "object") errors.push("themeUnlocks: must be an object of theme → rank id.");
  return errors;
}

// The admin editor's write path: validate, write the pack file, swap it in.
export function setAchievements(next) {
  const errors = validateAchievements(next);
  if (errors.length) return errors;
  const doc = {
    ...CFG, // keeps the _readme notes and anything the editor doesn't touch
    wordTiers: next.wordTiers.map((t) => ({ id: t.id, name: t.name.trim(), min: t.min, desc: String(t.desc ?? "").trim() })).sort((a, b) => a.min - b.min),
    usage: (next.usage ?? []).map(cleanUsage),
    usageOpen: (next.usageOpen ?? []).map(cleanUsage),
    themeUnlocks: next.themeUnlocks && typeof next.themeUnlocks === "object" ? next.themeUnlocks : CFG.themeUnlocks || {},
  };
  writeContent("achievements.json", JSON.stringify(doc, null, "\t") + "\n");
  applyCatalogue(doc);
  return [];
}
const cleanUsage = (b) => ({
  id: b.id,
  name: b.name.trim(),
  ...(cleanWords(b.triggers ?? []).length ? { triggers: cleanWords(b.triggers ?? []).map((t) => t.trim()) } : {}),
  ...((b.combos ?? []).some((c) => cleanWords(c).length) ? { combos: b.combos.map((c) => cleanWords(c).map((t) => t.trim())).filter((c) => c.length) } : {}),
  desc: String(b.desc ?? "").trim(),
});

// One-time migration off the legacy ladder: drop unknown (legacy) badge ids,
// then recompute word tiers from wordCount. Returns true if anything changed.
export function migrateBadges(u) {
  const before = JSON.stringify([u.badges, u.currentBadge]);
  u.badges = (u.badges || []).filter((id) => ALL.some((b) => b.id === id));
  awardWordBadges(u);
  return JSON.stringify([u.badges, u.currentBadge]) !== before;
}
