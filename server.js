import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { readFileSync } from "fs";
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

const GRACE_MS = 3000; // AFK/disconnect fallback after a turn deadline
const CHAT_LIMIT = 200;
const MAX_OPTIONS = 8;

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
    id, name: w.name, color: w.color, isHost: id === s.hostId,
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
    total: s.writers.size,
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
  s.deadline = Date.now() + s.turnSeconds * 1000;
  broadcastGame(s);
  s.timer = setTimeout(() => advance(s, null, null), s.turnSeconds * 1000 + GRACE_MS);
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
  io.to(s.code).emit("game-over", { prompt: s.prompt, story: s.story });
}

function removeWriter(s, id) {
  const wasHost = s.hostId === id;
  s.writers.delete(id);
  s.votes.delete(id);

  if (s.writers.size === 0) {
    clearTimeout(s.timer);
    sessions.delete(s.code);
    return;
  }
  if (wasHost) s.hostId = s.writers.keys().next().value;

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
    if (s.votes.size >= s.writers.size && s.writers.size > 0) return finalizeVote(s);
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
    const s = {
      code, hostId: socket.id, phase: "waiting",
      writers: new Map([[socket.id, { name: name || "Host", color: cleanColor(color) }]]),
      turnOrder: [], currentIdx: 0, turnCount: 0, maxTurns: null,
      story: [], prompt: "", options: [], votes: new Map(),
      turnSeconds: 60, deadline: 0, paused: false, remaining: 0, timer: null, chat: [],
    };
    sessions.set(code, s);
    joinedCode = code;
    socket.join(code);
    ack?.({ ok: true, code, hostId: socket.id });
    socket.emit("chat-history", s.chat);
    broadcastRoster(s);
  });

  socket.on("join-session", ({ name, color, code }, ack) => {
    code = (code || "").toUpperCase().trim();
    const s = sessions.get(code);
    if (!s) return ack?.({ ok: false, error: "Game not found." });
    if (s.phase !== "waiting")
      return ack?.({ ok: false, error: "This game has already started." });
    s.writers.set(socket.id, { name: name || "Writer", color: cleanColor(color) });
    joinedCode = code;
    socket.join(code);
    ack?.({ ok: true, code, hostId: s.hostId });
    socket.emit("chat-history", s.chat);
    broadcastRoster(s);
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
    broadcastGame(s);
  });

  socket.on("vote", ({ prompt }, ack) => {
    const s = mySession();
    if (!s || s.phase !== "choosing" || !s.options.includes(prompt)) return ack?.({ ok: false });
    s.votes.set(socket.id, prompt);
    if (s.votes.size >= s.writers.size) return finalizeVote(s);
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
    socket.to(s.code).emit("live-typing", { html: sanitizeRich(text || "") });
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
    broadcastGame(s);
    ack?.({ ok: true });
  });

  socket.on("resume-game", (_, ack) => {
    const s = mySession();
    if (!s || s.hostId !== socket.id || s.phase !== "writing" || !s.paused) return ack?.({ ok: false });
    s.paused = false;
    s.deadline = Date.now() + s.remaining;
    s.timer = setTimeout(() => advance(s, null, null), s.remaining + GRACE_MS);
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
    if (s) removeWriter(s, socket.id);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Byler Cowrite running on http://localhost:${PORT}`);
});
