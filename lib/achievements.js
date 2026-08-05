// Achievements: two types.
//  - "words":  a ladder earned by total words written (currentBadge = highest tier)
//  - "usage":  collectible badges earned the FIRST time a committed story line
//              contains a trigger word/phrase (matched on sanitized, tag-stripped
//              text; never chat).
// The whole catalogue — names, thresholds, triggers, descriptions — lives in
// achievements.json at the repo root, deliberately hand-editable.
// This ladder REPLACES the old Inkling→Living Legend one; migrateBadges()
// drops the legacy ids and recomputes tiers from wordCount.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CFG = JSON.parse(readFileSync(join(__dirname, "..", "achievements.json"), "utf-8"));

export const WORD_TIERS = CFG.wordTiers;
export const USAGE = CFG.usage; // secret: triggers AND descriptions hidden until earned
export const USAGE_OPEN = CFG.usageOpen || []; // regular: descriptions always visible

const ALL_USAGE = [...USAGE, ...USAGE_OPEN];
const ALL = [...WORD_TIERS, ...ALL_USAGE];
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
const MATCHERS = ALL_USAGE.map((b) => ({
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

// One-time migration off the legacy ladder: drop unknown (legacy) badge ids,
// then recompute word tiers from wordCount. Returns true if anything changed.
export function migrateBadges(u) {
  const before = JSON.stringify([u.badges, u.currentBadge]);
  u.badges = (u.badges || []).filter((id) => ALL.some((b) => b.id === id));
  awardWordBadges(u);
  return JSON.stringify([u.badges, u.currentBadge]) !== before;
}
