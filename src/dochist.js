// Version history for solo writes — the copies a story can be taken back to.
// WHICH copies are kept is lib/doc-history.js (pure); this is the storing.
//
// One cold blob per kept copy (storage.cold: never in memory, never loaded at
// boot). Everything a LISTING needs rides in the blob's name —
//   <docId>_<at>_<reason>_<words>_<chapters>
// — so showing a story's history reads no copies at all.
import { storage } from "./storage.js";
import { keepReason, pruneHistory } from "../lib/doc-history.js";

const KIND = "dochist";
const NAME_RE = /^([0-9a-f-]{36})_(\d{10,16})_(time|drop|restore)_(\d+)_(\d+)$/;

/** @typedef {import("../lib/doc-history.js").HistoryMeta & { name: string }} HistoryEntry */

/** @returns {HistoryEntry | null} */
const parseName = (name) => {
  const m = NAME_RE.exec(name);
  return m ? { name, at: Number(m[2]), reason: /** @type {"time"|"drop"|"restore"} */ (m[3]), words: Number(m[4]), chapters: Number(m[5]) } : null;
};

/** What of a document is worth going back to. */
const snapshotOf = (doc) => ({
  title: doc.title || "",
  words: doc.wordCount || 0,
  chapters: (doc.chapters || []).map(({ id, title, html }) => ({ id, title, html })),
});

/** A story's kept copies, newest first. @returns {Promise<HistoryEntry[]>} */
export async function listHistory(docId) {
  const names = await storage.cold.list(KIND, docId + "_");
  return names.map(parseName).filter((e) => !!e).sort((a, b) => b.at - a.at);
}

/** One kept copy: `{title, words, chapters: [{id, title, html}]}`, or null. */
export async function readHistory(docId, at) {
  const hit = (await listHistory(docId)).find((e) => e.at === Number(at));
  if (!hit) return null;
  try { return JSON.parse((await storage.cold.get(KIND, hit.name)) || "null"); } catch { return null; }
}

/**
 * Called by a save with the copy it is about to REPLACE (`prev`, a snapshot
 * taken before the mutation) and the document as it now stands. Keeps `prev`
 * when the rules say so, then prunes. `force` keeps it regardless (a restore).
 * Never throws: history failing must not fail the save it rides on.
 * @param {string} docId
 * @param {{ words: number, chapters: unknown[] }} prev
 * @param {{ wordCount?: number, chapters?: unknown[] }} next
 * @param {{ force?: "restore" | null, now?: number }} [opts]
 * @returns {Promise<"time" | "drop" | "restore" | null>}
 */
export async function keepBeforeOverwrite(docId, prev, next, { force = null, now = Date.now() } = {}) {
  try {
    const entries = await listHistory(docId);
    const reason = force || keepReason(entries, { words: prev.words, chapters: prev.chapters.length }, { words: next.wordCount || 0, chapters: (next.chapters || []).length }, now);
    if (!reason) return null;
    const name = `${docId}_${now}_${reason}_${prev.words}_${prev.chapters.length}`;
    await storage.cold.put(KIND, name, JSON.stringify(prev));
    const all = [...entries, /** @type {HistoryEntry} */ (parseName(name))];
    const keep = new Set(pruneHistory(all, now).map((e) => e.name));
    for (const e of all) if (!keep.has(e.name)) await storage.cold.del(KIND, e.name);
    return reason;
  } catch (e) {
    console.error("dochist: could not keep a copy of", docId, e.message);
    return null;
  }
}

export { snapshotOf };
