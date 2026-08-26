// The site's identity — fandom, app name, tagline — comes from the content
// pack (content/site.json) so an alternate fandom renames the whole app
// without touching a page. Pages carry {{SITE_NAME}} / {{FANDOM}} / {{TAGLINE}}
// / {{BLURB}} tokens which renderPage() fills when the server serves them;
// client modules read the name from the <meta name="site-name"> it injects.
import { readContent } from "./content.js";

const DEFAULTS = {
  fandom: "Cowrite",
  name: "Cowrite",
  tagline: "A round-robin writing game. Write fan fiction together",
  blurb: "A real-time, round-robin writing game for fanfiction. Everyone holds the pen.",
};

function load() {
  const raw = readContent("site.json") || {};
  const out = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) {
    if (typeof raw[k] === "string" && raw[k].trim()) out[k] = raw[k].trim().slice(0, 200);
  }
  return out;
}

export const SITE = load();

const escAttr = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const TOKENS = { SITE_NAME: "name", FANDOM: "fandom", TAGLINE: "tagline", BLURB: "blurb" };

export function renderPage(html) {
  const filled = html.replace(/\{\{(SITE_NAME|FANDOM|TAGLINE|BLURB)\}\}/g, (_, t) => escAttr(SITE[TOKENS[t]]));
  return filled.replace(/<head(\s[^>]*)?>/i, (m) => `${m}\n\t\t<meta name="site-name" content="${escAttr(SITE.name)}" />`);
}
