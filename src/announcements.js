// Announcements — the admin's blog on /announcements. One JSON document
// (announcements/announcements in src/storage.js: data/announcements.json
// locally, a Postgres row on Replit), newest post first. Posts are plain
// text: a title and a body whose blank lines become paragraphs on the page.
// Only admins add or delete (enforced in routes.js next to the other admin
// routes); every signed-in account can read.
import { randomUUID } from "crypto";
import { storage, getJson } from "./storage.js";
import { stripTags } from "./sanitize.js";

export const TITLE_MAX = 120;
export const BODY_MAX = 5000;
export const POSTS_MAX = 500;

let posts = [];
{
  const d = getJson("announcements", "announcements");
  if (d && Array.isArray(d.posts)) posts = d.posts;
}

const save = () => storage.put("announcements", "announcements", JSON.stringify({ posts }, null, 1));

export const listPosts = () => posts.map((p) => ({ ...p }));

// Body keeps its line breaks (they're the paragraphing) but nothing else:
// tags are stripped per line, runs of blank lines collapse to one.
export const cleanBody = (s) =>
  String(s ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => stripTags(l).replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, BODY_MAX);

export const cleanTitle = (s) => stripTags(String(s ?? "")).replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);

// Returns {post} or {error}. `by` is the admin's public identity.
export function addPost({ title, body }, by) {
  const t = cleanTitle(title);
  const b = cleanBody(body);
  if (!t) return { error: "A post needs a title." };
  if (!b) return { error: "A post needs some words." };
  const post = { id: randomUUID(), title: t, body: b, at: Date.now(), byId: by?.id ?? null, byName: by?.username ?? "" };
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

// tests only
export function _resetPosts() { posts = []; save(); }
