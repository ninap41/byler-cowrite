// All HTTP API routes: accounts, profiles, achievements metadata, the
// dashboard payload, and the private previous-games archive.
import { readFileSync, readdirSync } from "fs";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { WORD_TIERS, USAGE, USAGE_OPEN, badgeName, awardWordBadges } from "../lib/achievements.js";
import { cleanColor, stripTags, httpUrl, sanitizeAbout } from "./sanitize.js";
import { hashPassword, checkPassword } from "./passwords.js";
import {
  store, saveStore, EMAIL_RE, ADMIN_EMAILS,
  findByEmail, findByUsername, userByToken, authedUser, publicUser, profileOf,
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
  const { sessions, onlineSockets, SAVE_DIR, gameSummary, freshStory, inGame, myGamesFor, recentGamesFor, deleteGame, renameUser, setTags } = game;

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
      createdAt: Date.now(),
    };
    if (ADMIN_EMAILS.has(em)) u.admin = true;
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
    if (!authedUser(req)) return res.status(401).json({ error: "Sign in first." });
    const u = findByUsername(req.params.username);
    if (!u) return res.status(404).json({ error: "No writer by that name." });
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
    res.json({ user: profileOf(u, new Set(onlineSockets.values())), hosted, contributed, lastLine: u.lastLine || lastLine });
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
    if (!inGame(d, u) && d.hostUserId !== u.id)
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
