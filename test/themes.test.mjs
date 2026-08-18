// Themes as rank rewards: which account may wear which theme, and the data
// (achievements.json's themeUnlocks) that decides it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startServer, signup } from "./helpers.mjs";
import {
  WORD_TIERS, THEME_UNLOCKS, tierForTheme, canUseTheme, unlockedThemes, themeLocks, awardWordBadges,
} from "../lib/achievements.js";

const ADMIN_EMAIL = "admin@cowrite.test";
// The theme registry lives in the client (public/js/theme.js is the source of
// truth for what themes exist); the json only names ids from it.
const THEME_JS = readFileSync(new URL("../public/js/theme.js", import.meta.url), "utf-8");
const THEMES = [...THEME_JS.slice(THEME_JS.indexOf("export const THEMES = ["), THEME_JS.indexOf("export const THEME_LABELS")).matchAll(/"([a-z]+)"/g)].map((m) => m[1]);

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

test("an unlisted theme — or one pointing at a tier that no longer exists — is free", () => {
  assert.equal(tierForTheme("neon"), null);
  assert.equal(tierForTheme("a-theme-nobody-made"), null);
  assert.equal(canUseTheme({ badges: [] }, "neon"), true);
  // THEME_UNLOCKS is filtered at load, so a typo'd tier id can't lock a theme away
  const raw = JSON.parse(readFileSync(new URL("../achievements.json", import.meta.url), "utf-8"));
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
