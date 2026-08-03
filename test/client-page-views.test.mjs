import { test } from "node:test";
import assert from "node:assert/strict";
import {
  onlineUsersHtml, liveGameInfoHtml, statsText, badgeProgress, coverArt,
  myGameStatus, myGameCardHtml, recentRowHtml, achievementsHtml, streakRingHtml, writerRowHtml,
} from "../public/js/dashboard-view.js";
import { gameCardHtml, archiveMetaText, archiveStoryHtml } from "../public/js/archive-view.js";

// ---- dashboard ----
test("onlineUsersHtml: escapes names, marks me, empty fallback", () => {
  const out = onlineUsersHtml([
    { username: "<x>", color: "#6c8cff", badge: "✏️ Inkling", me: true },
    { username: "mike", color: "junk", badge: null },
  ]);
  assert.ok(out.includes("&lt;x&gt; (you)"));
  assert.ok(out.includes("✏️ Inkling"));
  assert.ok(out.includes("#e63946"), "junk color falls back");
  assert.match(onlineUsersHtml([]), /Nobody online/);
});

test("liveGameInfoHtml: phase label, host crown, online count", () => {
  const out = liveGameInfoHtml({
    code: "AB12", name: "The <Tale>", phase: "writing", hostName: "will",
    players: [{ name: "will", connected: true }, { name: "mike", connected: false }],
  });
  assert.ok(out.includes("The &lt;Tale&gt;"));
  assert.ok(out.includes("AB12 · writing"));
  assert.ok(out.includes("👑 will"));
  assert.ok(out.includes("1/2 online"));
});

test("statsText: singulars, next-badge distance, ladder top", () => {
  assert.equal(
    statsText({ wordCount: 99, badges: ["a"], nextBadge: { min: 100, name: "🖊️ Scribbler" } }),
    "99 words written · 1 badge · 1 word to 🖊️ Scribbler",
  );
  assert.equal(statsText({ wordCount: 20000, badges: ["a", "b"], nextBadge: null }), "20000 words written · 2 badges");
});

test("badgeProgress: real word counts in the label, sliver fill, topped-out ladder", () => {
  assert.deepEqual(badgeProgress({ wordCount: 23, nextBadge: { min: 100, name: "🖊️ Scribbler" } }),
    { pct: 23, label: "23 / 100 words to 🖊️ Scribbler" });
  assert.equal(badgeProgress({ wordCount: 8, nextBadge: { min: 5000, name: "🐶 Puppy Mike" } }).pct, 1,
    "any words at all show a sliver");
  assert.match(badgeProgress({ wordCount: 8, nextBadge: { min: 5000, name: "🐶 Puppy Mike" } }).label,
    /8 \/ 5,000 words/);
  assert.equal(badgeProgress({ wordCount: 0, nextBadge: { min: 5000, name: "x" } }).pct, 0);
  assert.equal(badgeProgress({ wordCount: 99, nextBadge: { min: 100, name: "x" } }).pct, 99);
  assert.equal(badgeProgress({ wordCount: 50000, nextBadge: null }).pct, 100);
});

test("writerRowHtml: escapes, online dot, badge chip optional", () => {
  const on = writerRowHtml({ username: "<will>", color: "#6c8cff", wordCount: 1234, badge: "🐶 Puppy Mike", online: true });
  assert.ok(on.includes("&lt;will&gt;"));
  assert.ok(on.includes("st-dot on"));
  assert.ok(on.includes("1,234 words"));
  assert.ok(on.includes("🐶 Puppy Mike"));
  const off = writerRowHtml({ username: "mike", color: "bad", wordCount: 0, badge: null, online: false });
  assert.ok(off.includes("st-dot off"));
  assert.ok(!off.includes("badge-chip"));
  assert.ok(!off.includes("mini-avatar"), "no avatar img without a picture");
  const pic = writerRowHtml({ username: "el", color: "#e879c9", wordCount: 1, online: true,
    avatar: "https://img.com/el.png", avatarFit: "contain" });
  assert.ok(pic.includes('mini-avatar fit-contain'), "directory rows show the profile pic with fit pref");
});

test("coverArt is deterministic per code and palette-bound", () => {
  assert.equal(coverArt("AB12"), coverArt("AB12"));
  assert.match(coverArt("AB12"), /^background:linear-gradient\(\d+deg, #[0-9a-f]{6}, #[0-9a-f]{6}\)$/);
});

test("myGameStatus covers every phase", () => {
  assert.equal(myGameStatus({ phase: "waiting" }).text, "Gathering writers");
  assert.equal(myGameStatus({ phase: "choosing" }).text, "Voting on a scenario");
  assert.deepEqual(myGameStatus({ phase: "writing", myTurn: true }), { text: "● Your turn — write!", cls: "is-turn" });
  assert.equal(myGameStatus({ phase: "writing", paused: true }).cls, "is-paused");
  assert.equal(myGameStatus({ phase: "writing", currentName: "mike" }).text, "Waiting for mike");
  assert.equal(myGameStatus({ phase: "writing" }).text, "In progress");
});

test("myGameCardHtml: escapes name, shows player dots with offline state", () => {
  const out = myGameCardHtml({
    code: "AB12", name: "<b>Tale</b>", phase: "writing", myTurn: true, paused: false,
    players: [{ name: "will", color: "#6c8cff", connected: true }, { name: "mike", color: "bad", connected: false }],
    lines: 3,
  });
  assert.ok(out.includes("&lt;b&gt;Tale&lt;/b&gt;"));
  assert.ok(out.includes("is-turn"));
  assert.ok(out.includes('mg-dot off'), "offline dot dimmed");
  assert.ok(out.includes("2 writers · 3 lines"));
});

test("recentRowHtml + achievementsHtml + streakRingHtml", () => {
  const row = recentRowHtml({ code: "AB12", name: "<Done>", prompt: "", lines: 1, writers: [{ name: "w" }] });
  assert.ok(row.includes("&lt;Done&gt;"));
  assert.ok(row.includes("1 line<"));

  const ach = achievementsHtml({ badges: ["✏️ Inkling"], nextBadge: { name: "🖊️ Scribbler", min: 100 } });
  assert.ok(ach.includes("✏️ Inkling"));
  assert.ok(ach.includes("? 🖊️ Scribbler · 100 words"));
  assert.match(achievementsHtml({ badges: [], nextBadge: null }), /first line/);

  const ring = streakRingHtml(3, 7);
  assert.ok(ring.includes('aria-label="3-day streak"'));
  assert.ok(ring.includes("3d"));
  const full = streakRingHtml(7, 7);
  assert.ok(full.includes('stroke-dashoffset="0.0"'), "at best -> full ring");
});

// ---- archive ----
test("gameCardHtml: escapes everything, marks host writers, counts lines", () => {
  const out = gameCardHtml({
    code: "AB12", name: "<b>N</b>", prompt: "<i>P</i>", phase: "over", lines: 1,
    hostName: "will", savedAt: 0,
    writers: [{ name: "will", isHost: true }, { name: "mike", isHost: false }],
  });
  assert.ok(out.includes("&lt;b&gt;N&lt;/b&gt;"));
  assert.ok(out.includes("&lt;i&gt;P&lt;/i&gt;"));
  assert.ok(out.includes("1 line<"));
  assert.ok(out.includes("finished"));
  assert.ok(out.includes("👑 will, mike"));
});

test("archiveMetaText + archiveStoryHtml: sanitized html as-is, names escaped, empty state", () => {
  assert.match(archiveMetaText({ code: "AB12", phase: "writing", savedAt: 0 }), /^AB12 · paused · /);
  const out = archiveStoryHtml([{ name: "<will>", color: "bad", html: "<b>line</b>", host: true }]);
  assert.ok(out.includes("<b>line</b>"), "server-sanitized html untouched");
  assert.ok(out.includes("&lt;will&gt;"));
  assert.ok(out.includes("👑"));
  assert.match(archiveStoryHtml([]), /Nothing written yet/);
});
