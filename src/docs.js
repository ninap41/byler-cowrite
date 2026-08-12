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
    betaReaders: [], visibility: "private", comments: [],
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

// The author writes; approved beta readers may read + comment once the doc is
// shared. A doc left "private" is invisible to everyone but its owner, even to
// readers who were invited earlier.
export const isReader = (doc, userId) => (doc.betaReaders || []).includes(userId);
export const canEdit = (doc, userId) => !!doc && doc.ownerId === userId;
export const canView = (doc, userId) =>
  !!doc && (doc.ownerId === userId || (doc.visibility === "readers" && isReader(doc, userId)));

// Listing shape — never carries the document body.
export const docSummary = (doc, nameOf) => ({
  id: doc.id,
  title: doc.title,
  wordCount: doc.wordCount || 0,
  visibility: doc.visibility,
  updatedAt: doc.updatedAt,
  createdAt: doc.createdAt,
  owner: nameOf(doc.ownerId),
  readers: (doc.betaReaders || []).map(nameOf).filter(Boolean),
  comments: (doc.comments || []).length,
});

export const listDocsFor = (userId, nameOf) =>
  allDocs()
    .filter((d) => canView(d, userId))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map((d) => ({ ...docSummary(d, nameOf), mine: d.ownerId === userId }));
