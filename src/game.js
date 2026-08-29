// The live game: session state machine, persistence (saves/*.json), and all
// Socket.IO handlers. createGame(io) owns the in-memory maps and returns the
// pieces the HTTP routes need (sessions, archive helpers, presence).
import { randomUUID, randomInt } from "crypto";
import { bumpStreak } from "../lib/streak.js";
import { badgeName, badgeDesc, usageMatches, awardWordBadges, rewardsForTiers, describeRewards, unlockedThemes, unlockedGimmicks, canUseGimmick } from "../lib/achievements.js";
import { cleanGimmickId, rollOutcome, describeRoll, galagaOutcome, describeGalaga, GALAGA_MAX_SCORE, ROLL_COOLDOWN_MS, SPIN_MS, DIE_SIDES, PAINT_MAX_STROKES, PAINT_MAX_PTS, CURSE_MS, GIMMICK_IDS } from "../lib/gimmicks.js";
import { PALETTE, cleanColor, cleanHex, sanitizeRich, stripTags, plainText, clip, httpUrl, sanitizeDoc, CID_RE } from "./sanitize.js";
import { store, saveStore, userByToken, makeMsg, isAdmin } from "./store.js";
import { storage, getJson } from "./storage.js";
import { generateSimplePrompt, generateIntermediatePrompt, validateIntermediateData, EXPLICIT_LEVELS, MODES, MAX_KINKS } from "../lib/prompt-gen.js";
import { readContent, writeContent } from "./content.js";
import { randomTitle } from "../lib/titles.js";
import { readDoc, writeDoc, canView, canEdit, canComment, anchorCids, anchorText, stripAnchor, stripAnchors, applySuggestion } from "./docs.js";

// Curated scenario prompts + the guided-mode component pools (edit
// content/prompts.json freely — no code changes). See docs/PROMPT_GENERATION.md.
let PROMPT_DATA = readContent("prompts.json") || { prompts: [] };
let PROMPT_BANK = PROMPT_DATA.prompts;
let INTERMEDIATE = PROMPT_DATA.intermediate || null;
export const getPromptData = () => PROMPT_DATA;
// The title bank for sessions the host doesn't name (content/titles.json;
// a pack without one gets "Untitled").
let TITLE_BANK = readContent("titles.json");
// The admin editor's write path: validate the whole document, write it to
// the pack, then swap it in — every ballot dealt from here on uses it.
// Returns the validation errors (empty = saved).
export async function setPromptData(next) {
  const errors = [];
  if (!Array.isArray(next?.prompts) || !next.prompts.length) errors.push("prompts: need at least one curated scenario");
  else if (!next.prompts.every((p) => typeof p === "string" && p.trim())) errors.push("prompts: every entry is a non-empty string");
  if (next?.intermediate) errors.push(...validateIntermediateData(next.intermediate));
  if (errors.length) return errors;
  const doc = { prompts: next.prompts.map((p) => p.trim()), ...(next.intermediate ? { intermediate: next.intermediate } : {}) };
  const text = JSON.stringify(doc, null, "\t") + "\n";
  await writeContent("prompts.json", text);
  PROMPT_DATA = doc;
  PROMPT_BANK = doc.prompts;
  INTERMEDIATE = doc.intermediate || null;
  return [];
}

// The host-facing knobs of guided mode, normalized so nothing off the wire
// reaches the generator raw.
function cleanPromptControls(c = {}) {
  const id = (v) => {
    const x = String(v ?? "random").slice(0, 60);
    return /^[a-z0-9-]+$/.test(x) ? x : "random";
  };
  return {
    seasonId: id(c.seasonId),
    canonId: id(c.canonId),
    worldId: id(c.worldId),
    placeId: id(c.placeId),
    situationId: id(c.situationId),
    relationshipId: id(c.relationshipId),
    toneId: id(c.toneId),
    // The explicit level defaults to none, never to random: nobody gets an
    // explicit ballot they didn't ask for.
    explicitLevel: EXPLICIT_LEVELS.includes(c.explicitLevel) ? c.explicitLevel : "none",
    // The explicit dropdowns: pins on the Kinks line, only read past the gate.
    setupId: id(c.setupId),
    dynamicId: id(c.dynamicId),
    actId: id(c.actId),
    kinkId: id(c.kinkId),
    // How many kinks on the line: 1 unless the host asks for more (never random)
    kinkCount: Number.isInteger(Number(c.kinkCount)) && Number(c.kinkCount) >= 1 && Number(c.kinkCount) <= MAX_KINKS ? Number(c.kinkCount) : 1,
    // Parts the host switched off: never drawn, never on the card.
    situationOff: c.situationOff === true,
    toneOff: c.toneOff === true,
    setupOff: c.setupOff === true,
    dynamicOff: c.dynamicOff === true,
    actOff: c.actOff === true,
    kinkOff: c.kinkOff === true,
  };
}
const cleanPromptMode = (m) => (MODES.includes(m) && (m !== "intermediate" || INTERMEDIATE) ? m : "simple");

// At the deadline the server advances immediately, using the writer's last
// live-typing content (s.lastTyping) as their line so partial work is kept.
const CHAT_LIMIT = 200;
const MAX_OPTIONS = 8;
// Disconnected writers linger as reclaimable "ghosts" this long. The client
// holds {code, token} in localStorage and rejoins via `rejoin-session`.
const GHOST_MS = Number(process.env.COWRITE_GHOST_MS) || 90_000;
// A denied join request can't retry for this long (anti-spam).
// Keyed by account id — every writer is signed in.
const DENY_COOLDOWN_MS = 5 * 60_000;

export function createGame(io) {
  const sessions = new Map(); // code -> session (in-memory; fine for a party game)
  const onlineSockets = new Map(); // socket.id -> userId (signed-in presence for the dashboard)
  // Who currently has a solo-write doc open: socket.id -> {docId, userId}.
  // Purely ephemeral, like spectators — never snapshotted.
  const docViewers = new Map();

  // Paused/finished games are snapshotted (save/<CODE> in src/storage.js —
  // saves/*.json locally, Postgres rows on Replit) so they survive a server
  // restart and can be picked up later. Seats are identified by writer token.
  // readSnapshot/allSnapshots are the ONLY readers; the HTTP routes use them too.
  const readSnapshot = (code) => getJson("save", code);
  const allSnapshots = () => storage.list("save").map(readSnapshot).filter(Boolean);
  const writeSnapshot = (code, d) => storage.put("save", code, JSON.stringify(d));

  // One-time sweep: every existing snapshot gets an (empty) tags array so the
  // all-stories page can filter on it uniformly.
  for (const d of allSnapshots()) {
    if (Array.isArray(d.tags) || !d.code) continue;
    d.tags = [];
    writeSnapshot(d.code, d);
  }

  // When a finished story gets continued, every previous contributor who is
  // online but not seated in the session gets an automatic invite: an inbox
  // message (type game-invite, carrying the code) plus a live `game-invite`
  // event on each of their identified sockets. Contributors are found from
  // story-line userIds ∪ current seats, so writers whose seats expired long
  // ago still get called back.
  function inviteContributors(s) {
    const seated = new Set(
      [...s.writers.values()].filter((w) => w.connected !== false && w.userId).map((w) => w.userId));
    const contributors = new Set(
      [...(s.story || []).map((l) => l.userId), ...[...s.writers.values()].map((w) => w.userId)]
        .filter(Boolean));
    const hostName = s.writers.get(s.hostId)?.name ?? s.hostName ?? null;
    const hostUserId = s.writers.get(s.hostId)?.userId ?? s.hostUserId ?? null;
    let changed = false;
    for (const uid of contributors) {
      if (seated.has(uid)) continue;
      const socketIds = [...onlineSockets.entries()].filter(([, id]) => id === uid).map(([sid]) => sid);
      if (!socketIds.length) continue; // only online contributors get the auto-invite
      const u = store.users.find((x) => x.id === uid);
      if (!u) continue;
      const title = s.name || s.code;
      u.inbox = u.inbox || [];
      u.inbox.unshift({
        ...makeMsg("game-invite", hostUserId, `“${title}” is being continued, jump back in and keep writing!`),
        code: s.code,
      });
      for (const sid of socketIds)
        io.to(sid).emit("game-invite", { code: s.code, name: s.name || "", host: hostName });
      changed = true;
    }
    if (changed) saveStore();
  }

  function saveSnapshot(s) {
    try {
      const doc = JSON.stringify({
        code: s.code, name: s.name || "", cover: s.cover || "", phase: s.phase, prompt: s.prompt, story: s.story, chat: s.chat,
        friendly: s.friendly !== false,
        promptMode: s.promptMode || "simple", promptControls: s.promptControls || cleanPromptControls(),
        createdAt: s.createdAt ?? null, tags: s.tags || [],
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
      storage.put("save", s.code, doc);
    } catch (e) {
      console.error("saveSnapshot failed:", e.message);
    }
  }

  // Rehydrate a saved game: every seat comes back as an unclaimed ghost keyed by
  // its token; players reclaim seats via the normal rejoin flow. A saved writing
  // game wakes up paused; the first reclaimer becomes host and can resume.
  function loadSession(code) {
    const d = readSnapshot(code);
    if (!d) return null;
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
      code, hostId: null, hostToken: d.hostToken ?? null, phase, cover: d.cover || "",
      writers,
      turnOrder:
        phase === "writing" ? d.turnOrderTokens.map((t) => "ghost:" + t).filter((id) => writers.has(id)) : [],
      currentIdx: Math.min(d.currentIdx || 0, Math.max(0, d.turnOrderTokens.length - 1)),
      turnCount: d.turnCount || 0, maxTurns: d.maxTurns ?? null,
      story: d.story || [], prompt: d.prompt || "", options: [], optionMeta: [], votes: new Map(),
      promptMode: cleanPromptMode(d.promptMode), promptControls: cleanPromptControls(d.promptControls || {}),
      turnSeconds: d.turnSeconds === 0 ? 0 : d.turnSeconds || 60, deadline: 0,
      paused: phase === "writing", remaining: d.remaining || (d.turnSeconds || 60) * 1000,
      timer: null, chat: d.chat || [], lastTyping: "",
      name: d.name || "", pending: new Map(), denied: new Map(),
      gated: true, // a continued game: the host must approve each re-entry
      hostName: d.hostName ?? null, hostUserId: d.hostUserId ?? null,
      friendly: d.friendly !== false,
      createdAt: d.createdAt ?? null, tags: d.tags || [],
    };
    sessions.set(code, s);
    if (s.phase === "writing") armIdleSleep(s); // wakes paused — and sleeps again if left alone
    return s;
  }

  function checkDenied(s, key) {
    const until = s.denied?.get(key);
    if (!until || until <= Date.now()) return null;
    const min = Math.ceil((until - Date.now()) / 60_000);
    return `The host turned you away, you can ask again in ${min} minute${min === 1 ? "" : "s"}.`;
  }

  const connectedCount = (s) => [...s.writers.values()].filter((w) => w.connected).length;

  // ONE chat for the whole table: writers speak from their seat, spectators
  // under their client-minted name (flagged `spec`), and every line — system
  // calls included — goes to the session room, so a watcher follows the
  // whole conversation. One history, snapshotted with the game.
  function joinAsWriter(sock, s) {
    touch(s);
    sock.join(s.code);
    sock.emit("chat-history", s.chat);
    if (s.dice?.size) sock.emit("gimmick-dice", diceList(s));
    if (s.ships?.size) sock.emit("gimmick-ships", shipsList(s));
    if (s.cups?.size) sock.emit("gimmick-cups", cupsList(s));
    if (s.balls?.size) sock.emit("gimmick-balls", ballsList(s));
    if (s.paint?.size) sock.emit("gimmick-paints", paintsList(s));
    if (s.guns?.size) sock.emit("gimmick-guns", gunsList(s));
  }
  // spectator name colors: stable per name, never attacker-controlled (PALETTE only)
  const specColor = (name) => PALETTE[[...name].reduce((h, c) => h + c.charCodeAt(0), 0) % PALETTE.length];

  // System-style chat line ("Will started the game") — rendered muted/italic client-side.
  // `chime: true` asks every client to ring for a system line (only the dice
  // gimmick's natural 20 does — every other system line stays silent).
  function announce(s, writer, text, { chime = false } = {}) {
    const msg = {
      name: writer?.name ?? "?", color: writer?.color ?? PALETTE[0],
      text, sys: true, ts: Date.now(), ...(chime ? { chime: true } : {}),
    };
    s.chat.push(msg);
    if (s.chat.length > CHAT_LIMIT) s.chat.shift();
    io.to(s.code).emit("chat", msg);
  }

  // ---- Gimmicks (lib/gimmicks.js) ----
  // Roll cooldown: COWRITE_ROLL_COOLDOWN_MS overrides (the tests shrink it).
  const ROLL_MS = Number(process.env.COWRITE_ROLL_COOLDOWN_MS || ROLL_COOLDOWN_MS);
  // The disco ball's spin cooldown is the show's own length; the same test
  // override shrinks it so the suite never waits out a real 8s show.
  const SPIN_COOLDOWN_MS = Number(process.env.COWRITE_ROLL_COOLDOWN_MS || SPIN_MS);
  // Vecna's curse duration; COWRITE_CURSE_MS overrides (the tests shrink it).
  const CURSE_HOLD_MS = Number(process.env.COWRITE_CURSE_MS || CURSE_MS);
  // Tests only: COWRITE_DICE_FIXED="20,1,7" makes the die land those values
  // in order (then random again) so a natural 20 can be produced on demand.
  const fixedDice = (process.env.COWRITE_DICE_FIXED || "").split(",").map((n) => Number(n)).filter((n) => n >= 1 && n <= DIE_SIDES);
  const rollDie = () => (fixedDice.length ? fixedDice.shift() : 1 + randomInt(DIE_SIDES));
  // "If one person at the table has the gimmick, everyone can play it": a
  // seat may roll when its own account has the rank — or ANY seated account
  // does (admins count as having every gimmick).
  const tableHasGimmick = (s, id) =>
    [...s.writers.values()].some((w) => {
      const u = store.users.find((x) => x.id === w.userId);
      return !!u && (canUseGimmick(u, id) || isAdmin(u));
    });
  // Every die on the table, so a late joiner (or a refresh) sees the ones
  // already out: userId -> {name, color, x, y} with x/y as fractions of the
  // viewer's own screen. In memory only — dice never survive a restart.
  const diceList = (s) => [...(s.dice?.entries() ?? [])].map(([userId, d]) => ({ userId, ...d }));
  // Put one player's die away for everyone (they left, or the game went friendly).
  function dropDie(s, userId) {
    if (!s.dice?.has(userId)) return;
    s.dice.delete(userId);
    io.to(s.code).emit("gimmick-die", { userId, on: false });
  }
  // The Galaga battles out right now, same contract as the dice: userId ->
  // {name, color, x, score, shots, bees} with every coordinate a fraction of
  // the viewer's own screen. In memory only — a battle never survives a restart.
  const shipsList = (s) => [...(s.ships?.entries() ?? [])].map(([userId, sh]) => ({ userId, ...sh }));
  function dropShip(s, userId) {
    if (!s.ships?.has(userId)) return;
    s.ships.delete(userId);
    io.to(s.code).emit("gimmick-ship", { userId, on: false });
  }
  // The milkshakes out on the table (Starcourt gimmick), same contract again:
  // userId -> {name, color, x, y, rot, level}. The spill itself is simulated
  // on every viewer's screen from this stream — the server relays the cup,
  // not the drops. In memory only.
  const cupsList = (s) => [...(s.cups?.entries() ?? [])].map(([userId, c]) => ({ userId, ...c }));
  function dropCup(s, userId) {
    if (!s.cups?.has(userId)) return;
    s.cups.delete(userId);
    io.to(s.code).emit("gimmick-cup", { userId, on: false });
  }
  // The disco balls hanging over the table (Rink-O-Mania gimmick), same
  // contract again: userId -> {name, color, x, y}. The light show itself is
  // simulated on every viewer's screen from the `gimmick-spin` event — the
  // server relays the ball, never a light spot. In memory only.
  const ballsList = (s) => [...(s.balls?.entries() ?? [])].map(([userId, b]) => ({ userId, ...b }));
  function dropBall(s, userId) {
    if (!s.balls?.has(userId)) return;
    s.balls.delete(userId);
    io.to(s.code).emit("gimmick-ball", { userId, on: false });
  }
  // The art room's paint (Will's Art Room gimmick): userId -> {name, color,
  // on, strokes, live, cursor}. Strokes are point lists in screen fractions —
  // every viewer redraws them on their own canvas, so no pixel ever crosses
  // the wire. Paint STAYS when the brush is put away (`on` flips false) and
  // leaves only on a wipe, the painter leaving, or the game going friendly.
  // In memory only — a painting never survives a restart.
  const paintsList = (s) => [...(s.paint?.entries() ?? [])].map(([userId, p]) => ({ userId, ...p }));
  function dropPaint(s, userId) {
    if (!s.paint?.has(userId)) return;
    s.paint.delete(userId);
    io.to(s.code).emit("gimmick-stroke", { userId, on: false, wipe: true });
  }
  // The water guns out on the table (SuperSoaker gimmick), same contract as
  // the dice: userId -> {name, color, x, y, angle}. A fired burst never
  // touches the wire beyond one seeded `gimmick-squirt` event — every viewer
  // simulates the same water locally. In memory only.
  const gunsList = (s) => [...(s.guns?.entries() ?? [])].map(([userId, g]) => ({ userId, ...g }));
  function dropGun(s, userId) {
    if (!s.guns?.has(userId)) return;
    s.guns.delete(userId);
    io.to(s.code).emit("gimmick-gun", { userId, on: false });
  }
  // Vecna's curse in flight (at most ONE per session): targetUserId ->
  // {by, until, timer}. Transient (~20s) — never snapshotted, no late-join
  // list; it simply expires. Dropping it early (victim leaves, friendly
  // switch) relays the lift so no screen stays grey.
  function dropCurse(s, targetUserId) {
    const c = s.curses?.get(targetUserId);
    if (!c) return;
    clearTimeout(c.timer);
    s.curses.delete(targetUserId);
    io.to(s.code).emit("gimmick-curse", { targetUserId, lift: true });
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

  // Solo writes count too: words an author ADDS to their own document credit
  // the account (a rank-up lands in the inbox — there is no chat to announce
  // it in). The document remembers its high-water mark (`creditedWords`) so
  // cutting a paragraph and writing it back never counts twice.
  function creditSoloWords(u, doc) {
    const mark = doc.creditedWords || 0;
    const words = Math.max(0, (doc.wordCount || 0) - mark);
    if (!words) return 0;
    doc.creditedWords = mark + words;
    u.wordCount += words;
    const before = u.currentBadge;
    const tiersBefore = new Set(u.badges);
    awardWordBadges(u);
    if (u.currentBadge !== before) {
      const unlocks = rewardsForTiers(u.badges.filter((id) => !tiersBefore.has(id)));
      const what = describeRewards(unlocks);
      if (!Array.isArray(u.inbox)) u.inbox = [];
      u.inbox.unshift(makeMsg("system", null,
        `🎉 You reached ${badgeName(u.currentBadge)}` + (what ? `, that unlocks ${what}.` : `! ${badgeDesc(u.currentBadge) || ""}`.trimEnd()) +
        (unlocks.themes.length ? " Find your new theme in the 🎨 menu at the foot of any page." : ""),
        { unlocks }));
    }
    saveStore();
    return words;
  }

  // Credit a committed line to the writer's account: word count, games list,
  // and any newly crossed badge tier (announced in chat).
  function creditLine(s, writer, cleanHtml) {
    if (!writer?.userId) return;
    const u = store.users.find((x) => x.id === writer.userId);
    if (!u) return;
    const text = plainText(cleanHtml);
    const words = text.split(/\s+/).filter(Boolean).length;
    u.wordCount += words;
    // remember their newest line — creditLine saves the store anyway, so free
    if (text) u.lastLine = { text: clip(text, 220), code: s.code, name: s.name || "", at: Date.now() };
    bumpStreak(u);
    if (!u.games.includes(s.code)) u.games.push(s.code);
    const before = u.currentBadge;
    const tiersBefore = new Set(u.badges);
    awardWordBadges(u);
    // Unlock notification (toast) for EVERYONE in the session — writers and
    // spectators alike — on top of the system chat announcement. `unlocks`
    // is what a rank hands out beyond the badge itself (themes, gimmicks) so
    // the toast can say it; a rank-up also carries `themes`, the full list
    // the writer may now wear, so THEIR menu re-gates without a fetch.
    const notifyEarned = (id, unlocks = null) =>
      io.to(s.code).emit("badge-earned", {
        badge: badgeName(id), desc: badgeDesc(id),
        name: writer.name, color: writer.color,
        unlocks, themes: unlocks ? unlockedThemes(u) : undefined,
        gimmicks: unlocks ? unlockedGimmicks(u) : undefined, // likewise, the gimmicks they may now play
      });
    // word-usage collectibles: awarded once, the first line that says the word
    for (const id of usageMatches(text)) {
      if (!u.badges.includes(id)) {
        u.badges.push(id);
        announce(s, writer, `earned the ${badgeName(id)} badge!`);
        notifyEarned(id);
      }
    }
    writer.badge = badgeName(u.currentBadge);
    if (u.currentBadge !== before) {
      // A rank-up: say what it unlocked — in chat, on the toast, and as an
      // inbox note the writer can find again once the toast is gone.
      const newTiers = u.badges.filter((id) => !tiersBefore.has(id));
      const unlocks = rewardsForTiers(newTiers);
      const what = describeRewards(unlocks);
      announce(s, writer, `earned the ${writer.badge} badge!${what ? ` That unlocks ${what}.` : ""}`);
      notifyEarned(u.currentBadge, unlocks);
      // Every rank-up lands in the inbox — with the unlocks when it hands
      // any out, as a plain congratulation when it doesn't.
      if (!Array.isArray(u.inbox)) u.inbox = [];
      u.inbox.unshift(makeMsg("system", null,
        `🎉 You reached ${writer.badge}` + (what ? `, that unlocks ${what}.` : `! ${badgeDesc(u.currentBadge) || ""}`.trimEnd()) +
        (unlocks.themes.length ? " Find your new theme in the 🎨 menu at the foot of any page." : ""),
        { unlocks }));
    }
    saveStore();
  }

  // Keep the seat but mark it reclaimable; drop it for real after GHOST_MS.
  function markDisconnected(s, id) {
    const w = s.writers.get(id);
    if (!w) return;
    w.connected = false;
    dropDie(s, w.userId); // a die with nobody behind it leaves the table
    dropShip(s, w.userId); // and so does a Galaga battle
    dropCup(s, w.userId); //  ...and a milkshake
    dropBall(s, w.userId); //  ...and a disco ball
    dropPaint(s, w.userId); //  ...and a painting with no painter
    dropGun(s, w.userId); //  ...and a water gun
    dropCurse(s, w.userId); // a curse lifts when its victim leaves
    // The host leaving (closed tab, routed away) pauses a running game — the
    // clock freezes until they return or the stand-in host resumes.
    if (s.hostId === id && s.phase === "writing" && !s.paused) {
      s.paused = true;
      s.remaining = Math.max(0, s.deadline - Date.now());
      clearTimeout(s.timer);
      armIdleSleep(s);
      saveSnapshot(s);
      announce(s, w, "stepped away: game paused");
    }
    if (s.hostId === id) {
      const entries = [...s.writers.entries()];
      const next =
        entries.find(([, ww]) => ww.connected && ww.userId) ?? entries.find(([, ww]) => ww.connected);
      if (next) {
        s.hostId = next[0];
        pushPendingRequests(s); // the stand-in host inherits the open requests
      }
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
    } while (sessions.has(code) || storage.has("save", code));
    return code;
  }

  // Fill a session's ballot. Simple mode deals curated prompts; guided
  // (intermediate) mode assembles them from compatible clauses and keeps the
  // component ids in s.optionMeta so the vote card can show chips.
  // The other mode's ballot, kept while this one is on screen.
  function stashOptions(s) {
    (s.optionSets ||= {})[s.promptMode] = { options: [...s.options], optionMeta: [...(s.optionMeta || [])], votes: new Map(s.votes) };
  }
  function restoreOptions(s) {
    const set = s.optionSets?.[s.promptMode];
    if (!set) return false;
    s.options = [...set.options];
    s.optionMeta = [...set.optionMeta];
    // only votes from seats still at the table come back
    s.votes = new Map([...set.votes].filter(([id]) => s.writers.has(id)));
    return true;
  }
  function fillOptions(s, n = 4) {
    // a fresh deal supersedes whatever this mode had stashed
    if (s.optionSets) delete s.optionSets[s.promptMode];
    s.optionMeta = [];
    if (s.promptMode === "intermediate" && INTERMEDIATE) {
      const out = [];
      const recent = [];
      // Two tries per slot: a repeated place+situation+tropes combo gets one reroll.
      for (let i = 0; i < n; i++) {
        let r = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          r = generateIntermediatePrompt(INTERMEDIATE, { ...s.promptControls, recentIds: recent });
          const combo = [r.selections.placeId, r.selections.situationId, ...r.selections.tropeIds].join("|");
          if (!out.some((x) => x.combo === combo)) { r.combo = combo; break; }
        }
        if (out.some((x) => x.prompt === r.prompt)) continue;
        recent.push(...Object.values(r.selections).flat().filter((v) => typeof v === "string"));
        out.push(r);
      }
      s.options = out.map((r) => r.prompt);
      s.optionMeta = out.map((r) => ({ seed: r.seed, selections: r.selections, labels: r.labels }));
      if (s.options.length) return s.options;
    }
    const recent = [];
    s.options = [];
    for (let i = 0; i < n && i < PROMPT_BANK.length; i++) {
      const { prompt } = generateSimplePrompt(PROMPT_BANK, { recent });
      recent.push(prompt);
      s.options.push(prompt);
    }
    s.optionMeta = s.options.map(() => null);
    return s.options;
  }

  const currentId = (s) => s.turnOrder[s.currentIdx] ?? null;
  const names = (s) =>
    s.turnOrder.length
      ? s.turnOrder.map((id) => s.writers.get(id)?.name)
      : [...s.writers.values()].map((w) => w.name);

  // The scoreboard of a non-friendly game: words each account has committed
  // to THIS story (a line with no account is nobody's).
  // Total committed words in a story (every line, seated or not).
  const storyWords = (story) =>
    (story || []).reduce((n, l) => n + plainText(l.html).split(/\s+/).filter(Boolean).length, 0);
  function gameWords(s) {
    const words = new Map();
    for (const l of s.story || []) {
      if (!l.userId) continue;
      const n = plainText(l.html).split(/\s+/).filter(Boolean).length;
      words.set(l.userId, (words.get(l.userId) || 0) + n);
    }
    return words;
  }
  function roster(s) {
    const score = s.friendly === false ? gameWords(s) : null; // friendly games keep no score
    return [...s.writers.entries()].map(([id, w]) => ({
      id, name: w.name, color: w.color, badge: w.badge ?? null,
      avatar: w.avatar ?? "", avatarFit: w.avatarFit ?? "cover",
      isHost: id === s.hostId, connected: w.connected !== false,
      userId: w.userId ?? null, // gimmick relays already speak userId (the curse targets by it)
      ...(score ? { words: score.get(w.userId) || 0 } : {}),
    }));
  }
  const broadcastRoster = (s) =>
    io.to(s.code).emit("roster", { writers: roster(s), code: s.code, name: s.name || "", cover: s.cover || "", hostUserId: s.hostUserId ?? null });

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

  // Who writes after the current writer: the next CONNECTED seat around the
  // circle (ghosts are skipped exactly as startTurn would skip them).
  function nextUpId(s) {
    if (s.phase !== "writing" || s.turnOrder.length < 2) return null;
    for (let i = 1; i < s.turnOrder.length; i++) {
      const id = s.turnOrder[(s.currentIdx + i) % s.turnOrder.length];
      if (s.writers.get(id)?.connected !== false) return id;
    }
    return null;
  }
  function broadcastGame(s) {
    const curId = currentId(s);
    io.to(s.code).emit("game-state", {
      code: s.code,
      name: s.name || "",
      cover: s.cover || "",
      phase: s.phase,
      options: s.phase === "choosing" ? s.options : [],
      optionMeta: s.phase === "choosing" ? s.optionMeta || [] : [],
      promptMode: s.promptMode || "simple",
      promptControls: s.promptControls || cleanPromptControls(),
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
      turnOrder: s.phase === "writing" || s.phase === "over" ? s.turnOrder : [],
      nextId: nextUpId(s),
      hostId: s.hostId,
      hostName: s.writers.get(s.hostId)?.name ?? null,
      hostUserId: s.hostUserId ?? null, // the ORIGINAL host, who may always continue
      spectators: spectatorCount(s),
      // what SOMEONE at the table has unlocked (the menu shows 🔓 on those)
      tableGimmicks: s.friendly === false ? GIMMICK_IDS.filter((id) => tableHasGimmick(s, id)) : [],
    });
  }

  // A paused writing game that sits idle this long ends itself with a reveal.
  // Nothing is lost: the snapshot survives and the host can continue-writing
  // from the archive any time. (Env override keeps the tests fast.)
  // A live game with NO ACTIVITY for 30 minutes goes to SLEEP — paused or
  // not: nobody wrote, typed, chatted, voted, joined or touched the rules —
  // rather than being revealed. Sleep = snapshot to disk, everyone in the
  // room told (`game-slept`), the session unloaded; the dashboard shows it
  // as "Wake it up" and the first rejoin revives it (loadSession) paused.
  // Turns advancing on their own are NOT activity — a timed game nobody is
  // writing in is exactly the idle case. touch(s) is called on every real
  // action; COWRITE_IDLE_SLEEP_MS (or the older COWRITE_IDLE_END_MS) shrinks
  // the window for tests.
  const IDLE_SLEEP_MS = Number(process.env.COWRITE_IDLE_SLEEP_MS || process.env.COWRITE_IDLE_END_MS) || 30 * 60_000;
  function armIdleSleep(s) {
    clearTimeout(s.idleTimer);
    if (s.phase === "over") return;
    s.idleTimer = setTimeout(() => {
      if (!sessions.has(s.code) || s.phase === "over") return;
      sleepGame(s, null, `, no one's written for ${Math.round(IDLE_SLEEP_MS / 60_000)} minutes, so the story went to sleep. Wake it up any time from the dashboard.`);
    }, IDLE_SLEEP_MS);
  }
  const touch = (s) => s && armIdleSleep(s);
  function sleepGame(s, by, line) {
    if (!sessions.has(s.code)) return false;
    if (s.phase === "writing" && !s.paused) {
      s.paused = true;
      s.remaining = s.turnSeconds ? Math.max(0, s.deadline - Date.now()) || s.turnSeconds * 1000 : 0;
    }
    clearTimeout(s.timer);
    clearTimeout(s.idleTimer);
    announce(s, by ? { name: by.username, color: cleanColor(by.color) } : (s.writers.get(s.hostId) ?? { name: s.hostName }), line);
    saveSnapshot(s);
    io.to(s.code).emit("game-slept", { code: s.code, name: s.name || "", by: by?.username ?? null });
    for (const w of s.writers.values()) clearTimeout(w.ghostTimer);
    for (const uid of [...(s.dice?.keys() ?? [])]) dropDie(s, uid);
    for (const uid of [...(s.ships?.keys() ?? [])]) dropShip(s, uid);
    for (const uid of [...(s.cups?.keys() ?? [])]) dropCup(s, uid);
    for (const uid of [...(s.balls?.keys() ?? [])]) dropBall(s, uid);
    for (const uid of [...(s.paint?.keys() ?? [])]) dropPaint(s, uid);
    for (const uid of [...(s.guns?.keys() ?? [])]) dropGun(s, uid);
    for (const uid of [...(s.curses?.keys() ?? [])]) dropCurse(s, uid);
    sessions.delete(s.code);
    return true;
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
    if (!s.idleTimer) armIdleSleep(s); // a game that never saw activity still has a clock on it
    s.paused = false;
    s.remaining = 0;
    s.stealScore = 0; // a fresh turn wipes the stacked-steal ledger
    s.stealBy = "";
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
    dropDie(s, s.writers.get(id)?.userId);
    dropShip(s, s.writers.get(id)?.userId);
    dropCup(s, s.writers.get(id)?.userId);
    dropBall(s, s.writers.get(id)?.userId);
    dropPaint(s, s.writers.get(id)?.userId);
    dropGun(s, s.writers.get(id)?.userId);
    dropCurse(s, s.writers.get(id)?.userId);
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
    }
    if (wasHost) {
      // The acting-host role moves so the game stays controllable, but the
      // ORIGINAL host keeps true-host rights forever (s.hostToken/hostUserId
      // never change) — nobody can hijack a story from its first host.
      pushPendingRequests(s);
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
    if (w.token === s.hostToken || (w.userId != null && w.userId === s.hostUserId) || !s.writers.has(s.hostId)) s.hostId = sock.id;
    sock.data.joinedCode = s.code;
    joinAsWriter(sock, s);
    ack?.({ ok: true, code: s.code, hostId: s.hostId, name: w.name, color: w.color, phase: s.phase, token: w.token });
    if (s.phase === "waiting") broadcastRoster(s);
    else if (s.phase === "over") {
      broadcastRoster(s); // everyone learns the (possibly restored) hostId
      sock.emit("game-over", { prompt: s.prompt, story: s.story });
    } else broadcastGame(s);
    if (s.hostId === sock.id) pushPendingRequests(s);
  }

  // Open join requests must survive host churn: whenever the host role lands
  // on a socket (refresh, reclaim, handoff), replay every pending request so
  // the notification stays up until the host accepts or denies it.
  function pushPendingRequests(s) {
    const hostSock = io.sockets.sockets.get(s.hostId);
    if (!hostSock) return;
    for (const [id, req] of s.pending)
      hostSock.emit("join-request", { id, name: req.name, returning: !!req.seatOldId });
  }

  // In a gated (continued) game with a host present, a returning seat that
  // hasn't been re-approved yet becomes a pending request instead of seating.
  function gateOrSeat(sock, s, oldId, w, ack) {
    const hostConnected = io.sockets.sockets.has(s.hostId) && s.writers.get(s.hostId)?.connected;
    // the true host by device token OR by account: a host who continues a
    // story from another device (or after a save that predates their token)
    // must never be asked to let themselves in
    const isTrueHost = w.token === s.hostToken || (w.userId != null && w.userId === s.hostUserId);
    const isMod = isAdmin(store.users.find((u) => u.id === w.userId));
    if (s.gated && !w.approved && !isTrueHost && !isMod && hostConnected) {
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
      const code = makeCode();
      const host = newWriter(acct);
      const s = {
        // Every story has a name from the start: a random one, ≤40 chars,
        // until the host renames it — so nothing is ever listed as a bare code.
        code, name: randomTitle(TITLE_BANK), cover: "", hostId: socket.id, hostToken: host.token,
        hostUserId: acct.id, hostName: acct.username, // the ORIGINAL host, forever
        createdAt: Date.now(), tags: [], // tags: curation for the all-stories page (empty for now)
        friendly: true, // story mode: friendly (default) vs non-friendly
        phase: "waiting",
        writers: new Map([[socket.id, host]]),
        turnOrder: [], currentIdx: 0, turnCount: 0, maxTurns: null,
        story: [], prompt: "", options: [], optionMeta: [], votes: new Map(),
        promptMode: "simple", promptControls: cleanPromptControls(),
        turnSeconds: 60, deadline: 0, paused: false, remaining: 0, timer: null, chat: [], lastTyping: "",
        pending: new Map(), // join requests awaiting host approval
        denied: new Map(), // denyKey -> retry-after timestamp (5-min cooldown)
      };
      sessions.set(code, s);
      socket.data.joinedCode = code;
      joinAsWriter(socket, s);
      ack?.({ ok: true, code, hostId: socket.id, token: s.writers.get(socket.id).token, name: s.name });
      broadcastRoster(s);
      saveSnapshot(s); // the code is claimable/revivable from the moment it exists
    });

    // Moderator rights, resolved from the seat's account (or a raw auth token
    // before a seat exists). Admins are a fixed list of emails in store.js —
    // no request can grant it, so this only ever reads what's already true.
    const adminSeat = (s, sockId) => {
      const w = s?.writers.get(sockId);
      return !!w && isAdmin(store.users.find((u) => u.id === w.userId));
    };

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
      // The ORIGINAL host with no seat left (an old save, a seat that was
      // removed) is still the host: seated straight in, never gated.
      const isOrigHost = s.hostUserId != null && acct.id === s.hostUserId;
      if (s.phase !== "waiting" && !isAdmin(acct) && !isOrigHost) {
        // Started games are gated: a NEW writer needs the host to let them in.
        // Admins are the exception — moderating a game means getting into it.
        const hostSock = io.sockets.sockets.get(s.hostId);
        if (!hostSock)
          return ack?.({ ok: false, error: "This game has already started and its host isn't here to let you in." });
        const coolMsg = checkDenied(s, acct.id);
        if (coolMsg) return ack?.({ ok: false, error: coolMsg });
        s.pending.set(socket.id, { auth, name: acct.username, key: acct.id });
        socket.data.pendingCode = code;
        hostSock.emit("join-request", { id: socket.id, name: acct.username });
        return ack?.({ ok: true, pending: true });
      }
      const w = newWriter(acct);
      w.approved = true;
      s.writers.set(socket.id, w);
      if (isOrigHost) { s.hostId = socket.id; s.hostToken = w.token; }
      if (s.phase === "choosing" || s.phase === "writing") s.turnOrder.push(socket.id);
      socket.data.joinedCode = code;
      joinAsWriter(socket, s);
      ack?.({ ok: true, code, hostId: s.hostId, name: w.name, color: w.color, phase: s.phase, token: w.token });
      if (s.phase === "waiting") broadcastRoster(s);
      else if (s.phase === "over") {
        broadcastRoster(s);
        socket.emit("game-over", { prompt: s.prompt, story: s.story });
      } else broadcastGame(s);
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

    socket.on("start-game", ({ turnSeconds, rounds, friendly, promptMode, promptControls }, ack) => {
      const s = mySession();
      if (!s || s.hostId !== socket.id) return ack?.({ ok: false, error: "Only the host can start." });
      if (s.writers.size < 1) return ack?.({ ok: false, error: "Need at least one writer." });
      const writeMore = !!s.prompt && s.story.length > 0; // a reopened story keeps its lines
      s.phase = "choosing";
      s.turnOrder = [...s.writers.keys()];
      s.currentIdx = 0;
      s.turnCount = 0;
      if (!writeMore) s.story = [];
      s.votes.clear();
      if (friendly != null) s.friendly = !!friendly;
      s.turnSeconds = cleanSeconds(turnSeconds, 60);
      const r = Number(rounds);
      s.maxTurns = r > 0 ? r * s.turnOrder.length : null;
      if (promptMode != null) s.promptMode = cleanPromptMode(promptMode);
      if (promptControls != null) s.promptControls = cleanPromptControls(promptControls);
      if (writeMore) {
        // "Write more": this lobby was gathered to CONTINUE a finished story —
        // the prompt and every line are kept, no vote, straight to the pen.
        s.phase = "writing";
        ack?.({ ok: true });
        announce(s, s.writers.get(socket.id), "picked the story back up");
        saveSnapshot(s);
        inviteContributors(s);
        return startTurn(s);
      }
      fillOptions(s);
      ack?.({ ok: true });
      announce(s, s.writers.get(socket.id), "started the game");
      broadcastGame(s);
      saveSnapshot(s);
    });

    socket.on("vote", ({ prompt }, ack) => {
      const s = mySession();
      if (!s || s.phase !== "choosing" || !s.options.includes(prompt)) return ack?.({ ok: false });
      touch(s);
      s.votes.set(socket.id, prompt);
      if (s.votes.size >= connectedCount(s)) return finalizeVote(s);
      broadcastGame(s);
      ack?.({ ok: true });
    });

    socket.on("shuffle-options", (_, ack) => {
      const s = mySession();
      if (!s || s.hostId !== socket.id || s.phase !== "choosing") return ack?.({ ok: false });
      fillOptions(s);
      s.votes.clear();
      broadcastGame(s);
      ack?.({ ok: true });
    });

    // Host-only: redeal ONE option, in the mode that is set, keeping the rest
    // of the ballot. Votes cast for the replaced option are dropped.
    socket.on("reroll-option", ({ index } = {}, ack) => {
      const s = mySession();
      const i = Number(index);
      if (!s || s.hostId !== socket.id || s.phase !== "choosing" || !Number.isInteger(i) || i < 0 || i >= s.options.length)
        return ack?.({ ok: false });
      // a hand-written scenario is somebody's words: it can be removed, never redealt
      if (s.optionMeta?.[i]?.custom) return ack?.({ ok: false, error: "A custom scenario can't be rerolled." });
      const old = s.options[i];
      let next = null, meta = null;
      for (let attempt = 0; attempt < 8 && (next == null || s.options.includes(next)); attempt++) {
        if (s.promptMode === "intermediate" && INTERMEDIATE) {
          const r = generateIntermediatePrompt(INTERMEDIATE, { ...s.promptControls });
          next = r.prompt; meta = { seed: r.seed, selections: r.selections, labels: r.labels };
        } else {
          next = generateSimplePrompt(PROMPT_BANK, { recent: s.options }).prompt; meta = null;
        }
      }
      if (next == null || s.options.includes(next)) return ack?.({ ok: false, error: "Nothing new to deal." });
      s.options[i] = next;
      (s.optionMeta ||= [])[i] = meta;
      for (const [sid, v] of s.votes) if (v === old) s.votes.delete(sid);
      broadcastGame(s);
      ack?.({ ok: true });
    });

    // Host-only: switch the generator mode (simple ↔ guided) or retune the
    // guided controls. Either way the ballot is redealt and votes reset.
    // Each mode keeps its own dealt ballot: switching modes stashes the set
    // on screen (options, components, votes) under the mode it belongs to
    // and brings back the other mode's set if there is one, so flipping
    // Simple ⇄ Advanced and back loses nothing. Only a knob change (the same
    // mode with new controls) or a reroll deals afresh — and a reroll in one
    // mode leaves the other mode's set alone.
    socket.on("set-prompt-mode", ({ mode, controls }, ack) => {
      const s = mySession();
      if (!s || s.hostId !== socket.id || s.phase !== "choosing") return ack?.({ ok: false });
      const nextMode = mode != null ? cleanPromptMode(mode) : s.promptMode;
      const nextControls = controls != null ? cleanPromptControls({ ...s.promptControls, ...controls }) : s.promptControls;
      const modeChanged = nextMode !== s.promptMode;
      const knobsChanged = JSON.stringify(nextControls) !== JSON.stringify(s.promptControls);
      if (modeChanged) {
        stashOptions(s);
        s.promptMode = nextMode;
        s.promptControls = nextControls;
        if (!restoreOptions(s)) { fillOptions(s); s.votes.clear(); }
      } else if (knobsChanged) {
        s.promptControls = nextControls;
        fillOptions(s);
        s.votes.clear();
      }
      broadcastGame(s);
      ack?.({ ok: true, mode: s.promptMode, controls: s.promptControls });
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
      // a hand-written scenario has no components; it is tagged with its
      // author so the page can offer THEM a Remove and nobody a reroll
      (s.optionMeta ||= []).push({ custom: true, by: s.writers.get(socket.id)?.userId ?? null });
      broadcastGame(s);
      ack?.({ ok: true });
    });

    // A hand-written scenario can be withdrawn by whoever wrote it (or the
    // host / an admin); votes on it are dropped with it.
    socket.on("remove-prompt", ({ index } = {}, ack) => {
      const s = mySession();
      const i = Number(index);
      if (!s || s.phase !== "choosing" || !Number.isInteger(i) || i < 0 || i >= s.options.length) return ack?.({ ok: false });
      const meta = s.optionMeta?.[i];
      if (!meta?.custom) return ack?.({ ok: false, error: "Only a hand-written scenario can be removed." });
      const me = s.writers.get(socket.id);
      const mine = me?.userId != null && me.userId === meta.by;
      if (!mine && s.hostId !== socket.id && !adminSeat(s, socket.id)) return ack?.({ ok: false, error: "Not yours to remove." });
      const old = s.options[i];
      s.options.splice(i, 1);
      s.optionMeta.splice(i, 1);
      for (const [sid, v] of s.votes) if (v === old) s.votes.delete(sid);
      broadcastGame(s);
      ack?.({ ok: true });
    });

    // Relay the current writer's in-progress line to everyone else, live.
    socket.on("typing", ({ text }) => {
      const s = mySession();
      if (!s || s.phase !== "writing" || s.paused) return;
      if (currentId(s) !== socket.id) return;
      touch(s);
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
      if ((!line.userId || line.userId !== w.userId) && !adminSeat(s, socket.id))
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
      if ((!line.userId || line.userId !== w.userId) && !adminSeat(s, socket.id))
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
      touch(s);
      advance(s, s.writers.get(socket.id), text);
      ack?.({ ok: true });
    });

    // Host can name the session; the name shows at the top for everyone.
    // The host hands the game to another seated writer — for good: the
    // ORIGINAL-host rights (hostToken/hostUserId/hostName) move with the role,
    // so the new host may delete the story, continue it from anywhere, and is
    // never gated out of it; the old host becomes an ordinary writer.
    socket.on("make-host", ({ id }, ack) => {
      const s = mySession();
      if (!s || (s.hostId !== socket.id && !adminSeat(s, socket.id)))
        return ack?.({ ok: false, error: "Host only." });
      const w = s.writers.get(String(id || ""));
      if (!w || w.connected === false) return ack?.({ ok: false, error: "Pick a writer who is in the game." });
      if (id === s.hostId) return ack?.({ ok: false, error: "They already host." });
      const from = s.writers.get(socket.id);
      s.hostId = id;
      s.hostToken = w.token;
      s.hostUserId = w.userId ?? s.hostUserId;
      s.hostName = w.name;
      w.approved = true;
      announce(s, from, `made ${w.name} the host 👑`);
      saveSnapshot(s);
      if (s.phase === "waiting" || s.phase === "over") broadcastRoster(s);
      if (s.phase !== "waiting") broadcastGame(s);
      pushPendingRequests(s);
      ack?.({ ok: true, hostId: s.hostId });
    });

    socket.on("rename-session", ({ name }, ack) => {
      const s = mySession();
      if (!s || (s.hostId !== socket.id && !adminSeat(s, socket.id)))
        return ack?.({ ok: false, error: "Host only." });
      s.name = stripTags(String(name || "")).slice(0, 40).trim();
      if (s.phase === "waiting" || s.phase === "over") broadcastRoster(s);
      if (s.phase !== "waiting") broadcastGame(s);
      saveSnapshot(s);
      ack?.({ ok: true, name: s.name });
    });

    // Host can link a header image (a URL, never an upload); it becomes the
    // story's cover thumbnail on the dashboard and archive. http/https only —
    // the same trust rule as profile links, since it lands in a style attr.
    socket.on("set-cover", ({ url }, ack) => {
      const s = mySession();
      if (!s || s.hostId !== socket.id) return ack?.({ ok: false, error: "Host only." });
      const v = String(url || "").trim().slice(0, 500);
      if (v && !httpUrl(v)) return ack?.({ ok: false, error: "That link must start with http:// or https://" });
      s.cover = v;
      if (s.phase === "waiting" || s.phase === "over") broadcastRoster(s);
      if (s.phase !== "waiting") broadcastGame(s);
      saveSnapshot(s);
      ack?.({ ok: true, cover: s.cover });
    });

    socket.on("pause-game", (_, ack) => {
      const s = mySession();
      if (!s || s.hostId !== socket.id || s.phase !== "writing" || s.paused) return ack?.({ ok: false });
      s.paused = true;
      s.remaining = Math.max(0, s.deadline - Date.now());
      clearTimeout(s.timer);
      touch(s);
      saveSnapshot(s);
      broadcastGame(s);
      ack?.({ ok: true });
    });

    // Host can retune mid-game: a new turn length applies from the next turn
    // (the running clock is untouched); added rounds extend maxTurns, and give
    // an endless game a finish line turnCount + extra turns away.
    socket.on("update-rules", ({ turnSeconds, addRounds, friendly, endless }, ack) => {
      const s = mySession();
      if (!s || s.hostId !== socket.id || s.phase !== "writing") return ack?.({ ok: false });
      if (friendly != null) s.friendly = !!friendly;
      if (s.friendly) {
        for (const uid of [...(s.dice?.keys() ?? [])]) dropDie(s, uid); // friendly again: dice away
        for (const uid of [...(s.ships?.keys() ?? [])]) dropShip(s, uid); // and the arcade closes
        for (const uid of [...(s.cups?.keys() ?? [])]) dropCup(s, uid); // and Scoops Ahoy shuts
        for (const uid of [...(s.balls?.keys() ?? [])]) dropBall(s, uid); // and the rink goes dark
        for (const uid of [...(s.paint?.keys() ?? [])]) dropPaint(s, uid); // and the art room closes
        for (const uid of [...(s.guns?.keys() ?? [])]) dropGun(s, uid); // and the water dries
        for (const uid of [...(s.curses?.keys() ?? [])]) dropCurse(s, uid); // and every curse lifts
      }
      if (endless) s.maxTurns = null; // ♾ the story loses its finish line
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
    // Who may continue a revealed story: the same authority that may END one
    // (the acting host, an admin), the ORIGINAL host by account, and — when
    // no connected seat holds the host role at all (the host was dropped
    // and the acting host has since left) — whichever seated writer asks,
    // who becomes acting host. Otherwise a story could be ended by an acting
    // host and then be continuable by nobody in the room.
    function mayContinue(s, sock) {
      if (s.hostId === sock.id || adminSeat(s, sock.id)) return true;
      const w = s.writers.get(sock.id);
      if (!w) return false;
      if (w.userId != null && w.userId === s.hostUserId) return true;
      return !s.writers.get(s.hostId)?.connected;
    }
    socket.on("continue-writing", ({ turnSeconds, rounds, friendly }, ack) => {
      const s = mySession();
      if (!s || s.phase !== "over" || !mayContinue(s, socket)) return ack?.({ ok: false });
      s.hostId = socket.id; // whoever continues drives the continued game
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
      saveSnapshot(s); // the archive reads snapshots: a continued story must not stay listed as over
      inviteContributors(s);
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
      touch(s);
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

    // Host or admin: a moderator can wrap up any game they're sitting in.
    socket.on("end-game", (_, ack) => {
      const s = mySession();
      if (!s || (s.hostId !== socket.id && !adminSeat(s, socket.id))) return ack?.({ ok: false });
      if (s.phase === "over") return ack?.({ ok: false });
      endGame(s);
      ack?.({ ok: true });
    });

    socket.on("chat", ({ text, name }) => {
      const code = socket.data.joinedCode || socket.data.spectating;
      const s = sessions.get(code);
      if (!s || !text || !String(text).trim()) return;
      touch(s);
      const w = socket.data.joinedCode ? s.writers.get(socket.id) : null;
      const body = String(text).slice(0, 500).trim();
      const msg = w
        ? {
            id: socket.id, // lets clients tell their own echo from others' messages (sounds)
            name: w.name, color: w.color, badge: w.badge ?? null,
            avatar: w.avatar ?? "", avatarFit: w.avatarFit ?? "cover",
            host: socket.id === s.hostId, text: body, ts: Date.now(),
          }
        : (() => {
            // a spectator: their own name, stripped, in a colour hashed from it
            const specName = String(name || "").replace(/<[^>]*>/g, "").slice(0, 28).trim() || "Spectator";
            return { id: socket.id, name: specName, color: specColor(specName), spec: true, text: body, ts: Date.now() };
          })();
      s.chat.push(msg);
      if (s.chat.length > CHAT_LIMIT) s.chat.shift();
      io.to(s.code).emit("chat", msg);
    });

    // Poking the editor / Add line while the game is paused earns a special
    // badge, exactly once. Purely behavioral — no words involved.
    socket.on("paused-poke", () => {
      const s = mySession();
      if (!s || s.phase !== "writing" || !s.paused) return;
      const w = s.writers.get(socket.id);
      if (!w?.userId) return;
      const u = store.users.find((x) => x.id === w.userId);
      if (!u || u.badges.includes("resumeitstupid")) return;
      u.badges.push("resumeitstupid");
      saveStore();
      announce(s, w, `earned the ${badgeName("resumeitstupid")} badge!`);
      io.to(s.code).emit("badge-earned", {
        badge: badgeName("resumeitstupid"), desc: badgeDesc("resumeitstupid"),
        name: w.name, color: w.color,
      });
    });

    // Spectator chat: open to spectators AND writers, visible to the whole
    // session room. Spectator names are client-minted (Stranger Things list +
    // number, localStorage) so they're stripped/limited here; colors come from
    // the palette by name hash. Never persisted — in-memory ring only.

    // Watch a running story WITHOUT a seat (no account needed). Spectators
    // join the broadcast room but hold no writer entry, so every game action
    // (vote, submit, chat, host controls) no-ops for them — mySession() is
    // keyed by joinedCode, which spectators never get.
    // ---- Gimmicks (see lib/gimmicks.js) ----
    // A die on the table is shown to EVERYONE — that's the distraction. The
    // owner reports it (`on: true` + where it sits, as fractions of their
    // screen; throttled client-side) or puts it away (`on: false`); the room
    // gets `gimmick-die {userId, name, color, x, y, on}` and paints it.
    socket.on("gimmick-die", ({ on, x, y } = {}) => {
      const s = mySession();
      const w = s?.writers.get(socket.id);
      if (!s || !w) return;
      if (on === false) return dropDie(s, w.userId);
      if (s.friendly !== false) return;
      const fx = Math.max(0, Math.min(1, Number(x) || 0)), fy = Math.max(0, Math.min(1, Number(y) || 0));
      s.dice ??= new Map();
      s.dice.set(w.userId, { name: w.name, color: w.color, x: fx, y: fy });
      io.to(s.code).emit("gimmick-die", { userId: w.userId, name: w.name, color: w.color, x: fx, y: fy, on: true });
    });
    // One event: throw the die. The server rolls, calls it in chat, and on a
    // natural 20 mid-writing hands the turn to the roller — the interrupted
    // writer's unsent line is gone (that's the distraction). Only in a
    // non-friendly game, only from a seat, only when the table has the rank.
    // `steal: false` is the roller's opt-out: a natural 20 is still called
    // in chat, but the turn stays where it is.

    // A stolen turn carries the victim's unsent line into the thief's editor:
    // whatever the interrupted writer had typed, with an italic note naming
    // the theft, becomes the thief's live text. Call AFTER startTurn() (which
    // wipes lastTyping): the thief's socket gets `steal-carry`, everyone else a
    // live-typing preview, so the ledger and every screen agree.
    const escName = (t) => String(t || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    function carryStolen(s, thiefSocket, thief, victim, stolenRaw) {
      const note = `<i>[- <b>${escName(thief?.name)}</b> stole from <b>${escName(victim)}</b> ]</i>`;
      const raw = (stolenRaw || "").trim() ? `${stolenRaw} ${note}` : note;
      s.lastTypingRaw = raw;
      s.lastTyping = sanitizeRich(raw);
      thiefSocket.emit("steal-carry", { html: s.lastTyping });
      thiefSocket.to(s.code).emit("live-typing", { html: s.lastTyping });
    }

    socket.on("gimmick-roll", ({ id, steal } = {}, ack) => {
      const s = mySession();
      const w = s?.writers.get(socket.id);
      if (!s || !w) return ack?.({ ok: false, error: "You're not seated in a game." });
      if (s.friendly !== false) return ack?.({ ok: false, error: "This is a friendly game, gimmicks are off." });
      const gid = cleanGimmickId(id ?? "d20");
      if (!gid) return ack?.({ ok: false, error: "Unknown gimmick." });
      if (!tableHasGimmick(s, gid)) return ack?.({ ok: false, error: "Nobody at this table has unlocked that gimmick yet." });
      const now = Date.now();
      s.gimmickRolls ??= new Map(); // userId -> last roll timestamp (never on the wire)
      if (now - (s.gimmickRolls.get(w.userId) ?? 0) < ROLL_MS) return ack?.({ ok: false, error: "Still rolling…" });
      s.gimmickRolls.set(w.userId, now);
      touch(s);
      const outcome = rollOutcome(rollDie());
      // The steal: writing, not paused, and it isn't already their turn.
      let stole = false, from = "";
      const declined = outcome.steal && steal === false;
      if (outcome.steal && !declined && s.phase === "writing" && !s.paused && currentId(s) !== socket.id) {
        const idx = s.turnOrder.indexOf(socket.id);
        if (idx !== -1) {
          from = s.writers.get(currentId(s))?.name ?? "";
          s.currentIdx = idx;
          stole = true;
        }
      }
      const stolenRaw = stole ? s.lastTypingRaw : "";
      announce(s, w, describeRoll(outcome, { stole, from, declined }), { chime: outcome.kind === "crit" });
      io.to(s.code).emit("gimmick-roll", { userId: w.userId, name: w.name, color: w.color, value: outcome.value, kind: outcome.kind, stole });
      if (stole) {
        startTurn(s); // re-broadcasts game-state with the new current writer
        carryStolen(s, socket, w, from, stolenRaw);
      }
      ack?.({ ok: true, value: outcome.value, kind: outcome.kind, stole });
    });
    // A Galaga battle in progress (components/galaga-game.js): the player
    // reports their ship, live shots and fleet as fractions of their own
    // screen (throttled client-side, exactly like gimmick-die); the server
    // clamps and relays so the whole table — spectators too — watches every
    // battle over the live game. The SCORE here is display-only; the one that
    // counts arrives at the end via gimmick-galaga.
    socket.on("gimmick-ship", ({ on, x, score, shots, bees } = {}) => {
      const s = mySession();
      const w = s?.writers.get(socket.id);
      if (!s || !w) return;
      if (on === false) return dropShip(s, w.userId);
      if (s.friendly !== false) return;
      const fr = (v) => Math.max(0, Math.min(1, Number(v) || 0));
      const ship = {
        name: w.name,
        color: w.color,
        x: fr(x),
        score: Math.max(0, Math.min(GALAGA_MAX_SCORE, Math.floor(Number(score) || 0))),
        shots: (Array.isArray(shots) ? shots.slice(0, 4) : []).map((p) => [fr(p?.[0]), fr(p?.[1])]),
        // the 4th slot is a stable per-bee id (see galaga-game.js: viewers key
        // bees by it so a kill explodes the right one instead of reshuffling)
        bees: (Array.isArray(bees) ? bees.slice(0, 10) : []).map((p) => {
          const bee = [fr(p?.[0]), fr(p?.[1]), p?.[2] ? 1 : 0];
          const id = Number(p?.[3]);
          if (Number.isFinite(id)) bee.push(Math.max(0, Math.min(1e6, Math.floor(id))));
          return bee;
        }),
      };
      s.ships ??= new Map();
      s.ships.set(w.userId, ship);
      io.to(s.code).emit("gimmick-ship", { userId: w.userId, ...ship, on: true });
    });
    // A milkshake on the table (components/milkshake-spill.js): the owner
    // reports their cup — where it sits, how tipped it is, how much is left —
    // as fractions/degrees, throttled client-side; the server clamps and
    // relays, and EVERY viewer simulates the spill from that stream, so the
    // mess runs down everyone's screen without a single drop on the wire.
    socket.on("gimmick-cup", ({ on, x, y, rot, level } = {}) => {
      const s = mySession();
      const w = s?.writers.get(socket.id);
      if (!s || !w) return;
      if (on === false) return dropCup(s, w.userId);
      if (s.friendly !== false) return;
      const fr = (v) => Math.max(0, Math.min(1, Number(v) || 0));
      const cup = {
        name: w.name,
        color: w.color,
        x: fr(x),
        y: fr(y),
        rot: Math.max(-90, Math.min(90, Number(rot) || 0)),
        level: fr(level),
      };
      s.cups ??= new Map();
      s.cups.set(w.userId, cup);
      io.to(s.code).emit("gimmick-cup", { userId: w.userId, ...cup, on: true });
    });
    // Tipping the cup right over is worth calling in the chat — once per
    // cooldown, so a mashed pour can't flood it. No steal, no chime: the
    // milkshake is pure distraction.
    socket.on("gimmick-pour", (_payload, ack) => {
      const s = mySession();
      const w = s?.writers.get(socket.id);
      if (!s || !w) return ack?.({ ok: false, error: "You're not seated in a game." });
      if (s.friendly !== false) return ack?.({ ok: false, error: "This is a friendly game, gimmicks are off." });
      if (!tableHasGimmick(s, "milkshake")) return ack?.({ ok: false, error: "Nobody at this table has unlocked that gimmick yet." });
      const now = Date.now();
      s.gimmickPours ??= new Map();
      if (now - (s.gimmickPours.get(w.userId) ?? 0) < ROLL_MS) return ack?.({ ok: false, error: "Still dripping…" });
      s.gimmickPours.set(w.userId, now);
      touch(s);
      announce(s, w, "tipped a milkshake over the game 🥤");
      io.to(s.code).emit("gimmick-pour", { userId: w.userId, name: w.name, color: w.color });
      ack?.({ ok: true });
    });
    // A disco ball over the table (components/disco-ball.js): the owner
    // reports where their ball hangs as fractions, throttled client-side; the
    // server clamps and relays. The light show never touches the wire — it
    // starts from `gimmick-spin` and every viewer runs it locally.
    socket.on("gimmick-ball", ({ on, x, y } = {}) => {
      const s = mySession();
      const w = s?.writers.get(socket.id);
      if (!s || !w) return;
      if (on === false) return dropBall(s, w.userId);
      if (s.friendly !== false) return;
      const fr = (v) => Math.max(0, Math.min(1, Number(v) || 0));
      const ball = { name: w.name, color: w.color, x: fr(x), y: fr(y) };
      s.balls ??= new Map();
      s.balls.set(w.userId, ball);
      io.to(s.code).emit("gimmick-ball", { userId: w.userId, ...ball, on: true });
    });
    // Spinning the ball is worth calling in the chat — once per show (the
    // cooldown IS the show's length, so it can't restart mid-sweep). No steal,
    // no chime: the disco ball is pure distraction, like the milkshake.
    socket.on("gimmick-spin", (_payload, ack) => {
      const s = mySession();
      const w = s?.writers.get(socket.id);
      if (!s || !w) return ack?.({ ok: false, error: "You're not seated in a game." });
      if (s.friendly !== false) return ack?.({ ok: false, error: "This is a friendly game, gimmicks are off." });
      if (!tableHasGimmick(s, "disco")) return ack?.({ ok: false, error: "Nobody at this table has unlocked that gimmick yet." });
      const now = Date.now();
      s.gimmickSpins ??= new Map();
      if (now - (s.gimmickSpins.get(w.userId) ?? 0) < SPIN_COOLDOWN_MS) return ack?.({ ok: false, error: "The ball is still spinning…" });
      s.gimmickSpins.set(w.userId, now);
      touch(s);
      announce(s, w, "turned on the disco ball 🪩");
      io.to(s.code).emit("gimmick-spin", { userId: w.userId, name: w.name, color: w.color, duration: SPIN_MS });
      ack?.({ ok: true });
    });
    // Paint on the table (components/art-room.js): the painter streams their
    // brush cursor and the stroke IN PROGRESS (whole so far, replaced each
    // update; `live: false` commits it) as screen fractions, throttled
    // client-side. The server validates the color (#rrggbb or the seat's
    // own), clamps every point, caps points per stroke and strokes per
    // painter (oldest gives way), and relays — every viewer redraws the paint
    // on their own canvas, so no pixel ever crosses the wire. `on: false`
    // puts the brush away and the PAINT STAYS; `wipe: true` clears the
    // painter's own paint everywhere and keeps the brush out.
    socket.on("gimmick-stroke", ({ on, wipe, cursor, stroke, live } = {}) => {
      const s = mySession();
      const w = s?.writers.get(socket.id);
      if (!s || !w) return;
      if (on === false) {
        const p = s.paint?.get(w.userId);
        if (!p) return;
        p.on = false;
        p.live = null;
        io.to(s.code).emit("gimmick-stroke", { userId: w.userId, on: false });
        return;
      }
      if (wipe === true) {
        const p = s.paint?.get(w.userId);
        if (!p) return;
        p.strokes = [];
        p.live = null;
        io.to(s.code).emit("gimmick-stroke", { userId: w.userId, wipe: true, on: p.on !== false });
        return;
      }
      if (s.friendly !== false) return;
      // unlike a die's position, the stroke IS the visible effect — so the
      // rank gate holds here too (checked once, when the paint entry begins)
      if (!s.paint?.has(w.userId) && !tableHasGimmick(s, "artroom")) return;
      const fr = (v) => Math.max(0, Math.min(1, Number(v) || 0));
      s.paint ??= new Map();
      const p = s.paint.get(w.userId) ?? { strokes: [], live: null };
      p.name = w.name;
      p.color = w.color;
      p.on = true;
      s.paint.set(w.userId, p);
      const out = { userId: w.userId, name: w.name, color: w.color, on: true };
      if (Array.isArray(cursor)) {
        p.cursor = [fr(cursor[0]), fr(cursor[1])];
        out.cursor = p.cursor;
      }
      if (stroke && Array.isArray(stroke.pts) && stroke.pts.length) {
        const clean = {
          color: cleanHex(stroke.color) ?? w.color,
          size: Math.max(2, Math.min(40, Number(stroke.size) || 6)),
          pts: stroke.pts.slice(0, PAINT_MAX_PTS).map((pt) => [fr(pt?.[0]), fr(pt?.[1])]),
          ...(stroke.erase === true ? { erase: true } : {}),
        };
        if (live === false) {
          p.live = null;
          p.strokes.push(clean);
          while (p.strokes.length > PAINT_MAX_STROKES) p.strokes.shift();
        } else {
          p.live = clean;
        }
        out.stroke = clean;
        out.live = live !== false;
      }
      io.to(s.code).emit("gimmick-stroke", out);
    });
    // Taking the brush out is worth calling in the chat — once per cooldown,
    // so re-opening the art room can't flood it. No steal, no chime: the
    // paint is pure distraction, like the milkshake and the disco ball.
    socket.on("gimmick-paint", (_payload, ack) => {
      const s = mySession();
      const w = s?.writers.get(socket.id);
      if (!s || !w) return ack?.({ ok: false, error: "You're not seated in a game." });
      if (s.friendly !== false) return ack?.({ ok: false, error: "This is a friendly game, gimmicks are off." });
      if (!tableHasGimmick(s, "artroom")) return ack?.({ ok: false, error: "Nobody at this table has unlocked that gimmick yet." });
      const now = Date.now();
      s.gimmickPaints ??= new Map();
      if (now - (s.gimmickPaints.get(w.userId) ?? 0) < ROLL_MS) return ack?.({ ok: false, error: "The paint is still wet…" });
      s.gimmickPaints.set(w.userId, now);
      touch(s);
      announce(s, w, "is painting all over the game 🎨");
      io.to(s.code).emit("gimmick-paint", { userId: w.userId, name: w.name, color: w.color });
      ack?.({ ok: true });
    });
    // A water gun on the table (components/super-soaker.js): the owner
    // reports where it sits and where it points, throttled client-side; the
    // server clamps and relays. The water never touches the wire — a burst
    // starts from `gimmick-squirt` and every viewer simulates it locally
    // from the seed.
    socket.on("gimmick-gun", ({ on, x, y, angle } = {}) => {
      const s = mySession();
      const w = s?.writers.get(socket.id);
      if (!s || !w) return;
      if (on === false) return dropGun(s, w.userId);
      if (s.friendly !== false) return;
      const fr = (v) => Math.max(0, Math.min(1, Number(v) || 0));
      const gun = {
        name: w.name,
        color: w.color,
        x: fr(x),
        y: fr(y),
        angle: Math.max(-180, Math.min(180, Number(angle) || 0)),
      };
      s.guns ??= new Map();
      s.guns.set(w.userId, gun);
      io.to(s.code).emit("gimmick-gun", { userId: w.userId, ...gun, on: true });
    });
    // Firing is worth calling in the chat — once per cooldown, so a mashed
    // trigger can't flood it. No steal, no chime: the soak is pure
    // distraction, the milkshake's category.
    socket.on("gimmick-squirt", (_payload, ack) => {
      const s = mySession();
      const w = s?.writers.get(socket.id);
      if (!s || !w) return ack?.({ ok: false, error: "You're not seated in a game." });
      if (s.friendly !== false) return ack?.({ ok: false, error: "This is a friendly game, gimmicks are off." });
      if (!tableHasGimmick(s, "supersoaker")) return ack?.({ ok: false, error: "Nobody at this table has unlocked that gimmick yet." });
      const now = Date.now();
      s.gimmickSquirts ??= new Map();
      if (now - (s.gimmickSquirts.get(w.userId) ?? 0) < ROLL_MS) return ack?.({ ok: false, error: "Pump it up first…" });
      s.gimmickSquirts.set(w.userId, now);
      touch(s);
      const g = s.guns?.get(w.userId) ?? { x: 0.5, y: 0.5, angle: 0 };
      const seed = randomInt(1e6);
      announce(s, w, "soaked the game with the SuperSoaker 💦");
      io.to(s.code).emit("gimmick-squirt", { userId: w.userId, name: w.name, color: w.color, x: g.x, y: g.y, angle: g.angle, seed });
      ack?.({ ok: true });
    });
    // Vecna's curse (components/vecna-curse.js): placed on a PERSON. The
    // victim's screen greys under red mist while the clock chimes; typing
    // ~15 characters lifts it (their words are their Running Up That Hill),
    // else it expires on its own. One curse in flight per session, cosmetic
    // only — nothing is ever blocked.
    socket.on("gimmick-curse", ({ targetUserId } = {}, ack) => {
      const s = mySession();
      const w = s?.writers.get(socket.id);
      if (!s || !w) return ack?.({ ok: false, error: "You're not seated in a game." });
      if (s.friendly !== false) return ack?.({ ok: false, error: "This is a friendly game, gimmicks are off." });
      if (!tableHasGimmick(s, "curse")) return ack?.({ ok: false, error: "Nobody at this table has unlocked that gimmick yet." });
      const target = [...s.writers.values()].find((x) => x.userId === targetUserId);
      if (!target || target.connected === false) return ack?.({ ok: false, error: "That writer isn't at the table." });
      if (targetUserId === w.userId) return ack?.({ ok: false, error: "The curse wants someone ELSE." });
      if (s.curses?.size) return ack?.({ ok: false, error: "A curse is already in flight…" });
      const now = Date.now();
      s.gimmickCurses ??= new Map();
      if (now - (s.gimmickCurses.get(w.userId) ?? 0) < ROLL_MS) return ack?.({ ok: false, error: "The clock is still striking…" });
      s.gimmickCurses.set(w.userId, now);
      s.curses ??= new Map();
      const timer = setTimeout(() => {
        // it fades on its own; silent — the victim just wasn't saved this time
        if (s.curses?.delete(targetUserId)) io.to(s.code).emit("gimmick-curse", { targetUserId, lift: true });
      }, CURSE_HOLD_MS);
      s.curses.set(targetUserId, { by: w.userId, until: now + CURSE_HOLD_MS, timer });
      touch(s);
      announce(s, w, `placed Vecna's curse on ${target.name} 🕰️`, { chime: true });
      io.to(s.code).emit("gimmick-curse", {
        byName: w.name, byColor: w.color, targetUserId, targetName: target.name, duration: CURSE_HOLD_MS,
      });
      ack?.({ ok: true, duration: CURSE_HOLD_MS });
    });
    // The escape: only the CURSED seat may sing itself out, and the payoff
    // is called in chat for the whole table.
    socket.on("gimmick-uncurse", (_payload, ack) => {
      const s = mySession();
      const w = s?.writers.get(socket.id);
      if (!s || !w) return ack?.({ ok: false });
      const c = s.curses?.get(w.userId);
      if (!c) return ack?.({ ok: false, error: "No curse on you." });
      clearTimeout(c.timer);
      s.curses.delete(w.userId);
      announce(s, w, "wrote their way out of Vecna's curse ⏱");
      io.to(s.code).emit("gimmick-curse", { targetUserId: w.userId, lift: true });
      ack?.({ ok: true });
    });
    // A finished Galaga run (components/galaga-game.js): the run itself plays
    // on the player's own screen, only the final score comes here. Same gates
    // as a die roll, and beating GALAGA_TARGET steals the turn exactly like a
    // natural 20 (`steal: false` is the same opt-out — the score is still
    // called in chat, the turn stays put).
    socket.on("gimmick-galaga", ({ score, steal } = {}, ack) => {
      const s = mySession();
      const w = s?.writers.get(socket.id);
      if (!s || !w) return ack?.({ ok: false, error: "You're not seated in a game." });
      if (s.friendly !== false) return ack?.({ ok: false, error: "This is a friendly game, gimmicks are off." });
      if (!tableHasGimmick(s, "galaga")) return ack?.({ ok: false, error: "Nobody at this table has unlocked that gimmick yet." });
      const now = Date.now();
      s.gimmickRolls ??= new Map(); // shared cooldown ledger with the dice
      if (now - (s.gimmickRolls.get(w.userId) ?? 0) < ROLL_MS) return ack?.({ ok: false, error: "Catch your breath…" });
      s.gimmickRolls.set(w.userId, now);
      touch(s);
      const outcome = galagaOutcome(score);
      let stole = false, from = "", beaten = false;
      const declined = outcome.steal && steal === false;
      // Steals STACK: the first run past the target takes the turn, and a
      // later run this same turn only takes it away with a HIGHER score —
      // s.stealScore/.stealBy remember the run that holds the stolen turn
      // (startTurn clears them whenever the turn changes hands for real).
      if (outcome.steal && !declined && s.phase === "writing" && !s.paused && currentId(s) !== socket.id) {
        if (outcome.score <= (s.stealScore ?? 0)) {
          beaten = true;
        } else {
          const idx = s.turnOrder.indexOf(socket.id);
          if (idx !== -1) {
            from = s.writers.get(currentId(s))?.name ?? "";
            s.currentIdx = idx;
            stole = true;
          }
        }
      }
      const stolenRaw = stole ? s.lastTypingRaw : "";
      announce(s, w, describeGalaga(outcome, { stole, from, declined, beaten, by: s.stealBy ?? "" }), { chime: outcome.kind === "highscore" });
      io.to(s.code).emit("gimmick-galaga", { userId: w.userId, name: w.name, color: w.color, score: outcome.score, kind: outcome.kind, stole });
      if (stole) {
        startTurn(s);
        s.stealScore = outcome.score; // after startTurn — it resets the ledger
        s.stealBy = w.name;
        carryStolen(s, socket, w, from, stolenRaw);
      }
      ack?.({ ok: true, score: outcome.score, kind: outcome.kind, stole });
    });

    socket.on("spectate-session", ({ code }, ack) => {
      code = (code || "").toUpperCase().trim();
      const s = sessions.get(code) ?? loadSession(code);
      if (!s) return ack?.({ ok: false, error: "Game not found." });
      socket.data.spectating = code;
      socket.join(code);
      ack?.({ ok: true, code, phase: s.phase, name: s.name || "" });
      socket.emit("chat-history", s.chat); // the one table chat, for watchers too
      if (s.dice?.size) socket.emit("gimmick-dice", diceList(s));
      if (s.ships?.size) socket.emit("gimmick-ships", shipsList(s));
      if (s.cups?.size) socket.emit("gimmick-cups", cupsList(s));
      if (s.balls?.size) socket.emit("gimmick-balls", ballsList(s));
      if (s.paint?.size) socket.emit("gimmick-paints", paintsList(s));
      if (s.guns?.size) socket.emit("gimmick-guns", gunsList(s));
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

    // ---- Solo-write documents: who's looking, and live comments ----
    socket.on("doc-open", ({ auth, id }) => {
      const u = userByToken(auth);
      const doc = readDoc(id);
      if (!u || !doc || !canView(doc, u.id)) return;
      leaveDoc(socket);
      socket.data.docId = doc.id;
      socket.join(docRoom(doc.id));
      docViewers.set(socket.id, { docId: doc.id, userId: u.id });
      broadcastDocPresence(doc.id);
    });

    socket.on("doc-close", () => leaveDoc(socket));

    // Leaving a comment anchors it: the client sends the doc's html with ONE new
    // marker span wrapped around the commented words. Readers may not edit, and
    // this is the one path that lets their action touch the html at all — so the
    // guard is exact: strip the new anchor back out and what's left must equal
    // the stored html, byte for byte. Any smuggled edit fails that and is
    // dropped whole. `suggestion` (readers' edits, per comment mode) is the text
    // they propose for the anchored range; the author accepts or rejects it.
    socket.on("doc-comment", ({ auth, id, cid, html, text, suggestion }) => {
      const u = userByToken(auth);
      const doc = readDoc(id);
      // canComment, not canView: a public document is READ by anyone signed in,
      // but only the author and the invited beta readers may write on it — and
      // this is the one path where a non-owner's action touches the html.
      if (!u || !doc || !canComment(doc, u.id)) return;
      const body = stripTags(String(text ?? "")).slice(0, 1000);
      const suggest = suggestion == null ? null : stripTags(String(suggestion)).slice(0, 1000);
      if (!body && suggest == null) return; // a comment says something or proposes something
      if (!CID_RE.test(String(cid ?? ""))) return;
      if (anchorCids(doc.html).includes(cid)) return; // never reuse an anchor id
      const next = sanitizeDoc(String(html ?? ""));
      if (!anchorCids(next).includes(cid)) return; // the anchor has to be there
      // …and, for a BETA READER, the ONLY change may be that one anchor: no
      // words touched, no other underline added, moved or removed. We check the
      // invariant instead of a byte-for-byte echo of the stored html, because a
      // reader's editor re-serializes the html (span order, whitespace) subtly
      // differently than sanitizeDoc stored it, and a byte match silently
      // dropped every comment after the first once anything drifted. So: the
      // anchor set must be exactly the stored one plus this new cid, and with
      // every anchor stripped the two must be identical (same words, same
      // markup). The author is a different case — they may edit their own
      // document, so no such check applies to them.
      if (!canEdit(doc, u.id)) {
        const want = [...anchorCids(doc.html), cid].sort().join(",");
        const got = [...anchorCids(next)].sort().join(",");
        if (want !== got) return; // an anchor was added, moved or removed beyond this one
        if (stripAnchors(next) !== stripAnchors(doc.html)) return; // words/markup changed
      }
      doc.html = next;
      doc.comments = [...(doc.comments || []), {
        id: randomUUID(), cid,
        quote: anchorText(next, cid).slice(0, 200),
        userId: u.id, text: body, suggestion: suggest,
        ts: Date.now(), resolved: false, accepted: false,
      }];
      writeDoc(doc);
      // Skip only the AUTHOR (a live editor whose caret a re-render would move);
      // a beta reader has no unsaved edits, so pushing the canonical html back
      // keeps their editor exactly in step with the store and their NEXT
      // comment builds on the same bytes the server holds — no drift to
      // accumulate across several comments.
      broadcastDocHtml(doc, canEdit(doc, u.id) ? socket : null);
      broadcastDocComments(doc);
    });

    // Accept / reject a suggestion — the author's call alone, since either way
    // it rewrites their document. Accept swaps the anchored words for the
    // proposed ones; reject just unwraps the anchor. Both resolve the comment
    // and both leave the words un-underlined afterwards.
    socket.on("doc-comment-decide", ({ auth, id, commentId, accept }) => {
      const u = userByToken(auth);
      const doc = readDoc(id);
      if (!u || !doc || !canEdit(doc, u.id)) return; // author only
      const c = (doc.comments || []).find((x) => x.id === commentId);
      if (!c || c.resolved) return;
      const taking = !!accept && typeof c.suggestion === "string";
      doc.html = taking ? applySuggestion(doc.html, c.cid, c.suggestion) : stripAnchor(doc.html, c.cid);
      c.resolved = true;
      c.accepted = taking;
      writeDoc(doc); // recomputes wordCount from the new html
      broadcastDocHtml(doc, socket); // the decider already applied it locally
      broadcastDocComments(doc);
    });

    // Either the comment's author or the doc's author can resolve/remove it.
    const myComment = (doc, cid, uid) =>
      (doc.comments || []).find((c) => c.id === cid && (c.userId === uid || doc.ownerId === uid));

    socket.on("doc-comment-resolve", ({ auth, id, commentId, resolved }) => {
      const u = userByToken(auth);
      const doc = readDoc(id);
      if (!u || !doc || !canView(doc, u.id)) return;
      const c = myComment(doc, commentId, u.id);
      if (!c) return;
      c.resolved = !!resolved;
      // A resolved comment stops underlining its words; unresolving can't put
      // the anchor back (the words may have moved on), so it reads as orphaned.
      if (c.resolved && c.cid) doc.html = stripAnchor(doc.html, c.cid);
      writeDoc(doc);
      broadcastDocHtml(doc, null);
      broadcastDocComments(doc);
    });

    socket.on("doc-comment-delete", ({ auth, id, commentId }) => {
      const u = userByToken(auth);
      const doc = readDoc(id);
      if (!u || !doc || !canView(doc, u.id)) return;
      const c = myComment(doc, commentId, u.id);
      if (!c) return;
      if (c.cid) doc.html = stripAnchor(doc.html, c.cid); // the underline goes with it
      doc.comments = (doc.comments || []).filter((x) => x.id !== commentId);
      writeDoc(doc);
      broadcastDocHtml(doc, null);
      broadcastDocComments(doc);
    });

    // The author's saved text, pushed to readers who have the doc open so they
    // aren't commenting on a stale draft.
    socket.on("doc-saved", ({ auth, id }) => {
      const u = userByToken(auth);
      const doc = readDoc(id);
      if (!u || !doc || !canEdit(doc, u.id)) return;
      socket.to(docRoom(doc.id)).emit("doc-updated", { id: doc.id, html: doc.html, title: doc.title });
    });

    socket.on("disconnect", () => {
      onlineSockets.delete(socket.id);
      leaveDoc(socket); // a closed tab must stop showing as a doc viewer
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

  // ---- Solo-write doc rooms (presence + live comments) ----
  const docRoom = (id) => "doc:" + id;

  // Everyone currently viewing a doc, deduped by account: two tabs are one
  // person. Shape matches miniAvatar() on the client.
  function docPresenceList(docId) {
    const seen = new Map();
    for (const { docId: d, userId } of docViewers.values()) {
      if (d !== docId || seen.has(userId)) continue;
      const u = store.users.find((x) => x.id === userId);
      if (u) seen.set(userId, {
        username: u.username, color: cleanColor(u.color),
        avatar: u.avatar || "", avatarFit: u.avatarFit || "cover",
      });
    }
    return [...seen.values()];
  }
  const broadcastDocPresence = (docId) =>
    io.to(docRoom(docId)).emit("doc-presence", { id: docId, viewers: docPresenceList(docId) });

  // Comments carry author identity for rendering — never account ids.
  const commentRows = (doc) =>
    (doc.comments || []).map((c) => {
      const a = store.users.find((x) => x.id === c.userId);
      return {
        id: c.id, cid: c.cid || "", quote: c.quote || "", text: c.text,
        suggestion: typeof c.suggestion === "string" ? c.suggestion : null,
        ts: c.ts, resolved: !!c.resolved, accepted: !!c.accepted,
        // No anchor left in the html means the words it pointed at are gone —
        // the client says so rather than silently showing a comment on nothing.
        orphaned: !!c.cid && !anchorCids(doc.html).includes(c.cid),
        author: a?.username || "someone", color: cleanColor(a?.color),
        avatar: a?.avatar || "", avatarFit: a?.avatarFit || "cover",
        isAuthor: c.userId === doc.ownerId, // the author's own notes-to-self read differently
      };
    });
  const broadcastDocComments = (doc) =>
    io.to(docRoom(doc.id)).emit("doc-comments", { id: doc.id, comments: commentRows(doc) });

  // The html changed underneath everyone (an anchor appeared, a suggestion was
  // taken). `except` skips the socket that caused it — it already applied the
  // change locally and re-rendering would jump their caret.
  const broadcastDocHtml = (doc, except) =>
    (except ? except.to(docRoom(doc.id)) : io.to(docRoom(doc.id)))
      .emit("doc-html", { id: doc.id, html: doc.html, wordCount: doc.wordCount });

  function leaveDoc(socket) {
    const seat = docViewers.get(socket.id);
    if (!seat) return;
    docViewers.delete(socket.id);
    socket.leave(docRoom(seat.docId));
    socket.data.docId = null;
    broadcastDocPresence(seat.docId);
  }

  // Access was just revoked (reader removed, or the doc went private again):
  // kick the affected sockets out of the room so they stop getting updates.
  function closeDocFor(docId, userId) {
    for (const [sid, seat] of [...docViewers.entries()]) {
      if (seat.docId !== docId || seat.userId !== userId) continue;
      docViewers.delete(sid);
      const sock = io.sockets.sockets.get(sid);
      sock?.leave(docRoom(docId));
      sock?.emit("doc-access-lost", { id: docId });
    }
    broadcastDocPresence(docId);
  }
  const closeDocReaders = (docId, ownerId) => {
    for (const [, seat] of [...docViewers.entries()])
      if (seat.docId === docId && seat.userId !== ownerId) closeDocFor(docId, seat.userId);
  };

  // Previous games are private: you only see games your account holds a seat in.
  // Names in snapshots are display copies; the ACCOUNT id is the durable tie.
  // Resolve to the current username at read time so renames follow the user.
  const freshName = (userId, fallback) => store.users.find((x) => x.id === userId)?.username ?? fallback;
  const freshStory = (story) => (story || []).map((l) => (l.userId ? { ...l, name: freshName(l.userId, l.name) } : l));
  const gameSummary = (d) => ({
    code: d.code, name: d.name || "", cover: d.cover || "", phase: d.phase, prompt: d.prompt || "",
    savedAt: d.savedAt || 0, createdAt: d.createdAt || d.savedAt || 0, tags: d.tags || [],
    lines: (d.story || []).length, words: storyWords(d.story),
    hostName: store.users.find((u) => u.id === d.hostUserId)?.username ?? d.hostName ?? null,
    writers: (d.writers || []).map((w) => ({
      name: freshName(w.userId, w.name), color: cleanColor(w.color), isHost: d.hostUserId != null && w.userId === d.hostUserId,
    })),
  });
  // A contributor is a contributor: holding a seat, having WRITTEN a line, or
  // being the original host all count — a seat that expired (ghost dropped,
  // the host went on without you) must not erase the story from your lists.
  const inGame = (d, u) =>
    (d.writers || []).some((w) => w.userId === u.id) ||
    (d.story || []).some((l) => l.userId === u.id) ||
    d.hostUserId === u.id;

  // Tag edits come over HTTP (routes.js) so they work on live AND finished
  // stories: update the live session when there is one, else rewrite the
  // snapshot directly.
  function setTags(code, tags) {
    const s = sessions.get(code);
    if (s) {
      s.tags = tags;
      saveSnapshot(s);
      return true;
    }
    const d = readSnapshot(code);
    if (!d) return false;
    d.tags = tags;
    writeSnapshot(code, d);
    return true;
  }

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
      const mine = inGame({ writers: [...s.writers.values()], story: s.story, hostUserId: s.hostUserId }, u);
      if (!mine) continue;
      const cur = s.phase === "writing" ? s.writers.get(s.turnOrder[s.currentIdx]) : null;
      out.set(s.code, {
        code: s.code, name: s.name || "", cover: s.cover || "", phase: s.phase, paused: !!s.paused,
        hosted: s.hostUserId === u.id, // the ORIGINAL host: the one who may delete it from here
        myTurn: s.phase === "writing" && !s.paused && cur?.userId === u.id,
        currentName: cur?.name ?? null,
        players: [...s.writers.values()].map((w) => ({
          name: w.name, color: cleanColor(w.color), connected: w.connected !== false,
        })),
        lines: s.story.length, words: storyWords(s.story), savedAt: Date.now(), live: true,
      });
    }
    for (const code of storage.list("save")) {
      if (out.has(code) || sessions.has(code)) continue;
      const d = readSnapshot(code);
      if (!d || d.phase === "over" || !inGame(d, u)) continue;
      out.set(code, {
        code, name: d.name || "", cover: d.cover || "", phase: d.phase, paused: true, myTurn: false, currentName: null,
        hosted: d.hostUserId === u.id,
        players: (d.writers || []).map((w) => ({ name: w.name, color: cleanColor(w.color), connected: false })),
        lines: (d.story || []).length, words: storyWords(d.story), savedAt: d.savedAt || 0, live: false,
      });
    }
    return [...out.values()].sort((a, b) => b.savedAt - a.savedAt).slice(0, 8);
  }

  // Finished stories for the dashboard's compact "previous games" list.
  function recentGamesFor(u, cap = 5) {
    const out = [];
    for (const d of allSnapshots())
      if (d.phase === "over" && inGame(d, u)) out.push({ ...gameSummary(d), hosted: d.hostUserId === u.id });
    out.sort((a, b) => b.savedAt - a.savedAt);
    return out.slice(0, cap);
  }

  // Admin moderation: end a running game from outside it (the dashboard),
  // without the moderator having to take a seat first. Returns false when the
  // code isn't a live, unfinished game.
  // End a game from outside it — an admin from /admin, or the host from
  // their dashboard. A paused snapshot with no live session is revived first
  // so the reveal (and the "over" phase) lands on disk the same way.
  function endGameByCode(code, by = null) {
    code = String(code || "").toUpperCase();
    const s = sessions.get(code) ?? loadSession(code);
    if (!s || s.phase === "over") return false;
    announce(s, by ? { name: by.username, color: cleanColor(by.color) } : { name: "Admin", color: PALETTE[0] }, "ended this story.");
    endGame(s);
    return true;
  }

  // "Write more": put a FINISHED story back into its lobby under the same
  // code so writers can gather again. The prompt and story stay on the
  // session (a waiting room WITH a story is what tells start-game to skip
  // the vote and keep writing). Returns false unless the code is finished.
  function reopenGameByCode(code, by = null) {
    code = String(code || "").toUpperCase();
    const s = sessions.get(code) ?? loadSession(code);
    if (!s || s.phase !== "over") return false;
    s.phase = "waiting";
    s.paused = false;
    s.turnOrder = [];
    s.currentIdx = 0;
    s.turnCount = 0;
    s.votes.clear();
    if (by) announce(s, { name: by.username, color: cleanColor(by.color) }, "reopened this story — gathering writers to write more.");
    saveSnapshot(s);
    broadcastRoster(s);
    return true;
  }

  // Permanently remove a game: kill the live session (players are told),
  // then delete the snapshot so the code truly dies. `by` is the account
  // doing it: every OTHER writer who held a seat gets an inbox note saying
  // the story is gone and who did it — a game vanishing from your dashboard
  // without a word would read as a bug.
  function deleteGame(code, by = null) {
    const s = sessions.get(code);
    let name = s?.name || "", seats = s ? [...s.writers.values()] : [];
    if (!s) {
      const d = readSnapshot(code);
      if (d) { name = d.name || ""; seats = d.writers || []; }
    }
    if (s) {
      clearTimeout(s.timer);
      clearTimeout(s.idleTimer);
      for (const w of s.writers.values()) clearTimeout(w.ghostTimer);
      io.to(code).emit("game-deleted");
      sessions.delete(s.code);
    }
    storage.del("save", code);
    if (by) {
      const told = new Set();
      for (const w of seats) {
        if (!w.userId || w.userId === by.id || told.has(w.userId)) continue;
        const u = store.users.find((x) => x.id === w.userId);
        if (!u) continue;
        told.add(u.id);
        u.inbox ??= [];
        u.inbox.unshift(makeMsg("system", null, `🗑 “${name || "Untitled story"}” (${code}) has been deleted by ${by.username}.`));
      }
      if (told.size) saveStore();
    }
  }

  // Host/admin from the dashboard: put a live game to sleep now.
  function sleepGameByCode(code, by) {
    const s = sessions.get(String(code || "").toUpperCase());
    if (!s || s.phase === "over") return false;
    return sleepGame(s, by, "put the story to sleep, wake it up any time from the dashboard.");
  }
  // Invite a friend to a session: an inbox game-invite (with the code) and a
  // live toast if they're online. Host-only, friends-only (routes.js checks).
  function inviteToGame(code, host, friend) {
    const s = sessions.get(String(code || "").toUpperCase());
    const name = s?.name || "";
    friend.inbox = friend.inbox || [];
    friend.inbox.unshift({
      ...makeMsg("game-invite", host.id, `“${name || code}”: ${host.username} invited you to come write!`),
      code,
    });
    saveStore();
    for (const [sid, uid] of onlineSockets.entries())
      if (uid === friend.id) io.to(sid).emit("game-invite", { code, name, host: host.username });
    return true;
  }

  // One prompt on demand, outside any session — the solo editor's "Prompt?"
  // roller. Same modes, same knobs, same cleaning as a ballot.
  function rollPrompt(mode, controls) {
    const m = cleanPromptMode(mode);
    const c = cleanPromptControls(controls || {});
    if (m === "intermediate" && INTERMEDIATE) {
      const r = generateIntermediatePrompt(INTERMEDIATE, { ...c });
      return { mode: m, prompt: r.prompt, meta: { seed: r.seed, selections: r.selections, labels: r.labels } };
    }
    return { mode: "simple", prompt: generateSimplePrompt(PROMPT_BANK, { recent: [] }).prompt, meta: null };
  }
  return { creditSoloWords, rollPrompt, sessions, onlineSockets, readSnapshot, allSnapshots, gameSummary, freshStory, inGame, myGamesFor, recentGamesFor, deleteGame, endGameByCode, reopenGameByCode, sleepGameByCode, inviteToGame, renameUser, setTags, commentRows, closeDocFor, closeDocReaders };
}
