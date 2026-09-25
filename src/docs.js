// Solo-write documents — one JSON blob per doc (data/docs/<id>.json locally,
// a doc/<id> row in Postgres on Replit — see src/storage.js). The doc dir
// lives UNDER the data dir so the test harness's temp COWRITE_DATA_DIR
// isolates docs for free.
import { randomUUID, randomBytes } from "crypto";
import { isThemeId } from "../public/js/shared/themes.js";
import { storage, getJson } from "./storage.js";
import { stripTags, plainText } from "./sanitize.js";

/**
 * The stored shapes. A document's prose and its comment threads are TWO
 * records (doc/<id> and comment/<id>): a beta reader writing on the margins
 * must never look, to the author's editor, like somebody editing the story.
 *
 * @typedef {{ id: string, title: string, html: string, wordCount?: number }} DocChapter
 * Reactions are the chat's shape, keyed by ACCOUNT id here (commentRows ships usernames).
 * @typedef {Record<string, { key: string, name: string, color?: string }[]>} DocReactions
 * `parentId` names the reply this one answers (absent = the note itself).
 * @typedef {{ id: string, userId: string, text: string, ts: number, editedAt?: number, parentId?: string, reactions?: DocReactions }} DocReply
 * Where a comment's words sat when it was made, in the chapter's plain text
 * (tags gone, entities decoded — what a DOM calls textContent), so an editor
 * that never received the anchor can put the underline back in place.
 * @typedef {{ chapterId: string, start: number, text: string, before: string, after: string }} CommentPos
 * @typedef {{
 *   id: string, cid: string, quote: string, userId: string, text: string,
 *   suggestion: string | null, ts: number, resolved: boolean, accepted: boolean,
 *   declined?: boolean, editedAt?: number, replies?: DocReply[], pos?: CommentPos,
 *   reactions?: DocReactions,
 * }} DocComment
 * @typedef {{ docId: string, comments: DocComment[] }} CommentRecord
 * `html` and `comments` are ATTACHED on read and never persisted in the doc
 * blob; `rev` counts the author's saves and is the only thing a save conflicts on.
 * @typedef {{
 *   id: string, ownerId: string, title: string, chapters: DocChapter[],
 *   betaReaders: string[], visibility: string, wordCount: number,
 *   createdAt: number, updatedAt: number, rev?: number,
 *   sprintWords?: number, sprints?: number, theme?: string | null,
 *   html?: string, comments: DocComment[],
 * }} Doc
 */

// Ids go straight into a filename — never trust one that isn't a plain uuid.
export const ID_RE = /^[0-9a-f-]{36}$/i;

export const cleanTitle = (t) => stripTags(String(t ?? "")).slice(0, 80) || "Untitled";
// Counted on plainText(): tags become spaces ("</h2><p>" separates two words)
// and entities are DECODED, so "don&#39;t" is one word — the same answer the
// editor's own counter gives, so the number doesn't move on a reload.
// Inline tags vanish WITHOUT a space first: "<b>won't</b>." is one word, not
// "won't" and a stray ".".
const INLINE_TAG = /<\/?(?:b|i|u|s|strong|em|del|span|a)(?:\s[^>]*)?>/gi;
export const countWords = (html) => {
  const text = plainText(String(html ?? "").replace(INLINE_TAG, ""));
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
};

// Documents saved while the sanitizer still re-escaped its own output carry
// `&amp;amp;…#39;` where an apostrophe was. Collapse any such run back to the
// one entity it started as. A no-op on healthy html, so it runs on every read.
export const repairEntities = (html) =>
  String(html ?? "").replace(/&(?:amp;)+(amp|lt|gt|quot|#39);/g, "&$1;");

// ---- chapters ----
// A document is a list of chapters, each its own html. `doc.html` is DERIVED —
// the chapters' html joined with no marker between them — and never stored:
// a one-chapter document's join is byte-identical to the old single blob, so
// every reader of `doc.html` (word counts, the anchor helpers, the reader
// comment guard's cid-uniqueness check, the stories listing) keeps working
// unchanged, and a marker would have leaked into the HTML view, the comment
// baseline and every export. Comments carry no chapter field: a comment's
// chapter is the one whose html holds its anchor (`chapterOfCid`).
export const CH_ID_RE = /^[0-9a-f]{12}$/;
export const MAX_CHAPTERS = 200;
export const newChapterId = () => randomBytes(6).toString("hex");
export const cleanChapterTitle = (t, n) => stripTags(String(t ?? "")).slice(0, 80) || `Chapter ${n}`;

// The migration, lazy: a blob written before chapters existed (html, no
// chapters) becomes one "Chapter 1" holding that html the first time it's read.
export function ensureChapters(doc) {
  if (!doc) return doc;
  if (!Array.isArray(doc.chapters) || !doc.chapters.length) {
    doc.chapters = [{ id: newChapterId(), title: "Chapter 1", html: String(doc.html ?? "") }];
  }
  doc.chapters = doc.chapters.map((c, i) => ({
    id: CH_ID_RE.test(String(c?.id ?? "")) ? c.id : newChapterId(),
    title: cleanChapterTitle(c?.title, i + 1),
    html: repairEntities(c?.html),
    wordCount: 0,
  }));
  return syncDocHtml(doc);
}

export const joinChapters = (doc) => (doc.chapters || []).map((c) => c.html).join("");
// Recompute everything derived from the chapters: per-chapter and total word
// counts and the joined html.
export function syncDocHtml(doc) {
  for (const c of doc.chapters) c.wordCount = countWords(c.html);
  doc.html = joinChapters(doc);
  doc.wordCount = doc.chapters.reduce((n, c) => n + c.wordCount, 0);
  return doc;
}
export const chapterById = (doc, id) => (doc?.chapters || []).find((c) => c.id === id) || null;
export const chapterOfCid = (doc, cid) =>
  cid ? (doc?.chapters || []).find((c) => anchorCids(c.html).includes(cid)) || null : null;
// Apply a string transform to every chapter's html and re-derive. The anchor
// helpers are no-ops on html without the cid, so callers need no lookup.
export function mapChapterHtml(doc, fn) {
  for (const c of doc.chapters) c.html = fn(c.html);
  return syncDocHtml(doc);
}

// The chapter ids are minted by `ensureChapters`, so a legacy blob read twice
// would carry two different ids — and a beta reader's comment names the id it
// was shown. The first read that upgrades a blob therefore writes the chaptered
// shape straight back (the html moved, nothing else: no `updatedAt` stamp, no
// anchor pruning — a read must not edit or reorder anything), so the id is the
// same on every read after.
/** @returns {Doc | null} */
export function readDoc(id) {
  if (!ID_RE.test(String(id || ""))) return null;
  const raw = getJson("doc", id);
  if (!raw) return null;
  const legacy = !Array.isArray(raw.chapters) || !raw.chapters.length;
  // a blob from before comments had their own record: move them out first
  const embedded = "comments" in raw;
  if (embedded) splitComments(raw);
  const doc = ensureChapters(raw);
  if (legacy || embedded) {
    try {
      storage.put("doc", doc.id, JSON.stringify({ ...doc, html: undefined, comments: undefined }, null, 1));
    } catch (e) {
      console.error("readDoc migration failed:", e.message);
    }
  }
  doc.comments = readComments(doc.id);
  return doc;
}

// ---- the comment record ----
// comment/<doc id> holds every thread on one document. Nothing in it is prose,
// so writing it never stamps the document and never moves `rev`.
/** @returns {DocComment[]} */
export function readComments(docId) {
  const rec = getJson("comment", docId);
  return Array.isArray(rec?.comments) ? rec.comments : [];
}

/** @param {Pick<Doc, "id" | "comments">} doc */
export function writeComments(doc) {
  const comments = Array.isArray(doc.comments) ? doc.comments : [];
  try {
    if (!comments.length) { if (storage.has("comment", doc.id)) storage.del("comment", doc.id); }
    else storage.put("comment", doc.id, JSON.stringify({ docId: doc.id, comments }, null, 1));
  } catch (e) {
    console.error("writeComments failed:", e.message);
  }
}

// The migration, one document: comments embedded in a doc blob (the shape
// before the split) are UNIONED by id into the comment record — never over
// it, so a half-finished run or a blob re-seeded from disk can't lose a
// thread — and dropped from the blob. The record is written FIRST: a crash in
// between leaves the comments in both places, and the next pass re-unions
// the same ids to the same answer. Returns how many comments moved.
function splitComments(raw) {
  const embedded = Array.isArray(raw.comments) ? raw.comments.filter((c) => c && c.id) : [];
  delete raw.comments;
  if (!embedded.length) return 0;
  const kept = readComments(raw.id);
  const known = new Set(kept.map((c) => c.id));
  const fresh = embedded.filter((c) => !known.has(c.id));
  if (fresh.length) writeComments({ id: raw.id, comments: [...kept, ...fresh].sort((a, b) => (a.ts || 0) - (b.ts || 0)) });
  return fresh.length;
}

// Boot-time sweep (server.js, right after storage.init): every document still
// carrying its comments is split. readDoc does the same lazily, so this is
// for the log line and so production is whole the moment it's up. Touches
// neither `updatedAt` nor the anchors — a migration is not an edit.
export function migrateDocComments() {
  let docs = 0, comments = 0;
  for (const id of storage.list("doc")) {
    const raw = getJson("doc", id);
    if (!raw || !("comments" in raw) || !ID_RE.test(String(raw.id || ""))) continue;
    const moved = splitComments(raw);
    // A blob from before CHAPTERS keeps its whole story in `html`. Chapters
    // first, THEN drop the derived field — stripping `html` from a blob that
    // has no chapters yet would write the story out of existence.
    // An already-chaptered blob is written back exactly as it was, minus its
    // comments: a migration is not an edit.
    const legacy = !Array.isArray(raw.chapters) || !raw.chapters.length;
    const doc = legacy ? ensureChapters(raw) : raw;
    storage.put("doc", doc.id, JSON.stringify({ ...doc, html: undefined }, null, 1));
    if (moved) { docs++; comments += moved; }
  }
  if (docs) console.log(`comments: migrated ${comments} comment${comments === 1 ? "" : "s"} out of ${docs} document${docs === 1 ? "" : "s"}`);
  return { docs, comments };
}

/** @param {Doc} doc */
export function writeDoc(doc) {
  // An anchor with no live comment behind it is not a legal state, and the
  // author's editor is the one thing that can reintroduce one: their undo
  // stack remembers the span, and a dirty editor ignores the server's html
  // push, so a resolve-then-undo-then-save used to smuggle the marker back in.
  // Every write goes through here, so this is where it's guaranteed — for
  // every chapter.
  ensureChapters(doc);
  mapChapterHtml(doc, (h) => pruneAnchors(h, doc.comments));
  doc.updatedAt = Date.now();
  // the derived join is never persisted — the chapters are the truth — and
  // the comments are their own record (writeComments)
  const json = JSON.stringify({ ...doc, html: undefined, comments: undefined }, null, 1);
  try {
    // The store answers reads from memory at once; whether the words reached
    // the DISK/DATABASE is this promise. Most callers don't wait (storage
    // retries a refused write by itself) — the author's save does, see docLanded.
    const landed = Promise.resolve(storage.put("doc", doc.id, json));
    landed.catch(() => {}); // storage logs it; an un-awaited write must not be an unhandled rejection
    landings.set(doc, landed);
  } catch (e) {
    console.error("writeDoc failed:", e.message);
    landings.set(doc, Promise.reject(e));
    landings.get(doc)?.catch(() => {});
  }
  return doc;
}

/** @type {WeakMap<object, Promise<unknown>>} */
const landings = new WeakMap();
/**
 * Resolves when the last writeDoc(doc) has actually been persisted, rejects
 * when the store refused it. "Saved" on the author's screen means this
 * resolved — the save route awaits it before answering.
 * @param {Doc} doc
 */
export const docLanded = (doc) => landings.get(doc) ?? Promise.resolve();

export function createDoc(ownerId, title) {
  const now = Date.now();
  return writeDoc({
    id: randomUUID(), ownerId, title: cleanTitle(title),
    chapters: [{ id: newChapterId(), title: "Chapter 1", html: "" }],
    betaReaders: [], visibility: "private", comments: [], // private until the author says otherwise
    wordCount: 0, createdAt: now, updatedAt: now, rev: 0,
  });
}

export function deleteDoc(id) {
  if (!ID_RE.test(String(id || ""))) return false;
  storage.del("doc", id);
  if (storage.has("comment", id)) storage.del("comment", id);
  return true;
}

export const allDocs = () => {
  return storage.list("doc").map(readDoc).filter(Boolean);
};

// Three visibility levels, narrowest first. "private" is invisible to everyone
// but the author, even to beta readers invited earlier; "readers" opens it to
// the invited friends, who may comment; "public" lets ANYONE read it, signed in
// or not — commenting stays with the invited readers, so going public never
// hands anyone a pen.
export const VISIBILITIES = ["private", "readers", "public"];
export const cleanVisibility = (v) => (VISIBILITIES.includes(v) ? v : "private");
// The theme readers see a public write in — the author's pick, a whitelisted
// id or nothing (readers then keep their own theme).
export const cleanTheme = (t) => (isThemeId(t) ? t : null);
export const isReader = (doc, userId) => (doc.betaReaders || []).includes(userId);
export const canEdit = (doc, userId) => !!doc && doc.ownerId === userId;
export const canView = (doc, userId) =>
  !!doc &&
  (doc.ownerId === userId ||
    doc.visibility === "public" ||
    (doc.visibility === "readers" && isReader(doc, userId)));
// Commenting is the beta-reader right, NOT a side effect of being able to see
// it: a public reader reads and nothing more.
export const canComment = (doc, userId) =>
  !!doc && (doc.ownerId === userId || (doc.visibility !== "private" && isReader(doc, userId)));

// Listing shape — never carries the document body.
export const docSummary = (doc, nameOf) => ({
  id: doc.id,
  title: doc.title,
  wordCount: doc.wordCount || 0,
  sprintWords: doc.sprintWords || 0,
  sprints: doc.sprints || 0,
  visibility: doc.visibility,
  theme: doc.theme || null,
  updatedAt: doc.updatedAt,
  createdAt: doc.createdAt,
  owner: nameOf(doc.ownerId),
  readers: (doc.betaReaders || []).map(nameOf).filter(Boolean),
  comments: (doc.comments || []).length,
  chapters: (doc.chapters || []).length || 1,
});

// The /writes shelf is YOUR writes plus the ones you were invited to beta
// read — a public document belongs to the all-stories page, not to everyone's
// personal shelf.
const onMyShelf = (doc, userId) =>
  doc.ownerId === userId || (doc.visibility === "readers" && isReader(doc, userId));

// Public writes, for the all-stories listing. "Public" means LISTED: one tier
// fewer to explain than a link-only one.
export const publicDocs = () => allDocs().filter((d) => d.visibility === "public");
// Everything ONE writer has written, private included, newest first — for
// their profile and their /stories?user= page, where a private write is
// still LISTED (it exists) but only opens for someone allowed to read it.
export const docsOwnedBy = (userId) =>
  allDocs().filter((d) => d.ownerId === userId).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

export const listDocsFor = (userId, nameOf) =>
  allDocs()
    .filter((d) => onMyShelf(d, userId))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map((d) => ({ ...docSummary(d, nameOf), mine: d.ownerId === userId, viewable: canView(d, userId) }));

// ---- comment anchors ----
// A comment is pinned to the text it's about by a marker span the author's html
// carries: <span class="cmt" data-cid="…">the commented words</span>. Anchors
// ride inside the saved html, so they survive edits elsewhere in the paragraph
// the way Google Docs' do — and sanitizeDoc() is what guarantees the shape.
//
// These are string surgery, not DOM: the server has no DOM, and the html is
// already sanitized, so the tags are in exactly one known form.
const ANCHOR_RE = /<span class="cmt" data-cid="([0-9a-f]{12})">/g;
const escText = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const anchorCids = (html) => [...String(html ?? "").matchAll(ANCHOR_RE)].map((m) => m[1]);

// Locate one anchor, counting span nesting so a size span inside the comment
// doesn't close it early.
function anchorSpan(html, cid) {
  const open = `<span class="cmt" data-cid="${cid}">`;
  const at = String(html ?? "").indexOf(open);
  if (at < 0) return null;
  const from = at + open.length;
  const re = /<span\b[^>]*>|<\/span>/g;
  re.lastIndex = from;
  let depth = 1, m;
  while ((m = re.exec(html))) {
    depth += m[0] === "</span>" ? -1 : 1;
    if (depth === 0) return { at, from, to: m.index, end: m.index + m[0].length };
  }
  return null; // unbalanced — leave the html alone rather than corrupt it
}

// Unwrap the anchor, keeping the text: what a resolved/rejected/deleted comment
// leaves behind. The words stay; only the underline goes.
export function stripAnchor(html, cid) {
  const s = anchorSpan(html, cid);
  return s ? html.slice(0, s.at) + html.slice(s.from, s.to) + html.slice(s.end) : String(html ?? "");
}

// Strip EVERY comment anchor, leaving the words. Used to compare a reader's
// submitted html against the stored one ignoring where the underlines sit, so
// a beta reader's comment isn't refused just because the two serialize their
// anchor spans in a different order or byte-shape.
export function stripAnchors(html) {
  let out = String(html ?? "");
  for (const cid of anchorCids(out)) out = stripAnchor(out, cid);
  return out;
}

// Merge adjacent identical inline formatting tags that got SPLIT apart. When a
// beta reader wraps a comment anchor around part of a run of italic (or bold,
// etc.) text, the browser splits the <i> into <i>…</i><span cmt>…</span><i>…</i>;
// after the anchor is stripped that leaves <i>…</i><i>…</i>, which is the same
// prose but not the same bytes as the stored <i>……</i>. Collapsing the seam
// makes the two comparable so the comment isn't refused for formatting the
// reader never actually changed.
const INLINE_SEAM = /<\/(i|em|b|strong|u|s|del)>(\s*)<\1>/gi;
export function normalizeInline(html) {
  let out = String(html ?? ""), prev;
  do { prev = out; out = out.replace(INLINE_SEAM, "$2"); } while (out !== prev);
  return out;
}

// The comparable shape of a document's html for the reader-comment guard:
// anchors gone, split inline runs rejoined.
export const commentBaseline = (html) => normalizeInline(stripAnchors(html));

// The cids that may legally wear an underline: a comment that still exists
// and hasn't been resolved. Resolving deliberately un-underlines the words, so
// a resolved comment's cid is no more anchorable than a deleted one's.
export const liveCids = (comments) =>
  new Set((comments || []).filter((c) => c && !c.resolved && c.cid).map((c) => c.cid));

// Unwrap every anchor whose comment is gone or resolved. The words always
// stay — only the marker goes.
export function pruneAnchors(html, comments) {
  const live = liveCids(comments);
  let out = String(html ?? "");
  for (const cid of anchorCids(out)) if (!live.has(cid)) out = stripAnchor(out, cid);
  return out;
}

// Accept a suggestion: the anchored text becomes the proposed text, and the
// anchor goes with it. Inline formatting inside the range is replaced too —
// a suggestion proposes words, not markup.
export function applySuggestion(html, cid, text) {
  const s = anchorSpan(html, cid);
  return s ? html.slice(0, s.at) + escText(text) + html.slice(s.end) : String(html ?? "");
}

// The text a comment currently points at, tags stripped — used to show readers
// what they're commenting on, and to spot anchors whose words have changed.
export function anchorText(html, cid) {
  const s = anchorSpan(html, cid);
  return s ? stripTags(html.slice(s.from, s.to)) : "";
}

// The anchored words as a DOM would read them: tags gone with NO space put in
// their place, entities decoded. (`stripTags`/`plainText` are for counting and
// quoting; this one has to agree with textContent offset for offset.)
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
const domText = (html) =>
  String(html ?? "").replace(/<[^>]+>/g, "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== "#") return NAMED[e.toLowerCase()] ?? m;
    const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });

// Where an anchor sits in its chapter's text, with a little of what surrounds
// it — enough for the author's editor to find the same words again after the
// author has typed elsewhere (see placeAnchor in the client's comment-sync).
const POS_CONTEXT = 32;
/** @returns {Omit<CommentPos, "chapterId"> | null} */
export function anchorPos(html, cid) {
  const s = anchorSpan(html, cid);
  if (!s) return null;
  const before = domText(html.slice(0, s.at));
  const text = domText(html.slice(s.from, s.to));
  const after = domText(html.slice(s.end));
  return { start: before.length, text: text.slice(0, 1000), before: before.slice(-POS_CONTEXT), after: after.slice(0, POS_CONTEXT) };
}
