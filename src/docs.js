// Solo-write documents — one JSON blob per doc (data/docs/<id>.json locally,
// a doc/<id> row in Postgres on Replit — see src/storage.js). The doc dir
// lives UNDER the data dir so the test harness's temp COWRITE_DATA_DIR
// isolates docs for free.
import { randomUUID, randomBytes } from "crypto";
import { storage, getJson } from "./storage.js";
import { stripTags } from "./sanitize.js";

// Ids go straight into a filename — never trust one that isn't a plain uuid.
export const ID_RE = /^[0-9a-f-]{36}$/i;

export const cleanTitle = (t) => stripTags(String(t ?? "")).slice(0, 80) || "Untitled";
// Tags become spaces, not nothing: "</h2><p>" separates two words, and
// stripTags alone would glue them into one.
export const countWords = (html) => {
  const text = stripTags(String(html ?? "").replace(/<[^>]+>/g, " "));
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
};

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
    html: String(c?.html ?? ""),
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
export function readDoc(id) {
  if (!ID_RE.test(String(id || ""))) return null;
  const raw = getJson("doc", id);
  if (!raw) return null;
  const legacy = !Array.isArray(raw.chapters) || !raw.chapters.length;
  const doc = ensureChapters(raw);
  if (legacy) {
    try {
      storage.put("doc", doc.id, JSON.stringify({ ...doc, html: undefined }, null, 1));
    } catch (e) {
      console.error("readDoc migration failed:", e.message);
    }
  }
  return doc;
}

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
  // the derived join is never persisted — the chapters are the truth
  const json = JSON.stringify({ ...doc, html: undefined }, null, 1);
  try {
    storage.put("doc", doc.id, json);
  } catch (e) {
    console.error("writeDoc failed:", e.message);
  }
  return doc;
}

export function createDoc(ownerId, title) {
  const now = Date.now();
  return writeDoc({
    id: randomUUID(), ownerId, title: cleanTitle(title),
    chapters: [{ id: newChapterId(), title: "Chapter 1", html: "" }],
    betaReaders: [], visibility: "private", comments: [], // private until the author says otherwise
    wordCount: 0, createdAt: now, updatedAt: now,
  });
}

export function deleteDoc(id) {
  if (!ID_RE.test(String(id || ""))) return false;
  storage.del("doc", id);
  return true;
}

export const allDocs = () => {
  return storage.list("doc").map(readDoc).filter(Boolean);
};

// Three visibility levels, narrowest first. "private" is invisible to everyone
// but the author, even to beta readers invited earlier; "readers" opens it to
// the invited friends, who may comment; "public" lets any signed-in account
// READ it — commenting stays with the invited readers, so going public never
// hands anyone a pen.
export const VISIBILITIES = ["private", "readers", "public"];
export const cleanVisibility = (v) => (VISIBILITIES.includes(v) ? v : "private");
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
