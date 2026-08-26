// The writers-reference bank, loaded once at startup and served to the solo
// editor's "/" slash palette. index.json is the manifest: each entry names a
// data file, the slash prefix that opens it, and (only where the file wraps its
// categories in an extra object) the `root` key to unwrap.
// Keys starting with "!" are parser config, not word banks — skipped here.
//
// The bank is editable from /admin: setReferenceGroup() rewrites ONE group's
// data file (categories + words, keys kept, the `root` wrapper honoured) and
// reloads the bundle, so the next palette open serves the edit. Files are
// read and written through src/storage.js (kind "reference", name = the
// manifest path minus "./" and ".json"), so on Replit the bank lives in the
// database — seeded from the repo on first boot, the database's copy after.
import { storage, getJson } from "./storage.js";

const refName = (path) => String(path).replace(/^\.\//, "").replace(/\.json$/, "");

// pining_and_tension -> "Pining and tension"
const label = (key) => {
  const words = String(key).replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// A category key is a filename-safe snake_case slug: it becomes a JSON key and
// a slash-palette heading, never markup, but a tidy vocabulary keeps the bank
// hand-editable in the repo too.
export const KEY_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
export const slugKey = (s) =>
  String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);

function readManifest() {
  const m = getJson("reference", "index");
  if (!m) console.error("reference: index.json unreadable");
  return m;
}

function loadBundle() {
  const manifest = readManifest();
  if (!manifest) return { groups: [] };
  const groups = [];
  for (const [slug, meta] of Object.entries(manifest)) {
    if (slug.startsWith("!") || !meta || typeof meta !== "object" || !meta.path) continue;
    try {
      const raw = getJson("reference", refName(meta.path));
      if (!raw) throw new Error("missing");
      const body = meta.root ? raw[meta.root] : raw;
      if (!body || typeof body !== "object") throw new Error("no categories");
      const categories = Object.entries(body)
        .filter(([, words]) => Array.isArray(words) && words.length)
        .map(([key, words]) => ({ key, label: label(key), words: words.map(String) }));
      if (categories.length) groups.push({ slug, label: label(slug.replace(/-/g, "_")), desc: meta.desc || "", prefix: meta.prefix || "/" + slug, categories });
    } catch (e) {
      // one bad file degrades its own group, never the boot
      console.error(`reference: skipping ${slug} —`, e.message);
    }
  }
  return { groups };
}

let bundle = loadBundle();
export const getReference = () => bundle;

// Validate an edited group and write it. `categories` is [{key, words[]}];
// a category with no words is dropped, so emptying one deletes it. Returns a
// list of errors — nothing is written unless it's empty.
export function setReferenceGroup(slug, categories) {
  const manifest = readManifest();
  const meta = manifest?.[String(slug)];
  if (!meta || String(slug).startsWith("!") || !meta.path) return ["No such reference group."];
  if (!Array.isArray(categories)) return ["categories must be a list."];
  const errors = [];
  const body = {};
  for (const c of categories) {
    const key = String(c?.key || "");
    if (!KEY_RE.test(key)) { errors.push(`"${key}" isn't a valid category key (snake_case).`); continue; }
    if (body[key]) { errors.push(`Category "${key}" appears twice.`); continue; }
    const words = (Array.isArray(c.words) ? c.words : [])
      .map((w) => String(w).replace(/\s+/g, " ").trim().slice(0, 200))
      .filter(Boolean);
    if (words.length) body[key] = [...new Set(words)];
  }
  if (!Object.keys(body).length) errors.push("A group needs at least one category with words.");
  if (errors.length) return errors;
  let out = body;
  if (meta.root) {
    const raw = getJson("reference", refName(meta.path)) || {};
    out = { ...raw, [meta.root]: body };
  }
  const json = JSON.stringify(out, null, "\t") + "\n";
  try {
    storage.put("reference", refName(meta.path), json);
  } catch (e) {
    return ["Couldn't write the reference file: " + e.message];
  }
  bundle = loadBundle();
  return [];
}
