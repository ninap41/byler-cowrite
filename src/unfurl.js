// Link previews for the game chat: fetch the page behind the first http(s)
// link in a message and read its Open Graph card (title, description, image,
// site). This is the ONE place the server fetches a URL a user typed, so it
// is defensive: http(s) only, no private/loopback hosts (by name, by literal
// address AND by what the name resolves to), redirects followed by hand and
// re-checked, a 5s timeout, an html-only content type, a 512 KB read cap,
// and an in-memory cache (negative results too). COWRITE_UNFURL=0 turns it
// off; COWRITE_UNFURL=stub answers a canned card without touching the
// network (the socket tests). No dependency: the meta tags are regexed.
import dns from "dns";
import net from "net";
import { httpUrl } from "./sanitize.js";

export const UNFURL_TIMEOUT_MS = 5000;
export const UNFURL_MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;

const BLOCKED_NAMES = /^(localhost|.+\.(local|localhost|internal|home|lan))$/i;
/** True for loopback, private, link-local, unspecified and mapped-v4 addresses. */
export function isPrivateAddress(ip) {
  const v = String(ip).toLowerCase().replace(/^\[|\]$/g, "");
  if (net.isIPv4(v)) {
    const [a, b] = v.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(v)) {
    if (v === "::" || v === "::1") return true;
    const m4 = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m4) return isPrivateAddress(m4[1]);
    return /^(fc|fd|fe[89ab])/.test(v);
  }
  return false;
}
export function hostLooksPrivate(hostname) {
  const h = String(hostname).toLowerCase().replace(/^\[|\]$/g, "");
  return !h || BLOCKED_NAMES.test(h) || isPrivateAddress(h);
}

const decode = (s) =>
  String(s).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
const tidy = (s, max) => decode(String(s || "")).replace(/\s+/g, " ").trim().slice(0, max);

/** Pull one <meta> content by property= or name= (attribute order agnostic). */
function meta(html, key) {
  const re = new RegExp(`<meta\\b[^>]*?(?:property|name)\\s*=\\s*["']${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  if (!tag) return "";
  return tag.match(/\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i)?.slice(1).find((x) => x != null) || "";
}
/** Parse a page's card out of its html. Exported for the unit tests. */
export function parsePreview(html, pageUrl) {
  const h = String(html).slice(0, UNFURL_MAX_BYTES);
  const title = tidy(meta(h, "og:title") || meta(h, "twitter:title") || h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1], 120);
  const description = tidy(meta(h, "og:description") || meta(h, "twitter:description") || meta(h, "description"), 200);
  const site = tidy(meta(h, "og:site_name"), 40);
  let image = "";
  const raw = meta(h, "og:image:secure_url") || meta(h, "og:image") || meta(h, "twitter:image");
  if (raw) {
    try {
      const abs = new URL(decode(raw).trim(), pageUrl).href;
      if (httpUrl(abs) && !hostLooksPrivate(new URL(abs).hostname)) image = abs.slice(0, 2000);
    } catch {}
  }
  if (!title && !image) return null;
  /** @type {{url: string, title?: string, description?: string, image?: string, site?: string}} */
  const out = { url: pageUrl };
  if (title) out.title = title;
  if (description) out.description = description;
  if (image) out.image = image;
  if (site) out.site = site;
  return out;
}

const STUB = (url) => ({ url, title: "Stub page", description: "A canned preview for the tests.", image: "https://example.test/i.png", site: "example.test" });

/**
 * @param {{fetchImpl?: typeof fetch, lookup?: (host: string) => Promise<{address: string}>, ttlMs?: number, max?: number, userAgent?: string, mode?: string}} [opts]
 */
export function createUnfurler(opts = {}) {
  const fetchImpl = opts.fetchImpl || ((...a) => globalThis.fetch(...a));
  const lookup = opts.lookup || ((host) => dns.promises.lookup(host));
  const ttlMs = opts.ttlMs ?? 60 * 60 * 1000;
  const max = opts.max ?? 200;
  const ua = opts.userAgent || "Cowrite link preview";
  const mode = opts.mode ?? process.env.COWRITE_UNFURL ?? "1";
  /** @type {Map<string, {at: number, preview: any}>} */
  const cache = new Map();

  async function guard(url) {
    if (!httpUrl(url)) return false;
    const host = new URL(url).hostname;
    if (hostLooksPrivate(host)) return false;
    try {
      const r = await lookup(host.replace(/^\[|\]$/g, ""));
      const addrs = Array.isArray(r) ? r.map((x) => x.address) : [r?.address];
      if (!addrs.length || addrs.some((a) => !a || isPrivateAddress(a))) return false;
    } catch {
      return false;
    }
    return true;
  }

  async function readCapped(res) {
    if (!res.body || typeof res.body.getReader !== "function") return (await res.text()).slice(0, UNFURL_MAX_BYTES);
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    while (got < UNFURL_MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.byteLength;
    }
    try { await reader.cancel(); } catch {}
    return Buffer.concat(chunks).toString("utf8").slice(0, UNFURL_MAX_BYTES);
  }

  async function fetchCard(startUrl) {
    let url = startUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!(await guard(url))) return null;
      const res = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(UNFURL_TIMEOUT_MS), headers: { "user-agent": ua, accept: "text/html,application/xhtml+xml" } });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return null;
        try { url = new URL(loc, url).href; } catch { return null; }
        continue;
      }
      if (!res.ok) return null;
      const type = (res.headers.get("content-type") || "").toLowerCase();
      if (!type.startsWith("text/html") && !type.startsWith("application/xhtml")) return null;
      return parsePreview(await readCapped(res), url);
    }
    return null;
  }

  /** @returns {Promise<null | {url: string, title?: string, description?: string, image?: string, site?: string}>} */
  async function unfurl(url) {
    if (mode === "0" || mode === "off" || !httpUrl(url)) return null;
    if (mode === "stub") return STUB(url);
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < ttlMs) return hit.preview;
    /** @type {Awaited<ReturnType<typeof fetchCard>>} */
    let preview = null;
    try { preview = await fetchCard(url); } catch { preview = null; }
    cache.set(url, { at: Date.now(), preview });
    if (cache.size > max) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return preview;
  }
  return { unfurl, cache };
}
