// All HTTP API routes: accounts, profiles, achievements metadata, the
// dashboard payload, and the private previous-games archive.
import { readFileSync, readdirSync } from "fs";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { WORD_TIERS, USAGE, badgeName, awardWordBadges } from "../lib/achievements.js";
import { cleanColor, stripTags, httpUrl, sanitizeAbout } from "./sanitize.js";
import { hashPassword, checkPassword } from "./passwords.js";
import {
  store, saveStore, EMAIL_RE,
  findByEmail, findByUsername, userByToken, authedUser, publicUser, profileOf,
} from "./store.js";

const CODE_RE = /^[A-Z0-9]{4}$/;
const RESET_TTL_MS = 30 * 60_000;

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
  const { sessions, onlineSockets, SAVE_DIR, gameSummary, freshStory, inGame, myGamesFor, recentGamesFor, deleteGame, renameUser } = game;

  // Random tagline quote for the homepage hero. quotes.json (repo root, one
  // string per entry) is hand-editable and re-read on every request, so new
  // quotes appear without a restart. Public — the homepage has no auth.
  const QUOTES_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "quotes.json");
  app.get("/api/quote", (_req, res) => {
    let quotes = [];
    try {
      quotes = JSON.parse(readFileSync(QUOTES_PATH, "utf-8"));
    } catch { /* missing/invalid file -> fall through to default */ }
    if (!Array.isArray(quotes) || !quotes.length)
      quotes = ["If we're both going crazy, we might as well write it down."];
    res.json({ quote: String(quotes[Math.floor(Math.random() * quotes.length)]) });
  });

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
      createdAt: Date.now(),
    };
    awardWordBadges(u); // the 0-word starter badge, from day one
    store.users.push(u);
    const token = randomUUID();
    store.sessions[token] = u.id;
    saveStore();
    res.json({ token, user: publicUser(u) });
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
  app.post("/api/account/color", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Not signed in." });
    u.color = cleanColor(req.body?.color);
    saveStore();
    res.json({ user: publicUser(u) });
  });

  // Public achievement metadata for the profile page: every badge with its
  // description ("what it means and how to earn it" — see achievements.json).
  // Raw trigger word lists still never ship.
  app.get("/api/achievements", (_req, res) => {
    res.json({
      wordTiers: WORD_TIERS.map((t) => ({ name: t.name, min: t.min, desc: t.desc })),
      usage: USAGE.map((b) => ({ name: b.name, desc: b.desc })),
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
    if (!authedUser(req)) return res.status(401).json({ error: "Sign in first." });
    const u = findByUsername(req.params.username);
    if (!u) return res.status(404).json({ error: "No writer by that name." });
    // Stories this user is the ORIGINAL host of (public shape only), with a
    // live "in progress" flag when the session is currently running.
    const hosted = [];
    for (const f of readdirSync(SAVE_DIR)) {
      if (!f.endsWith(".json")) continue;
      try {
        const d = JSON.parse(readFileSync(join(SAVE_DIR, f), "utf-8"));
        if (d.hostUserId !== u.id) continue;
        const live = sessions.get(d.code);
        hosted.push({
          code: d.code, name: d.name || "", prompt: d.prompt || "", phase: d.phase,
          lines: (d.story || []).length, savedAt: d.savedAt || 0,
          inProgress: !!live && live.phase !== "over",
        });
      } catch { /* skip unreadable snapshot */ }
    }
    hosted.sort((a, b) => b.savedAt - a.savedAt);
    res.json({ user: profileOf(u, new Set(onlineSockets.values())), hosted });
  });

  app.get("/api/me", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Not signed in." });
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
    if (d.hostUserId !== u.id) return res.status(403).json({ error: "Only the host can delete this story." });
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
      if (!inGame(d, u)) return res.status(403).json({ error: "That game isn't yours to view." });
      res.json({ ...gameSummary(d), story: freshStory(d.story) });
    } catch {
      res.status(404).json({ error: "Not found." });
    }
  });
}
