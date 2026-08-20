// Gimmicks: rank-unlocked toys played inside a live session. The registry +
// roll rules are pure (lib/gimmicks.js); the gate mirrors themes
// (lib/achievements.js); the one socket event lives in src/game.js and only
// works in a non-friendly game.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startServer, signup, startedGame } from "./helpers.mjs";
import {
  GIMMICKS, GIMMICK_IDS, cleanGimmickId, rollOutcome, describeRoll, DIE_SIDES,
  GALAGA_TARGET, GALAGA_MAX_SCORE, galagaOutcome, describeGalaga,
} from "../lib/gimmicks.js";
import {
  WORD_TIERS, GIMMICK_UNLOCKS, THEME_UNLOCKS, tierForGimmick, canUseGimmick, unlockedGimmicks, gimmickLocks,
  rewardsForTier, describeRewards,
} from "../lib/achievements.js";

const ADMIN_EMAIL = "admin@cowrite.test";
const CFG = JSON.parse(readFileSync(new URL("../achievements.json", import.meta.url), "utf-8"));

let ctx;
// The die is fixed for the steal test (20 first, then a 1, then random) and
// the cooldown shrunk so the flow doesn't wait on the animation budget.
before(async () => (ctx = await startServer({ COWRITE_ROLL_COOLDOWN_MS: "300", COWRITE_DICE_FIXED: "20,1" })));
after(async () => ctx.stop());

// ---- the data ----

test("a gimmick unlocks with its own THEME: GIMMICK_UNLOCKS is derived from the registry's theme field + themeUnlocks, not a second map", () => {
  assert.equal(CFG.gimmickUnlocks, undefined, "no separate gimmick map in achievements.json");
  const tierIds = WORD_TIERS.map((t) => t.id);
  for (const [id, tier] of Object.entries(GIMMICK_UNLOCKS)) {
    assert.ok(GIMMICK_IDS.includes(id), `${id} is a gimmick`);
    assert.ok(tierIds.includes(tier), `${tier} is a tier`);
    assert.equal(tier, THEME_UNLOCKS[GIMMICKS[id].theme], `${id} unlocks with its theme`);
  }
  // every registry gimmick naming a GATED theme is gated; a free theme would mean a free gimmick
  for (const [id, g] of Object.entries(GIMMICKS))
    assert.equal(GIMMICK_UNLOCKS[id], THEME_UNLOCKS[g.theme], `${id} rides its theme's tier`);
  assert.ok(GIMMICK_UNLOCKS.d20, "the d20 ships gated");
});

test("the d20 unlocks with the Hellfire theme, which now sits at Sorcerer (swapped with Cerebro)", () => {
  assert.equal(THEME_UNLOCKS.hellfire, "sorcerer");
  assert.equal(THEME_UNLOCKS.cerebro, "notmyfault");
  assert.equal(tierForGimmick("d20"), THEME_UNLOCKS.hellfire);
  const r = rewardsForTier("sorcerer");
  assert.ok(r.themes.some((t) => t.id === "hellfire"));
  assert.deepEqual(r.gimmicks, [{ id: "d20", name: "Hellfire d20" }]);
  assert.match(describeRewards(r), /the Hellfire d20 gimmick$/);
});

test("canUseGimmick: the ladder, admins, and a not-yet-earned rank", () => {
  assert.equal(canUseGimmick({ badges: ["outloud"] }, "d20"), false);
  assert.equal(canUseGimmick({ badges: ["outloud", "sorcerer"] }, "d20"), true);
  assert.equal(canUseGimmick({ badges: [], admin: true }, "d20"), true);
  assert.equal(canUseGimmick({ badges: [], admin: "yes" }, "d20"), false);
  assert.equal(canUseGimmick(null, "d20"), false);
  assert.equal(canUseGimmick(null, "not-a-gimmick"), true, "unlisted = free");
  assert.deepEqual(unlockedGimmicks(null), []);
  assert.deepEqual(unlockedGimmicks({ admin: true }), Object.keys(GIMMICK_UNLOCKS));
  const lock = gimmickLocks().d20;
  assert.equal(lock.tier, "sorcerer");
  assert.equal(lock.min, WORD_TIERS.find((t) => t.id === "sorcerer").min);
});

// ---- the roll rules (pure) ----

test("cleaners + outcomes: ids off the wire, nat 20 wants the turn, nat 1 fumbles, the rest are plain", () => {
  assert.equal(cleanGimmickId("d20"), "d20");
  assert.equal(cleanGimmickId("<script>"), null);
  assert.equal(DIE_SIDES, 20);
  assert.deepEqual(rollOutcome(20), { value: 20, kind: "crit", steal: true });
  assert.deepEqual(rollOutcome(1), { value: 1, kind: "fumble", steal: false });
  assert.deepEqual(rollOutcome(13), { value: 13, kind: "plain", steal: false });
  assert.equal(rollOutcome(99).value, 20, "clamped to the die");
  assert.equal(rollOutcome("junk").value, 1);
  assert.equal(describeRoll(rollOutcome(13)), "rolled a 13 🎲");
  assert.equal(describeRoll(rollOutcome(1)), "rolled a natural 1 🎲 — fumble.");
  assert.equal(describeRoll(rollOutcome(20)), "rolled a NATURAL 20 🎲");
  assert.equal(describeRoll(rollOutcome(20), { stole: true, from: "Mike" }), "rolled a NATURAL 20 🎲 and stole the turn from Mike!");
  assert.equal(describeRoll(rollOutcome(20), { stole: true }), "rolled a NATURAL 20 🎲 and stole the turn!");
});

// ---- the Galaga run (pure) ----

test("the Galaga gimmick unlocks with the Palace Arcade theme at practicewithme", () => {
  assert.equal(THEME_UNLOCKS.arcade, "practicewithme");
  assert.equal(tierForGimmick("galaga"), THEME_UNLOCKS.arcade);
  const r = rewardsForTier("practicewithme");
  assert.ok(r.themes.some((t) => t.id === "arcade"));
  assert.deepEqual(r.gimmicks, [{ id: "galaga", name: "Palace Arcade Galaga" }]);
  assert.equal(canUseGimmick({ badges: ["practicewithme"] }, "galaga"), true);
  assert.equal(canUseGimmick({ badges: ["practice"] }, "galaga"), false);
});

test("galagaOutcome: beating 3000 wants the turn, 3000 exactly does not, junk clamps", () => {
  assert.equal(GALAGA_TARGET, 3000);
  assert.deepEqual(galagaOutcome(3200), { score: 3200, kind: "highscore", steal: true });
  assert.deepEqual(galagaOutcome(3000), { score: 3000, kind: "plain", steal: false });
  assert.deepEqual(galagaOutcome(0), { score: 0, kind: "plain", steal: false });
  assert.equal(galagaOutcome(-40).score, 0);
  assert.equal(galagaOutcome("junk").score, 0);
  assert.equal(galagaOutcome(1e9).score, GALAGA_MAX_SCORE, "a run can't claim the moon");
  assert.equal(describeGalaga(galagaOutcome(350)), "scored 350 on the Galaga fleet 👾");
  assert.equal(describeGalaga(galagaOutcome(3200), { stole: true, from: "Mike" }), "blasted the fleet for 3,200 👾 — beat 3000 and stole the turn from Mike!");
  assert.equal(describeGalaga(galagaOutcome(3200), { declined: true }), "blasted the fleet for 3,200 👾 — beat 3000, and let the writer keep the turn.");
  assert.equal(describeGalaga(galagaOutcome(3200)), "blasted the fleet for 3,200 👾 — beat 3000!");
});

// ---- the endpoint ----

test("/api/gimmicks: catalogue + locks for everyone, unlocked per rank, all for admins; /api/me agrees", async () => {
  const anon = await ctx.api("/api/gimmicks");
  assert.equal(anon.status, 200);
  assert.deepEqual(anon.data.catalogue.map((g) => g.id), GIMMICK_IDS);
  assert.ok(anon.data.catalogue[0].desc && anon.data.catalogue[0].theme);
  assert.deepEqual(anon.data.unlocked, []);
  assert.equal(anon.data.locks.d20.tier, "sorcerer");
  const rookie = await signup(ctx, "dicerookie", "dice@x.com");
  const r = await ctx.api("/api/gimmicks", undefined, rookie.token);
  assert.deepEqual(r.data.unlocked, []);
  const me = await ctx.api("/api/me", undefined, rookie.token);
  assert.deepEqual(me.data.user.gimmicks, []);
  const admin = await signup(ctx, "diceadmin", ADMIN_EMAIL);
  const a = await ctx.api("/api/gimmicks", undefined, admin.token);
  assert.equal(a.data.admin, true);
  assert.deepEqual(a.data.unlocked.sort(), ["d20", "galaga", "milkshake"]);
});

// ---- the socket flow ----

test("gimmick-roll: refused in a friendly game, by an unranked table, with a bogus id", async () => {
  const g = await startedGame(ctx, { friendly: true });
  const r = await ctx.emit(g.A, "gimmick-roll", { id: "d20" });
  assert.equal(r.ok, false);
  assert.match(r.error, /friendly/);
  await ctx.emit(g.A, "update-rules", { friendly: false });
  const r2 = await ctx.emit(g.A, "gimmick-roll", { id: "d20" });
  assert.equal(r2.ok, false, "nobody seated has the rank");
  assert.match(r2.error, /unlocked/);
  assert.equal((await ctx.emit(g.B, "gimmick-roll", { id: "nope" })).ok, false);
  const S = await ctx.conn();
  await ctx.emit(S, "spectate-session", { code: g.code });
  assert.equal((await ctx.emit(S, "gimmick-roll", { id: "d20" })).ok, false, "no seat, no die");
});

test("a table with one ranked seat lets everyone roll; a natural 20 steals the turn; a 1 fumbles; the cooldown holds; chat hears every landing", async () => {
  const admin = await signup(ctx, "diceadmin", ADMIN_EMAIL);
  const mike = await signup(ctx, "dicemike", "dicemike@x.com", "#e63946");
  const A = await ctx.conn();
  const B = await ctx.conn();
  const rolls = [];
  const chat = [];
  let game = null;
  A.on("gimmick-roll", (r) => rolls.push(r));
  A.on("chat", (m) => chat.push(m));
  A.on("game-state", (st) => (game = st));
  const c = await ctx.emit(A, "create-session", { auth: admin.token });
  await ctx.emit(B, "join-session", { code: c.code, auth: mike.token });
  await ctx.emit(A, "start-game", { turnSeconds: 60, rounds: 2, friendly: false });
  await ctx.wait(150);
  A.emit("vote", { prompt: game.options[0] });
  B.emit("vote", { prompt: game.options[0] });
  await ctx.wait(200);
  assert.equal(game.phase, "writing");
  assert.equal(game.currentId, A.id, "the admin writes first");

  // Mike has no rank, but the admin at the table does — Mike may roll. The
  // die is fixed to land 20 first: it isn't Mike's turn, so he steals it.
  const r = await ctx.emit(B, "gimmick-roll", { id: "d20" });
  assert.equal(r.ok, true);
  assert.equal(r.value, 20);
  assert.equal(r.kind, "crit");
  assert.equal(r.stole, true);
  await ctx.wait(150);
  assert.equal(game.currentId, B.id, "the turn changed hands");
  assert.equal(game.turnCount, 0, "a steal is not a committed turn");
  assert.equal(rolls.at(-1).userId, mike.user.id);
  assert.equal(rolls.at(-1).stole, true);
  assert.ok(chat.some((m) => m.sys && /dicemike/.test(m.name) && /NATURAL 20 🎲 and stole the turn from diceadmin!/.test(m.text)));

  const again = await ctx.emit(B, "gimmick-roll", { id: "d20" });
  assert.equal(again.ok, false, "cooldown");
  await ctx.wait(350);
  // next fixed value is a 1: a fumble, nothing happens to the turn
  const f = await ctx.emit(B, "gimmick-roll", { id: "d20" });
  assert.equal(f.value, 1);
  assert.equal(f.kind, "fumble");
  assert.equal(f.stole, false);
  await ctx.wait(100);
  assert.equal(game.currentId, B.id);
  assert.ok(chat.some((m) => m.sys && /natural 1 🎲 — fumble/.test(m.text)));
  // then random: in range, announced
  const p = await ctx.emit(A, "gimmick-roll", { id: "d20" });
  assert.equal(p.ok, true);
  assert.ok(p.value >= 1 && p.value <= 20);
  await ctx.wait(100);
  assert.ok(chat.some((m) => m.sys && /diceadmin/.test(m.name) && /rolled a/.test(m.text) && m.text !== chat[0].text));
});

test("a natural 20 does NOT steal when it's already your turn or the game is paused", async () => {
  // fresh server so the fixed die can be re-seeded
  const local = await startServer({ COWRITE_ROLL_COOLDOWN_MS: "50", COWRITE_DICE_FIXED: "20,20" });
  try {
    const admin = await signup(local, "diceadmin", ADMIN_EMAIL);
    const A = await local.conn();
    let game = null;
    const chat = [];
    A.on("game-state", (st) => (game = st));
    A.on("chat", (m) => chat.push(m));
    await local.emit(A, "create-session", { auth: admin.token });
    await local.emit(A, "start-game", { turnSeconds: 60, rounds: 2, friendly: false });
    await local.wait(150);
    A.emit("vote", { prompt: game.options[0] });
    await local.wait(200);
    // solo: it's always my turn — a 20 is just a 20
    const r = await local.emit(A, "gimmick-roll", { id: "d20" });
    assert.equal(r.value, 20);
    assert.equal(r.stole, false);
    await local.wait(100);
    assert.ok(chat.some((m) => m.sys && m.text === "rolled a NATURAL 20 🎲"));
    // paused: no steal either
    await local.emit(A, "pause-game");
    await local.wait(80);
    const r2 = await local.emit(A, "gimmick-roll", { id: "d20" });
    assert.equal(r2.value, 20);
    assert.equal(r2.stole, false);
  } finally {
    await local.stop();
  }
});

test("gimmick-die: a die on the table is shown to everyone, follows its owner, and leaves with them; a late joiner gets the list", async () => {
  const admin = await signup(ctx, "diceadmin", ADMIN_EMAIL);
  const mike = await signup(ctx, "tablemike", "tablemike@x.com", "#e63946");
  const A = await ctx.conn();
  const B = await ctx.conn();
  const seenB = [];
  let game = null;
  A.on("game-state", (st) => (game = st));
  B.on("gimmick-die", (d) => seenB.push(d));
  const c = await ctx.emit(A, "create-session", { auth: admin.token });
  await ctx.emit(B, "join-session", { code: c.code, auth: mike.token });
  await ctx.emit(A, "start-game", { turnSeconds: 60, rounds: 2, friendly: false });
  await ctx.wait(150);
  // Mike (no rank, but at the admin's table) puts his die out top-right
  B.emit("gimmick-die", { on: true, x: 0.9, y: 0.1 });
  await ctx.wait(100);
  assert.equal(seenB.length, 1, "the owner sees their own broadcast too (the client ignores it)");
  assert.deepEqual(seenB[0], { userId: mike.user.id, name: "tablemike", color: "#e63946", x: 0.9, y: 0.1, on: true });
  B.emit("gimmick-die", { on: true, x: 7, y: -3 });
  await ctx.wait(80);
  assert.equal(seenB.at(-1).x, 1, "clamped");
  assert.equal(seenB.at(-1).y, 0);
  // a spectator arriving now is handed the dice already out
  const S = await ctx.conn();
  const list = new Promise((r) => S.on("gimmick-dice", r));
  await ctx.emit(S, "spectate-session", { code: c.code });
  const dice = await list;
  assert.equal(dice.length, 1);
  assert.equal(dice[0].userId, mike.user.id);
  assert.equal(dice[0].x, 1);
  // put away
  const offA = new Promise((r) => A.on("gimmick-die", (d) => d.on === false && r(d)));
  B.emit("gimmick-die", { on: false });
  const off = await offA;
  assert.equal(off.userId, mike.user.id);
  // out again, then Mike disconnects: his die goes with him
  B.emit("gimmick-die", { on: true, x: 0.5, y: 0.5 });
  await ctx.wait(80);
  const gone = new Promise((r) => A.on("gimmick-die", (d) => d.on === false && r(d)));
  B.disconnect();
  const g = await gone;
  assert.equal(g.userId, mike.user.id);
  // a friendly game takes no dice
  const F = await ctx.conn();
  const spec = [];
  F.on("gimmick-die", (d) => spec.push(d));
  await ctx.emit(F, "spectate-session", { code: c.code });
  A.emit("vote", { prompt: game.options[0] }); // B is gone: the solo vote finalizes, the game is writing
  await ctx.wait(200);
  assert.equal(game.phase, "writing");
  assert.equal((await ctx.emit(A, "update-rules", { friendly: true })).ok, true);
  A.emit("gimmick-die", { on: true, x: 0.2, y: 0.2 });
  await ctx.wait(100);
  assert.equal(spec.length, 0, "no die in a friendly game");
});

test("gimmick-galaga: friendly/unranked refused; a run over 3000 steals the turn (unless declined); the score is called in chat", async () => {
  const local = await startServer({ COWRITE_ROLL_COOLDOWN_MS: "50" });
  try {
    const admin = await signup(local, "diceadmin", ADMIN_EMAIL);
    const mike = await signup(local, "arcademike", "arcademike@x.com", "#e63946");
    const A = await local.conn();
    const B = await local.conn();
    let game = null;
    const chat = [];
    const runs = [];
    A.on("game-state", (st) => (game = st));
    A.on("chat", (m) => chat.push(m));
    A.on("gimmick-galaga", (r) => runs.push(r));
    const c = await local.emit(A, "create-session", { auth: admin.token });
    await local.emit(B, "join-session", { code: c.code, auth: mike.token });
    await local.emit(A, "start-game", { turnSeconds: 60, rounds: 2, friendly: true });
    await local.wait(150);
    A.emit("vote", { prompt: game.options[0] });
    B.emit("vote", { prompt: game.options[0] });
    await local.wait(200);
    assert.equal(game.phase, "writing");
    assert.equal(game.currentId, A.id);
    // friendly game: refused
    const f = await local.emit(B, "gimmick-galaga", { score: 9000 });
    assert.equal(f.ok, false);
    assert.match(f.error, /friendly/);
    await local.emit(A, "update-rules", { friendly: false });
    // a plain run: announced, no steal
    const plain = await local.emit(B, "gimmick-galaga", { score: 350 });
    assert.equal(plain.ok, true);
    assert.deepEqual({ score: plain.score, kind: plain.kind, stole: plain.stole }, { score: 350, kind: "plain", stole: false });
    await local.wait(100);
    assert.ok(chat.some((m) => m.sys && /scored 350 on the Galaga fleet 👾/.test(m.text)));
    assert.equal(game.currentId, A.id, "turn untouched");
    await local.wait(80); // cooldown
    // beat 3000 with the opt-out: called, turn stays
    const dec = await local.emit(B, "gimmick-galaga", { score: 3100, steal: false });
    assert.equal(dec.stole, false);
    await local.wait(100);
    assert.ok(chat.some((m) => m.sys && /beat 3000, and let the writer keep the turn/.test(m.text)));
    assert.equal(game.currentId, A.id);
    await local.wait(80);
    // beat 3000 for real: Mike (no rank, admin's table) steals the turn
    const win = await local.emit(B, "gimmick-galaga", { score: 3200 });
    assert.equal(win.ok, true);
    assert.equal(win.kind, "highscore");
    assert.equal(win.stole, true);
    await local.wait(150);
    assert.equal(game.currentId, B.id, "the turn changed hands");
    assert.equal(runs.at(-1).userId, mike.user.id);
    assert.equal(runs.at(-1).stole, true);
    const call = chat.find((m) => m.sys && /blasted the fleet for 3,200 👾 — beat 3000 and stole the turn from diceadmin!/.test(m.text));
    assert.ok(call, "the steal is called in chat");
    assert.equal(call.chime, true, "and it rings like a natural 20");
    // a spectator has no seat, no run
    const S = await local.conn();
    await local.emit(S, "spectate-session", { code: c.code });
    assert.equal((await local.emit(S, "gimmick-galaga", { score: 999 })).ok, false);
  } finally {
    await local.stop();
  }
});

test("gimmick-ship: a battle is relayed to everyone (clamped), late joiners get the list, and it leaves with its owner or a friendly switch", async () => {
  const local = await startServer({ COWRITE_ROLL_COOLDOWN_MS: "50" });
  try {
    const admin = await signup(local, "diceadmin", ADMIN_EMAIL);
    const mike = await signup(local, "shipmike", "shipmike@x.com", "#e63946");
    const A = await local.conn();
    const B = await local.conn();
    let game = null;
    const seen = [];
    A.on("game-state", (st) => (game = st));
    A.on("gimmick-ship", (d) => seen.push(d));
    const c = await local.emit(A, "create-session", { auth: admin.token });
    await local.emit(B, "join-session", { code: c.code, auth: mike.token });
    await local.emit(A, "start-game", { turnSeconds: 60, rounds: 2, friendly: false });
    await local.wait(150);
    // Mike's battle goes out: ship, fleet, shots — clamped to fractions
    B.emit("gimmick-ship", { on: true, x: 0.5, score: 150, bees: [[0.2, 0.1, 0], [7, -1, 1]], shots: [[0.5, 0.7]] });
    await local.wait(100);
    assert.equal(seen.length, 1);
    const d = seen[0];
    assert.equal(d.userId, mike.user.id);
    assert.equal(d.name, "shipmike");
    assert.equal(d.color, "#e63946");
    assert.equal(d.score, 150);
    assert.deepEqual(d.bees, [[0.2, 0.1, 0], [1, 0, 1]], "coordinates clamped, dive flag kept");
    assert.deepEqual(d.shots, [[0.5, 0.7]]);
    // an absurd payload is bounded, not trusted
    B.emit("gimmick-ship", { on: true, x: 9, score: 1e12, bees: Array.from({ length: 40 }, () => [0, 0, 0]), shots: Array.from({ length: 40 }, () => [0, 0]) });
    await local.wait(100);
    assert.equal(seen.at(-1).x, 1);
    assert.equal(seen.at(-1).score, GALAGA_MAX_SCORE);
    assert.equal(seen.at(-1).bees.length, 10);
    assert.equal(seen.at(-1).shots.length, 4);
    // a spectator arriving now gets the battles already on
    const S = await local.conn();
    const list = new Promise((r) => S.on("gimmick-ships", r));
    await local.emit(S, "spectate-session", { code: c.code });
    const ships = await list;
    assert.equal(ships.length, 1);
    assert.equal(ships[0].userId, mike.user.id);
    // friendly again: the arcade closes for everyone
    A.emit("vote", { prompt: game.options[0] });
    B.emit("vote", { prompt: game.options[0] });
    await local.wait(200);
    assert.equal(game.phase, "writing");
    const gone = new Promise((r) => A.on("gimmick-ship", (x) => x.on === false && r(x)));
    await local.emit(A, "update-rules", { friendly: true });
    assert.equal((await gone).userId, mike.user.id);
    // and a friendly game takes no new battles
    const before = seen.length;
    B.emit("gimmick-ship", { on: true, x: 0.5, score: 0, bees: [], shots: [] });
    await local.wait(100);
    assert.equal(seen.length, before, "a friendly game takes no new battles");
    // disconnect takes the battle with it
    await local.emit(A, "update-rules", { friendly: false });
    B.emit("gimmick-ship", { on: true, x: 0.4, score: 100, bees: [], shots: [] });
    await local.wait(100);
    const left = new Promise((r) => A.on("gimmick-ship", (x) => x.on === false && r(x)));
    B.disconnect();
    assert.equal((await left).userId, mike.user.id);
  } finally {
    await local.stop();
  }
});

test("the Starcourt Milkshake unlocks with the Starcourt theme at practice", () => {
  assert.equal(THEME_UNLOCKS.starcourt, "practice");
  assert.equal(tierForGimmick("milkshake"), THEME_UNLOCKS.starcourt);
  const r = rewardsForTier("practice");
  assert.ok(r.themes.some((t) => t.id === "starcourt"));
  assert.deepEqual(r.gimmicks, [{ id: "milkshake", name: "Starcourt Milkshake" }]);
  assert.equal(canUseGimmick({ badges: ["practice"] }, "milkshake"), true);
  assert.equal(canUseGimmick({ badges: ["puppymike"] }, "milkshake"), false);
});

test("gimmick-cup / gimmick-pour: the cup is relayed (clamped), the pour is called in chat on a cooldown, and the cup leaves with its owner", async () => {
  const local = await startServer({ COWRITE_ROLL_COOLDOWN_MS: "200" });
  try {
    const admin = await signup(local, "diceadmin", ADMIN_EMAIL);
    const mike = await signup(local, "shakemike", "shakemike@x.com", "#e63946");
    const A = await local.conn();
    const B = await local.conn();
    const seen = [];
    const chat = [];
    A.on("gimmick-cup", (d) => seen.push(d));
    A.on("chat", (m) => chat.push(m));
    const c = await local.emit(A, "create-session", { auth: admin.token });
    await local.emit(B, "join-session", { code: c.code, auth: mike.token });
    // friendly game: no cup, no pour
    B.emit("gimmick-cup", { on: true, x: 0.5, y: 0.5, rot: 0, level: 1 });
    await local.wait(100);
    assert.equal(seen.length, 0, "a friendly game takes no cup");
    assert.match((await local.emit(B, "gimmick-pour", {})).error, /friendly/);
    await local.emit(A, "start-game", { turnSeconds: 60, rounds: 2, friendly: false });
    await local.wait(150);
    // the cup goes out, clamped
    B.emit("gimmick-cup", { on: true, x: 0.4, y: 9, rot: -400, level: 2 });
    await local.wait(100);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].userId, mike.user.id);
    assert.equal(seen[0].color, "#e63946");
    assert.equal(seen[0].x, 0.4);
    assert.equal(seen[0].y, 1, "clamped");
    assert.equal(seen[0].rot, -90, "clamped");
    assert.equal(seen[0].level, 1, "clamped");
    // the pour: announced once, then the cooldown holds
    const p1 = await local.emit(B, "gimmick-pour", {});
    assert.equal(p1.ok, true);
    await local.wait(100);
    const call = chat.find((m) => m.sys && /shakemike/.test(m.name) && /tipped a milkshake over the game 🥤/.test(m.text));
    assert.ok(call, "the pour is called in chat");
    assert.notEqual(call.chime, true, "no chime — pure distraction");
    assert.equal((await local.emit(B, "gimmick-pour", {})).ok, false, "cooldown");
    // a spectator arriving now gets the cups already out
    const S = await local.conn();
    const list = new Promise((r) => S.on("gimmick-cups", r));
    await local.emit(S, "spectate-session", { code: c.code });
    const cups = await list;
    assert.equal(cups.length, 1);
    assert.equal(cups[0].userId, mike.user.id);
    // and has no seat: no pour
    assert.equal((await local.emit(S, "gimmick-pour", {})).ok, false);
    // the cup leaves with its owner
    const gone = new Promise((r) => A.on("gimmick-cup", (d) => d.on === false && r(d)));
    B.disconnect();
    assert.equal((await gone).userId, mike.user.id);
  } finally {
    await local.stop();
  }
});
