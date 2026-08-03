import { test } from "node:test";
import assert from "node:assert/strict";
import { onlineUsersHtml, liveGameInfoHtml, statsText } from "../public/js/dashboard-view.js";
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
