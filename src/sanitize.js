// Sanitizers — the server-side trust boundary. All user-supplied html/urls
// pass through here exactly once before reaching any other player's DOM.
import { randomBytes } from "node:crypto";

// Name-color palette. Colors are validated against this list (prevents style injection).
export const PALETTE = ["#e63946", "#6c8cff", "#3ddc84", "#f4a261", "#e879c9", "#38bdf8", "#facc15", "#c084fc"];
// A writer's colour is any #rrggbb (the settings page has a picker); the
// palette is the starter set. The strict hex shape is what makes it safe to
// inject into style= — anything else falls back to a random palette entry.
export const HEX_RE = /^#[0-9a-f]{6}$/;
export const isHex = (c) => typeof c === "string" && HEX_RE.test(c.toLowerCase());
export const cleanColor = (c) => (isHex(c) ? c.toLowerCase() : PALETTE[Math.floor(Math.random() * PALETTE.length)]);

// Free-choice colors (the art room's picker) are a closed FORMAT instead of a
// closed list: exactly #rrggbb or nothing. The value is only ever used as a
// canvas strokeStyle client-side, but nothing off the wire goes unvalidated.
export const cleanHex = (c) => (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null);

// Font sizes are a FIXED LADDER rendered as classes (fs-18), never as an
// inline style. A free-form `style="font-size:…"` would mean letting an
// attribute through the boundary and parsing a css value; a closed set of
// class names has no injection surface at all — anything off this list stays
// escaped text. Mirrored in public/js/write-view.js for the client.
export const FONT_SIZES = [6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48];
const FS_RE = new RegExp(`&lt;span class=&quot;fs-(${FONT_SIZES.join("|")})&quot;&gt;`, "g");
// Rich-text sanitizer: escape everything, then re-enable a tiny allowlist —
// inline formatting, block formats, lists, the font-size ladder, and exactly
// two alignment classes on blocks. No other attribute ever survives.
//
// The game editor offers the same formatting as the solo one, so this list
// tracks sanitizeDoc's — MINUS <a> and <img>, which are the only entries that
// carry a url. That's the deliberate line: a story line may be shaped, but it
// can never carry a link or load a remote image into another player's page.
export function sanitizeRich(html) {
  let out = String(html).slice(0, 8000)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  out = out
    .replace(/&lt;(\/?)(b|i|u|s|strong|em|del|h1|h2|h3|p|ul|ol|li|blockquote)&gt;/g, "<$1$2>")
    .replace(/&lt;(h1|h2|h3|p|blockquote) class=&quot;al-(c|r)&quot;&gt;/g, '<$1 class="al-$2">')
    .replace(/&lt;(br|hr)\s*\/?&gt;/g, "<$1>")
    // font-size spans, from the closed ladder only (see FONT_SIZES below)
    .replace(FS_RE, '<span class="fs-$1">')
    .replace(/&lt;\/span&gt;/g, "</span>");
  return out;
}

export const stripTags = (html) => html.replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/gi, " ").trim();
// The words a line actually says: tags gone, entities DECODED (stripTags
// turns them into spaces, which read as "shouldn t" and count as two words).
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export const plainText = (html) =>
  String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") {
        const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
// A preview cut on a word, with an ellipsis when something was left out.
export const clip = (text, max) => {
  const t = String(text || "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max).replace(/\s+\S*$/, "");
  return (cut || t.slice(0, max)).trimEnd() + "…";
};

// Solo-write documents. Same escape-everything-then-re-enable shape as
// sanitizeRich, but a document-sized cap and a wider allowlist (lists, quotes,
// strikethrough, links, images). Kept SEPARATE from sanitizeRich on purpose:
// the game depends on that narrow subset, and widening it there would let a
// story line carry an <a>/<img> it was never meant to.
export const DOC_MAX = 200000;

// Comment anchors. CID_RE is the closed set: 12 hex chars, minted by newCid().
// data-cid is the only data attribute sanitizeDoc lets through, and only in
// this exact shape — an anchor can name a comment and nothing else.
export const CID_RE = /^[0-9a-f]{12}$/;
export const newCid = () => randomBytes(6).toString("hex");
const CMT_RE = /&lt;span class=&quot;cmt&quot; data-cid=&quot;([0-9a-f]{12})&quot;&gt;/g;

export function sanitizeDoc(html) {
  let out = String(html).slice(0, DOC_MAX)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  out = out
    // inline + block formatting, no attributes
    .replace(/&lt;(\/?)(b|i|u|s|strong|em|del|h1|h2|h3|p|ul|ol|li|blockquote)&gt;/g, "<$1$2>")
    // the two alignment classes, on blocks only
    .replace(/&lt;(h1|h2|h3|p|blockquote) class=&quot;al-(c|r)&quot;&gt;/g, '<$1 class="al-$2">')
    .replace(/&lt;(br|hr)\s*\/?&gt;/g, "<$1>")
    // font-size spans, from the closed ladder only
    .replace(FS_RE, '<span class="fs-$1">')
    // comment anchors: the ONLY data attribute that survives, and only with a
    // hex id of our own minting — so the underline can never carry a payload
    .replace(CMT_RE, '<span class="cmt" data-cid="$1">')
    // closing </span> and </a> are inert on their own; the OPENING tags are
    // the gated ones (a size off the ladder simply never opens a span)
    .replace(/&lt;\/(span|a)&gt;/g, "</$1>");
  // Links: only http/https survive; anything else stays inert escaped text.
  out = out.replace(/&lt;a href=&quot;(.+?)&quot;&gt;/gi, (whole, escapedHref) => {
    const href = unescapeEntities(escapedHref);
    return httpUrl(href)
      ? `<a href="${escAttr(href)}" target="_blank" rel="noopener noreferrer nofollow">`
      : whole;
  });
  // Images: same url gate as sanitizeAbout.
  out = out.replace(/&lt;img\s+src=&quot;(.+?)&quot;\s*\/?&gt;/gi, (whole, escapedSrc) => {
    const src = unescapeEntities(escapedSrc);
    return httpUrl(src) ? `<img class="doc-img" src="${escAttr(src)}" alt="" loading="lazy">` : whole;
  });
  return out;
}

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
