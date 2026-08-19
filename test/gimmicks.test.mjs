// Gimmicks: rank-unlocked toys played inside a live session. The registry +
// roll rules are pure (lib/gimmicks.js); the gate mirrors themes
// (lib/achievements.js); the one socket event lives in src/game.js and only
// works in a non-friendly game.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startServer, signup, startedGame } from "./helpers.mjs";
import { GIMMICKS, GIMMICK_IDS, cleanGimmickId, rollOutcome, describeRoll, DIE_SIDES } from "../lib/gimmicks.js";
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

test("every gimmickUnlocks key is a real gimmick pointing at a real tier, and its label is the registry name", () => {
  const tierIds = WORD_TIERS.map((t) => t.id);
  for (const [id, tier] of Object.entries(CFG.gimmickUnlocks)) {
    assert.ok(GIMMICK_IDS.includes(id), `${id} is a gimmick`);
    assert.ok(tierIds.includes(tier), `${tier} is a tier`);
    assert.equal(CFG.gimmickLabels[id], GIMMICKS[id].name, `label for ${id} matches the registry`);
  }
  assert.deepEqual(Object.keys(GIMMICK_UNLOCKS).sort(), Object.keys(CFG.gimmickUnlocks).sort());
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
  assert.deepEqual(a.data.unlocked, ["d20"]);
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
