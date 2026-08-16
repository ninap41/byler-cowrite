// All HTTP API routes: accounts, profiles, achievements metadata, the
// dashboard payload, and the private previous-games archive.
import { readFileSync, readdirSync } from "fs";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { WORD_TIERS, USAGE, USAGE_OPEN, badgeName, awardWordBadges } from "../lib/achievements.js";
import { cleanColor, stripTags, httpUrl, sanitizeAbout, sanitizeDoc } from "./sanitize.js";
import {
  readDoc, writeDoc, createDoc, deleteDoc, listDocsFor, docSummary,
  canView, canEdit, isReader, cleanTitle,
} from "./docs.js";
import { referenceBundle } from "./reference.js";
import { hashPassword, checkPassword } from "./passwords.js";
import {
  store, saveStore, EMAIL_RE, ADMIN_EMAILS,
  findByEmail, findByUsername, userByToken, authedUser, publicUser, profileOf,
  makeMsg, welcomeMsg, isAdmin, touchSeen, removeUser,
} from "./store.js";

const CODE_RE = /^[A-Z0-9]{4}$/;
const RESET_TTL_MS = 30 * 60_000;
// Alpha account cap: past this many accounts, signup closes and the homepage
// offers the waiting list instead (COWRITE_MAX_USERS overrides — tests shrink it).
const USER_CAP = Number(process.env.COWRITE_MAX_USERS || 100);

// Forgot password: email a reset link (valid 30 minutes). Without SMTP env
// vars the link is logged to the server console instead — it is never
// returned to the browser.
async function sendResetEmail(to, link) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST) {
    console.log(`[reset] Password reset link for ${to}: ${link}`);
    return;
  }
  const nodemailer = (await import("nodemailer")).default;
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT) === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
  await transport.sendMail({
    from: SMTP_FROM || SMTP_USER,
    to,
    subject: "Byler Cowrite — reset your password",
    text: `Someone (hopefully you) asked to reset your Byler Cowrite password.\n\nReset it here: ${link}\n\nThis link expires in 30 minutes. If you didn't ask, ignore this email.`,
  });
}

export function registerRoutes(app, game) {
  const { sessions, onlineSockets, SAVE_DIR, gameSummary, freshStory, inGame, myGamesFor, recentGamesFor, deleteGame, endGameByCode, renameUser, setTags, commentRows, closeDocFor, closeDocReaders } = game;

  // Random tagline quote for the homepage hero. quotes.json (repo root, one
  // string per entry) is hand-editable and re-read on every request, so new
  // quotes appear without a restart. Public — the homepage has no auth.
  const QUOTES_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "quotes.json");
  const readQuotes = () => {
    let quotes = [];
    try {
      quotes = JSON.parse(readFileSync(QUOTES_PATH, "utf-8"));
    } catch { /* missing/invalid file -> fall through to default */ }
    if (!Array.isArray(quotes) || !quotes.length)
      quotes = ["If we're both going crazy, we might as well write it down."];
    return quotes.map(String);
  };
  app.get("/api/quote", (_req, res) => {
    const quotes = readQuotes();
    res.json({ quote: quotes[Math.floor(Math.random() * quotes.length)] });
  });
  // The whole bank at once — the dashboard cycles through it client-side.
  app.get("/api/quotes", (_req, res) => res.json({ quotes: readQuotes() }));

  // Logged-in dashboard: who's online + games currently running.
  app.get("/api/dashboard", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const ids = new Set(onlineSockets.values());
    const onlineUsers = store.users
      .filter((x) => ids.has(x.id))
      .map((x) => ({ username: x.username, color: x.color, badge: badgeName(x.currentBadge), me: x.id === u.id }));
    const liveGames = [...sessions.values()]
      .filter((g) => g.phase !== "over")
      .map((g) => ({
        code: g.code, name: g.name || "", phase: g.phase,
        hostName: g.writers.get(g.hostId)?.name ?? g.hostName ?? null,
        players: [...g.writers.values()].map((w) => ({ name: w.name, connected: w.connected !== false })),
      }));
    res.json({ onlineUsers, liveGames, myGames: myGamesFor(u), recentGames: recentGamesFor(u), stats: publicUser(u) });
  });

  // Public list of running stories, for homepage spectating — names and
  // counts only, no auth, no tokens, no story content.
  app.get("/api/live", (_req, res) => {
    const games = [...sessions.values()]
      .filter((g) => g.phase !== "over")
      .map((g) => ({
        code: g.code, name: g.name || "", phase: g.phase,
        players: g.writers.size,
        hostName: g.writers.get(g.hostId)?.name ?? g.hostName ?? null,
      }));
    res.json({ games });
  });

  app.post("/api/signup", (req, res) => {
    // Cap check comes first: once we're full, every signup attempt gets the
    // waiting-list wall (capReached tells the client to show it).
    if (store.users.length >= USER_CAP)
      return res.status(403).json({ error: "Sign-ups are closed for now — join the waiting list!", capReached: true });
    const { email, username, password, color } = req.body || {};
    const em = String(email || "").toLowerCase().trim();
    const un = String(username || "").trim();
    if (!EMAIL_RE.test(em)) return res.status(400).json({ error: "Enter a valid email." });
    if (un.length < 4 || un.length > 24)
      return res.status(400).json({ error: "Username must be 4–24 characters." });
    if (un.includes("@"))
      return res.status(400).json({ error: "Usernames can't contain @ — that's for emails." });
    if (String(password || "").length < 4)
      return res.status(400).json({ error: "Password must be at least 4 characters." });
    if (findByEmail(em)) return res.status(400).json({ error: "That email already has an account." });
    if (findByUsername(un)) return res.status(400).json({ error: "That username is taken." });
    const u = {
      id: randomUUID(), email: em, username: un, passHash: hashPassword(password),
      color: cleanColor(color), games: [], wordCount: 0, currentBadge: null, badges: [],
      friends: [], inbox: [welcomeMsg()],
      createdAt: Date.now(),
    };
    if (ADMIN_EMAILS.has(em)) u.admin = true;
    touchSeen(u);
    awardWordBadges(u); // the 0-word starter badge, from day one
    store.users.push(u);
    const token = randomUUID();
    store.sessions[token] = u.id;
    saveStore();
    res.json({ token, user: publicUser(u) });
  });

  // Waiting list (shown when the account cap is hit). Each entry keeps
  // accessGranted (flip to true when inviting) and signupLink (null until an
  // individual invite link is issued). Duplicate emails are a friendly no-op.
  app.post("/api/waitlist", (req, res) => {
    const em = String(req.body?.email || "").toLowerCase().trim();
    if (!EMAIL_RE.test(em)) return res.status(400).json({ error: "Enter a valid email." });
    if (findByEmail(em)) return res.status(400).json({ error: "That email already has an account — just log in!" });
    if (!store.waitlist.some((w) => w.email === em)) {
      store.waitlist.push({ email: em, accessGranted: false, signupLink: null, addedAt: Date.now() });
      saveStore();
    }
    res.json({ ok: true });
  });

  // Distinct login errors on purpose (bad email format / unknown email /
  // unknown username / wrong password) — friendlier for a small friend group,
  // and the forgot-password flow reveals usernames anyway.
  app.post("/api/login", (req, res) => {
    const { user, password } = req.body || {};
    const raw = String(user || "").trim();
    if (!raw) return res.status(400).json({ error: "Enter your username or email." });
    let u;
    if (raw.includes("@")) {
      if (!EMAIL_RE.test(raw.toLowerCase())) return res.status(400).json({ error: "Enter a valid email." });
      u = findByEmail(raw);
      if (!u) return res.status(404).json({ error: "We couldn't find a username associated with that email." });
    } else {
      u = findByUsername(raw);
      if (!u) return res.status(404).json({ error: "We couldn't find an email associated with that username." });
    }
    if (!checkPassword(String(password || ""), u.passHash))
      return res.status(401).json({ error: "Wrong password." });
    // The admin list is checked on the way IN as well as at startup, so a
    // listed email is an admin from its very first sign-in.
    if (ADMIN_EMAILS.has(u.email)) u.admin = true;
    touchSeen(u);
    const token = randomUUID();
    store.sessions[token] = u.id;
    saveStore();
    res.json({ token, user: publicUser(u) });
  });

  app.post("/api/logout", (req, res) => {
    const t = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (store.sessions[t]) {
      delete store.sessions[t];
      saveStore();
    }
    res.json({ ok: true });
  });

  // Change the display username (same rules as signup; frees the old name).
  app.post("/api/account/username", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Not signed in." });
    const un = String(req.body?.username || "").trim();
    if (un.length < 4 || un.length > 24)
      return res.status(400).json({ error: "Username must be 4–24 characters." });
    if (un.includes("@"))
      return res.status(400).json({ error: "Usernames can't contain @ — that's for emails." });
    const taken = findByUsername(un);
    if (taken && taken.id !== u.id) return res.status(400).json({ error: "That username is taken." });
    u.username = un;
    saveStore();
    // stories and lines are tied to the account id — live sessions, rosters,
    // and snapshots pick up the new display name immediately
    renameUser(u.id, un);
    res.json({ user: publicUser(u) });
  });

  // Pick a name color — saved to the account.
  // Sound preference: persists on the account so it follows the user
  // across sessions and devices.
  app.post("/api/account/sounds", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Not signed in." });
    const b = req.body || {};
    u.sounds = { chat: !!b.chat, story: !!b.story, clock: !!b.clock };
    saveStore();
    res.json({ user: publicUser(u) });
  });

  app.post("/api/account/color", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Not signed in." });
    u.color = cleanColor(req.body?.color);
    saveStore();
    res.json({ user: publicUser(u) });
  });

  // Public achievement metadata for the profile page. Raw trigger word lists
  // never ship — and SECRET usage badges don't even ship their descriptions
  // (those arrive per-user via badgeDescs once earned). Open usage badges are
  // the non-secret kind: their descriptions always show.
  app.get("/api/achievements", (_req, res) => {
    res.json({
      wordTiers: WORD_TIERS.map((t) => ({ name: t.name, min: t.min, desc: t.desc })),
      usage: USAGE.map((b) => ({ name: b.name })),
      usageOpen: USAGE_OPEN.map((b) => ({ name: b.name, desc: b.desc })),
      usageCount: USAGE.length,
    });
  });

  // Change the account email (password-confirmed; same rules as signup).
  app.post("/api/account/email", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Not signed in." });
    if (!checkPassword(String(req.body?.password || ""), u.passHash))
      return res.status(401).json({ error: "Wrong password." });
    const em = String(req.body?.email || "").toLowerCase().trim();
    if (!EMAIL_RE.test(em)) return res.status(400).json({ error: "Enter a valid email." });
    const taken = findByEmail(em);
    if (taken && taken.id !== u.id) return res.status(400).json({ error: "That email already has an account." });
    // Admin emails grant the flag at startup — switching onto one would be a
    // backdoor to admin, so non-admins can't claim them here.
    if (ADMIN_EMAILS.has(em) && u.admin !== true)
      return res.status(400).json({ error: "That email is reserved." });
    u.email = em;
    saveStore();
    res.json({ user: publicUser(u) });
  });

  // Change the password (old password confirmed; other sessions signed out).
  app.post("/api/account/password", (req, res) => {
    const t = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const u = userByToken(t);
    if (!u) return res.status(401).json({ error: "Not signed in." });
    if (!checkPassword(String(req.body?.oldPassword || ""), u.passHash))
      return res.status(401).json({ error: "Wrong password." });
    const pw = String(req.body?.newPassword || "");
    if (pw.length < 4) return res.status(400).json({ error: "Password must be at least 4 characters." });
    u.passHash = hashPassword(pw);
    for (const [tok, id] of Object.entries(store.sessions))
      if (id === u.id && tok !== t) delete store.sessions[tok]; // keep only this session
    saveStore();
    res.json({ user: publicUser(u) });
  });

  // Profile content shown to other players: About (with inline <img> embeds,
  // sanitized server-side), up to three links, and an external profile pic.
  app.post("/api/account/profile", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Not signed in." });
    const links = [];
    for (const l of (Array.isArray(req.body?.links) ? req.body.links : []).slice(0, 3)) {
      const url = String(l?.url ?? "").trim();
      if (!url) continue;
      if (!httpUrl(url)) return res.status(400).json({ error: "Links must start with http:// or https://." });
      const label = stripTags(String(l?.label ?? "")).slice(0, 40).trim();
      links.push({ label: label || url.slice(0, 40), url });
    }
    const avatar = String(req.body?.avatar ?? "").trim();
    if (avatar && !httpUrl(avatar))
      return res.status(400).json({ error: "The profile picture must be an http:// or https:// image link." });
    u.about = sanitizeAbout(req.body?.about ?? "");
    u.links = links;
    u.avatar = avatar;
    // crop-to-fill vs zoom-out-to-fit — the user's display preference
    u.avatarFit = req.body?.avatarFit === "contain" ? "contain" : "cover";
    delete u.images; // superseded by inline <img> embeds in About
    saveStore();
    res.json({ user: publicUser(u) });
  });

  // The writers directory: every account, with live online status.
  app.get("/api/users", (req, res) => {
    if (!authedUser(req)) return res.status(401).json({ error: "Sign in first." });
    const ids = new Set(onlineSockets.values());
    const users = store.users
      .map((x) => ({
        username: x.username, color: x.color, badge: badgeName(x.currentBadge),
        wordCount: x.wordCount, online: ids.has(x.id),
        avatar: x.avatar || "", avatarFit: x.avatarFit || "cover",
      }))
      .sort((a, b) => (b.online - a.online) || a.username.localeCompare(b.username));
    res.json({ users });
  });

  // A single player's public profile.
  app.get("/api/users/:username", (req, res) => {
    const viewer = authedUser(req);
    if (!viewer) return res.status(401).json({ error: "Sign in first." });
    const u = findByUsername(req.params.username);
    if (!u) return res.status(404).json({ error: "No writer by that name." });
    // Friendship between the viewer and this profile, for the Add-friend
    // button: self | friends | outgoing (I asked) | incoming (they asked,
    // with the request's message id so the client can accept it) | none.
    const friendState =
      u.id === viewer.id ? { state: "self" }
      : areFriends(viewer, u) ? { state: "friends" }
      : pendingReqFrom(u, viewer.id) ? { state: "outgoing" }
      : pendingReqFrom(viewer, u.id) ? { state: "incoming", requestId: pendingReqFrom(viewer, u.id).id }
      : { state: "none" };
    // Stories this user is the ORIGINAL host of, and stories they hold a seat
    // in without hosting (public shape only), with a live "in progress" flag
    // when the session is currently running.
    const hosted = [];
    const contributed = [];
    let lastLine = null; // the newest story line this user committed, as plain text
    for (const f of readdirSync(SAVE_DIR)) {
      if (!f.endsWith(".json")) continue;
      try {
        const d = JSON.parse(readFileSync(join(SAVE_DIR, f), "utf-8"));
        const isHost = d.hostUserId === u.id;
        if (!isHost && !(d.writers || []).some((w) => w.userId === u.id)) continue;
        const live = sessions.get(d.code);
        (isHost ? hosted : contributed).push({
          code: d.code, name: d.name || "", prompt: d.prompt || "", phase: d.phase,
          lines: (d.story || []).length, savedAt: d.savedAt || 0,
          inProgress: !!live && live.phase !== "over",
        });
        if ((d.savedAt || 0) >= (lastLine?.savedAt ?? -1))
          for (const l of d.story || []) {
            if (l.userId !== u.id) continue;
            const text = stripTags(String(l.html || "")).trim().slice(0, 220);
            if (text) lastLine = { text, code: d.code, name: d.name || "", savedAt: d.savedAt || 0 };
          }
      } catch { /* skip unreadable snapshot */ }
    }
    hosted.sort((a, b) => b.savedAt - a.savedAt);
    contributed.sort((a, b) => b.savedAt - a.savedAt);
    res.json({ user: profileOf(u, new Set(onlineSockets.values())), hosted, contributed, lastLine: u.lastLine || lastLine, friendState });
  });

  // ---- Inbox ----
  // The wire shape resolves fromId to a public identity (never the account id).
  const msgShape = (m) => {
    const from = m.fromId ? store.users.find((x) => x.id === m.fromId) : null;
    return {
      id: m.id, type: m.type, text: m.text, read: m.read === true, ts: m.ts,
      code: m.code || null, // game-invite messages carry the game code

      from: from
        ? { username: from.username, color: from.color, badge: badgeName(from.currentBadge),
            avatar: from.avatar || "", avatarFit: from.avatarFit || "cover" }
        : null,
    };
  };

  app.get("/api/inbox", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const messages = (u.inbox || []).map(msgShape).sort((a, b) => b.ts - a.ts);
    res.json({ messages, unread: messages.filter((m) => !m.read).length });
  });

  // Mark messages read: {ids:[...]} for specific ones, or no ids for all.
  app.post("/api/inbox/read", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const ids = Array.isArray(req.body?.ids) ? new Set(req.body.ids.map(String)) : null;
    let changed = false;
    for (const m of u.inbox || [])
      if (!m.read && (!ids || ids.has(m.id))) { m.read = true; changed = true; }
    if (changed) saveStore();
    res.json({ unread: (u.inbox || []).filter((m) => !m.read).length });
  });

  app.delete("/api/inbox/:id", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const before = (u.inbox || []).length;
    u.inbox = (u.inbox || []).filter((m) => m.id !== req.params.id);
    if (u.inbox.length === before) return res.status(404).json({ error: "No such message." });
    saveStore();
    res.json({ ok: true });
  });

  // ---- Friends ----
  // Friendship is mutual (both ids in both `friends` arrays); a pending
  // request is just a friend-request message sitting in the target's inbox.
  const areFriends = (a, b) => (a.friends || []).includes(b.id);
  const pendingReqFrom = (target, senderId) =>
    (target.inbox || []).find((m) => m.type === "friend-request" && m.fromId === senderId);

  app.get("/api/friends", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const ids = new Set(onlineSockets.values());
    const friends = (u.friends || [])
      .map((id) => store.users.find((x) => x.id === id))
      .filter(Boolean)
      .map((x) => ({
        username: x.username, color: x.color, badge: badgeName(x.currentBadge),
        avatar: x.avatar || "", avatarFit: x.avatarFit || "cover", online: ids.has(x.id),
      }))
      .sort((a, b) => (b.online - a.online) || a.username.localeCompare(b.username));
    res.json({ friends });
  });

  app.post("/api/friends/request", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const target = findByUsername(req.body?.username);
    if (!target) return res.status(404).json({ error: "No writer by that name." });
    if (target.id === u.id) return res.status(400).json({ error: "That's you!" });
    if (areFriends(u, target)) return res.status(400).json({ error: "You're already friends." });
    if (pendingReqFrom(target, u.id)) return res.status(400).json({ error: "Request already sent." });
    if (pendingReqFrom(u, target.id))
      return res.status(400).json({ error: "They already sent you a request — check your inbox!" });
    target.inbox = target.inbox || [];
    target.inbox.unshift(makeMsg("friend-request", u.id, `${u.username} wants to be your friend.`));
    saveStore();
    res.json({ ok: true });
  });

  // Answer a friend-request message in MY inbox: {id, accept: bool}.
  // Accepting links both accounts and drops an accepted note in the
  // requester's inbox; either way the request message is consumed.
  app.post("/api/friends/respond", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const m = (u.inbox || []).find((x) => x.id === String(req.body?.id) && x.type === "friend-request");
    if (!m) return res.status(404).json({ error: "No such friend request." });
    u.inbox = u.inbox.filter((x) => x.id !== m.id);
    const sender = store.users.find((x) => x.id === m.fromId);
    if (req.body?.accept && sender) {
      if (!areFriends(u, sender)) {
        u.friends = [...(u.friends || []), sender.id];
        sender.friends = [...(sender.friends || []), u.id];
      }
      sender.inbox = sender.inbox || [];
      sender.inbox.unshift(makeMsg("friend-accept", u.id, `${u.username} accepted your friend request. 🎉`));
    }
    saveStore();
    res.json({ ok: true, accepted: !!(req.body?.accept && sender) });
  });

  // Unfriend — removes the link on both sides.
  app.delete("/api/friends/:username", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const other = findByUsername(req.params.username);
    if (!other || !areFriends(u, other)) return res.status(404).json({ error: "You're not friends." });
    u.friends = (u.friends || []).filter((id) => id !== other.id);
    other.friends = (other.friends || []).filter((id) => id !== u.id);
    saveStore();
    res.json({ ok: true });
  });

  app.get("/api/me", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Not signed in." });
    touchSeen(u);
    saveStore();
    res.json({ user: publicUser(u) });
  });

  // Forgot password step 1 / forgot username: look up the account by email and
  // return its username. Plainly says so when the email has no account.
  app.post("/api/forgot", (req, res) => {
    const em = String(req.body?.email || "").toLowerCase().trim();
    if (!EMAIL_RE.test(em)) return res.status(400).json({ error: "Enter a valid email." });
    const u = findByEmail(em);
    if (!u) return res.status(404).json({ error: "There's no username under that email — no account exists." });
    res.json({ username: u.username });
  });

  app.post("/api/send-reset", (req, res) => {
    const em = String(req.body?.email || "").toLowerCase().trim();
    if (!EMAIL_RE.test(em)) return res.status(400).json({ error: "Enter a valid email." });
    const u = findByEmail(em);
    if (!u) return res.status(404).json({ error: "There's no username under that email — no account exists." });
    // one live reset token per user
    for (const [t, r] of Object.entries(store.resets))
      if (r.userId === u.id || r.exp < Date.now()) delete store.resets[t];
    const token = randomUUID();
    store.resets[token] = { userId: u.id, exp: Date.now() + RESET_TTL_MS };
    saveStore();
    const link = `${req.protocol}://${req.get("host")}/reset.html?token=${token}`;
    sendResetEmail(u.email, link).catch((e) => console.error("sendResetEmail failed:", e.message));
    res.json({ ok: true });
  });

  app.post("/api/reset", (req, res) => {
    const { token, password } = req.body || {};
    const r = store.resets[token];
    if (!r || r.exp < Date.now()) return res.status(400).json({ error: "This reset link is invalid or has expired." });
    if (String(password || "").length < 4)
      return res.status(400).json({ error: "Password must be at least 4 characters." });
    const u = store.users.find((x) => x.id === r.userId);
    if (!u) return res.status(400).json({ error: "This reset link is invalid or has expired." });
    u.passHash = hashPassword(password);
    delete store.resets[token];
    for (const [t, id] of Object.entries(store.sessions)) if (id === u.id) delete store.sessions[t]; // sign out everywhere
    saveStore();
    res.json({ ok: true });
  });

  // ---- All games & stories (read-only, every snapshot, any signed-in user) ----
  // Unlike the private archive below, this lists EVERYTHING — but only ever
  // for reading: no continue/edit/delete surface, no seat tokens.
  // ?q= title search · ?tag= filter · ?sort=date|words · ?dir=asc|desc ·
  // ?page=&limit= pagination (reading every snapshot per request is the
  // expensive part — pages keep the payload bounded).
  const storyWordCount = (d) =>
    (d.story || []).reduce(
      (n, l) => n + stripTags(String(l.html || "")).trim().split(/\s+/).filter(Boolean).length, 0);

  app.get("/api/stories", (req, res) => {
    if (!authedUser(req)) return res.status(401).json({ error: "Sign in first." });
    const q = String(req.query.q || "").toLowerCase().trim();
    const tag = String(req.query.tag || "").toLowerCase().trim();
    // ?user= narrows to games where that account holds a seat (or hosted) —
    // the "all of this writer's games" page linked from profiles
    const forUser = req.query.user ? findByUsername(req.query.user) : null;
    if (req.query.user && !forUser) return res.status(404).json({ error: "No writer by that name." });
    const sort = req.query.sort === "words" ? "words" : "date";
    const dir = req.query.dir === "asc" ? 1 : -1;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12));
    const all = [];
    for (const f of readdirSync(SAVE_DIR)) {
      if (!f.endsWith(".json")) continue;
      try {
        const d = JSON.parse(readFileSync(join(SAVE_DIR, f), "utf-8"));
        // "title" is what the cards show: the host-set name, else the prompt
        if (q && !`${d.name || ""} ${d.prompt || ""}`.toLowerCase().includes(q)) continue;
        if (tag && !(d.tags || []).some((t) => String(t).toLowerCase() === tag)) continue;
        if (forUser && !inGame(d, forUser) && d.hostUserId !== forUser.id) continue;
        all.push({ ...gameSummary(d), wordCount: storyWordCount(d) });
      } catch { /* skip unreadable snapshot */ }
    }
    all.sort((a, b) => dir * (sort === "words" ? a.wordCount - b.wordCount : a.createdAt - b.createdAt));
    const total = all.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    res.json({ stories: all.slice((page - 1) * limit, page * limit), total, page, pages });
  });

  app.get("/api/stories/:code", (req, res) => {
    if (!authedUser(req)) return res.status(401).json({ error: "Sign in first." });
    const code = String(req.params.code || "").toUpperCase();
    if (!CODE_RE.test(code)) return res.status(400).json({ error: "Bad code." });
    try {
      // Story html in snapshots already passed through sanitizeRich() when written.
      const d = JSON.parse(readFileSync(join(SAVE_DIR, code + ".json"), "utf-8"));
      res.json({ ...gameSummary(d), wordCount: storyWordCount(d), story: freshStory(d.story) });
    } catch {
      res.status(404).json({ error: "Not found." });
    }
  });

  // ---- Solo writes ----
  // Documents, not games: no timers, no turns. The author owns the doc; friends
  // invited as beta readers can open it (once shared) and comment per line.
  // Durable CRUD lives here; presence and live comment fan-out are sockets.

  // The slash-command word bank. Static, auth'd only to keep it off the public
  // surface — it's read once at startup, so this is a cheap constant response.
  app.get("/api/reference", (req, res) => {
    if (!authedUser(req)) return res.status(401).json({ error: "Sign in first." });
    res.json(referenceBundle);
  });

  const nameOf = (id) => store.users.find((x) => x.id === id)?.username || "";
  // Reader rows carry what the presence/avatar UI needs.
  const readerRows = (doc) =>
    (doc.betaReaders || [])
      .map((id) => store.users.find((x) => x.id === id))
      .filter(Boolean)
      .map((x) => ({
        username: x.username, color: x.color,
        avatar: x.avatar || "", avatarFit: x.avatarFit || "cover",
      }));
  // commentRows comes from game.js so HTTP and socket payloads can never drift.
  const docPayload = (doc, u) => ({
    ...docSummary(doc, nameOf),
    html: doc.html || "",
    mine: doc.ownerId === u.id,
    readerRows: readerRows(doc),
    comments: commentRows(doc),
  });

  app.get("/api/docs", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    res.json({ docs: listDocsFor(u.id, nameOf) });
  });

  app.post("/api/docs", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    res.json({ doc: docPayload(createDoc(u.id, req.body?.title || "Untitled"), u) });
  });

  app.get("/api/docs/:id", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const doc = readDoc(req.params.id);
    if (!doc) return res.status(404).json({ error: "No such document." });
    if (!canView(doc, u.id)) return res.status(403).json({ error: "That document isn't shared with you." });
    res.json({ doc: docPayload(doc, u) });
  });

  // Save. The body is rich text headed for other people's DOM — sanitizeDoc()
  // here is the trust boundary; the client's cleanHtml() is only convenience.
  app.put("/api/docs/:id", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const doc = readDoc(req.params.id);
    if (!doc) return res.status(404).json({ error: "No such document." });
    if (!canEdit(doc, u.id)) return res.status(403).json({ error: "Only the author can edit this." });
    if (typeof req.body?.title === "string") doc.title = cleanTitle(req.body.title);
    if (typeof req.body?.html === "string") doc.html = sanitizeDoc(req.body.html);
    writeDoc(doc);
    res.json({ doc: docPayload(doc, u) });
  });

  app.delete("/api/docs/:id", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const doc = readDoc(req.params.id);
    if (!doc) return res.status(404).json({ error: "No such document." });
    if (!canEdit(doc, u.id)) return res.status(403).json({ error: "Only the author can delete this." });
    deleteDoc(doc.id);
    res.json({ ok: true });
  });

  // Invite a beta reader. Deliberately friends-only: sharing a draft is a
  // trust decision, and `friends` is the trust relationship we already have.
  app.post("/api/docs/:id/readers", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const doc = readDoc(req.params.id);
    if (!doc) return res.status(404).json({ error: "No such document." });
    if (!canEdit(doc, u.id)) return res.status(403).json({ error: "Only the author can invite readers." });
    const target = findByUsername(req.body?.username);
    if (!target) return res.status(404).json({ error: "No writer by that name." });
    if (target.id === u.id) return res.status(400).json({ error: "That's you!" });
    if (!(u.friends || []).includes(target.id))
      return res.status(400).json({ error: "You can only invite friends as beta readers." });
    if (isReader(doc, target.id)) return res.status(400).json({ error: "They're already a beta reader." });
    doc.betaReaders = [...(doc.betaReaders || []), target.id];
    writeDoc(doc);
    target.inbox = target.inbox || [];
    target.inbox.unshift(makeMsg("doc-invite", u.id, `${u.username} added you as a beta reader on “${doc.title}”.`));
    saveStore();
    res.json({ doc: docPayload(doc, u) });
  });

  app.delete("/api/docs/:id/readers/:username", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const doc = readDoc(req.params.id);
    if (!doc) return res.status(404).json({ error: "No such document." });
    if (!canEdit(doc, u.id)) return res.status(403).json({ error: "Only the author can remove readers." });
    const target = findByUsername(req.params.username);
    if (!target) return res.status(404).json({ error: "No writer by that name." });
    doc.betaReaders = (doc.betaReaders || []).filter((id) => id !== target.id);
    writeDoc(doc);
    closeDocFor(doc.id, target.id); // boot them out of the live room
    res.json({ doc: docPayload(doc, u) });
  });

  app.post("/api/docs/:id/visibility", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const doc = readDoc(req.params.id);
    if (!doc) return res.status(404).json({ error: "No such document." });
    if (!canEdit(doc, u.id)) return res.status(403).json({ error: "Only the author can share this." });
    doc.visibility = req.body?.visibility === "readers" ? "readers" : "private";
    writeDoc(doc);
    if (doc.visibility === "private") closeDocReaders(doc.id, doc.ownerId);
    res.json({ doc: docPayload(doc, u) });
  });

  // ---- Admin moderation ----
  // Admin is a fixed list of emails (store.js): nothing here can grant it, and
  // every route below refuses anyone the list doesn't already name.
  const requireAdmin = (req, res) => {
    const u = authedUser(req);
    if (!u) { res.status(401).json({ error: "Sign in first." }); return null; }
    if (!isAdmin(u)) { res.status(403).json({ error: "Admins only." }); return null; }
    return u;
  };

  // Every account, with what a moderator needs to judge inactivity: when they
  // last signed in, how much they've written, and whether they're online now.
  app.get("/api/admin/users", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const online = new Set(onlineSockets.values());
    res.json({
      users: store.users
        .map((u) => ({
          username: u.username, email: u.email, admin: isAdmin(u),
          wordCount: u.wordCount || 0, games: (u.games || []).length,
          createdAt: u.createdAt ?? null, lastSeen: u.lastSeen ?? null,
          online: online.has(u.id),
        }))
        .sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0)),
    });
  });

  // Remove an inactive account. Admins can't be deleted (including yourself) —
  // that keeps the moderation seat from being removable by mistake.
  app.delete("/api/admin/users/:username", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const target = findByUsername(req.params.username);
    if (!target) return res.status(404).json({ error: "No such user." });
    if (isAdmin(target)) return res.status(403).json({ error: "Admin accounts can't be removed." });
    removeUser(target);
    res.json({ ok: true });
  });

  // Every running game, not just the admin's own — the moderation view.
  app.get("/api/admin/games", (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.json({
      games: [...sessions.values()].map((g) => ({
        code: g.code, name: g.name || "", phase: g.phase,
        players: g.writers.size, lines: g.story.length,
        hostName: g.writers.get(g.hostId)?.name ?? g.hostName ?? null,
        createdAt: g.createdAt ?? null,
      })),
    });
  });

  // End a game in progress without taking a seat in it. Players see the
  // reveal, and the snapshot stays continuable like any other finished story.
  app.post("/api/admin/games/:code/end", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const code = String(req.params.code || "").toUpperCase();
    if (!CODE_RE.test(code)) return res.status(400).json({ error: "Bad code." });
    if (!endGameByCode(code)) return res.status(404).json({ error: "No game in progress with that code." });
    res.json({ ok: true });
  });

  // ---- Previous-games archive (read-only, backed by saves/*.json snapshots) ----
  // No database on purpose: saveSnapshot() already persists every paused/finished
  // game to disk, so the archive is just a directory listing + file reads.

  app.get("/api/games", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in to see your previous games." });
    const out = [];
    for (const f of readdirSync(SAVE_DIR)) {
      if (!f.endsWith(".json")) continue;
      try {
        const d = JSON.parse(readFileSync(join(SAVE_DIR, f), "utf-8"));
        if (inGame(d, u)) out.push({ ...gameSummary(d), hosted: d.hostUserId === u.id });
      } catch { /* skip unreadable snapshot */ }
    }
    out.sort((a, b) => b.savedAt - a.savedAt);
    res.json(out);
  });

  // Tags: tumblr-style labels on a story. Any writer holding a seat (or the
  // original host) may edit them — during the game or after it's finished.
  app.post("/api/games/:code/tags", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const code = String(req.params.code || "").toUpperCase();
    if (!CODE_RE.test(code)) return res.status(400).json({ error: "Bad code." });
    let d;
    try {
      d = JSON.parse(readFileSync(join(SAVE_DIR, code + ".json"), "utf-8"));
    } catch {
      return res.status(404).json({ error: "Not found." });
    }
    if (!inGame(d, u) && d.hostUserId !== u.id && !isAdmin(u))
      return res.status(403).json({ error: "Only this story's writers can edit its tags." });
    const seen = new Set();
    const tags = (Array.isArray(req.body?.tags) ? req.body.tags : [])
      .map((t) => stripTags(String(t)).replace(/^#+/, "").trim().slice(0, 30))
      .filter((t) => t && !seen.has(t.toLowerCase()) && !!seen.add(t.toLowerCase()))
      .slice(0, 20);
    if (!setTags(code, tags)) return res.status(500).json({ error: "Could not save tags." });
    res.json({ tags });
  });

  // Only the game's true host may delete a story — for everyone, forever.
  app.delete("/api/games/:code", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const code = String(req.params.code || "").toUpperCase();
    if (!CODE_RE.test(code)) return res.status(400).json({ error: "Bad code." });
    let d;
    try {
      d = JSON.parse(readFileSync(join(SAVE_DIR, code + ".json"), "utf-8"));
    } catch {
      return res.status(404).json({ error: "Not found." });
    }
    if (d.hostUserId !== u.id && !isAdmin(u))
      return res.status(403).json({ error: "Only the host can delete this story." });
    deleteGame(code);
    res.json({ ok: true });
  });

  app.get("/api/games/:code", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in to see your previous games." });
    const code = String(req.params.code || "").toUpperCase();
    if (!CODE_RE.test(code)) return res.status(400).json({ error: "Bad code." });
    try {
      // Story html in snapshots already passed through sanitizeRich() when written.
      const d = JSON.parse(readFileSync(join(SAVE_DIR, code + ".json"), "utf-8"));
      if (!inGame(d, u) && !isAdmin(u)) return res.status(403).json({ error: "That game isn't yours to view." });
      res.json({ ...gameSummary(d), story: freshStory(d.story) });
    } catch {
      res.status(404).json({ error: "Not found." });
    }
  });
}
