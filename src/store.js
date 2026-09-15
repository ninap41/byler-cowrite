// User accounts — one JSON document (data/users.json locally, the
// users/users row in Postgres on Replit — see src/storage.js), ~100 users;
// every mutation rewrites the whole document.
import { randomUUID } from "crypto";
import { badgeName, badgeDesc, isUsageId, isOpenUsageId, nextTierFor, migrateBadges, unlockedThemes, unlockedGimmicks } from "../lib/achievements.js";
import { storage, getJson } from "./storage.js";
import { SITE } from "./site.js";

/**
 * One account as the store holds it (data/users.json). Optional fields are
 * the ones added after launch — older accounts gain them lazily.
 * @typedef {Object} User
 * @property {string} id
 * @property {string} email
 * @property {string} username
 * @property {string} passHash
 * @property {string} color
 * @property {string[]} games
 * @property {number} wordCount
 * @property {string | null} currentBadge
 * @property {string[]} badges
 * @property {boolean} [admin]
 * @property {string} [avatar]
 * @property {string} [avatarFit]
 * @property {string} [about]
 * @property {{label: string, url: string}[]} [links]
 * @property {string[]} [images]
 * @property {string[]} [friends]
 * @property {InboxMsg[]} [inbox]
 * @property {boolean | {chat?: boolean, story?: boolean, clock?: boolean, gimmick?: boolean}} [sounds]
 * @property {{text: string, code: string, name: string, at?: number, savedAt?: number}} [lastLine]
 * @property {number} [createdAt]
 * @property {number} [lastSeen]
 * @property {number} [lastHelpAt]
 * @property {number} [streak]
 * @property {number} [bestStreak]
 * @property {string} [lastWroteDay]
 * @property {number} [sprintWords]
 * @property {Sprint[]} [sprints]
 * @property {boolean} [isAMemberOfBylerOffscreen]
 * @property {string} [protocol]
 */
/**
 * @typedef {Object} InboxMsg
 * @property {string} id
 * @property {string} type
 * @property {string} text
 * @property {boolean} read
 * @property {number} ts
 * @property {string | null} [fromId]
 * @property {string | null} [toId]
 * @property {string | null} [code]
 * @property {string} [threadId]
 * @property {boolean} [mine]
 * @property {unknown} [unlocks]
 * @property {string} [docId]
 */
/** @typedef {{docId: string, title: string, words: number, seconds: number, at: number}} Sprint */
/** @typedef {{email: string, accessGranted: boolean, signupLink: string | null, addedAt: number}} WaitlistRow */
/**
 * @typedef {Object} Store
 * @property {User[]} users
 * @property {Record<string, string>} sessions  token -> user id
 * @property {Record<string, {userId: string, exp: number}>} resets
 * @property {WaitlistRow[]} waitlist
 */

/** @type {Store} */
export let store = { users: [], sessions: {}, resets: {}, waitlist: [] };
store = { ...store, ...(getJson("users", "users") || {}) }; // first run: nothing yet

export const saveStore = () => {
  try {
    storage.put("users", "users", JSON.stringify(store, null, 1));
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

// The only accounts that carry admin: true — applied to existing accounts at
// startup (below) and at signup (routes.js). Nobody else ever gets the flag.
export const ADMIN_EMAILS = new Set(["admin2@cowrite.test", "admin@cowrite.test"]);
{
  let changed = false;
  for (const u of store.users)
    if (ADMIN_EMAILS.has(u.email) && u.admin !== true) {
      u.admin = true;
      changed = true;
    }
  if (changed) saveStore();
}

// ---- Inbox & friends ----
// Every user carries `friends` (array of account ids, mutual) and `inbox`
// (array of messages, newest first). Message shape:
//   { id, type: 'system'|'note'|'friend-request'|'friend-accept',
//     fromId: account id or null (system), text, read: bool, ts }
// Friend requests ARE inbox messages — accepting/declining consumes them.
// `extra` carries the optional fields: `threadId` (the conversation this
// message belongs to — see /api/inbox/reply), `mine` (my own sent copy, kept
// so a reply chain shows both halves), `code` (a game invite's code), `toId`
// (the recipient's account id — who a person-to-person message was sent to).
export const makeMsg = (type, fromId, text, extra = {}) =>
  ({ id: randomUUID(), type, fromId: fromId || null, text: String(text || ""), read: false, ts: Date.now(), ...extra });

export const welcomeMsg = () =>
  makeMsg("system", null, `Welcome to ${SITE.name}! This is your inbox, friend requests and notes land here. 📬`);

// Init arrays on legacy accounts + seed sample messages: the welcome note,
// plus a hello from an admin account when one exists (a "from a real user"
// example so the inbox never starts empty).
{
  let changed = false;
  const greeter = store.users.find((u) => u.admin === true);
  for (const u of store.users) {
    if (!Array.isArray(u.friends)) { u.friends = []; changed = true; }
    // Membership of the Byler Offscreen Discord: declared by the signup
    // checkbox (nothing else sets it), defaulted here so every existing
    // account carries the key after one boot.
    if (typeof u.isAMemberOfBylerOffscreen !== "boolean") { u.isAMemberOfBylerOffscreen = false; changed = true; }
    if (!Array.isArray(u.inbox)) {
      u.inbox = [welcomeMsg()];
      if (greeter && greeter.id !== u.id)
        u.inbox.unshift(makeMsg("note", greeter.id, "Hey! Glad you're here: start a game from the dashboard and send me a friend request. ✒"));
      changed = true;
    }
  }
  if (changed) saveStore();
}

// Admin is a property of the EMAIL, never of a request: the list above is the
// only source, so no payload can promote an account.
export const isSecretUsageId = (id) => isUsageId(id) && !isOpenUsageId(id);
export const isAdmin = (u) => !!u && (u.admin === true || ADMIN_EMAILS.has(u.email));

// Called wherever an account proves it's alive (signup, login, /api/me) —
// this is what "inactive" is measured against on the admin panel.
export const touchSeen = (u) => {
  if (!u) return;
  u.lastSeen = Date.now();
};

// Delete an account for good: its sessions, its friendships, and every inbox
// message it sent. Stories keep their lines (they're the other writers' work
// too) — the byline simply stops resolving to a live account.
export function removeUser(u) {
  const i = store.users.indexOf(u);
  if (i < 0) return false;
  store.users.splice(i, 1);
  for (const [t, id] of Object.entries(store.sessions)) if (id === u.id) delete store.sessions[t];
  for (const other of store.users) {
    if (Array.isArray(other.friends)) other.friends = other.friends.filter((id) => id !== u.id);
    if (Array.isArray(other.inbox)) other.inbox = other.inbox.filter((m) => m.fromId !== u.id);
  }
  saveStore();
  return true;
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
  id: u.id, email: u.email, username: u.username, color: u.color, admin: u.admin === true,
  games: u.games, wordCount: u.wordCount,
  isAMemberOfBylerOffscreen: u.isAMemberOfBylerOffscreen === true,
  // the gated themes this rank has earned (admins: all of them) — the theme
  // menu reads it straight off /api/me, no second request on page load
  themes: unlockedThemes(u),
  gimmicks: unlockedGimmicks(u), // same idea: the gimmicks this rank has earned
  currentBadge: badgeName(u.currentBadge), badges: u.badges.map(badgeName),
  wordBadges: u.badges.filter((id) => !isUsageId(id)).map(badgeName),
  usageBadges: u.badges.filter((id) => isUsageId(id) && !isOpenUsageId(id)).map(badgeName),
  openBadges: u.badges.filter(isOpenUsageId).map(badgeName),
  // hover text for EARNED badges only — unearned usage badges stay a mystery
  badgeDescs: Object.fromEntries(u.badges.map((id) => [badgeName(id), badgeDesc(id)])),
  nextBadge: nextTierFor(u),
  streak: u.streak || 0, bestStreak: u.bestStreak || 0, lastWroteDay: u.lastWroteDay ?? null,
  // per-category sound prefs; a legacy boolean (or absence) fans out to all
  sounds: typeof u.sounds === "object" && u.sounds !== null
    ? { chat: u.sounds.chat !== false, story: u.sounds.story !== false, clock: u.sounds.clock !== false, gimmick: u.sounds.gimmick !== false }
    : { chat: u.sounds !== false, story: u.sounds !== false, clock: u.sounds !== false, gimmick: u.sounds !== false },
  about: u.about || "", links: u.links || [], avatar: u.avatar || "", avatarFit: u.avatarFit || "cover",
  lastLine: u.lastLine || null, // newest committed story line (text/code/name/at)
});

// What OTHER signed-in players may see: everything public-facing, never the
// email, account id, or game codes (the archive stays private per account).
// `viewer` is who is looking: a SECRET usage badge's description (the how)
// travels only when the viewer has earned that badge too (or is the owner, or
// an admin) — seeing someone else wear it must never give the recipe away.
/** @param {User} u @param {Set<string>} onlineIds @param {User | null} [viewer] */
export const profileOf = (u, onlineIds, viewer = null) => ({
  username: u.username, color: u.color, wordCount: u.wordCount,
  currentBadge: badgeName(u.currentBadge), badges: u.badges.map(badgeName),
  wordBadges: u.badges.filter((id) => !isUsageId(id)).map(badgeName),
  usageBadges: u.badges.filter((id) => isUsageId(id) && !isOpenUsageId(id)).map(badgeName),
  openBadges: u.badges.filter(isOpenUsageId).map(badgeName),
  badgeDescs: Object.fromEntries(u.badges
    .filter((id) => !isSecretUsageId(id) || viewer === u || isAdmin(viewer) || (viewer?.badges || []).includes(id))
    .map((id) => [badgeName(id), badgeDesc(id)])),
  nextBadge: nextTierFor(u),
  streak: u.streak || 0, bestStreak: u.bestStreak || 0,
  stories: (u.games || []).length,
  sprintWords: u.sprintWords || 0, sprintCount: (u.sprints || []).length,
  about: u.about || "", links: u.links || [], avatar: u.avatar || "", avatarFit: u.avatarFit || "cover",
  online: onlineIds.has(u.id),
});
