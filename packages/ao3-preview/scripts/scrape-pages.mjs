// Scrapes the AO3 pages the previewer can show into public/ao3/html/<id>.html:
// the live page's <body> inner HTML, scripts/noscript and CSRF tokens removed,
// root-relative src/srcset/poster made absolute so images still load inside the
// previewer's frame (hrefs stay as they are — the frame's <base target=_blank>
// opens them, and a site skin's selectors match either way). Run from the
// package: `node scripts/scrape-pages.mjs [id ...]` (no ids = every page).
// The work page (work.html) is NOT scraped here: it is a hand-curated chapter
// with its comments shown; re-scrape it by hand if it must change.
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const ORIGIN = "https://archiveofourown.org";
// id → path; the order is the Page dropdown's order after the work page
export const SCRAPED_PAGES = [
  ["home", "/"],
  ["media", "/media"],
  ["dashboard", "/users/justthegatekeeper"],
  ["works", "/works"],
  ["works-search", "/works/search"],
  ["people-search", "/people/search"],
  ["collections", "/collections"],
  ["tags", "/tags"],
  ["bookmarks", "/bookmarks"],
];

export function bodyOf(html) {
  const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  let body = m ? m[1] : html;
  body = body.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "");
  body = body.replace(/<input\b[^>]*authenticity_token[^>]*>/g, "");
  body = body.replace(/\s(src|poster)="\/(?!\/)/g, ` $1="${ORIGIN}/`);
  body = body.replace(/\ssrcset="([^"]*)"/g, (_, v) => ` srcset="${v.replace(/(^|,\s*)\/(?!\/)/g, `$1${ORIGIN}/`)}"`);
  return body.trim() + "\n";
}

async function fetchPage(path, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    const r = await fetch(ORIGIN + path, { headers: { "user-agent": "Mozilla/5.0 (ao3-preview scraper)", accept: "text/html" } });
    if (r.ok) return await r.text();
    last = r.status;
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
  }
  throw new Error(`${path}: HTTP ${last}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "ao3", "html");
  mkdirSync(outDir, { recursive: true });
  const want = process.argv.slice(2);
  for (const [id, path] of SCRAPED_PAGES) {
    if (want.length && !want.includes(id)) continue;
    const html = await fetchPage(path);
    const body = `<!-- ${ORIGIN}${path} — body only, scraped by scripts/scrape-pages.mjs; scripts and CSRF tokens removed. -->\n` + bodyOf(html);
    writeFileSync(join(outDir, id + ".html"), body);
    console.log(`${id}.html  ${body.length} bytes  ← ${path}`);
  }
}
