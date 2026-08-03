import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom, mount } from "./dom.mjs";

installDom();
const { storyHtml, livePreviewHtml, EMPTY_STORY_HTML } = await import("../public/js/components/story-feed.js");
const { chatMessageHtml } = await import("../public/js/components/chat-view.js");
const { countdownView } = await import("../public/js/components/countdown.js");
const { statusDot, refreshStatusDots, updateLiveStatus } = await import("../public/js/status.js");
const { buildExports, exportDocument } = await import("../public/js/export.js");

// ---- story feed ----
test("storyHtml: empty story placeholder", () => {
  assert.equal(storyHtml([]), EMPTY_STORY_HTML);
});

test("storyHtml: edit button only on my lines, edited tag, data-idx", () => {
  const story = [
    { name: "will", color: "#6c8cff", html: "mine", userId: "u1", edited: true },
    { name: "mike", color: "#e63946", html: "theirs", userId: "u2" },
  ];
  const out = storyHtml(story, { mineId: "u1" });
  const [a, b] = out.split('data-idx="1"');
  assert.ok(a.includes("line-edit"), "my line editable");
  assert.ok(a.includes("edited-tag"), "revision marked");
  assert.ok(!b.includes("line-edit"), "their line not editable");
  assert.ok(out.includes('data-idx="0"'));
  assert.ok(!storyHtml(story, {}).includes("line-edit"), "no editing when signed-out id missing");
});

test("storyHtml: server-sanitized html injected as-is, names escaped, fresh from index", () => {
  const story = [
    { name: "<will>", color: "#6c8cff", html: "<b>bold</b> line" },
    { name: "mike", color: "nope", html: "second" },
  ];
  const out = storyHtml(story, { freshFrom: 1 });
  assert.ok(out.includes("<b>bold</b> line"), "sanitized html untouched");
  assert.ok(out.includes("&lt;will&gt;"), "name escaped");
  assert.ok(out.includes("#e63946"), "junk color falls back to palette");
  const fresh = out.split("story-line").slice(1);
  assert.ok(!fresh[0].startsWith(" fresh"), "old line not fresh");
  assert.ok(fresh[1].startsWith(" fresh"), "new line animates");
});

test("livePreviewHtml carries a caret and escapes the name", () => {
  const out = livePreviewHtml("<i>typing</i>", "m&m", "#6c8cff");
  assert.ok(out.includes("<i>typing</i>"));
  assert.ok(out.includes("m&amp;m"));
  assert.ok(out.includes('class="caret"'));
});

// ---- chat ----
test("chatMessageHtml: profile pic beside the name; system messages have none", () => {
  const m = { name: "will", color: "#6c8cff", text: "hi", avatar: "https://img.com/w.png", avatarFit: "cover" };
  assert.ok(chatMessageHtml(m).includes('mini-avatar fit-cover'));
  assert.ok(!chatMessageHtml({ ...m, sys: true }).includes("mini-avatar"), "system lines stay bare");
  assert.ok(!chatMessageHtml({ name: "x", color: "#6c8cff", text: "hi" }).includes("mini-avatar"));
});

test("avatarHtml carries the fit preference", async () => {
  const { avatarHtml } = await import("../public/js/profile-view.js");
  assert.ok(avatarHtml({ username: "w", avatar: "https://i.com/a.png", avatarFit: "contain" }).includes("fit-contain"));
  assert.ok(avatarHtml({ username: "w", avatar: "https://i.com/a.png" }).includes("fit-cover"));
});

test("chatMessageHtml: text and badge escaped, system messages skip dot/marks", () => {
  const out = chatMessageHtml({ name: "will", color: "#6c8cff", badge: "✏️ <b>", text: "<script>hi" });
  assert.ok(out.includes("&lt;script&gt;hi"), "text escaped");
  assert.ok(out.includes("✏️ &lt;b&gt;"), "badge escaped");
  assert.ok(out.includes("st-dot"), "status dot present");
  const sys = chatMessageHtml({ name: "will", color: "#6c8cff", badge: "x", text: "started", sys: true });
  assert.ok(!sys.includes("st-dot"), "no dot on system lines");
  assert.ok(!sys.includes("badge-chip"), "no badge on system lines");
});

// ---- countdown ----
test("countdownView: paused freezes remaining; live counts down; expires at 0", () => {
  assert.deepEqual(countdownView({ paused: true, remaining: 12400 }), {
    text: "⏸ 13s", paused: true, low: false, expired: false,
  });
  const now = 1_000_000;
  const v = countdownView({ paused: false, deadline: now + 30_000 }, now);
  assert.deepEqual(v, { text: "30s", paused: false, low: false, expired: false });
  assert.equal(countdownView({ deadline: now + 9_000 }, now).low, true, "low at <=10s");
  const done = countdownView({ deadline: now - 1 }, now);
  assert.equal(done.text, "0s");
  assert.equal(done.expired, true);
  assert.equal(countdownView({ paused: true, remaining: 0 }).text, "⏸ 0s");
});

// ---- status dots ----
test("status dots resolve against the live map, unknown names stay unknown", () => {
  const box = mount(statusDot("will") + statusDot("mike") + statusDot("ghost"));
  updateLiveStatus([{ name: "will", connected: true }, { name: "mike", connected: false }]);
  const [w, m, g] = box.querySelectorAll("[data-status-name]");
  assert.ok(w.classList.contains("on") && w.title === "Online");
  assert.ok(m.classList.contains("off") && m.title === "Offline");
  assert.ok(g.classList.contains("unknown") && g.title === "");
  updateLiveStatus("not-an-array"); // ignored, no throw
  refreshStatusDots();
  assert.ok(w.classList.contains("on"), "state survives refresh");
  box.remove();
});

// ---- exports ----
test("buildExports: names stripped, blocks stand alone, inline lines wrapped, plain text unescaped", () => {
  const story = [
    { name: "will", color: "#6c8cff", html: "just <b>inline</b>" },
    { name: "mike", color: "#e63946", html: "<h2>Chapter</h2>" },
    { name: "will", color: "#6c8cff", html: "one<br>two &amp; three" },
  ];
  const { html, plain } = buildExports("A <prompt>", story);
  assert.ok(html.startsWith("<h3 class=\"prompt\"><em>A &lt;prompt&gt;</em></h3>"), "prompt escaped");
  assert.ok(html.includes("<p>just <b>inline</b></p>"), "inline line wrapped");
  assert.ok(html.includes("\n<h2>Chapter</h2>\n"), "block line not double-wrapped");
  assert.ok(!html.includes("will") && !html.includes("mike"), "no usernames");
  assert.ok(plain.startsWith("A <prompt>\n\n"), "plain keeps raw prompt");
  assert.ok(plain.includes("one\ntwo & three"), "br -> newline, entities decoded");
  assert.ok(!plain.includes("<b>"), "no tags in plain text");
});

test("exportDocument wraps the html in a standalone styled page", () => {
  const doc = exportDocument("<p>body</p>");
  assert.ok(doc.startsWith("<!doctype html>"));
  assert.ok(doc.includes("<p>body</p>"));
  assert.ok(doc.includes(".al-c{text-align:center}"), "alignment styles included");
});
