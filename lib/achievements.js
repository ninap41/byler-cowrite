// Achievements: two types.
//  - "words":  a ladder earned by total words written (currentBadge = highest tier)
//  - "usage":  collectible badges earned the FIRST time a committed story line
//              contains a trigger word/phrase (matched on sanitized, tag-stripped
//              text; never chat). Placeholder emojis for now.
// This ladder REPLACES the old Inkling→Living Legend one; migrateBadges()
// drops the legacy ids and recomputes tiers from wordCount.

export const WORD_TIERS = [
  { id: "outloud", name: "🔫 There. Out Loud.", min: 0, desc: "Made an account. Said it — there, out loud." },
  { id: "puppymike", name: "🐶 Puppy Mike", min: 5000, desc: "Write 5,000 words." },
  { id: "practice", name: "🪄 Practice", min: 10000, desc: "Write 10,000 words. Practice makes canon." },
  { id: "sorcerer", name: "🧙 Sorcerer", min: 20000, desc: "Write 20,000 words." },
  { id: "innate", name: "⚡ Innate Powers", min: 30000, desc: "Write 30,000 words." },
  { id: "explorer", name: "🧭 Explorer", min: 50000, desc: "Write 50,000 words." },
  { id: "bestfriend", name: "💛 A Best \"Friend\"", min: 100000, desc: "Write 100,000 words. A best 'friend' indeed." },
];

// Usage descs are revealed ONLY on earned badges (via publicUser.badgeDescs) —
// /api/achievements never ships them, so unearned ones stay a mystery.
export const USAGE = [
  { id: "omega", name: "🐺 Omega Badge", triggers: ["puppy"], desc: "A story line said “puppy.” Good boy." },
  { id: "justthetip", name: "🐓 Just the tip.", triggers: ["cock"], desc: "You wrote it. Just the tip, though." },
  { id: "smuttybuddy", name: "😏 Smutty Buddy", triggers: ["moan", "moaning"], desc: "A moan made it into the story." },
  { id: "ughmike", name: "🙄 Ugh, Mike...", triggers: ["michael?"], desc: "Someone wrote “Michael?” — ugh, Mike…" },
];

const ALL = [...WORD_TIERS, ...USAGE];
export const badgeName = (id) => ALL.find((b) => b.id === id)?.name ?? null;
export const badgeDesc = (id) => ALL.find((b) => b.id === id)?.desc ?? null;
export const isUsageId = (id) => USAGE.some((b) => b.id === id);

// Word-boundary matcher that tolerates non-word edges in the trigger itself
// ("michael?" needs the literal ? and no trailing boundary).
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const triggerRe = (t) => {
  const pre = /^\w/.test(t) ? "\\b" : "";
  const post = /\w$/.test(t) ? "\\b" : "";
  return new RegExp(pre + escapeRe(t) + post, "i");
};
const MATCHERS = USAGE.map((b) => ({ id: b.id, res: b.triggers.map(triggerRe) }));

// ids of usage achievements whose trigger appears in the (plain-text) line
export const usageMatches = (text) =>
  MATCHERS.filter((m) => m.res.some((re) => re.test(text))).map((m) => m.id);

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
