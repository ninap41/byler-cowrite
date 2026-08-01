import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { randomUUID } from "crypto";
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
      writers: [...s.writers.values()].map((w) => ({ name: w.name, color: w.color, token: w.token })),
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
    { name: w.name, color: cleanColor(w.color), token: w.token, connected: false, ghostTimer: null },
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

const newWriter = (name, color, fallbackName) => ({
  name: name || fallbackName, color: cleanColor(color),
  token: randomUUID(), connected: true, ghostTimer: null,
});

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
    id, name: w.name, color: w.color, isHost: id === s.hostId, connected: w.connected !== false,
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
    if (stripTags(clean)) s.story.push({ name: writer?.name, color: writer?.color, html: clean });
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

  socket.on("create-session", ({ name, color }, ack) => {
    const code = makeCode();
    const host = newWriter(name, color, "Host");
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

  socket.on("join-session", ({ name, color, code }, ack) => {
    code = (code || "").toUpperCase().trim();
    const s = sessions.get(code);
    if (!s) return ack?.({ ok: false, error: "Game not found." });
    if (s.phase !== "waiting")
      return ack?.({ ok: false, error: "This game has already started." });
    s.writers.set(socket.id, newWriter(name, color, "Writer"));
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
      name: w?.name ?? "?",
      color: w?.color ?? PALETTE[0],
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
