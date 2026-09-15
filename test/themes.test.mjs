// Themes as rank rewards: which account may wear which theme, and the data
// (achievements.json's themeUnlocks) that decides it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startServer, signup, startedGame } from "./helpers.mjs";
import {
  WORD_TIERS, THEME_UNLOCKS, tierForTheme, canUseTheme, unlockedThemes, themeLocks, awardWordBadges, rewardsForTier, describeRewards,
} from "../lib/achievements.js";

const ADMIN_EMAIL = "admin@cowrite.test";
// The theme registry lives in the client (client/shared/themes.ts is the source of
// truth for what themes exist); the json only names ids from it.
// The registry is TypeScript now (client/shared/themes.ts, emitted to
// public/js/shared/themes.js); import the emitted module rather than regex it.
const { THEMES } = await import("../public/js/shared/themes.js");

let ctx;
before(async () => (ctx = await startServer()));
after(async () => ctx.stop());

// ---- the data ----

test("every gated theme names a real theme and a real tier", () => {
  assert.ok(THEMES.length >= 19, "parsed the theme registry");
  for (const [theme, tierId] of Object.entries(THEME_UNLOCKS)) {
    assert.ok(THEMES.includes(theme), theme + " is a theme that exists");
    assert.ok(WORD_TIERS.some((t) => t.id === tierId), theme + " needs a real tier: " + tierId);
  }
  // and some themes are deliberately free, or a new account has nothing to wear
  assert.ok(THEMES.some((t) => !THEME_UNLOCKS[t]), "at least one theme costs nothing");
});

test("the theme registry lists themes in unlock order: free first, then rung by rung up the ladder", () => {
  const cost = (id) => {
    const tier = WORD_TIERS.find((t) => t.id === THEME_UNLOCKS[id]);
    return THEME_UNLOCKS[id] ? tier.min : -1; // free sorts before the 0-word rung
  };
  const costs = THEMES.map(cost);
  assert.deepEqual(costs, [...costs].sort((a, b) => a - b), "the menu reads as the reward track: " + THEMES.map((t) => `${t}:${cost(t)}`).join(" "));
});

test("an unlisted theme, or one pointing at a tier that no longer exists, is free", () => {
  assert.equal(tierForTheme("neon"), null);
  assert.equal(tierForTheme("a-theme-nobody-made"), null);
  assert.equal(canUseTheme({ badges: [] }, "neon"), true);
  // THEME_UNLOCKS is filtered at load, so a typo'd tier id can't lock a theme away
  const raw = JSON.parse(readFileSync(new URL("../content/achievements.json", import.meta.url), "utf-8"));
  const tierIds = new Set(WORD_TIERS.map((t) => t.id));
  for (const [theme, tierId] of Object.entries(raw.themeUnlocks || {}))
    if (!tierIds.has(tierId)) assert.equal(tierForTheme(theme), null, theme + " falls back to free");
});

test("a gated theme needs its tier, and the ladder hands them over in order", () => {
  const gated = Object.entries(THEME_UNLOCKS);
  const [theme, tierId] = gated.find(([, t]) => t !== WORD_TIERS[0].id);
  const tier = WORD_TIERS.find((t) => t.id === tierId);

  const u = { wordCount: 0, badges: [] };
  awardWordBadges(u);
  assert.equal(canUseTheme(u, theme), false, theme + " is not free");
  assert.ok(!unlockedThemes(u).includes(theme));

  u.wordCount = tier.min - 1;
  awardWordBadges(u);
  assert.equal(canUseTheme(u, theme), false, "one word short is still short");

  u.wordCount = tier.min;
  awardWordBadges(u);
  assert.equal(canUseTheme(u, theme), true);
  assert.ok(unlockedThemes(u).includes(theme));
  // ...and a rank never takes a theme back
  u.wordCount = 999999;
  awardWordBadges(u);
  assert.ok(unlockedThemes(u).includes(theme));
});

test("an admin wears everything regardless of rank", () => {
  const admin = { admin: true, wordCount: 0, badges: [] };
  assert.deepEqual(unlockedThemes(admin).sort(), Object.keys(THEME_UNLOCKS).sort());
  for (const theme of Object.keys(THEME_UNLOCKS)) assert.equal(canUseTheme(admin, theme), true, theme);
  // admin is the account flag, not something a payload can claim
  assert.equal(canUseTheme({ admin: "yes", badges: [] }, Object.keys(THEME_UNLOCKS)[0]), false);
});

test("nobody signed in is nobody's rank", () => {
  assert.deepEqual(unlockedThemes(null), []);
  assert.deepEqual(unlockedThemes(undefined), []);
});

test("themeLocks explains each lock: which tier and what it costs", () => {
  const locks = themeLocks();
  assert.deepEqual(Object.keys(locks).sort(), Object.keys(THEME_UNLOCKS).sort());
  for (const [theme, lock] of Object.entries(locks)) {
    const tier = WORD_TIERS.find((t) => t.id === lock.tier);
    assert.equal(lock.name, tier.name, theme + " names its tier");
    assert.equal(lock.min, tier.min);
  }
});

// ---- the endpoint ----

test("/api/themes: signed out gets locks but no unlocks", async () => {
  const { status, data } = await ctx.api("/api/themes");
  assert.equal(status, 200);
  assert.deepEqual(data.unlocked, []);
  assert.equal(data.admin, false);
  assert.deepEqual(Object.keys(data.locks).sort(), Object.keys(THEME_UNLOCKS).sort());
  const someLock = Object.values(data.locks)[0];
  assert.ok(someLock.name && typeof someLock.min === "number");
});

test("/api/themes and /api/me agree about what a new account has earned", async () => {
  const u = await signup(ctx, "themerookie", "rookie@x.com");
  const { data } = await ctx.api("/api/themes", undefined, u.token);
  const me = await ctx.api("/api/me", undefined, u.token);
  assert.equal(data.admin, false);
  assert.deepEqual(me.data.user.themes, data.unlocked, "/api/me carries the same list");
  // a brand-new account holds the zero-word tier, so its themes are unlocked
  const freeTier = Object.entries(THEME_UNLOCKS).filter(([, t]) => t === WORD_TIERS[0].id).map(([x]) => x);
  assert.deepEqual(data.unlocked.sort(), freeTier.sort());
});

test("/api/themes: an admin account is handed every theme", async () => {
  const a = await signup(ctx, "themeadmin", ADMIN_EMAIL);
  const { data } = await ctx.api("/api/themes", undefined, a.token);
  assert.equal(data.admin, true);
  assert.deepEqual(data.unlocked.sort(), Object.keys(THEME_UNLOCKS).sort());
});

test("a bad token is treated as signed out, not as an error", async () => {
  const { status, data } = await ctx.api("/api/themes", undefined, "not-a-real-token");
  assert.equal(status, 200);
  assert.deepEqual(data.unlocked, []);
});

// ---- a rank-up says what it unlocked ----

test("rewardsForTier / describeRewards: themes by label; puppymike hands out the disco ball with the rink; innate hands out no gimmick", () => {
  const r = rewardsForTier("puppymike");
  const expect = Object.entries(THEME_UNLOCKS).filter(([, t]) => t === "puppymike").map(([id]) => id);
  assert.deepEqual(r.themes.map((x) => x.id).sort(), expect.sort());
  assert.ok(r.themes.every((x) => x.name && x.name !== x.id), "labels come from theme.js");
  assert.deepEqual(r.gimmicks, [{ id: "disco", name: "Rink-O-Mania Disco Ball" }], "the disco ball rides the rink theme");
  assert.deepEqual(rewardsForTier("innate").gimmicks, [], "castlebyers carries no gimmick");
  assert.equal(describeRewards({ themes: [], gimmicks: [] }), "", "a rank that is just a rank says nothing");
  assert.equal(describeRewards({ themes: [{ id: "a", name: "A" }], gimmicks: [] }), "the A theme");
  assert.equal(
    describeRewards({ themes: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }], gimmicks: [{ id: "g", name: "G" }] }),
    "the A, B and C themes and the G gimmick",
  );
});

test("crossing a tier toasts, announces and inboxes the themes it unlocks", async () => {
  const { host, mike, A, B, state } = await startedGame(ctx, { turnSeconds: 60, rounds: 2 });
  const toasts = [], chat = [];
  A.on("badge-earned", (b) => toasts.push(b));
  B.on("badge-earned", (b) => toasts.push(b));
  A.on("chat", (m) => chat.push(m));
  B.on("chat", (m) => chat.push(m));
  const cur = state.current.currentId === A.id ? A : B;
  const other = cur === A ? B : A;
  const wall = Array(3000).fill("we").join(" "); // 3000 words, under the 8000-char cap
  assert.equal((await ctx.emit(cur, "submit-line", { text: wall })).ok, true);
  await ctx.wait(150);
  assert.equal((await ctx.emit(other, "submit-line", { text: "short" })).ok, true);
  await ctx.wait(150);
  assert.equal((await ctx.emit(cur, "submit-line", { text: wall })).ok, true); // 6000 → 🐶 Puppy Mike
  await ctx.wait(300);
  const tier = WORD_TIERS.find((t) => t.id === "puppymike");
  const expect = Object.entries(THEME_UNLOCKS).filter(([, t]) => t === "puppymike").map(([id]) => id);
  const up = toasts.filter((t) => t.badge === tier.name);
  assert.equal(up.length, 2, "both writers get the rank-up toast");
  for (const t of up) {
    assert.deepEqual(t.unlocks.themes.map((x) => x.id).sort(), expect.sort(), "the toast names the themes");
    assert.deepEqual(t.unlocks.gimmicks.map((g) => g.id), ["disco"], "puppymike hands out the disco ball (it rides the rink theme)");
    assert.ok(Array.isArray(t.gimmicks), "a rank-up toast also carries the writer's playable gimmicks, so the menu re-gates without a fetch");
    assert.ok(expect.every((id) => t.themes.includes(id)), "and the full wearable list rides along");
  }
  const line = chat.find((m) => m.sys && m.text.includes(tier.name));
  assert.ok(line && /That unlocks the .* theme/.test(line.text), "chat says what it unlocked: " + line?.text);
  // and a durable note in the writer's inbox — the toast is gone in five seconds
  const who = cur === A ? host : mike;
  const inbox = await ctx.api("/api/inbox", undefined, who.token);
  const note = inbox.data.messages.find((m) => m.type === "system" && m.text.includes(tier.name));
  assert.ok(note, "inbox note landed");
  assert.deepEqual(note.unlocks.themes.map((x) => x.id).sort(), expect.sort());
  const others = await ctx.api("/api/inbox", undefined, (cur === A ? mike : host).token);
  assert.ok(!others.data.messages.some((m) => m.text.includes(tier.name)), "only the writer who ranked up");
});
