// Solo-write documents — one JSON file per doc in data/docs/, the same
// "the file IS the store" approach as store.js/saves. Lives UNDER the data dir
// so the test harness's temp COWRITE_DATA_DIR isolates docs for free.
// When DATABASE_URL is set, persist.js mirrors each doc into Postgres.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, unlinkSync } from "fs";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { mirror, mirrorDelete } from "./persist.js";
import { stripTags } from "./sanitize.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.COWRITE_DATA_DIR || join(__dirname, "..", "data");
export const DOC_DIR = process.env.COWRITE_DOC_DIR || join(DATA_DIR, "docs");
mkdirSync(DOC_DIR, { recursive: true });

const pathOf = (id) => join(DOC_DIR, id + ".json");
// Ids go straight into a filename — never trust one that isn't a plain uuid.
export const ID_RE = /^[0-9a-f-]{36}$/i;

export const cleanTitle = (t) => stripTags(String(t ?? "")).slice(0, 80) || "Untitled";
// Tags become spaces, not nothing: "</h2><p>" separates two words, and
// stripTags alone would glue them into one.
export const countWords = (html) => {
  const text = stripTags(String(html ?? "").replace(/<[^>]+>/g, " "));
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
};

export function readDoc(id) {
  if (!ID_RE.test(String(id || ""))) return null;
  try {
    return JSON.parse(readFileSync(pathOf(id), "utf-8"));
  } catch {
    return null;
  }
}

export function writeDoc(doc) {
  // An anchor with no live comment behind it is not a legal state, and the
  // author's editor is the one thing that can reintroduce one: their undo
  // stack remembers the span, and a dirty editor ignores the server's html
  // push, so a resolve-then-undo-then-save used to smuggle the marker back in.
  // Every write goes through here, so this is where it's guaranteed.
  doc.html = pruneAnchors(doc.html, doc.comments);
  doc.updatedAt = Date.now();
  doc.wordCount = countWords(doc.html);
  const json = JSON.stringify(doc, null, 1);
  try {
    writeFileSync(pathOf(doc.id), json);
    mirror("doc", doc.id, json); // no-op without DATABASE_URL
  } catch (e) {
    console.error("writeDoc failed:", e.message);
  }
  return doc;
}

export function createDoc(ownerId, title) {
  const now = Date.now();
  return writeDoc({
    id: randomUUID(), ownerId, title: cleanTitle(title), html: "",
    betaReaders: [], visibility: "private", comments: [], // private until the author says otherwise
    wordCount: 0, createdAt: now, updatedAt: now,
  });
}

export function deleteDoc(id) {
  if (!ID_RE.test(String(id || ""))) return false;
  try {
    unlinkSync(pathOf(id));
  } catch { /* already gone */ }
  mirrorDelete("doc", id);
  return true;
}

export const allDocs = () => {
  try {
    return readdirSync(DOC_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readDoc(f.slice(0, -5)))
      .filter(Boolean);
  } catch {
    return [];
  }
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
    .map((d) => ({ ...docSummary(d, nameOf), mine: d.ownerId === userId }));

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
