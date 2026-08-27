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
  // The name is "<fandom> Cowrite" unless the pack names the app itself:
  // Byler Cowrite, Heated Rivalry Cowrite… one field to change per fandom.
  if (!(typeof raw.name === "string" && raw.name.trim())) out.name = `${out.fandom} Cowrite`;
  return out;
}

export const SITE = load();

const escAttr = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const TOKENS = { SITE_NAME: "name", FANDOM: "fandom", TAGLINE: "tagline", BLURB: "blurb" };

// Open Graph: the card Discord (Slack, iMessage…) draws when a link to the
// site is pasted — title, description, and the banner at
// public/img/og-banner.png (1200×630, captured by scripts/og-banner.sh).
// The image and og:url must be ABSOLUTE, so they're built on PUBLIC_APP_URL;
// without it (local dev, tests) the text tags still go out and the image
// stays a root-relative path an unfurler will simply skip.
export function ogTags(origin = String(process.env.PUBLIC_APP_URL || "").trim().replace(/\/$/, "")) {
  const img = origin + "/img/og-banner.png";
  const tags = [
    ["property", "og:type", "website"],
    ["property", "og:site_name", SITE.name],
    ["property", "og:title", SITE.name],
    ["property", "og:description", SITE.blurb],
    ["property", "og:image", img],
    ["property", "og:image:width", "1200"],
    ["property", "og:image:height", "630"],
    ...(origin ? [["property", "og:url", origin + "/"]] : []),
    ["name", "description", SITE.blurb],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", SITE.name],
    ["name", "twitter:description", SITE.blurb],
    ["name", "twitter:image", img],
  ];
  return tags.map(([k, n, v]) => `<meta ${k}="${n}" content="${escAttr(v)}" />`).join("\n\t\t");
}

export function renderPage(html) {
  const filled = html.replace(/\{\{(SITE_NAME|FANDOM|TAGLINE|BLURB)\}\}/g, (_, t) => escAttr(SITE[TOKENS[t]]));
  return filled.replace(/<head(\s[^>]*)?>/i, (m) => `${m}\n\t\t<meta name="site-name" content="${escAttr(SITE.name)}" />\n\t\t${ogTags()}`);
}
