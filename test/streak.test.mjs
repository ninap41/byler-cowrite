import { test } from "node:test";
import assert from "node:assert/strict";
import { bumpStreak, dayOf } from "../lib/streak.js";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 7, 3, 12); // 2026-08-03 noon UTC

test("first line ever starts a 1-day streak", () => {
  const u = {};
  bumpStreak(u, T0);
  assert.equal(u.streak, 1);
  assert.equal(u.bestStreak, 1);
  assert.equal(u.lastWroteDay, "2026-08-03");
});

test("multiple lines the same day don't increment", () => {
  const u = {};
  bumpStreak(u, T0);
  bumpStreak(u, T0 + 3600_000);
  assert.equal(u.streak, 1);
});

test("writing the next day extends; the day after that too", () => {
  const u = {};
  bumpStreak(u, T0);
  bumpStreak(u, T0 + DAY);
  bumpStreak(u, T0 + 2 * DAY);
  assert.equal(u.streak, 3);
  assert.equal(u.bestStreak, 3);
});

test("a missed day resets the streak but keeps the best", () => {
  const u = {};
  bumpStreak(u, T0);
  bumpStreak(u, T0 + DAY);
  bumpStreak(u, T0 + 3 * DAY); // skipped a day
  assert.equal(u.streak, 1);
  assert.equal(u.bestStreak, 2);
});

test("day boundary is calendar-based, not 24h-based", () => {
  const u = {};
  const lateNight = Date.UTC(2026, 7, 3, 23, 50);
  const earlyNext = Date.UTC(2026, 7, 4, 0, 10); // 20 minutes later, new day
  bumpStreak(u, lateNight);
  bumpStreak(u, earlyNext);
  assert.equal(u.streak, 2);
  assert.equal(dayOf(earlyNext), "2026-08-04");
});
