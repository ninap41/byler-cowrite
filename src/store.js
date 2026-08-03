// User accounts — JSON file store (data/users.json), ~100 users; every
// mutation just rewrites the file. When DATABASE_URL is set, src/persist.js
// mirrors the file into Postgres so it survives Replit deploys.
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { badgeName, badgeDesc, isUsageId, nextTierFor, migrateBadges } from "../lib/achievements.js";
import { mirror } from "./persist.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATA_DIR = process.env.COWRITE_DATA_DIR || join(__dirname, "..", "data");
mkdirSync(DATA_DIR, { recursive: true });
const USERS_PATH = join(DATA_DIR, "users.json");

export let store = { users: [], sessions: {}, resets: {} };
try {
  store = { ...store, ...JSON.parse(readFileSync(USERS_PATH, "utf-8")) };
} catch { /* first run */ }

export const saveStore = () => {
  try {
    const doc = JSON.stringify(store, null, 1);
    writeFileSync(USERS_PATH, doc);
    mirror("users", "users", doc); // no-op without DATABASE_URL
  } catch (e) {
    console.error("saveStore failed:", e.message);
  }
};

// One-time migration off the legacy Inkling→Legend badge ladder.
{
  let changed = false;
  for (const u of store.users) if (migrateBadges(u)) changed = true;
  if (changed) saveStore();
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const findByEmail = (e) => store.users.find((u) => u.email === String(e || "").toLowerCase().trim());
export const findByUsername = (n) =>
  store.users.find((u) => u.username.toLowerCase() === String(n || "").toLowerCase().trim());
export const userByToken = (t) =>
  (t && store.sessions[t] ? store.users.find((u) => u.id === store.sessions[t]) : null);
export const authedUser = (req) => userByToken((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));

// What the account OWNER sees about themselves.
export const publicUser = (u) => ({
  id: u.id, email: u.email, username: u.username, color: u.color,
  games: u.games, wordCount: u.wordCount,
  currentBadge: badgeName(u.currentBadge), badges: u.badges.map(badgeName),
  wordBadges: u.badges.filter((id) => !isUsageId(id)).map(badgeName),
  usageBadges: u.badges.filter(isUsageId).map(badgeName),
  // hover text for EARNED badges only — unearned usage badges stay a mystery
  badgeDescs: Object.fromEntries(u.badges.map((id) => [badgeName(id), badgeDesc(id)])),
  nextBadge: nextTierFor(u),
  streak: u.streak || 0, bestStreak: u.bestStreak || 0, lastWroteDay: u.lastWroteDay ?? null,
  about: u.about || "", links: u.links || [], avatar: u.avatar || "", avatarFit: u.avatarFit || "cover",
});

// What OTHER signed-in players may see: everything public-facing, never the
// email, account id, or game codes (the archive stays private per account).
export const profileOf = (u, onlineIds) => ({
  username: u.username, color: u.color, wordCount: u.wordCount,
  currentBadge: badgeName(u.currentBadge), badges: u.badges.map(badgeName),
  wordBadges: u.badges.filter((id) => !isUsageId(id)).map(badgeName),
  usageBadges: u.badges.filter(isUsageId).map(badgeName),
  badgeDescs: Object.fromEntries(u.badges.map((id) => [badgeName(id), badgeDesc(id)])),
  nextBadge: nextTierFor(u),
  streak: u.streak || 0, bestStreak: u.bestStreak || 0,
  stories: (u.games || []).length,
  about: u.about || "", links: u.links || [], avatar: u.avatar || "", avatarFit: u.avatarFit || "cover",
  online: onlineIds.has(u.id),
});
