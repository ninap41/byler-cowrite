// The writers-reference bank, loaded once at startup and served to the solo
// editor's "/" slash palette. index.json is the manifest: each entry names a
// data file, the slash prefix that opens it, and (only where the file wraps its
// categories in an extra object) the `root` key to unwrap.
// Keys starting with "!" are parser config, not word banks — skipped here.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REF_DIR = process.env.COWRITE_REF_DIR || join(__dirname, "..", "writers-reference");

// pining_and_tension -> "Pining and tension"
const label = (key) => {
  const words = String(key).replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

function loadBundle() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(REF_DIR, "index.json"), "utf-8"));
  } catch (e) {
    console.error("reference: index.json unreadable —", e.message);
    return { groups: [] };
  }

  const groups = [];
  for (const [slug, meta] of Object.entries(manifest)) {
    if (slug.startsWith("!") || !meta || typeof meta !== "object" || !meta.path) continue;
    try {
      const raw = JSON.parse(readFileSync(join(REF_DIR, meta.path), "utf-8"));
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

export const referenceBundle = loadBundle();
