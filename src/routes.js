// All HTTP API routes: accounts, profiles, achievements metadata, the
// dashboard payload, and the private previous-games archive.
import { randomUUID } from "crypto";
import { readContent } from "./content.js";
import { storage, describeStorage } from "./storage.js";
import { buildZip } from "./zip.js";
import { listPosts, addPost, deletePost, updatePost } from "./announcements.js";
import { verifyInteraction, handleInteraction, postAnnouncement, postGame, discordStatus } from "./discord.js";
import { SITE } from "./site.js";
import { getPromptData, setPromptData } from "./game.js";
import { WORD_TIERS, USAGE, USAGE_OPEN, getAchievements, setAchievements, badgeName, awardWordBadges, themeLocks, unlockedThemes, gimmickLocks, unlockedGimmicks } from "../lib/achievements.js";
import { GIMMICKS } from "../lib/gimmicks.js";
import { cleanColor, stripTags, plainText, clip, httpUrl, sanitizeAbout, sanitizeDoc, DOC_MAX } from "./sanitize.js";
import {
  readDoc, writeDoc, docLanded, createDoc, deleteDoc, listDocsFor, docSummary,
  canView, canEdit, canComment, isReader, cleanTitle, cleanVisibility, cleanTheme, publicDocs, docsOwnedBy,
  cleanChapterTitle, newChapterId, MAX_CHAPTERS,
} from "./docs.js";
import { listHistory, readHistory, keepBeforeOverwrite, snapshotOf } from "./dochist.js";
import { getReference, setReferenceGroup } from "./reference.js";
import { hashPassword, checkPassword } from "./passwords.js";
import {
  store, saveStore, EMAIL_RE, ADMIN_EMAILS,
  findByEmail, findByUsername, userByToken, authedUser, publicUser, profileOf,
  makeMsg, welcomeMsg, isAdmin, touchSeen, removeUser,
} from "./store.js";

const CODE_RE = /^[A-Z0-9]{4}$/;
const RESET_TTL_MS = 30 * 60_000;
const RESET_ORIGIN = (() => {
  const configured = String(process.env.PUBLIC_APP_URL || "").trim();
  if (!configured) {
    if (process.env.SMTP_HOST)
      throw new Error("PUBLIC_APP_URL is required when SMTP_HOST is configured");
    return `http://localhost:${Number(process.env.PORT || 3000)}`;
  }
  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("PUBLIC_APP_URL must be a valid absolute URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
      parsed.pathname !== "/" || parsed.search || parsed.hash)
    throw new Error("PUBLIC_APP_URL must be an HTTPS origin without credentials or a path");
  return parsed.origin;
})();
// Alpha account cap: past this many accounts, signup closes and the homepage
// offers the waiting list instead (COWRITE_MAX_USERS overrides — tests shrink it).
const USER_CAP = Number(process.env.COWRITE_MAX_USERS || 100);

// Forgot password: email a reset link (valid 30 minutes). Without SMTP env
// vars the link is logged locally for development — it is never returned to
// the browser.
// The transport is built from the env each time, so a secret edited on
// Replit takes effect without a restart. Timeouts are short on purpose: a
// blocked port otherwise hangs the request for minutes before failing.
async function smtpTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  const port = Number(SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("SMTP_PORT must be an integer between 1 and 65535");
  const nodemailer = (await import("nodemailer")).default;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}
// What /admin's SMTP check reports: which vars are set (never their values)
// and, when a host is configured, whether a real connection + login works —
// the underlying error message included, because that is the whole point.
export async function smtpStatus() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  const configured = { host: !!SMTP_HOST, port: SMTP_PORT || "587 (default)", user: !!SMTP_USER, pass: !!SMTP_PASS, from: !!(SMTP_FROM || SMTP_USER) };
  if (!SMTP_HOST) return { ok: false, configured, error: "SMTP_HOST is not set: reset links are only logged to the console." };
  try {
    const t = await smtpTransport();
    await t.verify();
    return { ok: true, configured };
  } catch (e) {
    return { ok: false, configured, error: e.message, code: e.code };
  }
}
async function sendResetEmail(to, link) {
  const { SMTP_HOST, SMTP_USER, SMTP_FROM } = process.env;
  if (!SMTP_HOST) {
    console.log(`[reset] Password reset link for ${to}: ${link}`);
    return;
  }
  const transport = await smtpTransport();
  const info = await transport.sendMail({
    from: SMTP_FROM || SMTP_USER,
    to,
    subject: `${SITE.name}: reset your password`,
    text: `Someone (hopefully you) asked to reset your ${SITE.name} password.\n\nReset it here: ${link}\n\nThis link expires in 30 minutes. If you didn't ask, ignore this email.`,
  });
  // the production trail: who was mailed and the relay's acceptance id
  // (never the link itself — that would put a live token in the log)
  console.log(`[reset] Sent password reset email to ${to} via ${SMTP_HOST} (${info.messageId || "no id"}; ${info.response || "no response"})`);
}

export function registerRoutes(app, game) {
  const { sessions, onlineSockets, readSnapshot, allSnapshots, gameSummary, freshStory, inGame, myGamesFor, recentGamesFor, deleteGame, endGameByCode, reopenGameByCode, sleepGameByCode, inviteToGame, renameUser, setTags, commentRows, closeDocFor, closeDocReaders } = game;

  // Random tagline quote for the homepage hero. content/quotes.json (one
  // string per entry) is hand-editable and read on every request, so new
  // quotes appear without a restart. Public — the homepage has no auth.
  const readQuotes = () => {
    let quotes = readContent("quotes.json");
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

  // The guided-prompt menus: ids + labels only, so the vote card can build its
  // dropdowns without shipping every clause of the component library.
  app.get("/api/prompt-options", (_req, res) => {
    const data = getPromptData().intermediate || null;
    if (!data) return res.json({ modes: ["simple"], intermediate: null });
    // Each menu row carries the rules that decide whether it can go with the
    // other choices — never its clause text — so the client can grey out an
    // option the generator would refuse (exes on a minor season, a modern
    // world with… no: fluff with explicit) instead of letting it be picked.
    const rules = (x) => ({
      ...(x.tags?.length ? { tags: x.tags } : {}),
      ...(x.requiresTags?.length ? { requires: x.requiresTags } : {}),
      ...(x.incompatibleTags?.length ? { excludes: x.incompatibleTags } : {}),
      ...(x.compatibleAgeGroups?.length ? { ageGroups: x.compatibleAgeGroups } : {}),
      ...(x.compatibleCanon?.length ? { canon: x.compatibleCanon } : {}),
      ...(x.adultOnly ? { adultOnly: true } : {}),
    });
    const menu = (list) => (list || []).map((x) => ({ id: x.id, label: x.label, ...rules(x) }));
    res.json({
      modes: ["simple", "intermediate"],
      intermediate: {
        seasons: (data.seasons || []).map((x) => ({ id: x.id, label: x.label, ageGroup: x.ageGroup, ...rules(x) })),
        canon: menu(data.canon),
        worlds: menu((data.tropes || []).filter((t) => t.group === "setting-au")),
        places: menu(data.places),
        // every world's own rooms (id/label/rules; `requires` carries the
        // world's au-<id> tag) so the Place menu can follow the chosen world
        auPlaces: menu(data.auPlaces),
        situations: menu(data.situations),
        relationships: menu(data.relationships),
        tones: menu(data.tones),
        explicitLevels: menu(data.explicit?.levels).filter((x) => x.id !== "suggestive").map((x) => ({ ...x, adultOnly: !!x.adultOnly })),
        // the explicit dropdowns (ids + labels + rules, never clause text);
        // the client shows them only past None and the generator only reads
        // them past the gate
        setups: menu(data.explicit?.setups),
        dynamics: menu(data.explicit?.dynamics),
        acts: menu(data.explicit?.acts),
        kinks: menu(data.explicit?.kinks),
        tropeGroups: Object.entries(data.tropeGroups || {}).map(([id, label]) => ({ id, label })),
      },
    });
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
        code: g.code, name: g.name || "", phase: g.phase, paused: !!g.paused,
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
      return res.status(403).json({ error: "Sign-ups are closed for now, join the waiting list!", capReached: true });
    const { email, username, password, color } = req.body || {};
    const member = req.body?.isAMemberOfBylerOffscreen === true; // the signup checkbox; only a real true counts
    const em = String(email || "").toLowerCase().trim();
    const un = String(username || "").trim();
    if (!EMAIL_RE.test(em)) return res.status(400).json({ error: "Enter a valid email." });
    if (un.length < 4 || un.length > 24)
      return res.status(400).json({ error: "Username must be 4–24 characters." });
    if (un.includes("@"))
      return res.status(400).json({ error: "Usernames can't contain @: that's for emails." });
    if (String(password || "").length < 4)
      return res.status(400).json({ error: "Password must be at least 4 characters." });
    if (findByEmail(em)) return res.status(400).json({ error: "That email already has an account." });
    if (findByUsername(un)) return res.status(400).json({ error: "That username is taken." });
    const u = {
      id: randomUUID(), email: em, username: un, passHash: hashPassword(password),
      color: cleanColor(color), games: [], wordCount: 0, currentBadge: null, badges: [], isAMemberOfBylerOffscreen: member,
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
    if (findByEmail(em)) return res.status(400).json({ error: "That email already has an account, just log in!" });
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
      return res.status(400).json({ error: "Usernames can't contain @: that's for emails." });
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
    u.sounds = { chat: !!b.chat, story: !!b.story, clock: !!b.clock, gimmick: b.gimmick == null ? true : !!b.gimmick }; // absent = on (older settings pages)
    saveStore();
    res.json({ user: publicUser(u) });
  });

  // The signup checkbox, changeable later from /settings. Only a real true counts.
  app.post("/api/account/membership", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Not signed in." });
    u.isAMemberOfBylerOffscreen = req.body?.isAMemberOfBylerOffscreen === true;
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

  // Which themes this account has earned. Themes are a rank reward: a theme
  // listed in achievements.json's themeUnlocks needs that word tier, anything
  // unlisted is free, and admins get the lot. Signed out, only the free ones —
  // the caller sends no token and gets an empty `unlocked`. This gate is
  // cosmetic by nature (a theme is a css attribute on the visitor's own
  // document), so it hides rewards rather than protecting anything.
  app.get("/api/themes", (req, res) => {
    const u = authedUser(req); // optional: signed-out visitors get the free set
    res.json({ locks: themeLocks(), unlocked: unlockedThemes(u), admin: isAdmin(u || {}) === true });
  });

  // Which gimmicks this account has earned. Same gate as themes: catalogue +
  // locks for the menu, unlocked for the caller. Play is enforced server-side
  // in game.js (a table where ANYONE holds the rank may play) — this only
  // feeds the menu.
  app.get("/api/gimmicks", (req, res) => {
    const u = authedUser(req);
    res.json({
      catalogue: Object.values(GIMMICKS),
      locks: gimmickLocks(), unlocked: unlockedGimmicks(u), admin: isAdmin(u || {}) === true,
    });
  });

  // Public achievement metadata for the profile page. Raw trigger word lists
  // never ship — and SECRET usage badges don't even ship their descriptions
  // (those arrive per-user via badgeDescs once earned). Open usage badges are
  // the non-secret kind: their descriptions always show.
  app.get("/api/achievements", (req, res) => {
    // Secret badges keep their triggers and descriptions to themselves —
    // except for an admin, who gets the whole recipe so the ranks page can
    // show them how every badge is earned.
    const admin = isAdmin(authedUser(req));
    const recipe = (b) => (admin ? { desc: b.desc, triggers: b.triggers || [], combos: b.combos || [] } : {});
    res.json({
      // ids ride along so the ranks page can join tiers to themeUnlocks /
      // gimmick locks (they're not secret — docs/UNLOCKS.md prints them)
      wordTiers: WORD_TIERS.map((t) => ({ id: t.id, name: t.name, min: t.min, desc: t.desc })),
      usage: USAGE.map((b) => ({ name: b.name, ...recipe(b) })),
      usageOpen: USAGE_OPEN.map((b) => ({ name: b.name, desc: b.desc, ...recipe(b) })),
      usageCount: USAGE.length,
      admin,
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

  // Friendship is mutual (both ids in both `friends` arrays); a pending
  // request is just a friend-request message sitting in the target's inbox.
  // (Declared here because the directory below reads them too.)
  const areFriends = (a, b) => (a.friends || []).includes(b.id);
  const pendingReqFrom = (target, senderId) =>
    (target.inbox || []).find((m) => m.type === "friend-request" && m.fromId === senderId);

  // The writers directory: every account, with live online status.
  app.get("/api/users", (req, res) => {
    const me = authedUser(req);
    if (!me) return res.status(401).json({ error: "Sign in first." });
    const ids = new Set(onlineSockets.values());
    const users = store.users
      .map((x) => ({
        username: x.username, color: x.color, badge: badgeName(x.currentBadge),
        wordCount: x.wordCount, online: ids.has(x.id),
        avatar: x.avatar || "", avatarFit: x.avatarFit || "cover",
        // where the caller stands with them: the directory row says so
        me: x.id === me.id,
        friend: x.id !== me.id && areFriends(me, x),
        requested: x.id !== me.id && !!pendingReqFrom(x, me.id),
      }))
      .sort((a, b) => (Number(b.online) - Number(a.online)) || a.username.localeCompare(b.username));
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
    /** @type {{text: string, code: string, name: string, savedAt: number} | null} */
    let lastLine = null; // the newest story line this user committed, as plain text
    for (const d of allSnapshots()) {
      {
        const isHost = d.hostUserId === u.id;
        if (!isHost && !(d.writers || []).some((w) => w.userId === u.id)) continue;
        const live = sessions.get(d.code);
        (isHost ? hosted : contributed).push({
          code: d.code, name: d.name || "", prompt: d.prompt || "", phase: d.phase,
          lines: (d.story || []).length, savedAt: d.savedAt || 0,
          inProgress: !!live && live.phase !== "over",
          // may the VIEWER open this in their archive (copy/download/write
          // more)? Only a contributor, the host or an admin; everyone else
          // gets the read-only story view.
          mine: inGame(d, viewer) || isAdmin(viewer),
        });
        if ((d.savedAt || 0) >= (lastLine?.savedAt ?? -1))
          for (const l of d.story || []) {
            if (l.userId !== u.id) continue;
            const text = clip(plainText(l.html), 220);
            if (text) lastLine = { text, code: d.code, name: d.name || "", savedAt: d.savedAt || 0 };
          }
      }
    }
    hosted.sort((a, b) => b.savedAt - a.savedAt);
    contributed.sort((a, b) => b.savedAt - a.savedAt);
    // Solo writes, private ones included: the profile LISTS everything this
    // writer has written; `viewable` says whether the viewer may open it.
    const writes = docsOwnedBy(u.id).map((d) => ({
      ...docSummary(d, nameOf), mine: d.ownerId === viewer.id, viewable: canView(d, viewer?.id ?? null),
      deletable: d.ownerId === viewer.id || isAdmin(viewer), // an admin may delete any story
    }));
    // Sprints: the newest 20, each naming the project it was written in.
    const sprints = (u.sprints || []).slice(0, 20);
    res.json({ user: profileOf(u, new Set(onlineSockets.values()), viewer), hosted, contributed, writes, sprints, lastLine: u.lastLine || lastLine, friendState });
  });

  // ---- Inbox ----
  // The wire shape resolves fromId to a public identity (never the account id).
  const ident = (x) => x
    ? { username: x.username, color: x.color, badge: badgeName(x.currentBadge),
        avatar: x.avatar || "", avatarFit: x.avatarFit || "cover" }
    : null;
  // `owner` is whose inbox the copy sits in: a received message's recipient
  // is the owner; a sent copy (`mine`) names its recipient by `toId`, stored
  // at send time. Older sent copies with no toId have no known recipient.
  const msgShape = (m, owner) => {
    const from = m.fromId ? store.users.find((x) => x.id === m.fromId) : null;
    const to = m.mine === true
      ? (m.toId ? store.users.find((x) => x.id === m.toId) : null)
      : (m.toId ? store.users.find((x) => x.id === m.toId) : null) || owner;
    return {
      id: m.id, type: m.type, text: m.text, read: m.read === true, ts: m.ts,
      code: m.code || null, // game-invite messages carry the game code
      // a rank-up note names what the rank handed out ({themes, gimmicks})
      ...(m.unlocks ? { unlocks: m.unlocks } : {}),
      // A conversation: a reply carries the thread of what it answers, and a
      // message with no thread of its own IS its thread. `mine` is my own sent
      // copy — kept so a chain can show both halves of the exchange.
      threadId: m.threadId || m.id,
      mine: m.mine === true,

      from: ident(from),
      to: ident(to),
    };
  };

  app.get("/api/inbox", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const messages = (u.inbox || []).map((m) => msgShape(m, u)).sort((a, b) => b.ts - a.ts);
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

  // ---- Help: ask the admin ----
  // The dashboard's help box. A question lands in every admin's inbox as a
  // `help` message from the asker, so the admin can reply to it like any note.
  const HELP_COOLDOWN_MS = 30_000;
  const HELP_MAX = 1000;

  app.post("/api/help", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    if (isAdmin(u)) return res.status(400).json({ error: "You are the admin, questions land in your inbox." });
    const text = stripTags(String(req.body?.text || "")).trim().slice(0, HELP_MAX);
    if (text.length < 2) return res.status(400).json({ error: "Type your question first." });
    const admins = store.users.filter(isAdmin);
    if (!admins.length) return res.status(503).json({ error: "There's no admin to ask right now." });
    // Light anti-spam: one question every 30 seconds.
    if (u.lastHelpAt && Date.now() - u.lastHelpAt < HELP_COOLDOWN_MS)
      return res.status(429).json({ error: "Give the last question a moment to land." });
    u.lastHelpAt = Date.now();
    // One thread id across every copy — each admin's, and the asker's own —
    // so an answer from any admin chains onto the question that prompted it.
    const threadId = randomUUID();
    for (const a of admins) {
      a.inbox = a.inbox || [];
      a.inbox.unshift(makeMsg("help", u.id, text, { threadId, toId: a.id }));
    }
    u.inbox = u.inbox || [];
    u.inbox.unshift(makeMsg("help", u.id, text, { threadId, mine: true, read: true, toId: admins[0].id }));
    saveStore();
    res.json({ ok: true, sentTo: admins.map((a) => a.username) });
  });

  // Message another writer straight from their profile — a plain note into
  // their inbox that starts a conversation (they Reply to chain onto it). No
  // friendship required: an inbox note is how people first reach each other.
  app.post("/api/message", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const to = findByUsername(req.body?.username);
    if (!to) return res.status(404).json({ error: "No writer by that name." });
    if (to.id === u.id) return res.status(400).json({ error: "That's you." });
    const text = stripTags(String(req.body?.text || "")).trim().slice(0, HELP_MAX);
    if (text.length < 1) return res.status(400).json({ error: "Type a message first." });
    // light anti-spam, shared with the help box's cadence
    if (u.lastHelpAt && Date.now() - u.lastHelpAt < HELP_COOLDOWN_MS)
      return res.status(429).json({ error: "Give the last message a moment to land." });
    u.lastHelpAt = Date.now();
    const threadId = randomUUID();
    to.inbox = to.inbox || [];
    to.inbox.unshift(makeMsg("note", u.id, text, { threadId, toId: to.id }));
    u.inbox = u.inbox || [];
    (u.inbox ??= []).unshift(makeMsg("note", u.id, text, { threadId, mine: true, read: true, toId: to.id }));
    saveStore();
    res.json({ ok: true });
  });

  // Reply to a message sitting in MY inbox — the other half of the help box,
  // and how the admin answers. The reply is an ordinary note in their inbox.
  app.post("/api/inbox/reply", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const m = (u.inbox || []).find((x) => x.id === String(req.body?.id || ""));
    if (!m) return res.status(404).json({ error: "No such message." });
    const to = m.fromId ? store.users.find((x) => x.id === m.fromId) : null;
    if (!to) return res.status(400).json({ error: "There's nobody to reply to." });
    const text = stripTags(String(req.body?.text || "")).trim().slice(0, HELP_MAX);
    if (text.length < 1) return res.status(400).json({ error: "Type a reply first." });
    // The exchange is one conversation: the reply joins the thread of what it
    // answers (a message with no thread of its own starts one), and I keep my
    // own copy — already read — so the chain shows both halves on both sides.
    const threadId = m.threadId || m.id;
    m.threadId = threadId;
    to.inbox = to.inbox || [];
    to.inbox.unshift(makeMsg("note", u.id, text, { threadId, toId: to.id }));
    (u.inbox ??= []).unshift(makeMsg("note", u.id, text, { threadId, mine: true, read: true, toId: to.id }));
    m.read = true;
    saveStore();
    res.json({ ok: true, threadId });
  });

  // ---- Friends ----
  // Friendship is mutual (both ids in both `friends` arrays); a pending
  // request is just a friend-request message sitting in the target's inbox.

  app.get("/api/friends", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const ids = new Set(onlineSockets.values());
    const friends = (u.friends || [])
      .flatMap((id) => { const x = store.users.find((y) => y.id === id); return x ? [x] : []; })
      .map((x) => ({
        username: x.username, color: x.color, badge: badgeName(x.currentBadge),
        avatar: x.avatar || "", avatarFit: x.avatarFit || "cover", online: ids.has(x.id),
        // the row's hover tooltip: the same public counts a profile shows
        wordCount: x.wordCount || 0, badges: (x.badges || []).length, games: (x.games || []).length,
      }))
      .sort((a, b) => (Number(b.online) - Number(a.online)) || a.username.localeCompare(b.username));
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
      return res.status(400).json({ error: "They already sent you a request, check your inbox!" });
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
    u.inbox = (u.inbox || []).filter((x) => x.id !== m.id);
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
    if (!u) return res.status(404).json({ error: "There's no username under that email, no account exists." });
    res.json({ username: u.username });
  });

  app.post("/api/send-reset", async (req, res) => {
    const em = String(req.body?.email || "").toLowerCase().trim();
    if (!EMAIL_RE.test(em)) return res.status(400).json({ error: "Enter a valid email." });
    const u = findByEmail(em);
    if (!u) return res.status(404).json({ error: "There's no username under that email, no account exists." });
    // one live reset token per user
    for (const [t, r] of Object.entries(store.resets))
      if (r.userId === u.id || r.exp < Date.now()) delete store.resets[t];
    const token = randomUUID();
    store.resets[token] = { userId: u.id, exp: Date.now() + RESET_TTL_MS };
    saveStore();
    const link = `${RESET_ORIGIN}/reset.html?token=${token}`;
    try {
      await sendResetEmail(u.email, link);
    } catch (e) {
      delete store.resets[token];
      saveStore();
      console.error("sendResetEmail failed:", e.message);
      return res.status(502).json({ error: "We couldn't send the reset email. Please try again later." });
    }
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
    // ?kind=game|write narrows to one shelf (the rail's "All previous games"); anything else is both
    const kind = req.query.kind === "game" || req.query.kind === "write" ? req.query.kind : "";
    const sort = req.query.sort === "words" ? "words" : "date";
    const dir = req.query.dir === "asc" ? 1 : -1;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12));
    const all = [];
    for (const d of kind === "write" ? [] : allSnapshots()) {
      {
        // "title" is what the cards show: the host-set name, else the prompt
        if (q && !`${d.name || ""} ${d.prompt || ""}`.toLowerCase().includes(q)) continue;
        if (tag && !(d.tags || []).some((t) => String(t).toLowerCase() === tag)) continue;
        if (forUser && !inGame(d, forUser) && d.hostUserId !== forUser.id) continue;
        all.push({ ...gameSummary(d), kind: "game", wordCount: storyWordCount(d) });
      }
    }
    // Public solo writes are listed here too — "public" means listed, not
    // merely reachable by link. Private and reader-shared ones never appear
    // in the library at large — but ONE writer's page (?user=) lists all of
    // theirs, with `viewable` deciding whether a card opens for the viewer.
    const viewer = authedUser(req);
    for (const d of kind === "game" ? [] : forUser ? docsOwnedBy(forUser.id) : publicDocs()) {
      if (q && !String(d.title || "").toLowerCase().includes(q)) continue;
      if (tag) continue; // documents carry no tags
      all.push({
        kind: "write", id: d.id, name: d.title, prompt: "", code: "",
        lines: (d.chapters || []).length || 1, phase: "write", // for a write, `lines` counts chapters tags: [], cover: "", writers: [],
        hostName: nameOf(d.ownerId),
        createdAt: d.createdAt, savedAt: d.updatedAt,
        wordCount: d.wordCount || 0,
        visibility: d.visibility, viewable: canView(d, viewer?.id ?? null),
        deletable: !!viewer && (d.ownerId === viewer.id || isAdmin(viewer)),
      });
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
    // Story html in snapshots already passed through sanitizeRich() when written.
    const d = readSnapshot(code);
    if (!d) return res.status(404).json({ error: "Not found." });
    res.json({ ...gameSummary(d), wordCount: storyWordCount(d), story: freshStory(d.story) });
  });

  // ---- Solo writes ----
  // Documents, not games: no timers, no turns. The author owns the doc; friends
  // invited as beta readers can open it (once shared) and comment per line.
  // Durable CRUD lives here; presence and live comment fan-out are sockets.

  // The slash-command word bank. Static, auth'd only to keep it off the public
  // surface — it's read once at startup, so this is a cheap constant response.
  app.get("/api/reference", (req, res) => {
    if (!authedUser(req)) return res.status(401).json({ error: "Sign in first." });
    res.json(getReference());
  });

  const nameOf = (id) => store.users.find((x) => x.id === id)?.username || "";
  // Reader rows carry what the presence/avatar UI needs.
  const readerRows = (doc) =>
    (doc.betaReaders || [])
      .flatMap((id) => { const x = store.users.find((y) => y.id === id); return x ? [x] : []; })
      .map((x) => ({
        username: x.username, color: x.color,
        avatar: x.avatar || "", avatarFit: x.avatarFit || "cover",
      }));
  // commentRows comes from game.js so HTTP and socket payloads can never drift.
  // `u` may be null: a public write is served to signed-out visitors. Comments
  // and the reader roster leave the server only for people who may comment —
  // a plain reader (public, signed in or not) gets an empty list, so nothing
  // on the client has to remember to hide them.
  const docPayload = (doc, u) => {
    const uid = u?.id ?? null;
    const notes = canComment(doc, uid);
    return {
      ...docSummary(doc, nameOf),
      html: doc.html || "", // the chapters joined — kept for readers of the old shape
      chapters: doc.chapters.map(({ id, title, html, wordCount }) => ({ id, title, html, wordCount })),
      mine: doc.ownerId === uid,
      canComment: notes,
      rev: doc.rev || 0,
      readerRows: notes ? readerRows(doc) : [],
      comments: notes ? commentRows(doc) : [],
    };
  };

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

  // Sign-in is optional here, the one doc route where it is: a public write
  // is a public page. Anything else still needs an account (401 signed out).
  app.get("/api/docs/:id", (req, res) => {
    const u = authedUser(req);
    const doc = readDoc(req.params.id);
    if (!doc) return res.status(404).json({ error: "No such document." });
    if (!canView(doc, u?.id ?? null)) {
      if (!u) return res.status(401).json({ error: "Sign in to read this." });
      return res.status(403).json({ error: "That document isn't shared with you." });
    }
    res.json({ doc: docPayload(doc, u) });
  });

  // Save. The body is rich text headed for other people's DOM — sanitizeDoc()
  // here is the trust boundary; the client's cleanHtml() is only convenience.
  app.put("/api/docs/:id", async (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const doc = readDoc(req.params.id);
    if (!doc) return res.status(404).json({ error: "No such document." });
    if (!canEdit(doc, u.id)) return res.status(403).json({ error: "Only the author can edit this." });
    // Optimistic concurrency: a client that says which SAVE it started from
    // (`baseRev`, the rev it last received) is refused when another save has
    // landed since — another tab of the same author. `rev` moves here and
    // nowhere else: comments, sprints and sharing all stamp `updatedAt`, and
    // none of them is a reason to stop an author's autosave. A body without it
    // (a deliberate overwrite) saves as before.
    const base = req.body?.baseRev;
    if (typeof base === "number" && (doc.rev || 0) !== base)
      return res.status(409).json({ error: "This story was changed elsewhere — in another tab, perhaps. Reload to see it, or Save to overwrite.", conflict: true, rev: doc.rev || 0 });
    const before = snapshotOf(doc); // what this save replaces — history may want it
    doc.rev = (doc.rev || 0) + 1;
    if (typeof req.body?.title === "string") doc.title = cleanTitle(req.body.title);
    const chapters = req.body?.chapters;
    if (chapters !== undefined) {
      // The whole list, in its new order: an existing id keeps its chapter, a
      // new (or unknown) one is minted, a chapter left out is deleted — its
      // comments read as orphaned from then on, nothing else to do.
      if (!Array.isArray(chapters) || !chapters.length) return res.status(400).json({ error: "A document needs at least one chapter." });
      if (chapters.length > MAX_CHAPTERS) return res.status(400).json({ error: `At most ${MAX_CHAPTERS} chapters.` });
      // Refuse, never cut: sanitizeDoc slices at DOC_MAX, and a silent slice is
      // the end of somebody's chapter gone for good.
      const long = chapters.findIndex((c) => String(c?.html ?? "").length > DOC_MAX);
      if (long >= 0) return res.status(413).json({ error: `Chapter ${long + 1} is too long to save. Split it into two chapters.` });
      const known = new Set(doc.chapters.map((c) => c.id)), used = new Set();
      doc.chapters = chapters.map((c, i) => {
        const keep = known.has(c?.id) && !used.has(c.id);
        const id = keep ? c.id : newChapterId();
        used.add(id);
        return { id, title: cleanChapterTitle(c?.title, i + 1), html: sanitizeDoc(String(c?.html ?? "")) };
      });
    } else if (typeof req.body?.html === "string") {
      // the pre-chapter save shape: the body of a single-chapter document
      if (doc.chapters.length !== 1) return res.status(400).json({ error: "This document has chapters — send them." });
      if (req.body.html.length > DOC_MAX) return res.status(413).json({ error: "This chapter is too long to save. Split it into two chapters." });
      doc.chapters[0].html = sanitizeDoc(req.body.html);
    }
    writeDoc(doc); // recomputes wordCount
    if (game.creditSoloWords(u, doc)) writeDoc(doc); // the high-water mark moved
    // "Saved" has to mean the store took it. The server's memory already holds
    // the new copy (and storage keeps retrying the write), but until it lands a
    // restart would roll the story back — so the author's editor is told the
    // truth: it stays unsaved, keeps its local draft, and saves again shortly.
    // `rev` rides along because the copy in memory DID move: the retry names it.
    // The copy this save replaced is kept when enough time has passed, or when
    // the save lost a lot of words or a chapter (lib/doc-history.js) — so the
    // next accident is two clicks to undo, not a database restore.
    await keepBeforeOverwrite(doc.id, before, doc);
    try {
      await docLanded(doc);
    } catch {
      return res.status(503).json({ error: "Couldn't reach the database just now. Your words are safe in this tab and saved in this browser. Trying again shortly.", unlanded: true, rev: readDoc(doc.id)?.rev || 0 }); // the rev a retry will meet: moved in a memory-first store, unmoved on plain files
    }
    // Answer from a fresh read, not the snapshot taken at the top: a comment
    // that arrived while this request was awaiting the store has already put
    // its anchor in the chapter and its thread in the record, and the
    // snapshot would hand the editor a page and a rail from before it.
    res.json({ doc: docPayload(readDoc(doc.id) || doc, u), wordCount: u.wordCount });
  });

  // ---- version history: the author's alone ----
  // A story's kept copies (when, why, how long); one copy in full; and Restore,
  // which is itself a save — it keeps the copy it replaces, so it can be undone.
  const ownDoc = (req, res) => {
    const u = authedUser(req);
    if (!u) return void res.status(401).json({ error: "Sign in first." });
    const doc = readDoc(req.params.id);
    if (!doc) return void res.status(404).json({ error: "No such document." });
    if (!canEdit(doc, u.id)) return void res.status(403).json({ error: "Only the author can see a story's history." });
    return { u, doc };
  };
  app.get("/api/docs/:id/history", async (req, res) => {
    const own = ownDoc(req, res);
    if (!own) return;
    const versions = (await listHistory(own.doc.id)).map(({ at, reason, words, chapters }) => ({ at, reason, words, chapters }));
    res.json({ versions });
  });
  app.get("/api/docs/:id/history/:at", async (req, res) => {
    const own = ownDoc(req, res);
    if (!own) return;
    const copy = await readHistory(own.doc.id, req.params.at);
    if (!copy) return res.status(404).json({ error: "That version is gone." });
    res.json({ version: { at: Number(req.params.at), title: copy.title, words: copy.words, chapters: copy.chapters } });
  });
  app.post("/api/docs/:id/history/:at/restore", async (req, res) => {
    const own = ownDoc(req, res);
    if (!own) return;
    const { u, doc } = own;
    const copy = await readHistory(doc.id, req.params.at);
    if (!copy || !Array.isArray(copy.chapters) || !copy.chapters.length) return res.status(404).json({ error: "That version is gone." });
    const before = snapshotOf(doc);
    doc.rev = (doc.rev || 0) + 1; // a restore is a save: every open editor's next save meets it
    const used = new Set();
    doc.chapters = copy.chapters.slice(0, MAX_CHAPTERS).map((c, i) => {
      const id = typeof c?.id === "string" && !used.has(c.id) ? c.id : newChapterId();
      used.add(id);
      return { id, title: cleanChapterTitle(c?.title, i + 1), html: sanitizeDoc(String(c?.html ?? "")) };
    });
    writeDoc(doc);
    await keepBeforeOverwrite(doc.id, before, doc, { force: "restore" });
    try {
      await docLanded(doc);
    } catch {
      return res.status(503).json({ error: "Couldn't reach the database just now. Nothing was lost. Try the restore again in a moment.", unlanded: true });
    }
    res.json({ doc: docPayload(readDoc(doc.id), u) });
  });

  app.delete("/api/docs/:id", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const doc = readDoc(req.params.id);
    if (!doc) return res.status(404).json({ error: "No such document." });
    // The author, or an admin (moderation: a story that has to go). An admin's
    // delete tells the author who did it, the way deleteGame tells the seats.
    if (!canEdit(doc, u.id) && !isAdmin(u)) return res.status(403).json({ error: "Only the author can delete this." });
    deleteDoc(doc.id);
    if (doc.ownerId !== u.id) {
      const owner = store.users.find((x) => x.id === doc.ownerId);
      if (owner) {
        (owner.inbox ??= []).unshift(makeMsg("system", null, `🗑 Your solo write “${doc.title || "Untitled"}” has been deleted by ${u.username}.`));
        saveStore();
      }
    }
    res.json({ ok: true });
  });

  // A writing sprint, logged when it stops: the client subtracts the words it
  // had when the sprint began from the words it has now. The count lands on
  // the account (a `sprints` log, newest first, with the doc it was written
  // in) and on the document (its own running total), so a profile can say
  // how much was sprinted and where. Owner only — you sprint in your own
  // draft. Negative counts (words deleted) log as 0: a sprint can't owe.
  // The solo editor's prompt roller: one prompt in the asked mode, with the
  // guided knobs honoured; nothing is stored.
  app.post("/api/prompt/roll", (req, res) => {
    if (!authedUser(req)) return res.status(401).json({ error: "Sign in first." });
    res.json(game.rollPrompt(req.body?.mode, req.body?.controls));
  });

  // Delete one of MY OWN sprints, keyed by its `at` timestamp (sprints carry
  // no id; `at` is a per-user ms stamp, unique enough). Rolls the words back
  // off the account and, if the document still exists, off its running totals.
  app.delete("/api/account/sprints/:at", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const at = Number(req.params.at);
    const list = u.sprints || [];
    const i = list.findIndex((s) => s.at === at);
    if (i === -1) return res.status(404).json({ error: "No such sprint." });
    const [gone] = list.splice(i, 1);
    u.sprints = list;
    u.sprintWords = Math.max(0, (u.sprintWords || 0) - (gone.words || 0));
    const doc = gone.docId ? readDoc(gone.docId) : null;
    if (doc && doc.ownerId === u.id) {
      doc.sprintWords = Math.max(0, (doc.sprintWords || 0) - (gone.words || 0));
      doc.sprints = Math.max(0, (doc.sprints || 0) - 1);
      writeDoc(doc);
    }
    saveStore();
    res.json({ ok: true, sprintWords: u.sprintWords, sprintCount: u.sprints.length });
  });

  app.post("/api/docs/:id/sprint", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const doc = readDoc(req.params.id);
    if (!doc) return res.status(404).json({ error: "No such document." });
    if (!canEdit(doc, u.id)) return res.status(403).json({ error: "Only the author can sprint here." });
    const words = Math.min(50000, Math.max(0, Math.floor(Number(req.body?.words) || 0)));
    const seconds = Math.min(86400, Math.max(0, Math.floor(Number(req.body?.seconds) || 0)));
    const entry = { docId: doc.id, title: doc.title, words, seconds, at: Date.now() };
    u.sprints = [entry, ...(u.sprints || [])].slice(0, 200);
    u.sprintWords = (u.sprintWords || 0) + words;
    saveStore();
    doc.sprintWords = (doc.sprintWords || 0) + words;
    doc.sprints = (doc.sprints || 0) + 1;
    writeDoc(doc);
    res.json({ ok: true, sprint: entry, sprintWords: u.sprintWords, doc: docPayload(doc, u) });
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
    // Assigning a beta reader is meant to hand them the story, so a private
    // doc moves to the "readers" state automatically — otherwise the invite
    // arrives but the reader still can't open it. A public doc is already
    // wider than "readers", so it's left as is.
    if (doc.visibility === "private") doc.visibility = "readers";
    writeDoc(doc);
    target.inbox = target.inbox || [];
    target.inbox.unshift(makeMsg("doc-invite", u.id, `${u.username} added you as a beta reader on “${doc.title}”. Open it from your Beta reading list.`));
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
    // Anything unrecognised narrows to private — the safe direction. A body
    // that carries only `theme` (the reader-theme picker) leaves visibility be.
    const body = req.body || {};
    if (typeof body.visibility === "string") doc.visibility = cleanVisibility(body.visibility);
    if ("theme" in body) doc.theme = cleanTheme(body.theme);
    writeDoc(doc);
    // Narrowing to private boots whoever is reading it right now, so the UI
    // has to say so — nobody should vanish mid-sentence without being told.
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

  // Strip admin off an account that was flagged by hand (not through the
  // ADMIN_EMAILS allowlist) — e.g. a test account someone toggled during
  // development. That's the only way an admin row can end up removable: an
  // allowlisted email gets re-promoted on its next login/signup (see below),
  // so demoting one here would silently revert — refuse instead of lying.
  app.post("/api/admin/users/:username/demote", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const target = findByUsername(req.params.username);
    if (!target) return res.status(404).json({ error: "No such user." });
    if (!isAdmin(target)) return res.status(400).json({ error: "That account isn't an admin." });
    if (ADMIN_EMAILS.has(target.email)) return res.status(400).json({ error: "This account's admin status is tied to its email and can't be revoked here." });
    target.admin = false;
    saveStore();
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

  // The prompt library, whole: every axis, the trope bank, the explicit
  // layer and the curated scenarios. The editor round-trips the document —
  // PUT validates it as one piece (lib/prompt-gen validateIntermediateData)
  // and nothing is written unless all of it passes.
  app.get("/api/admin/prompts", (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.json({ data: getPromptData() });
  });
  app.put("/api/admin/prompts", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const errors = await setPromptData(req.body?.data);
      if (errors.length) return res.status(400).json({ error: "The library didn't validate.", errors });
      res.json({ ok: true });
    } catch (err) {
      console.error("prompt library save failed:", err.message);
      res.status(500).json({ error: "The library couldn't be saved. Please try again." });
    }
  });

  // The writers-reference bank behind the "/" palette, one group per data
  // file. The editor edits a group at a time: PUT replaces that group's
  // categories whole (a category emptied is a category removed) and the next
  // palette open serves it — no restart, mirrored like the prompt library.
  // ---- Announcements: the admin's blog. Reading needs an account, writing
  // needs admin — the page hides the composer and Delete for everyone else,
  // and these checks are what actually enforces it.
  app.get("/api/announcements", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in to read announcements." });
    res.json({ posts: listPosts(), admin: isAdmin(u) });
  });
  app.post("/api/admin/announcements", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const r = addPost({ markdown: req.body?.markdown, images: req.body?.images }, authedUser(req));
    if (r.error) return res.status(400).json({ error: r.error });
    // every account hears about it: a system note in each inbox naming the
    // post, so nobody has to check /announcements to learn there is one
    for (const u of store.users) {
      u.inbox = u.inbox || [];
      u.inbox.unshift(makeMsg("system", null, `📣 New announcement: “${r.post?.title ?? ""}” — read it on /announcements.`));
    }
    saveStore();
    res.json({ ok: true, post: r.post });
  });
  // Share an announcement to the admin Discord channel: the post's MARKDOWN
  // goes verbatim (Discord renders it). Admin only, like posting itself.
  app.post("/api/admin/announcements/:id/discord", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const post = listPosts().find((p) => p.id === String(req.params.id));
    if (!post) return res.status(404).json({ error: "No such post." });
    const r = await postAnnouncement(post);
    if (r.error) return res.status(502).json({ error: r.error });
    res.json({ ok: true });
  });
  app.put("/api/admin/announcements/:id", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const r = updatePost(String(req.params.id), { markdown: req.body?.markdown, images: req.body?.images }, authedUser(req));
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    res.json({ ok: true, post: r.post });
  });
  app.delete("/api/admin/announcements/:id", (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!deletePost(String(req.params.id))) return res.status(404).json({ error: "No such post." });
    res.json({ ok: true });
  });

  // Where the data lives and whether writes are landing: "files" locally,
  // "postgres" on Replit. lastError surfaces a failed upsert that would
  // otherwise only be a server log line.
  // Why did a reset email fail? Verifies the SMTP transport and returns the
  // real error to an admin (the reset route only ever says "try again later").
  app.get("/api/admin/smtp", async (req, res) => {
    const u = authedUser(req);
    if (!isAdmin(u)) return res.status(403).json({ error: "Admins only." });
    res.json(await smtpStatus());
  });

  app.get("/api/admin/storage", (req, res) => {
    const u = authedUser(req);
    if (!isAdmin(u)) return res.status(403).json({ error: "Admins only." });
    res.json({ mode: storage.mode, counts: storage.counts(), seeded: storage.seeded, lastError: storage.lastError, unlanded: storage.unlanded, summary: describeStorage() });
  });

  // The badge catalogue editor: the whole achievements document in, the whole
  // document out — validated and live at once (lib/achievements.js).
  app.get("/api/admin/achievements", (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.json(getAchievements());
  });
  app.put("/api/admin/achievements", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const errors = setAchievements(req.body?.data);
    if (errors.length) return res.status(400).json({ error: "The badge catalogue didn't validate.", errors });
    res.json({ ok: true, data: getAchievements() });
  });

  app.get("/api/admin/reference", (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.json(getReference());
  });
  app.put("/api/admin/reference/:slug", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const errors = setReferenceGroup(req.params.slug, req.body?.categories);
    if (errors.length) return res.status(400).json({ error: "That group didn't validate.", errors });
    res.json({ ok: true, group: getReference().groups.find((g) => g.slug === req.params.slug) || null });
  });

  // A backup of the live pack: every content/* and reference/* document as
  // the store holds it (the database in production), zipped as
  // content/<name>.json + writers-reference/<name>.json — the repo's own
  // layout, so a download can be dropped back in and reseeded.
  app.get("/api/admin/content.zip", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const files = [];
    for (const [kind, dir] of [["content", "content"], ["reference", "writers-reference"]]) {
      for (const name of storage.list(kind).sort()) files.push({ name: `${dir}/${name}.json`, data: storage.get(kind, name) ?? "" });
    }
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="cowrite-content-${stamp}.zip"`);
    res.send(buildZip(files));
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

  // The host (or an admin) ends a game from the dashboard's card menu: the
  // reveal fires for anyone in it and the snapshot stays continuable.
  app.post("/api/games/:code/end", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const code = String(req.params.code || "").toUpperCase();
    if (!CODE_RE.test(code)) return res.status(400).json({ error: "Bad code." });
    const d = readSnapshot(code);
    if (!d) return res.status(404).json({ error: "Not found." });
    if (d.hostUserId !== u.id && !isAdmin(u)) return res.status(403).json({ error: "Only the host can end this story." });
    if (!endGameByCode(code, u)) return res.status(409).json({ error: "That story is already over." });
    res.json({ ok: true });
  });

  // "Write more": anyone who is IN a finished story (or an admin) reopens it
  // as a lobby under the same code; the caller then routes to /game?code=.
  app.post("/api/games/:code/reopen", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const code = String(req.params.code || "").toUpperCase();
    if (!CODE_RE.test(code)) return res.status(400).json({ error: "Bad code." });
    const d = readSnapshot(code);
    if (!d) return res.status(404).json({ error: "Not found." });
    if (!inGame(d, u) && !isAdmin(u)) return res.status(403).json({ error: "You're not in this story." });
    if (!reopenGameByCode(code, u)) return res.status(409).json({ error: "That story isn't finished." });
    res.json({ ok: true });
  });

  // The host (or an admin) puts a LIVE game to sleep from the dashboard: it
  // is snapshotted and unloaded, and wakes on the next visit.
  app.post("/api/games/:code/sleep", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const code = String(req.params.code || "").toUpperCase();
    if (!CODE_RE.test(code)) return res.status(400).json({ error: "Bad code." });
    const s = sessions.get(code);
    if (!s) return res.status(409).json({ error: "That story is already asleep." });
    if (s.hostUserId !== u.id && !isAdmin(u)) return res.status(403).json({ error: "Only the host can put this story to sleep." });
    if (!sleepGameByCode(code, u)) return res.status(409).json({ error: "That story is over." });
    res.json({ ok: true });
  });

  // The host invites a FRIEND to a live session: an inbox game-invite (and a
  // live toast if they're online). Friends only — same trust line as beta
  // readers; the game code is in the note, and the join is still gated by
  // the host once they arrive.
  // ---- Discord ----
  // Slash commands arrive here as signed POSTs from Discord (no gateway, no
  // library). The signature check IS the auth: an unsigned or missigned call
  // is a 401, exactly what Discord's endpoint verification probes for.
  app.post("/discord/interactions", (req, res) => {
    const ok = verifyInteraction({ signature: req.get("X-Signature-Ed25519"), timestamp: req.get("X-Signature-Timestamp"), rawBody: req.rawBody });
    if (!ok) return res.status(401).json({ error: "Bad request signature." });
    const onlineNames = () => { const ids = new Set(onlineSockets.values()); return store.users.filter((x) => ids.has(x.id)).map((x) => x.username); };
    res.json(handleInteraction(req.body, { onlineNames, siteName: SITE.name }));
  });
  app.get("/api/admin/discord", (req, res) => { if (!requireAdmin(req, res)) return; res.json(discordStatus()); });
  // The host (or an admin) shares a live game to the writing-room channel:
  // title, code, Join + Spectate buttons. Codes are host-gated, so sharing is safe.
  app.post("/api/games/:code/discord", async (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const code = String(req.params.code || "").toUpperCase();
    const s = sessions.get(code);
    if (!s || s.phase === "over") return res.status(404).json({ error: "That story isn't running right now." });
    const hostSeat = [...s.writers.values()].find((w) => w.userId === u.id);
    if (!(hostSeat && s.writers.get(s.hostId) === hostSeat) && s.hostUserId !== u.id && !isAdmin(u)) return res.status(403).json({ error: "Only the host can share." });
    const r = await postGame({ code, phase: s.phase, name: s.name, hostName: s.writers.get(s.hostId)?.name ?? s.hostName, players: s.writers.size });
    if (r.error) return res.status(502).json({ error: r.error });
    res.json({ ok: true });
  });

  app.post("/api/games/:code/invite", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in first." });
    const code = String(req.params.code || "").toUpperCase();
    if (!CODE_RE.test(code)) return res.status(400).json({ error: "Bad code." });
    const s = sessions.get(code);
    if (!s) return res.status(404).json({ error: "That story isn't running right now." });
    const hostSeat = [...s.writers.values()].find((w) => w.userId === u.id);
    const isHostNow = hostSeat && s.writers.get(s.hostId) === hostSeat;
    if (!isHostNow && s.hostUserId !== u.id && !isAdmin(u)) return res.status(403).json({ error: "Only the host can invite." });
    const friend = findByUsername(req.body?.username);
    if (!friend) return res.status(404).json({ error: "No writer by that name." });
    if (friend.id === u.id) return res.status(400).json({ error: "That's you." });
    if ([...s.writers.values()].some((w) => w.userId === friend.id)) return res.status(409).json({ error: `${friend.username} is already in this story.` });
    if (!areFriends(u, friend)) return res.status(403).json({ error: "You can only invite friends." });
    inviteToGame(code, u, friend);
    res.json({ ok: true });
  });

  // ---- Previous-games archive (read-only, backed by the save/<CODE> snapshots) ----
  // saveSnapshot() already persists every paused/finished game, so the archive
  // is just a listing of those snapshots.

  app.get("/api/games", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in to see your previous games." });
    const out = [];
    // Only FINISHED stories are archive: a lobby, a vote or a live/paused
    // game belongs on the dashboard's in-progress cards, not here.
    for (const d of allSnapshots()) {
      if (d.phase === "over" && inGame(d, u)) out.push({ ...gameSummary(d), hosted: d.hostUserId === u.id });
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
    const d = readSnapshot(code);
    if (!d) return res.status(404).json({ error: "Not found." });
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
    const d = readSnapshot(code);
    if (!d) return res.status(404).json({ error: "Not found." });
    if (d.hostUserId !== u.id && !isAdmin(u))
      return res.status(403).json({ error: "Only the host can delete this story." });
    deleteGame(code, u); // the other writers hear who did it (inbox note)
    res.json({ ok: true });
  });

  app.get("/api/games/:code", (req, res) => {
    const u = authedUser(req);
    if (!u) return res.status(401).json({ error: "Sign in to see your previous games." });
    const code = String(req.params.code || "").toUpperCase();
    if (!CODE_RE.test(code)) return res.status(400).json({ error: "Bad code." });
    // Story html in snapshots already passed through sanitizeRich() when written.
    const d = readSnapshot(code);
    if (!d) return res.status(404).json({ error: "Not found." });
    if (!inGame(d, u) && !isAdmin(u)) return res.status(403).json({ error: "That game isn't yours to view." });
    res.json({ ...gameSummary(d), story: freshStory(d.story) });
  });
}
