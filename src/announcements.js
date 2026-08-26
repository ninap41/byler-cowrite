// Announcements — the admin's blog on /announcements. One JSON document
// (announcements/announcements in src/storage.js: data/announcements.json
// locally, a Postgres row on Replit), newest post first. A post is RICH TEXT
// written in the shared WYSIWYG toolbar and sanitized here with
// sanitizeRich() — the story-line subset, no links or images, which is
// exactly what that toolbar offers — and its title is derived, not typed:
// the first heading in the post, else its opening words. Only admins add or
// delete (enforced in routes.js next to the other admin routes); every
// signed-in account can read.
import { randomUUID } from "crypto";
import { storage, getJson } from "./storage.js";
import { sanitizeRich, stripTags } from "./sanitize.js";

export const TITLE_MAX = 120;
export const HTML_MAX = 40_000;
export const POSTS_MAX = 500;

let posts = [];
{
  const d = getJson("announcements", "announcements");
  if (d && Array.isArray(d.posts)) posts = d.posts;
}

const save = () => storage.put("announcements", "announcements", JSON.stringify({ posts }, null, 1));

export const listPosts = () => posts.map((p) => ({ ...p }));

const squash = (s) => stripTags(String(s ?? "")).replace(/\s+/g, " ").trim();

// The title is the first heading's text; a post without one is titled by
// its first words. Runs on already-sanitized html.
export function titleOf(html) {
  const m = /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(String(html ?? ""));
  const fromHeading = m ? squash(m[1]) : "";
  if (fromHeading) return fromHeading.slice(0, TITLE_MAX);
  const words = squash(String(html ?? "").replace(/<\/(p|h[1-3]|li|blockquote|div)>|<br\s*\/?>/gi, " "));
  return words.length > TITLE_MAX ? words.slice(0, TITLE_MAX - 1).replace(/\s+\S*$/, "") + "…" : words;
}

// Returns {post} or {error}. `by` is the admin's public identity.
export function addPost({ html }, by) {
  const clean = sanitizeRich(String(html ?? "").slice(0, HTML_MAX));
  if (!squash(clean)) return { error: "A post needs some words." };
  const post = { id: randomUUID(), title: titleOf(clean), html: clean, at: Date.now(), byId: by?.id ?? null, byName: by?.username ?? "" };
  posts = [post, ...posts].slice(0, POSTS_MAX);
  save();
  return { post };
}

export function deletePost(id) {
  const before = posts.length;
  posts = posts.filter((p) => p.id !== id);
  if (posts.length === before) return false;
  save();
  return true;
}
