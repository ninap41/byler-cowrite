// The live game: session state machine, persistence (saves/*.json), and all
// Socket.IO handlers. createGame(io) owns the in-memory maps and returns the
// pieces the HTTP routes need (sessions, archive helpers, presence).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, unlinkSync } from "fs";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { bumpStreak } from "../lib/streak.js";
import { badgeName, badgeDesc, usageMatches, awardWordBadges } from "../lib/achievements.js";
import { PALETTE, cleanColor, sanitizeRich, stripTags } from "./sanitize.js";
import { store, saveStore, userByToken } from "./store.js";
import { mirror, mirrorDelete } from "./persist.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Curated Byler scenario prompts (edit prompts.json freely — no code changes).
const { prompts: PROMPT_BANK } = JSON.parse(
  readFileSync(join(__dirname, "..", "prompts.json"), "utf-8")
);

// At the deadline the server advances immediately, using the writer's last
// live-typing content (s.lastTyping) as their line so partial work is kept.
const CHAT_LIMIT = 200;
const MAX_OPTIONS = 8;
// Disconnected writers linger as reclaimable "ghosts" this long. The client
// holds {code, token} in localStorage and rejoins via `rejoin-session`.
const GHOST_MS = 90_000;
// A denied join request can't retry for this long (anti-spam).
// Keyed by account id — every writer is signed in.
const DENY_COOLDOWN_MS = 5 * 60_000;
// At most this many stories can be running at once (small server on purpose;
// COWRITE_MAX_ACTIVE overrides — the test harness raises it).
const MAX_ACTIVE_SESSIONS = Number(process.env.COWRITE_MAX_ACTIVE || 5);

export function createGame(io) {
  const sessions = new Map(); // code -> session (in-memory; fine for a party game)
  const onlineSockets = new Map(); // socket.id -> userId (signed-in presence for the dashboard)

  // Paused/finished games are snapshotted to disk so they survive a server
  // restart and can be picked up later. Seats are identified by writer token.
  const SAVE_DIR = process.env.COWRITE_SAVE_DIR || join(__dirname, "..", "saves");
  mkdirSync(SAVE_DIR, { recursive: true });

  function saveSnapshot(s) {
    try {
      const doc = JSON.stringify({
        code: s.code, name: s.name || "", phase: s.phase, prompt: s.prompt, story: s.story, chat: s.chat,
        friendly: s.friendly !== false,
        turnSeconds: s.turnSeconds, maxTurns: s.maxTurns, turnCount: s.turnCount,
        remaining: s.remaining, currentIdx: s.currentIdx,
        writers: [...s.writers.values()].map((w) => ({
          name: w.name, color: w.color, token: w.token, userId: w.userId ?? null, badge: w.badge ?? null,
          avatar: w.avatar ?? "", avatarFit: w.avatarFit ?? "cover",
        })),
        turnOrderTokens: s.turnOrder.map((id) => s.writers.get(id)?.token).filter(Boolean),
        // ALWAYS the ORIGINAL host: true-host rights (delete, host reclaim)
        // never migrate to whoever is acting host at save time.
        hostToken: s.hostToken ?? s.writers.get(s.hostId)?.token ?? null,
        hostName: s.hostName ?? s.writers.get(s.hostId)?.name ?? null,
        hostUserId: s.hostUserId ?? s.writers.get(s.hostId)?.userId ?? null,
        savedAt: Date.now(),
      });
      writeFileSync(join(SAVE_DIR, s.code + ".json"), doc);
      mirror("save", s.code, doc); // no-op without DATABASE_URL
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
        userId: w.userId ?? null, badge: w.badge ?? null,
        avatar: w.avatar ?? "", avatarFit: w.avatarFit ?? "cover",
        connected: false, ghostTimer: null,
        approved: false, // continued games gate every returning writer (host approves)
      },
    ]));
    // waiting revives as waiting; a half-done vote (choosing) restarts as a
    // waiting room the host can re-start; writing/over revive as themselves.
    const phase =
      d.phase === "over" ? "over" : d.phase === "waiting" || d.phase === "choosing" ? "waiting" : "writing";
    const s = {
      code, hostId: null, hostToken: d.hostToken ?? null, phase,
      writers,
      turnOrder:
        phase === "writing" ? d.turnOrderTokens.map((t) => "ghost:" + t).filter((id) => writers.has(id)) : [],
      currentIdx: Math.min(d.currentIdx || 0, Math.max(0, d.turnOrderTokens.length - 1)),
      turnCount: d.turnCount || 0, maxTurns: d.maxTurns ?? null,
      story: d.story || [], prompt: d.prompt || "", options: [], votes: new Map(),
      turnSeconds: d.turnSeconds === 0 ? 0 : d.turnSeconds || 60, deadline: 0,
      paused: phase === "writing", remaining: d.remaining || (d.turnSeconds || 60) * 1000,
      timer: null, chat: d.chat || [], lastTyping: "",
      name: d.name || "", pending: new Map(), denied: new Map(),
      gated: true, // a continued game: the host must approve each re-entry
      hostName: d.hostName ?? null, hostUserId: d.hostUserId ?? null,
      friendly: d.friendly !== false,
    };
    sessions.set(code, s);
    if (s.phase === "writing") armIdleEnd(s); // wakes paused — don't let it sit forever
    return s;
  }

  function checkDenied(s, key) {
    const until = s.denied?.get(key);
    if (!until || until <= Date.now()) return null;
    const min = Math.ceil((until - Date.now()) / 60_000);
    return `The host turned you away — you can ask again in ${min} minute${min === 1 ? "" : "s"}.`;
  }

  const connectedCount = (s) => [...s.writers.values()].filter((w) => w.connected).length;

  // Two chat channels. Writers chat is writers-only: seated sockets join the
  // ":writers" room, spectators never do, so nothing writer-said reaches them.
  // Spectator chat broadcasts to the whole session room (writers see it too)
  // and is deliberately ephemeral: in-memory ring only, never snapshotted.
  const writersRoom = (s) => s.code + ":writers";
  function joinAsWriter(sock, s) {
    sock.join(s.code);
    sock.join(writersRoom(s));
    sock.emit("chat-history", s.chat);
    sock.emit("spec-chat-history", s.specChat ?? []);
  }
  const SPEC_CHAT_LIMIT = 50;
  // spectator name colors: stable per name, never attacker-controlled (PALETTE only)
  const specColor = (name) => PALETTE[[...name].reduce((h, c) => h + c.charCodeAt(0), 0) % PALETTE.length];

  // System-style chat line ("Will started the game") — rendered muted/italic client-side.
  function announce(s, writer, text) {
    const msg = {
      name: writer?.name ?? "?", color: writer?.color ?? PALETTE[0],
      text, sys: true, ts: Date.now(),
    };
    s.chat.push(msg);
    if (s.chat.length > CHAT_LIMIT) s.chat.shift();
    io.to(writersRoom(s)).emit("chat", msg);
  }

  // Every writer is a signed-in account: name, color, and badge come from the
  // account, and committed lines count toward word-count achievements.
  const newWriter = (acct) => ({
    name: acct.username,
    color: cleanColor(acct.color),
    userId: acct.id,
    badge: badgeName(acct.currentBadge),
    avatar: acct.avatar || "",
    avatarFit: acct.avatarFit || "cover",
    token: randomUUID(), connected: true, ghostTimer: null,
    approved: true, // gating only applies to seats revived from a save
  });

  // Credit a committed line to the writer's account: word count, games list,
  // and any newly crossed badge tier (announced in chat).
  function creditLine(s, writer, cleanHtml) {
    if (!writer?.userId) return;
    const u = store.users.find((x) => x.id === writer.userId);
    if (!u) return;
    const text = stripTags(cleanHtml);
    const words = text.split(/\s+/).filter(Boolean).length;
    u.wordCount += words;
    bumpStreak(u);
    if (!u.games.includes(s.code)) u.games.push(s.code);
    const before = u.currentBadge;
    awardWordBadges(u);
    // Unlock notification (toast) for EVERYONE in the session — writers and
    // spectators alike — on top of the system chat announcement.
    const notifyEarned = (id) =>
      io.to(s.code).emit("badge-earned", {
        badge: badgeName(id), desc: badgeDesc(id),
        name: writer.name, color: writer.color,
      });
    // word-usage collectibles: awarded once, the first line that says the word
    for (const id of usageMatches(text)) {
      if (!u.badges.includes(id)) {
        u.badges.push(id);
        announce(s, writer, `earned the ${badgeName(id)} badge!`);
        notifyEarned(id);
      }
    }
    saveStore();
    writer.badge = badgeName(u.currentBadge);
    if (u.currentBadge !== before) {
      announce(s, writer, `earned the ${writer.badge} badge!`);
      notifyEarned(u.currentBadge);
    }
  }

  // Keep the seat but mark it reclaimable; drop it for real after GHOST_MS.
  function markDisconnected(s, id) {
    const w = s.writers.get(id);
    if (!w) return;
    w.connected = false;
    // The host leaving (closed tab, routed away) pauses a running game — the
    // clock freezes until they return or the stand-in host resumes.
    if (s.hostId === id && s.phase === "writing" && !s.paused) {
      s.paused = true;
      s.remaining = Math.max(0, s.deadline - Date.now());
      clearTimeout(s.timer);
      armIdleEnd(s);
      saveSnapshot(s);
      announce(s, w, "stepped away — game paused");
    }
    if (s.hostId === id) {
      const entries = [...s.writers.entries()];
      const next =
        entries.find(([, ww]) => ww.connected && ww.userId) ?? entries.find(([, ww]) => ww.connected);
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
      // saved codes stay valid forever, so never hand one out twice
    } while (sessions.has(code) || existsSync(join(SAVE_DIR, code + ".json")));
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
      avatar: w.avatar ?? "", avatarFit: w.avatarFit ?? "cover",
      isHost: id === s.hostId, connected: w.connected !== false,
    }));
  }
  const broadcastRoster = (s) =>
    io.to(s.code).emit("roster", { writers: roster(s), code: s.code, name: s.name || "" });

  function tally(s) {
    const counts = s.options.map(() => 0);
    for (const p of s.votes.values()) {
      const i = s.options.indexOf(p);
      if (i !== -1) counts[i]++;
    }
    return counts;
  }

  // Sockets in the session room that hold no seat — read-only watchers.
  function spectatorCount(s) {
    let n = 0;
    for (const id of io.sockets.adapter.rooms.get(s.code) ?? [])
      if (io.sockets.sockets.get(id)?.data.spectating === s.code) n++;
    return n;
  }

  function broadcastGame(s) {
    const curId = currentId(s);
    io.to(s.code).emit("game-state", {
      code: s.code,
      name: s.name || "",
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
      friendly: s.friendly !== false,
      turnCount: s.turnCount,
      maxTurns: s.maxTurns,
      players: names(s),
      writers: roster(s), // incl. connected flags -> online/offline dots
      hostId: s.hostId,
      hostName: s.writers.get(s.hostId)?.name ?? null,
      spectators: spectatorCount(s),
    });
  }

  // A paused writing game that sits idle this long ends itself with a reveal.
  // Nothing is lost: the snapshot survives and the host can continue-writing
  // from the archive any time. (Env override keeps the tests fast.)
  const IDLE_END_MS = Number(process.env.COWRITE_IDLE_END_MS) || 30 * 60_000;
  function armIdleEnd(s) {
    clearTimeout(s.idleTimer);
    s.idleTimer = setTimeout(() => {
      if (s.phase !== "writing" || !s.paused) return;
      announce(s, s.writers.get(s.hostId), `— idle for ${Math.round(IDLE_END_MS / 60_000)} minutes, so the story was revealed. Continue it any time from the archive.`);
      endGame(s);
    }, IDLE_END_MS);
  }

  // Turn length sanitizer: 0 (explicit) = untimed — turns wait for the writer.
  // Anything else clamps to 10..600s; garbage falls back.
  const cleanSeconds = (v, fallback) => {
    if (v === 0 || v === "0") return 0;
    const n = Number(v);
    return n > 0 ? Math.min(600, Math.max(10, n)) : fallback;
  };

  function startTurn(s) {
    clearTimeout(s.timer);
    clearTimeout(s.idleTimer);
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
      armIdleEnd(s);
      saveSnapshot(s);
      broadcastGame(s);
      return;
    }
    s.lastTyping = "";
    s.lastTypingRaw = "";
    if (s.turnSeconds === 0) {
      // untimed story: no deadline, no auto-commit — the writer takes their time
      s.deadline = 0;
      broadcastGame(s);
      return;
    }
    s.deadline = Date.now() + s.turnSeconds * 1000;
    broadcastGame(s);
    s.timer = setTimeout(() => timeUp(s), s.turnSeconds * 1000);
  }

  function timeUp(s) {
    advance(s, s.writers.get(currentId(s)), s.lastTypingRaw);
  }

  function advance(s, writer, html) {
    clearTimeout(s.timer);
    if (html) {
      const clean = sanitizeRich(html);
      if (stripTags(clean)) {
        s.story.push({
          name: writer?.name, color: writer?.color, html: clean,
          userId: writer?.userId ?? null, // lets the author edit this line later
          host: writer === s.writers.get(s.hostId),
        });
        creditLine(s, writer, clean);
      }
    }
    s.turnCount++;
    saveSnapshot(s); // every committed line hits disk — the code stays revivable
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
    clearTimeout(s.idleTimer);
    s.phase = "over";
    s.paused = false;
    saveSnapshot(s);
    io.to(s.code).emit("game-over", { prompt: s.prompt, story: s.story });
  }

  function removeWriter(s, id) {
    saveSnapshot(s); // seat (incl. its token) hits disk before removal — rejoinable later
    const wasHost = s.hostId === id;
    clearTimeout(s.writers.get(id)?.ghostTimer);
    s.writers.delete(id);
    s.votes.delete(id);

    if (s.writers.size === 0) {
      clearTimeout(s.timer);
      clearTimeout(s.idleTimer);
      sessions.delete(s.code);
      return;
    }
    if (wasHost) {
      const entries = [...s.writers.entries()];
      s.hostId = (entries.find(([, w]) => w.connected && w.userId) ??
        entries.find(([, w]) => w.connected) ?? entries[0])[0];
      // The acting-host role moves so the game stays controllable, but the
      // ORIGINAL host keeps true-host rights forever (s.hostToken/hostUserId
      // never change) — nobody can hijack a story from its first host.
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

  // Put a socket into an existing seat: swaps the new socket id into every
  // place the old one appears, restores host role, and syncs the right phase.
  // Used by token rejoin, account reclaim, and host-approved re-entries.
  function seatSocket(sock, s, oldId, w, ack) {
    if (oldId !== sock.id) {
      io.sockets.sockets.get(oldId)?.disconnect(true); // stale duplicate tab
      s.writers.delete(oldId);
      s.writers.set(sock.id, w);
      const pos = s.turnOrder.indexOf(oldId);
      if (pos !== -1) s.turnOrder[pos] = sock.id;
      if (s.votes.has(oldId)) { s.votes.set(sock.id, s.votes.get(oldId)); s.votes.delete(oldId); }
      if (s.hostId === oldId) s.hostId = sock.id;
    }
    clearTimeout(w.ghostTimer);
    w.connected = true;
    w.approved = true;
    // The original host reclaims the role on return; otherwise the first
    // person back into a rehydrated game hosts until they do.
    if (w.token === s.hostToken || !s.writers.has(s.hostId)) s.hostId = sock.id;
    sock.data.joinedCode = s.code;
    joinAsWriter(sock, s);
    ack?.({ ok: true, code: s.code, hostId: s.hostId, name: w.name, color: w.color, phase: s.phase, token: w.token });
    if (s.phase === "waiting") broadcastRoster(s);
    else if (s.phase === "over") {
      broadcastRoster(s); // everyone learns the (possibly restored) hostId
      sock.emit("game-over", { prompt: s.prompt, story: s.story });
    } else broadcastGame(s);
  }

  // In a gated (continued) game with a host present, a returning seat that
  // hasn't been re-approved yet becomes a pending request instead of seating.
  function gateOrSeat(sock, s, oldId, w, ack) {
    const hostConnected = io.sockets.sockets.has(s.hostId) && s.writers.get(s.hostId)?.connected;
    const isTrueHost = w.token === s.hostToken;
    if (s.gated && !w.approved && !isTrueHost && hostConnected) {
      const key = w.userId;
      const coolMsg = checkDenied(s, key);
      if (coolMsg) return ack?.({ ok: false, error: coolMsg });
      s.pending.set(sock.id, { name: w.name, color: w.color, seatOldId: oldId, key });
      sock.data.pendingCode = s.code;
      io.sockets.sockets.get(s.hostId)?.emit("join-request", { id: sock.id, name: w.name, returning: true });
      return ack?.({ ok: true, pending: true });
    }
    seatSocket(sock, s, oldId, w, ack);
  }

  io.on("connection", (socket) => {
    // socket.data (not a closure) so other handlers — e.g. the host approving a
    // join request — can seat this socket into a session.
    const mySession = () => sessions.get(socket.data.joinedCode);

    socket.on("create-session", ({ auth }, ack) => {
      const acct = userByToken(auth);
      if (!acct) return ack?.({ ok: false, error: "Sign in to host a game." });
      const active = [...sessions.values()].filter((x) => x.phase !== "over").length;
      if (active >= MAX_ACTIVE_SESSIONS)
        return ack?.({ ok: false, error: `${MAX_ACTIVE_SESSIONS} stories are already running — wait for one to wrap up.`, cap: MAX_ACTIVE_SESSIONS });
      const code = makeCode();
      const host = newWriter(acct);
      const s = {
        code, name: "", hostId: socket.id, hostToken: host.token,
        hostUserId: acct.id, hostName: acct.username, // the ORIGINAL host, forever
        friendly: true, // story mode: friendly (default) vs non-friendly
        phase: "waiting",
        writers: new Map([[socket.id, host]]),
        turnOrder: [], currentIdx: 0, turnCount: 0, maxTurns: null,
        story: [], prompt: "", options: [], votes: new Map(),
        turnSeconds: 60, deadline: 0, paused: false, remaining: 0, timer: null, chat: [], lastTyping: "",
        pending: new Map(), // join requests awaiting host approval
        denied: new Map(), // denyKey -> retry-after timestamp (5-min cooldown)
      };
      sessions.set(code, s);
      socket.data.joinedCode = code;
      joinAsWriter(socket, s);
      ack?.({ ok: true, code, hostId: socket.id, token: s.writers.get(socket.id).token });
      broadcastRoster(s);
      saveSnapshot(s); // the code is claimable/revivable from the moment it exists
    });

    const seatByAccount = (s, auth) => {
      const acct = userByToken(auth);
      return acct ? [...s.writers.entries()].find(([, w]) => w.userId === acct.id) : null;
    };

    socket.on("join-session", ({ code, auth }, ack) => {
      code = (code || "").toUpperCase().trim();
      const acct = userByToken(auth);
      if (!acct) return ack?.({ ok: false, error: "Sign in to join a game." });
      const s = sessions.get(code) ?? loadSession(code);
      if (!s) return ack?.({ ok: false, error: "Game not found." });
      // Account-based seat reclaim: a player who lost their device token can
      // re-enter a running game by code — their account finds the seat.
      const mine = seatByAccount(s, auth);
      if (mine) return gateOrSeat(socket, s, mine[0], mine[1], ack);
      if (s.phase !== "waiting") {
        // Started games are gated: a NEW writer needs the host to let them in.
        const hostSock = io.sockets.sockets.get(s.hostId);
        if (!hostSock)
          return ack?.({ ok: false, error: "This game has already started and its host isn't here to let you in." });
        const coolMsg = checkDenied(s, acct.id);
        if (coolMsg) return ack?.({ ok: false, error: coolMsg });
        s.pending.set(socket.id, { auth, key: acct.id });
        socket.data.pendingCode = code;
        hostSock.emit("join-request", { id: socket.id, name: acct.username });
        return ack?.({ ok: true, pending: true });
      }
      s.writers.set(socket.id, newWriter(acct));
      socket.data.joinedCode = code;
      joinAsWriter(socket, s);
      ack?.({ ok: true, code, hostId: s.hostId, token: s.writers.get(socket.id).token });
      broadcastRoster(s);
      saveSnapshot(s);
    });

    // Host verdict on a pending join request for a started game.
    socket.on("approve-join", ({ id, allow }, ack) => {
      const s = mySession();
      if (!s || s.hostId !== socket.id) return ack?.({ ok: false, error: "Host only." });
      const req = s.pending.get(id);
      if (!req) return ack?.({ ok: false, error: "That request is gone." });
      s.pending.delete(id);
      const target = io.sockets.sockets.get(id);
      if (!target) return ack?.({ ok: false, error: "They already left." });
      delete target.data.pendingCode;
      if (!allow) {
        if (req.key) s.denied.set(req.key, Date.now() + DENY_COOLDOWN_MS);
        target.emit("join-denied");
        return ack?.({ ok: true });
      }
      // returning writer of a continued game: re-seat their existing chair
      if (req.seatOldId) {
        const seat = s.writers.get(req.seatOldId);
        if (!seat) return ack?.({ ok: false, error: "Their seat is gone." });
        seatSocket(target, s, req.seatOldId, seat, (payload) => target.emit("join-approved", payload));
        announce(s, seat, "rejoined the story");
        saveSnapshot(s);
        return ack?.({ ok: true });
      }
      const acct = userByToken(req.auth);
      if (!acct) {
        target.emit("join-denied");
        return ack?.({ ok: false, error: "Their sign-in expired." });
      }
      const w = newWriter(acct);
      s.writers.set(id, w);
      // new writers slot in at the end of the rotation
      if (s.phase === "choosing" || s.phase === "writing") s.turnOrder.push(id);
      target.data.joinedCode = s.code;
      joinAsWriter(target, s);
      target.emit("join-approved", {
        ok: true, code: s.code, hostId: s.hostId, name: w.name, color: w.color, phase: s.phase, token: w.token,
      });
      announce(s, w, "joined the story");
      if (s.phase === "over") {
        broadcastRoster(s);
        target.emit("game-over", { prompt: s.prompt, story: s.story });
      } else broadcastGame(s);
      saveSnapshot(s);
      ack?.({ ok: true });
    });

    // Reclaim a seat (page refresh / transient reconnect) using the localStorage
    // seat token, falling back to the signed-in account's seat.
    socket.on("rejoin-session", ({ code, token, auth }, ack) => {
      code = (code || "").toUpperCase().trim();
      const s = sessions.get(code) ?? loadSession(code);
      if (!s || (!token && !auth)) return ack?.({ ok: false, error: "Game not found." });
      const entry =
        (token && [...s.writers.entries()].find(([, w]) => w.token === token)) || seatByAccount(s, auth);
      if (!entry) return ack?.({ ok: false, error: "Seat expired." });
      gateOrSeat(socket, s, entry[0], entry[1], ack);
    });

    socket.on("start-game", ({ turnSeconds, rounds, friendly }, ack) => {
      const s = mySession();
      if (!s || s.hostId !== socket.id) return ack?.({ ok: false, error: "Only the host can start." });
      if (s.writers.size < 1) return ack?.({ ok: false, error: "Need at least one writer." });
      s.phase = "choosing";
      s.turnOrder = [...s.writers.keys()];
      s.currentIdx = 0;
      s.turnCount = 0;
      s.story = [];
      s.votes.clear();
      if (friendly != null) s.friendly = !!friendly;
      s.turnSeconds = cleanSeconds(turnSeconds, 60);
      const r = Number(rounds);
      s.maxTurns = r > 0 ? r * s.turnOrder.length : null;
      s.options = promptOptions();
      ack?.({ ok: true });
      announce(s, s.writers.get(socket.id), "started the game");
      broadcastGame(s);
      saveSnapshot(s);
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
      s.lastTypingRaw = String(text || ""); // committed at timeout; advance() sanitizes ONCE
      s.lastTyping = sanitizeRich(text || "");
      socket.to(s.code).emit("live-typing", { html: s.lastTyping });
    });

    socket.on("finalize-vote", (_, ack) => {
      const s = mySession();
      if (!s || s.hostId !== socket.id || s.phase !== "choosing") return ack?.({ ok: false });
      finalizeVote(s);
      ack?.({ ok: true });
    });

    // Authors can revise their own committed lines (writing or reveal phase).
    // Sanitized exactly once, like a fresh line; word counts are NOT re-credited.
    socket.on("edit-line", ({ index, text }, ack) => {
      const s = mySession();
      if (!s || (s.phase !== "writing" && s.phase !== "over")) return ack?.({ ok: false });
      const w = s.writers.get(socket.id);
      const line = s.story[Number(index)];
      if (!w || !line) return ack?.({ ok: false, error: "That line doesn't exist." });
      if (!line.userId || line.userId !== w.userId)
        return ack?.({ ok: false, error: "You can only edit your own lines." });
      const clean = sanitizeRich(text);
      if (!stripTags(clean)) return ack?.({ ok: false, error: "A line can't be empty." });
      line.html = clean;
      line.edited = true;
      saveSnapshot(s);
      if (s.phase === "over") io.to(s.code).emit("game-over", { prompt: s.prompt, story: s.story });
      else broadcastGame(s);
      ack?.({ ok: true });
    });

    // Authors can remove their own committed lines (writing or reveal phase).
    // Word counts are NOT clawed back, mirroring edit-line's no-re-credit rule.
    socket.on("delete-line", ({ index }, ack) => {
      const s = mySession();
      if (!s || (s.phase !== "writing" && s.phase !== "over")) return ack?.({ ok: false });
      const w = s.writers.get(socket.id);
      const i = Number(index);
      const line = s.story[i];
      if (!w || !line) return ack?.({ ok: false, error: "That line doesn't exist." });
      if (!line.userId || line.userId !== w.userId)
        return ack?.({ ok: false, error: "You can only delete your own lines." });
      s.story.splice(i, 1);
      saveSnapshot(s);
      if (s.phase === "over") io.to(s.code).emit("game-over", { prompt: s.prompt, story: s.story });
      else broadcastGame(s);
      ack?.({ ok: true });
    });

    socket.on("submit-line", ({ text }, ack) => {
      const s = mySession();
      if (!s || s.phase !== "writing" || s.paused) return ack?.({ ok: false });
      if (currentId(s) !== socket.id) return ack?.({ ok: false, error: "Not your turn." });
      advance(s, s.writers.get(socket.id), text);
      ack?.({ ok: true });
    });

    // Host can name the session; the name shows at the top for everyone.
    socket.on("rename-session", ({ name }, ack) => {
      const s = mySession();
      if (!s || s.hostId !== socket.id) return ack?.({ ok: false, error: "Host only." });
      s.name = stripTags(String(name || "")).slice(0, 40).trim();
      if (s.phase === "waiting" || s.phase === "over") broadcastRoster(s);
      if (s.phase !== "waiting") broadcastGame(s);
      saveSnapshot(s);
      ack?.({ ok: true, name: s.name });
    });

    socket.on("pause-game", (_, ack) => {
      const s = mySession();
      if (!s || s.hostId !== socket.id || s.phase !== "writing" || s.paused) return ack?.({ ok: false });
      s.paused = true;
      s.remaining = Math.max(0, s.deadline - Date.now());
      clearTimeout(s.timer);
      armIdleEnd(s);
      saveSnapshot(s);
      broadcastGame(s);
      ack?.({ ok: true });
    });

    // Host can retune mid-game: a new turn length applies from the next turn
    // (the running clock is untouched); added rounds extend maxTurns, and give
    // an endless game a finish line turnCount + extra turns away.
    socket.on("update-rules", ({ turnSeconds, addRounds, friendly }, ack) => {
      const s = mySession();
      if (!s || s.hostId !== socket.id || s.phase !== "writing") return ack?.({ ok: false });
      if (friendly != null) s.friendly = !!friendly;
      const wantsUntimed = turnSeconds === 0 || turnSeconds === "0";
      const newSeconds = wantsUntimed || (turnSeconds != null && Number(turnSeconds) > 0);
      if (newSeconds) s.turnSeconds = cleanSeconds(turnSeconds, s.turnSeconds);
      const r = Number(addRounds);
      if (r > 0) {
        const extra = r * Math.max(1, s.turnOrder.length);
        s.maxTurns = s.maxTurns == null ? s.turnCount + extra : s.maxTurns + extra;
      }
      // Apply hits NOW: the current turn's clock restarts at the new full
      // length (the writer keeps whatever they've typed). A paused game just
      // updates its stored remainder; resume rearms from it.
      if (newSeconds) {
        if (s.paused) s.remaining = s.turnSeconds * 1000;
        else if (s.turnSeconds === 0) {
          clearTimeout(s.timer); // timer disabled mid-game: current turn goes untimed
          s.deadline = 0;
        } else {
          clearTimeout(s.timer);
          s.deadline = Date.now() + s.turnSeconds * 1000;
          s.timer = setTimeout(() => timeUp(s), s.turnSeconds * 1000);
        }
      }
      broadcastGame(s);
      ack?.({ ok: true });
    });

    // After a reveal, the host can pick the story back up with fresh rules.
    // Keeps prompt + story; the turn order rebuilds from connected writers.
    socket.on("continue-writing", ({ turnSeconds, rounds, friendly }, ack) => {
      const s = mySession();
      if (!s || s.hostId !== socket.id || s.phase !== "over") return ack?.({ ok: false });
      if (friendly != null) s.friendly = !!friendly;
      s.turnSeconds = cleanSeconds(turnSeconds, s.turnSeconds);
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
      clearTimeout(s.idleTimer);
      if (s.turnSeconds === 0) {
        s.deadline = 0; // untimed: resume just unfreezes, no clock to rearm
        broadcastGame(s);
        return ack?.({ ok: true });
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
        avatar: w?.avatar ?? "",
        avatarFit: w?.avatarFit ?? "cover",
        host: socket.id === s.hostId,
        text: String(text).slice(0, 500).trim(),
        ts: Date.now(),
      };
      s.chat.push(msg);
      if (s.chat.length > CHAT_LIMIT) s.chat.shift();
      io.to(writersRoom(s)).emit("chat", msg);
    });

    // Spectator chat: open to spectators AND writers, visible to the whole
    // session room. Spectator names are client-minted (Stranger Things list +
    // number, localStorage) so they're stripped/limited here; colors come from
    // the palette by name hash. Never persisted — in-memory ring only.
    socket.on("spec-chat", ({ text, name }) => {
      const code = socket.data.joinedCode || socket.data.spectating;
      const s = sessions.get(code);
      if (!s || !text || !String(text).trim()) return;
      const w = socket.data.joinedCode ? s.writers.get(socket.id) : null;
      const body = String(text).slice(0, 500).trim();
      const msg = w
        ? {
            id: socket.id, name: w.name, color: w.color, badge: w.badge ?? null,
            avatar: w.avatar ?? "", avatarFit: w.avatarFit ?? "cover",
            host: socket.id === s.hostId, writer: true, spec: true, text: body, ts: Date.now(),
          }
        : (() => {
            const specName = String(name || "").replace(/<[^>]*>/g, "").slice(0, 28).trim() || "Spectator";
            return { id: socket.id, name: specName, color: specColor(specName), spec: true, text: body, ts: Date.now() };
          })();
      (s.specChat ??= []).push(msg);
      if (s.specChat.length > SPEC_CHAT_LIMIT) s.specChat.shift();
      io.to(s.code).emit("spec-chat", msg);
    });

    // Watch a running story WITHOUT a seat (no account needed). Spectators
    // join the broadcast room but hold no writer entry, so every game action
    // (vote, submit, chat, host controls) no-ops for them — mySession() is
    // keyed by joinedCode, which spectators never get.
    socket.on("spectate-session", ({ code }, ack) => {
      code = (code || "").toUpperCase().trim();
      const s = sessions.get(code) ?? loadSession(code);
      if (!s) return ack?.({ ok: false, error: "Game not found." });
      socket.data.spectating = code;
      socket.join(code); // NOT the ":writers" room — writers chat never reaches spectators
      ack?.({ ok: true, code, phase: s.phase, name: s.name || "" });
      socket.emit("spec-chat-history", s.specChat ?? []);
      if (s.phase === "over") socket.emit("game-over", { prompt: s.prompt, story: s.story });
      else if (s.phase === "waiting") broadcastRoster(s);
      else broadcastGame(s);
    });

    // Presence for the dashboard: bind/unbind this socket to an account.
    socket.on("identify", ({ auth }) => {
      const u = userByToken(auth);
      if (u) onlineSockets.set(socket.id, u.id);
      else onlineSockets.delete(socket.id);
    });

    socket.on("disconnect", () => {
      onlineSockets.delete(socket.id);
      // A departing spectator changes the watcher count everyone sees.
      const watched = sessions.get(socket.data.spectating);
      if (watched && watched.phase !== "waiting" && watched.phase !== "over") broadcastGame(watched);
      const p = sessions.get(socket.data.pendingCode);
      if (p && p.pending.delete(socket.id))
        io.sockets.sockets.get(p.hostId)?.emit("join-request-cancel", { id: socket.id });
      const s = mySession();
      // Guard: after a rejoin swap, this stale socket's id is no longer a writer.
      if (s && s.writers.has(socket.id)) markDisconnected(s, socket.id);
    });
  });

  // ---- Archive / dashboard read helpers (used by the HTTP routes) ----

  // Previous games are private: you only see games your account holds a seat in.
  // Names in snapshots are display copies; the ACCOUNT id is the durable tie.
  // Resolve to the current username at read time so renames follow the user.
  const freshName = (userId, fallback) => store.users.find((x) => x.id === userId)?.username ?? fallback;
  const freshStory = (story) => (story || []).map((l) => (l.userId ? { ...l, name: freshName(l.userId, l.name) } : l));
  const gameSummary = (d) => ({
    code: d.code, name: d.name || "", phase: d.phase, prompt: d.prompt || "",
    savedAt: d.savedAt || 0, lines: (d.story || []).length,
    hostName: store.users.find((u) => u.id === d.hostUserId)?.username ?? d.hostName ?? null,
    writers: (d.writers || []).map((w) => ({
      name: freshName(w.userId, w.name), color: cleanColor(w.color), isHost: d.hostUserId != null && w.userId === d.hostUserId,
    })),
  });
  const inGame = (d, u) => (d.writers || []).some((w) => w.userId === u.id);

  // A username change ripples into every live session the account sits in:
  // seats, committed story lines, host label — then re-broadcasts + snapshots.
  function renameUser(userId, newName) {
    for (const s of sessions.values()) {
      let touched = false;
      for (const w of s.writers.values())
        if (w.userId === userId && w.name !== newName) { w.name = newName; touched = true; }
      for (const l of s.story) if (l.userId === userId && l.name !== newName) { l.name = newName; touched = true; }
      if (s.hostUserId === userId && s.hostName !== newName) { s.hostName = newName; touched = true; }
      if (!touched) continue;
      saveSnapshot(s);
      if (s.phase === "waiting") broadcastRoster(s);
      else broadcastGame(s);
    }
  }

  // "Games in progress" for MY dashboard: running sessions where my account
  // holds a seat, plus paused save snapshots not currently in memory.
  function myGamesFor(u) {
    const out = new Map();
    for (const s of sessions.values()) {
      if (s.phase === "over") continue;
      const mine = [...s.writers.values()].some((w) => w.userId === u.id);
      if (!mine) continue;
      const cur = s.phase === "writing" ? s.writers.get(s.turnOrder[s.currentIdx]) : null;
      out.set(s.code, {
        code: s.code, name: s.name || "", phase: s.phase, paused: !!s.paused,
        myTurn: s.phase === "writing" && !s.paused && cur?.userId === u.id,
        currentName: cur?.name ?? null,
        players: [...s.writers.values()].map((w) => ({
          name: w.name, color: cleanColor(w.color), connected: w.connected !== false,
        })),
        lines: s.story.length, savedAt: Date.now(), live: true,
      });
    }
    for (const f of readdirSync(SAVE_DIR)) {
      if (!f.endsWith(".json")) continue;
      const code = f.slice(0, -5);
      if (out.has(code) || sessions.has(code)) continue;
      try {
        const d = JSON.parse(readFileSync(join(SAVE_DIR, f), "utf-8"));
        if (d.phase === "over" || !(d.writers || []).some((w) => w.userId === u.id)) continue;
        out.set(code, {
          code, name: d.name || "", phase: d.phase, paused: true, myTurn: false, currentName: null,
          players: (d.writers || []).map((w) => ({ name: w.name, color: cleanColor(w.color), connected: false })),
          lines: (d.story || []).length, savedAt: d.savedAt || 0, live: false,
        });
      } catch { /* skip unreadable snapshot */ }
    }
    return [...out.values()].sort((a, b) => b.savedAt - a.savedAt).slice(0, 8);
  }

  // Finished stories for the dashboard's compact "previous games" list.
  function recentGamesFor(u, cap = 5) {
    const out = [];
    for (const f of readdirSync(SAVE_DIR)) {
      if (!f.endsWith(".json")) continue;
      try {
        const d = JSON.parse(readFileSync(join(SAVE_DIR, f), "utf-8"));
        if (d.phase === "over" && inGame(d, u)) out.push(gameSummary(d));
      } catch { /* skip unreadable snapshot */ }
    }
    out.sort((a, b) => b.savedAt - a.savedAt);
    return out.slice(0, cap);
  }

  // Permanently remove a game: kill the live session (players are told),
  // then delete the snapshot so the code truly dies.
  function deleteGame(code) {
    const s = sessions.get(code);
    if (s) {
      clearTimeout(s.timer);
      clearTimeout(s.idleTimer);
      for (const w of s.writers.values()) clearTimeout(w.ghostTimer);
      io.to(code).emit("game-deleted");
      sessions.delete(code);
    }
    try {
      unlinkSync(join(SAVE_DIR, code + ".json"));
    } catch { /* already gone */ }
    mirrorDelete("save", code); // no-op without DATABASE_URL
  }

  return { sessions, onlineSockets, SAVE_DIR, gameSummary, freshStory, inGame, myGamesFor, recentGamesFor, deleteGame, renameUser };
}
