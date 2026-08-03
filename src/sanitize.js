// Sanitizers — the server-side trust boundary. All user-supplied html/urls
// pass through here exactly once before reaching any other player's DOM.

// Name-color palette. Colors are validated against this list (prevents style injection).
export const PALETTE = ["#e63946", "#6c8cff", "#3ddc84", "#f4a261", "#e879c9", "#38bdf8", "#facc15", "#c084fc"];
export const cleanColor = (c) => (PALETTE.includes(c) ? c : PALETTE[Math.floor(Math.random() * PALETTE.length)]);

// Rich-text sanitizer: escape everything, then re-enable a tiny allowlist —
// inline formatting, block formats (h1-h3/p/hr), and exactly two alignment
// classes on blocks. No other attribute ever survives.
export function sanitizeRich(html) {
  let out = String(html).slice(0, 8000)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  out = out
    .replace(/&lt;(\/?)(b|i|u|strong|em|h1|h2|h3|p)&gt;/g, "<$1$2>")
    .replace(/&lt;(h1|h2|h3|p) class=&quot;al-(c|r)&quot;&gt;/g, '<$1 class="al-$2">')
    .replace(/&lt;(br|hr)\s*\/?&gt;/g, "<$1>");
  return out;
}

export const stripTags = (html) => html.replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/gi, " ").trim();

// http/https only — rejects javascript:, data:, etc.
export const httpUrl = (v) => {
  try {
    const u = new URL(String(v));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

const unescapeEntities = (s) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const escAttr = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// About sanitizer (like sanitizeRich): escape EVERYTHING, then re-enable only
// <img src="http(s)://…"> tags whose src validates — so users can embed
// images inline in their About with plain html.
export function sanitizeAbout(input) {
  let out = String(input).slice(0, 2000)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  out = out.replace(/&lt;img\s+src=&quot;(.+?)&quot;\s*\/?&gt;/gi, (whole, escapedSrc) => {
    const src = unescapeEntities(escapedSrc);
    return httpUrl(src) ? `<img class="about-img" src="${escAttr(src)}" alt="" loading="lazy">` : whole;
  });
  return out.trim();
}
