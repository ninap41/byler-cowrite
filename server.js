import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Curated Byler scenario prompts (edit prompts.json freely — no code changes).
const { prompts: PROMPT_BANK } = JSON.parse(
  readFileSync(join(__dirname, "prompts.json"), "utf-8")
);

// Name-color palette. Colors are validated against this list (prevents style injection).
const PALETTE = ["#e63946", "#6c8cff", "#3ddc84", "#f4a261", "#e879c9", "#38bdf8", "#facc15", "#c084fc"];
const cleanColor = (c) => (PALETTE.includes(c) ? c : PALETTE[Math.floor(Math.random() * PALETTE.length)]);

// Rich-text sanitizer (the trust boundary): escape everything, then re-enable a
// tiny allowlist of formatting tags with no attributes. Anything else stays escaped.
function sanitizeRich(html) {
  let out = String(html).slice(0, 4000)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  out = out
    .replace(/&lt;(\/?)(b|i|u|strong|em)&gt;/g, "<$1$2>")
    .replace(/&lt;br\s*\/?&gt;/g, "<br>");
  return out;
}
const stripTags = (html) => html.replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/gi, " ").trim();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
app.use(express.static(join(__dirname, "public")));
app.use("/sounds", express.static(join(__dirname, "sounds")));
app.use(express.json());

// ---------------------------------------------------------------------------
// User accounts — JSON file store (data/users.json), no database on purpose.
// ~100 users; every mutation just rewrites the file.
// ---------------------------------------------------------------------------
const DATA_DIR = join(__dirname, "data");
mkdirSync(DATA_DIR, { recursive: true });
const USERS_PATH = join(DATA_DIR, "users.json");
let store = { users: [], sessions: {}, resets: {} };
try {
  store = { ...store, ...JSON.parse(readFileSync(USERS_PATH, "utf-8")) };
} catch { /* first run */ }
const saveStore = () => {
  try {
    writeFileSync(USERS_PATH, JSON.stringify(store, null, 1));
  } catch (e) {
    console.error("saveStore failed:", e.message);
  }
};

const hashPassword = (pw) => {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(pw, salt, 64).toString("hex");
};
const checkPassword = (pw, stored) => {
  const [salt, hash] = String(stored).split(":");
  const a = Buffer.from(hash, "hex");
  const b = scryptSync(pw, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
};

// Achievement badges, earned by total words written while signed in.
// currentBadge is always the highest earned tier.
const BADGES = [
  { id: "inkling", name: "✏️ Inkling", min: 1 },
  { id: "scribbler", name: "🖊️ Scribbler", min: 100 },
  { id: "wordsmith", name: "📜 Wordsmith", min: 500 },
  { id: "storyteller", name: "📖 Storyteller", min: 1000 },
  { id: "novelist", name: "📚 Novelist", min: 5000 },
  { id: "legend", name: "🏆 Living Legend", min: 10000 },
];
const badgeName = (id) => BADGES.find((b) => b.id === id)?.name ?? null;
function awardBadges(u) {
  for (const b of BADGES) if (u.wordCount >= b.min && !u.badges.includes(b.id)) u.badges.push(b.id);
  u.currentBadge = [...BADGES].reverse().find((b) => u.badges.includes(b.id))?.id ?? null;
}

const findByEmail = (e) => store.users.find((u) => u.email === String(e || "").toLowerCase().trim());
const findByUsername = (n) =>
  store.users.find((u) => u.username.toLowerCase() === String(n || "").toLowerCase().trim());
const userByToken = (t) => (t && store.sessions[t] ? store.users.find((u) => u.id === store.sessions[t]) : null);
const authedUser = (req) => userByToken((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
const publicUser = (u) => ({
  id: u.id, email: u.email, username: u.username, color: u.color,
  games: u.games, wordCount: u.wordCount,
  currentBadge: badgeName(u.currentBadge), badges: u.badges.map(badgeName),
  nextBadge: BADGES.find((b) => u.wordCount < b.min) ?? null,
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post("/api/signup", (req, res) => {
  const { email, username, password, color } = req.body || {};
  const em = String(email || "").toLowerCase().trim();
  const un = String(username || "").trim();
  if (!EMAIL_RE.test(em)) return res.status(400).json({ error: "Enter a valid email." });
  if (un.length < 4 || un.length > 24)
    return res.status(400).json({ error: "Username must be 4–24 characters." });
  if (String(password || "").length < 4)
    return res.status(400).json({ error: "Password must be at least 4 characters." });
  if (findByEmail(em)) return res.status(400).json({ error: "That email already has an account." });
  if (findByUsername(un)) return res.status(400).json({ error: "That username is taken." });
  const u = {
    id: randomUUID(), email: em, username: un, passHash: hashPassword(password),
    color: cleanColor(color), games: [], wordCount: 0, currentBadge: null, badges: [],
    createdAt: Date.now(),
  };
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

// Forgot password, step 2: email a reset link (valid 30 minutes). Without SMTP
// env vars the link is logged to the server console instead — it is never
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

const RESET_TTL_MS = 30 * 60_000;
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

const sessions = new Map(); // code -> session (in-memory; fine for a party game)

// ---- Previous-games archive (read-only, backed by saves/*.json snapshots) ----
// No database on purpose: saveSnapshot() already persists every paused/finished
// game to disk, so the archive is just a directory listing + file reads.
const CODE_RE = /^[A-Z0-9]{4}$/;

app.get("/api/games", (_req, res) => {
  const out = [];
  for (const f of readdirSync(SAVE_DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const d = JSON.parse(readFileSync(join(SAVE_DIR, f), "utf-8"));
      out.push({
        code: d.code, phase: d.phase, prompt: d.prompt || "",
        savedAt: d.savedAt || 0, lines: (d.story || []).length,
        writers: (d.writers || []).map((w) => ({ name: w.name, color: cleanColor(w.color) })),
      });
    } catch { /* skip unreadable snapshot */ }
  }
  out.sort((a, b) => b.savedAt - a.savedAt);
  res.json(out);
});

app.get("/api/games/:code", (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  if (!CODE_RE.test(code)) return res.status(400).json({ error: "Bad code." });
  try {
    // Story html in snapshots already passed through sanitizeRich() when written.
    const d = JSON.parse(readFileSync(join(SAVE_DIR, code + ".json"), "utf-8"));
    res.json({
      code: d.code, phase: d.phase, prompt: d.prompt || "", savedAt: d.savedAt || 0,
      story: d.story || [],
      writers: (d.writers || []).map((w) => ({ name: w.name, color: cleanColor(w.color) })),
    });
  } catch {
    res.status(404).json({ error: "Not found." });
  }
});

// Paused/finished games are snapshotted to disk so they survive a server
// restart and can be picked up later. Seats are identified by writer token.
const SAVE_DIR = join(__dirname, "saves");
mkdirSync(SAVE_DIR, { recursive: true });

function saveSnapshot(s) {
  try {
    writeFileSync(join(SAVE_DIR, s.code + ".json"), JSON.stringify({
      code: s.code, phase: s.phase, prompt: s.prompt, story: s.story, chat: s.chat,
      turnSeconds: s.turnSeconds, maxTurns: s.maxTurns, turnCount: s.turnCount,
      remaining: s.remaining, currentIdx: s.currentIdx,
      writers: [...s.writers.values()].map((w) => ({
        name: w.name, color: w.color, token: w.token, userId: w.userId ?? null, badge: w.badge ?? null,
      })),
      turnOrderTokens: s.turnOrder.map((id) => s.writers.get(id)?.token).filter(Boolean),
      hostToken: s.writers.get(s.hostId)?.token ?? s.hostToken ?? null,
      savedAt: Date.now(),
    }));
  } catch (e) {
    console.error("saveSnapshot failed:", e.message);
  }
}

// Rehydrate a saved game: every seat comes back as an unclaimed ghost keyed by
// its token; players reclaim seats via the normal rejoin flow. A saved writing
// game wakes up paused; the first reclaimer becomes host and can resume.
function loadSession(code) {
  let d;
  try {
    d = JSON.parse(readFileSync(join(SAVE_DIR, code + ".json"), "utf-8"));
  } catch {
    return null;
  }
  const writers = new Map(d.writers.map((w) => [
    "ghost:" + w.token,
    {
      name: w.name, color: cleanColor(w.color), token: w.token,
      userId: w.userId ?? null, badge: w.badge ?? null, connected: false, ghostTimer: null,
    },
  ]));
  const s = {
    code, hostId: null, hostToken: d.hostToken ?? null, phase: d.phase === "over" ? "over" : "writing",
    writers, turnOrder: d.turnOrderTokens.map((t) => "ghost:" + t).filter((id) => writers.has(id)),
    currentIdx: Math.min(d.currentIdx || 0, Math.max(0, d.turnOrderTokens.length - 1)),
    turnCount: d.turnCount || 0, maxTurns: d.maxTurns ?? null,
    story: d.story || [], prompt: d.prompt || "", options: [], votes: new Map(),
    turnSeconds: d.turnSeconds || 60, deadline: 0,
    paused: d.phase !== "over", remaining: d.remaining || (d.turnSeconds || 60) * 1000,
    timer: null, chat: d.chat || [], lastTyping: "",
  };
  sessions.set(code, s);
  return s;
}

// At the deadline the server advances immediately, using the writer's last
// live-typing content (s.lastTyping) as their line so partial work is kept.
const CHAT_LIMIT = 200;
const MAX_OPTIONS = 8;
// Disconnected writers linger as reclaimable "ghosts" this long. The client
// holds {code, token} in localStorage and rejoins via `rejoin-session`.
const GHOST_MS = 90_000;

const connectedCount = (s) => [...s.writers.values()].filter((w) => w.connected).length;

// System-style chat line ("Will started the game") — rendered muted/italic client-side.
function announce(s, writer, text) {
  const msg = {
    name: writer?.name ?? "?", color: writer?.color ?? PALETTE[0],
    text, sys: true, ts: Date.now(),
  };
  s.chat.push(msg);
  if (s.chat.length > CHAT_LIMIT) s.chat.shift();
  io.to(s.code).emit("chat", msg);
}

// Signed-in players (valid auth token) get their account's name, color, and
// badge, and their lines count toward word-count achievements.
const newWriter = (name, color, fallbackName, authToken) => {
  const acct = userByToken(authToken);
  return {
    name: acct?.username || name || fallbackName,
    color: cleanColor(acct?.color ?? color),
    userId: acct?.id ?? null,
    badge: acct ? badgeName(acct.currentBadge) : null,
    token: randomUUID(), connected: true, ghostTimer: null,
  };
};

// Credit a committed line to the writer's account: word count, games list,
// and any newly crossed badge tier (announced in chat).
function creditLine(s, writer, cleanHtml) {
  if (!writer?.userId) return;
  const u = store.users.find((x) => x.id === writer.userId);
  if (!u) return;
  const words = stripTags(cleanHtml).split(/\s+/).filter(Boolean).length;
  u.wordCount += words;
  if (!u.games.includes(s.code)) u.games.push(s.code);
  const before = u.currentBadge;
  awardBadges(u);
  saveStore();
  writer.badge = badgeName(u.currentBadge);
  if (u.currentBadge !== before) announce(s, writer, `earned the ${writer.badge} badge!`);
}

// Keep the seat but mark it reclaimable; drop it for real after GHOST_MS.
function markDisconnected(s, id) {
  const w = s.writers.get(id);
  if (!w) return;
  w.connected = false;
  if (s.hostId === id) {
    const next = [...s.writers.entries()].find(([, ww]) => ww.connected);
    if (next) s.hostId = next[0];
  }
  clearTimeout(w.ghostTimer);
  w.ghostTimer = setTimeout(() => {
    if (s.writers.get(id) === w && !w.connected) removeWriter(s, id);
  }, GHOST_MS);
  if (s.phase === "choosing" && s.votes.size >= connectedCount(s) && connectedCount(s) > 0)
    return finalizeVote(s);
  if (s.phase === "waiting" || s.phase === "over") broadcastRoster(s);
  else broadcastGame(s);
}

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      alphabet[Math.floor(Math.random() * alphabet.length)]
    ).join("");
  } while (sessions.has(code));
  return code;
}

function promptOptions(n = 4) {
  const pool = [...PROMPT_BANK];
  const out = [];
  for (let i = 0; i < n && pool.length; i++) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
}

const currentId = (s) => s.turnOrder[s.currentIdx] ?? null;
const names = (s) =>
  s.turnOrder.length
    ? s.turnOrder.map((id) => s.writers.get(id)?.name)
    : [...s.writers.values()].map((w) => w.name);

function roster(s) {
  return [...s.writers.entries()].map(([id, w]) => ({
    id, name: w.name, color: w.color, badge: w.badge ?? null,
    isHost: id === s.hostId, connected: w.connected !== false,
  }));
}
const broadcastRoster = (s) => io.to(s.code).emit("roster", { writers: roster(s) });

function tally(s) {
  const counts = s.options.map(() => 0);
  for (const p of s.votes.values()) {
    const i = s.options.indexOf(p);
    if (i !== -1) counts[i]++;
  }
  return counts;
}

function broadcastGame(s) {
  const curId = currentId(s);
  io.to(s.code).emit("game-state", {
    phase: s.phase,
    options: s.phase === "choosing" ? s.options : [],
    tally: s.phase === "choosing" ? tally(s) : [],
    voted: s.votes.size,
    total: connectedCount(s),
    prompt: s.prompt,
    story: s.story,
    currentId: curId,
    currentName: s.writers.get(curId)?.name ?? null,
    currentColor: s.writers.get(curId)?.color ?? null,
    deadline: s.paused ? 0 : s.deadline,
    paused: s.paused,
    remaining: s.paused ? s.remaining : null,
    turnSeconds: s.turnSeconds,
    turnCount: s.turnCount,
    maxTurns: s.maxTurns,
    players: names(s),
    hostId: s.hostId,
  });
}

function startTurn(s) {
  clearTimeout(s.timer);
  s.paused = false;
  s.remaining = 0;
  if (s.turnOrder.length === 0) return endGame(s);
  // Skip ghost seats; if nobody is connected, auto-pause (and snapshot) so the
  // game waits instead of burning empty turns.
  let hops = 0;
  while (hops < s.turnOrder.length && !s.writers.get(currentId(s))?.connected) {
    s.currentIdx = (s.currentIdx + 1) % s.turnOrder.length;
    hops++;
  }
  if (!s.writers.get(currentId(s))?.connected) {
    s.paused = true;
    s.remaining = s.turnSeconds * 1000;
    saveSnapshot(s);
    broadcastGame(s);
    return;
  }
  s.deadline = Date.now() + s.turnSeconds * 1000;
  s.lastTyping = "";
  broadcastGame(s);
  s.timer = setTimeout(() => timeUp(s), s.turnSeconds * 1000);
}

function timeUp(s) {
  advance(s, s.writers.get(currentId(s)), s.lastTyping);
}

function advance(s, writer, html) {
  clearTimeout(s.timer);
  if (html) {
    const clean = sanitizeRich(html);
    if (stripTags(clean)) {
      s.story.push({ name: writer?.name, color: writer?.color, html: clean });
      creditLine(s, writer, clean);
    }
  }
  s.turnCount++;
  if (s.maxTurns && s.turnCount >= s.maxTurns) return endGame(s);
  s.currentIdx = (s.currentIdx + 1) % s.turnOrder.length;
  startTurn(s);
}

function startWriting(s, prompt) {
  s.prompt = prompt;
  s.phase = "writing";
  s.currentIdx = 0;
  s.turnCount = 0;
  s.story = [];
  s.votes.clear();
  startTurn(s);
}

function finalizeVote(s) {
  const counts = tally(s);
  let max = -1;
  const winners = [];
  s.options.forEach((p, i) => {
    if (counts[i] > max) { max = counts[i]; winners.length = 0; winners.push(p); }
    else if (counts[i] === max) winners.push(p);
  });
  startWriting(s, winners[Math.floor(Math.random() * winners.length)]);
}

function endGame(s) {
  clearTimeout(s.timer);
  s.phase = "over";
  s.paused = false;
  saveSnapshot(s);
  io.to(s.code).emit("game-over", { prompt: s.prompt, story: s.story });
}

function removeWriter(s, id) {
  const wasHost = s.hostId === id;
  clearTimeout(s.writers.get(id)?.ghostTimer);
  s.writers.delete(id);
  s.votes.delete(id);

  if (s.writers.size === 0) {
    clearTimeout(s.timer);
    sessions.delete(s.code);
    return;
  }
  if (wasHost) {
    s.hostId = ([...s.writers.entries()].find(([, w]) => w.connected) ?? [...s.writers.entries()][0])[0];
    s.hostToken = s.writers.get(s.hostId)?.token ?? null; // permanent transfer
  }

  if (s.phase === "writing") {
    const pos = s.turnOrder.indexOf(id);
    if (pos !== -1) {
      const wasCurrent = pos === s.currentIdx;
      s.turnOrder.splice(pos, 1);
      if (s.turnOrder.length === 0) return endGame(s);
      if (pos < s.currentIdx) s.currentIdx--;
      s.currentIdx %= s.turnOrder.length;
      if (wasCurrent) return startTurn(s); // fresh turn for the next writer
    }
    broadcastGame(s);
  } else if (s.phase === "choosing") {
    const pos = s.turnOrder.indexOf(id);
    if (pos !== -1) {
      s.turnOrder.splice(pos, 1);
      if (pos < s.currentIdx) s.currentIdx--;
    }
    if (s.votes.size >= connectedCount(s) && connectedCount(s) > 0) return finalizeVote(s);
    broadcastGame(s);
  } else {
    broadcastRoster(s);
  }
}

io.on("connection", (socket) => {
  let joinedCode = null;
  const mySession = () => sessions.get(joinedCode);

  socket.on("create-session", ({ name, color, auth }, ack) => {
    const code = makeCode();
    const host = newWriter(name, color, "Host", auth);
    const s = {
      code, hostId: socket.id, hostToken: host.token, phase: "waiting",
      writers: new Map([[socket.id, host]]),
      turnOrder: [], currentIdx: 0, turnCount: 0, maxTurns: null,
      story: [], prompt: "", options: [], votes: new Map(),
      turnSeconds: 60, deadline: 0, paused: false, remaining: 0, timer: null, chat: [], lastTyping: "",
    };
    sessions.set(code, s);
    joinedCode = code;
    socket.join(code);
    ack?.({ ok: true, code, hostId: socket.id, token: s.writers.get(socket.id).token });
    socket.emit("chat-history", s.chat);
    broadcastRoster(s);
  });

  socket.on("join-session", ({ name, color, code, auth }, ack) => {
    code = (code || "").toUpperCase().trim();
    const s = sessions.get(code);
    if (!s) return ack?.({ ok: false, error: "Game not found." });
    if (s.phase !== "waiting")
      return ack?.({ ok: false, error: "This game has already started." });
    s.writers.set(socket.id, newWriter(name, color, "Writer", auth));
    joinedCode = code;
    socket.join(code);
    ack?.({ ok: true, code, hostId: s.hostId, token: s.writers.get(socket.id).token });
    socket.emit("chat-history", s.chat);
    broadcastRoster(s);
  });

  // Reclaim a seat (page refresh / transient reconnect) using the localStorage token.
  // Swaps the new socket id into every place the old one appears.
  socket.on("rejoin-session", ({ code, token }, ack) => {
    code = (code || "").toUpperCase().trim();
    const s = sessions.get(code) ?? loadSession(code);
    if (!s || !token) return ack?.({ ok: false, error: "Game not found." });
    const entry = [...s.writers.entries()].find(([, w]) => w.token === token);
    if (!entry) return ack?.({ ok: false, error: "Seat expired." });
    const [oldId, w] = entry;
    if (oldId !== socket.id) {
      io.sockets.sockets.get(oldId)?.disconnect(true); // stale duplicate tab
      s.writers.delete(oldId);
      s.writers.set(socket.id, w);
      const pos = s.turnOrder.indexOf(oldId);
      if (pos !== -1) s.turnOrder[pos] = socket.id;
      if (s.votes.has(oldId)) { s.votes.set(socket.id, s.votes.get(oldId)); s.votes.delete(oldId); }
      if (s.hostId === oldId) s.hostId = socket.id;
    }
    clearTimeout(w.ghostTimer);
    w.connected = true;
    // The original host reclaims the role on return; otherwise the first
    // person back into a rehydrated game hosts until they do.
    if (w.token === s.hostToken || !s.writers.has(s.hostId)) s.hostId = socket.id;
    joinedCode = code;
    socket.join(code);
    ack?.({ ok: true, code, hostId: s.hostId, name: w.name, color: w.color, phase: s.phase, token: w.token });
    socket.emit("chat-history", s.chat);
    if (s.phase === "waiting") broadcastRoster(s);
    else if (s.phase === "over") {
      broadcastRoster(s); // everyone learns the (possibly restored) hostId
      socket.emit("game-over", { prompt: s.prompt, story: s.story });
    } else broadcastGame(s);
  });

  socket.on("start-game", ({ turnSeconds, rounds }, ack) => {
    const s = mySession();
    if (!s || s.hostId !== socket.id) return ack?.({ ok: false, error: "Only the host can start." });
    if (s.writers.size < 1) return ack?.({ ok: false, error: "Need at least one writer." });
    s.phase = "choosing";
    s.turnOrder = [...s.writers.keys()];
    s.currentIdx = 0;
    s.turnCount = 0;
    s.story = [];
    s.votes.clear();
    s.turnSeconds = Math.min(600, Math.max(10, Number(turnSeconds) || 60));
    const r = Number(rounds);
    s.maxTurns = r > 0 ? r * s.turnOrder.length : null;
    s.options = promptOptions();
    ack?.({ ok: true });
    announce(s, s.writers.get(socket.id), "started the game");
    broadcastGame(s);
  });

  socket.on("vote", ({ prompt }, ack) => {
    const s = mySession();
    if (!s || s.phase !== "choosing" || !s.options.includes(prompt)) return ack?.({ ok: false });
    s.votes.set(socket.id, prompt);
    if (s.votes.size >= connectedCount(s)) return finalizeVote(s);
    broadcastGame(s);
    ack?.({ ok: true });
  });

  socket.on("shuffle-options", (_, ack) => {
    const s = mySession();
    if (!s || s.hostId !== socket.id || s.phase !== "choosing") return ack?.({ ok: false });
    s.options = promptOptions();
    s.votes.clear();
    broadcastGame(s);
    ack?.({ ok: true });
  });

  // Anyone can add a custom scenario to the vote options.
  socket.on("add-prompt", ({ prompt }, ack) => {
    const s = mySession();
    if (!s || s.phase !== "choosing") return ack?.({ ok: false });
    const p = stripTags(String(prompt || "")).slice(0, 280).trim();
    if (!p) return ack?.({ ok: false, error: "Empty prompt." });
    if (s.options.includes(p)) return ack?.({ ok: false, error: "That's already an option." });
    if (s.options.length >= MAX_OPTIONS) return ack?.({ ok: false, error: "Too many options already." });
    s.options.push(p);
    broadcastGame(s);
    ack?.({ ok: true });
  });

  // Relay the current writer's in-progress line to everyone else, live.
  socket.on("typing", ({ text }) => {
    const s = mySession();
    if (!s || s.phase !== "writing" || s.paused) return;
    if (currentId(s) !== socket.id) return;
    s.lastTyping = sanitizeRich(text || "");
    socket.to(s.code).emit("live-typing", { html: s.lastTyping });
  });

  socket.on("finalize-vote", (_, ack) => {
    const s = mySession();
    if (!s || s.hostId !== socket.id || s.phase !== "choosing") return ack?.({ ok: false });
    finalizeVote(s);
    ack?.({ ok: true });
  });

  socket.on("submit-line", ({ text }, ack) => {
    const s = mySession();
    if (!s || s.phase !== "writing" || s.paused) return ack?.({ ok: false });
    if (currentId(s) !== socket.id) return ack?.({ ok: false, error: "Not your turn." });
    advance(s, s.writers.get(socket.id), text);
    ack?.({ ok: true });
  });

  socket.on("pause-game", (_, ack) => {
    const s = mySession();
    if (!s || s.hostId !== socket.id || s.phase !== "writing" || s.paused) return ack?.({ ok: false });
    s.paused = true;
    s.remaining = Math.max(0, s.deadline - Date.now());
    clearTimeout(s.timer);
    saveSnapshot(s);
    broadcastGame(s);
    ack?.({ ok: true });
  });

  // Host can retune mid-game: a new turn length applies from the next turn
  // (the running clock is untouched); added rounds extend maxTurns, and give
  // an endless game a finish line turnCount + extra turns away.
  socket.on("update-rules", ({ turnSeconds, addRounds }, ack) => {
    const s = mySession();
    if (!s || s.hostId !== socket.id || s.phase !== "writing") return ack?.({ ok: false });
    if (turnSeconds != null && Number(turnSeconds) > 0)
      s.turnSeconds = Math.min(600, Math.max(10, Number(turnSeconds)));
    const r = Number(addRounds);
    if (r > 0) {
      const extra = r * Math.max(1, s.turnOrder.length);
      s.maxTurns = s.maxTurns == null ? s.turnCount + extra : s.maxTurns + extra;
    }
    broadcastGame(s);
    ack?.({ ok: true });
  });

  // After a reveal, the host can pick the story back up with fresh rules.
  // Keeps prompt + story; the turn order rebuilds from connected writers.
  socket.on("continue-writing", ({ turnSeconds, rounds }, ack) => {
    const s = mySession();
    if (!s || s.hostId !== socket.id || s.phase !== "over") return ack?.({ ok: false });
    s.turnSeconds = Math.min(600, Math.max(10, Number(turnSeconds) || s.turnSeconds));
    s.turnOrder = [...s.writers.entries()].filter(([, w]) => w.connected).map(([id]) => id);
    if (s.turnOrder.length === 0) return ack?.({ ok: false });
    const r = Number(rounds);
    s.turnCount = 0;
    s.maxTurns = r > 0 ? r * s.turnOrder.length : null;
    s.currentIdx = 0;
    s.votes.clear();
    s.phase = "writing";
    ack?.({ ok: true });
    startTurn(s);
  });

  socket.on("resume-game", (_, ack) => {
    const s = mySession();
    if (!s || s.hostId !== socket.id || s.phase !== "writing" || !s.paused) return ack?.({ ok: false });
    s.paused = false;
    // If the paused turn belongs to a ghost (e.g. a rehydrated save), hand out
    // a fresh turn via startTurn(), which skips disconnected seats.
    if (!s.writers.get(currentId(s))?.connected) {
      ack?.({ ok: true });
      return startTurn(s);
    }
    s.deadline = Date.now() + s.remaining;
    s.timer = setTimeout(() => timeUp(s), s.remaining);
    broadcastGame(s);
    ack?.({ ok: true });
  });

  socket.on("end-game", (_, ack) => {
    const s = mySession();
    if (!s || s.hostId !== socket.id) return ack?.({ ok: false });
    if (s.phase === "over") return ack?.({ ok: false });
    endGame(s);
    ack?.({ ok: true });
  });

  socket.on("chat", ({ text }) => {
    const s = mySession();
    if (!s || !text || !text.trim()) return;
    const w = s.writers.get(socket.id);
    const msg = {
      id: socket.id, // lets clients tell their own echo from others' messages (sounds)
      name: w?.name ?? "?",
      color: w?.color ?? PALETTE[0],
      badge: w?.badge ?? null,
      text: String(text).slice(0, 500).trim(),
      ts: Date.now(),
    };
    s.chat.push(msg);
    if (s.chat.length > CHAT_LIMIT) s.chat.shift();
    io.to(s.code).emit("chat", msg);
  });

  socket.on("disconnect", () => {
    const s = mySession();
    // Guard: after a rejoin swap, this stale socket's id is no longer a writer.
    if (s && s.writers.has(socket.id)) markDisconnected(s, socket.id);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Byler Cowrite running on http://localhost:${PORT}`);
});
