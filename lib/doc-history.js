// Which saved copies of a story are worth keeping — pure rules, no I/O
// (src/dochist.js does the storing). History is spaced by TIME, never per
// save: the editor autosaves every 30 seconds, so "the last N saves" would
// cover a couple of minutes and, after an accident, all be the damaged copy.
//
// Three tiers:
//   recent — at most one copy per RECENT_GAP_MS, the newest RECENT_KEEP
//            (a few hours of writing: "I broke it this afternoon")
//   daily  — the last copy of each day for KEEP_DAYS ("I noticed this morning")
//   drop   — the copy from just BEFORE a save that lost a lot of words or a
//            chapter; always kept, whatever the spacing, for KEEP_DAYS. That
//            is what an accident looks like from the server's side.
//   restore — the copy a Restore replaced, so a restore can itself be undone.

export const RECENT_GAP_MS = 10 * 60 * 1000;
export const RECENT_KEEP = 12;
export const KEEP_DAYS = 14;
export const DROP_KEEP = 10;
export const DROP_WORDS = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {{ at: number, reason: "time" | "drop" | "restore", words: number, chapters: number }} HistoryMeta
 */

/**
 * Should the copy being REPLACED be kept? `entries` are the ones already kept.
 * @param {HistoryMeta[]} entries
 * @param {{ words: number, chapters: number }} prev  the stored copy, about to be overwritten
 * @param {{ words: number, chapters: number }} next  what is replacing it
 * @param {number} now
 * @returns {"time" | "drop" | null}
 */
export function keepReason(entries, prev, next, now) {
  if (!prev || !(prev.words > 0)) return null; // an empty story is nothing to go back to
  if (prev.words - next.words > DROP_WORDS || next.chapters < prev.chapters) return "drop";
  const newest = entries.reduce((m, e) => Math.max(m, e.at), 0);
  return now - newest >= RECENT_GAP_MS ? "time" : null;
}

const dayOf = (at) => Math.floor(at / DAY_MS);

/**
 * The entries to KEEP, oldest first. Everything else may be deleted.
 * @template {HistoryMeta} T
 * @param {T[]} entries
 * @param {number} now
 * @returns {T[]}
 */
export function pruneHistory(entries, now) {
  const fresh = entries.filter((e) => now - e.at <= KEEP_DAYS * DAY_MS).sort((a, b) => b.at - a.at); // newest first
  const keep = new Set();
  // the accidents and the undone restores: the newest DROP_KEEP of them
  fresh.filter((e) => e.reason !== "time").slice(0, DROP_KEEP).forEach((e) => keep.add(e));
  // a few hours back, copy by copy
  fresh.slice(0, RECENT_KEEP).forEach((e) => keep.add(e));
  // and one a day behind that: the last copy of each day
  const days = new Set();
  for (const e of fresh) {
    if (days.has(dayOf(e.at))) continue;
    days.add(dayOf(e.at));
    keep.add(e);
  }
  return [...keep].sort((a, b) => a.at - b.at);
}
