import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom, mount } from "./dom.mjs";

installDom();
const { storyHtml, livePreviewHtml, EMPTY_STORY_HTML } = await import("../public/js/components/story-feed.js");
const { chatMessageHtml } = await import("../public/js/components/chat-view.js");
const { countdownView } = await import("../public/js/components/countdown.js");
const { statusDot, refreshStatusDots, updateLiveStatus, presenceHtml } = await import("../public/js/status.js");
const { buildExports, exportDocument, exportWork, exportChapterHtml, slugOf } = await import("../public/js/export.js");

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
  const disc = chatMessageHtml({ name: "x", color: "#6c8cff", text: "hi" });
  assert.ok(disc.includes("mini-initial") && disc.includes(">X<"), "no picture -> colored initial disc");
});

test("avatarHtml carries the fit preference", async () => {
  const { avatarHtml } = await import("../public/js/profile-view.js");
  assert.ok(avatarHtml({ username: "w", avatar: "https://i.com/a.png", avatarFit: "contain" }).includes("fit-contain"));
  assert.ok(avatarHtml({ username: "w", avatar: "https://i.com/a.png" }).includes("fit-cover"));
});

test("chatMessageHtml: minimal person tag, avatar + name + (host); text escaped", () => {
  const out = chatMessageHtml({ name: "will", color: "#6c8cff", badge: "✏️ <b>", text: "<script>hi" });
  assert.ok(out.includes("&lt;script&gt;hi"), "text escaped");
  assert.ok(!out.includes("badge-chip"), "no badge chip in chat");
  assert.ok(!out.includes("st-dot"), "no status dot in chat");
  assert.ok(!out.includes("cn-host"), "no host tag for non-hosts");
  const host = chatMessageHtml({ name: "will", color: "#6c8cff", host: true, text: "hi" });
  assert.ok(host.includes(">(host)<"), "host tagged in parens");
  const sys = chatMessageHtml({ name: "will", color: "#6c8cff", host: true, badge: "x", text: "started", sys: true });
  assert.ok(!sys.includes("cn-host") && !sys.includes("mini-avatar"), "system lines stay bare");
});

// ---- countdown ----
test("countdownView: untimed story (no deadline) shows ∞ and NEVER expires or chimes low", () => {
  const v = countdownView({ paused: false, deadline: 0, turnSeconds: 0 });
  assert.equal(v.text, "∞");
  assert.equal(v.expired, false, "no expiry -> no auto-submit ever");
  assert.equal(v.low, false, "no doom effects without a clock");
  assert.equal(v.left, Infinity);
  // still ∞ a long "time" later — there is nothing to count down
  assert.equal(countdownView({ paused: false, deadline: 0 }, Date.now() + 9_999_999).text, "∞");
  // paused untimed game shows the pause glyph without a bogus remaining
  assert.equal(countdownView({ paused: true, remaining: 0, turnSeconds: 0 }).text, "⏸");
});

test("countdownView: paused freezes remaining; live counts down; expires at 0", () => {
  assert.deepEqual(countdownView({ paused: true, remaining: 12400 }), {
    text: "⏸ 13s", left: 13, paused: true, low: false, expired: false,
  });
  const now = 1_000_000;
  const v = countdownView({ paused: false, deadline: now + 30_000 }, now);
  assert.deepEqual(v, { text: "30s", left: 30, paused: false, low: false, expired: false });
  assert.equal(countdownView({ deadline: now + 9_000 }, now).low, true, "low at <=10s");
  const done = countdownView({ deadline: now - 1 }, now);
  assert.equal(done.text, "0s");
  assert.equal(done.expired, true);
  assert.equal(done.left, 0);
  assert.equal(countdownView({ deadline: now + 14_500 }, now).left, 15, "left exposed for the clock alarm");
  assert.equal(countdownView({ paused: true, remaining: 0 }).text, "⏸ 0s");
});

// ---- status dots ----
test("status dots resolve against the live map, unknown names stay unknown", () => {
  const box = mount(statusDot("will") + statusDot("mike") + statusDot("ghost"));
  updateLiveStatus([{ name: "will", connected: true }, { name: "mike", connected: false }]);
  const [w, m, g] = box.querySelectorAll("[data-status-name]");
  assert.ok(w.classList.contains("on") && w.title === "In game");
  assert.ok(m.classList.contains("off") && m.title === "Not in game");
  assert.ok(g.classList.contains("unknown") && g.title === "");
  updateLiveStatus("not-an-array"); // ignored, no throw
  refreshStatusDots();
  assert.ok(w.classList.contains("on"), "state survives refresh");
  box.remove();
  // the writers/players lists say it in words too
  assert.match(presenceHtml(true), /st-dot on" title="In game"><\/span><span class="st-label on">In game/);
  assert.match(presenceHtml(false), /st-label off">Not in game/);
});

// ---- exports ----
test("the exported document keeps a multi-line prompt's breaks", () => {
  const { html, plain } = buildExports("Line one.\nLine two.", []);
  assert.ok(html.includes("Line one.\nLine two."), "html carries the newline through");
  assert.ok(plain.startsWith("Line one.\nLine two.\n\n"), "and so does the plain-text copy");
  assert.match(exportDocument(html), /h3\.prompt\{[^}]*white-space:pre-line/, "the download renders them");
});

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

// ---- the all-stories layout picker ----

test("the shelf's layout picker offers a list and three column counts", async () => {
  const { STORY_VIEWS, viewToggleHtml, cleanStoryView, storyView, DEFAULT_STORY_VIEW } =
    await import("../public/js/archive-view.js");
  assert.deepEqual(STORY_VIEWS.map((v) => v.key), ["list", "g3", "g4", "g6"]);
  assert.deepEqual(STORY_VIEWS.map((v) => v.cols), [1, 3, 4, 6]);
  assert.equal(DEFAULT_STORY_VIEW, "list", "a full-width card per row is the reading default");

  // anything unrecognised (a stale or hand-edited localStorage value) reads as the default
  for (const junk of ["g9", "", null, 4, "<img>"]) assert.equal(cleanStoryView(junk), "list", JSON.stringify(junk));
  assert.equal(storyView("g6").cols, 6);

  const html = viewToggleHtml("g4");
  assert.ok(html.includes('data-view="g4"') && html.includes('aria-pressed="true"'), "the current view is announced");
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1, "exactly one segment is pressed");
  assert.ok(html.includes('aria-label="4 across"'), "each segment says what it does, glyph or not");
});

test("solo-write exports: one chapter headed under the title, or the whole work ruled apart; filenames slug the title", () => {
  const doc = { title: "The <Upside> Down", chapters: [
    { id: "a", title: "One", html: "<p>first</p>" }, { id: "b", title: "", html: "<p>second</p>" },
  ] };
  const one = exportChapterHtml(doc, doc.chapters[1]);
  assert.equal(one, "<h1>The &lt;Upside&gt; Down</h1>\n<h2 class=\"chapter\">Chapter 2</h2>\n<p>second</p>", "a bare title is numbered by position; the title is escaped");
  const all = exportWork(doc);
  assert.equal(all, "<h1>The &lt;Upside&gt; Down</h1>\n<h2 class=\"chapter\">One</h2>\n<p>first</p>\n<hr>\n<h2 class=\"chapter\">Chapter 2</h2>\n<p>second</p>");
  assert.match(exportDocument(all), /h2\.chapter\{margin-top/, "the standalone page spaces chapters");
  assert.equal(slugOf("The Upside Down!"), "the-upside-down");
  assert.equal(slugOf("   "), "story");
});

// ---- chat reactions ----
test("reactions: toggle per key, refuse system lines and unknown emoji, render counted chips with mine marked", async () => {
  const { REACTIONS, toggleReaction, reactionsHtml, reactionPickerHtml } = await import("../public/js/components/reactions.js");
  const m = { mid: "abc", text: "hi" };
  assert.equal(toggleReaction(m, "u1", "will", "❤️"), true);
  assert.equal(toggleReaction(m, "u2", "mike", "❤️"), true);
  assert.equal(m.reactions["❤️"].length, 2);
  assert.equal(toggleReaction(m, "u1", "will", "❤️"), true, "toggling off");
  assert.equal(m.reactions["❤️"].length, 1);
  assert.equal(toggleReaction(m, "u1", "will", "🤖"), false, "off the list");
  assert.equal(toggleReaction({ sys: true, text: "rolled a 13" }, "u1", "will", "❤️"), false, "system lines refuse");
  assert.equal(toggleReaction({ text: "no mid" }, "u1", "will", "❤️"), false);
  const html = reactionsHtml(m.reactions, "u2");
  assert.ok(html.includes('class="react mine"') && html.includes('data-react="❤️"') && html.includes('<span class="react-n">1</span>'));
  assert.ok(reactionsHtml(m.reactions, "u9").includes('class="react"'), "not mine without my key");
  assert.equal(reactionsHtml(undefined, "u1"), "");
  toggleReaction(m, "u2", "mike", "❤️");
  assert.equal(m.reactions, undefined, "an emptied map goes away");
  assert.equal(toggleReaction(m, "u3", "<b>x</b>", "🔥"), true);
  assert.ok(reactionsHtml(m.reactions, "u3").includes('title="&lt;b&gt;x&lt;/b&gt;"'), "names escaped in the tooltip");
  const pick = reactionPickerHtml(m.reactions, "u3");
  assert.equal((pick.match(/react-opt/g) || []).length, REACTIONS.length);
  assert.ok(pick.includes('class="react-opt on" data-react="🔥"'));
  assert.ok(pick.includes('class="react-search"'), "a search box over the grid");
});

test("reactions: the list is a grid of whole rows, every emoji has search words, search matches by word prefix", async () => {
  const { REACTIONS, EMOJI_WORDS, searchReactions, reactionGridHtml } = await import("../public/js/components/reactions.js");
  assert.equal(REACTIONS.length % 8, 0, "eight per row");
  assert.equal(new Set(REACTIONS).size, REACTIONS.length, "no duplicates");
  for (const e of REACTIONS) assert.ok(EMOJI_WORDS[e]?.trim(), e + " has words");
  assert.deepEqual(searchReactions(""), REACTIONS, "empty query = everything");
  assert.deepEqual(searchReactions("  "), REACTIONS);
  assert.ok(searchReactions("hea").includes("❤️") && searchReactions("hea").includes("🫶"), "prefix match");
  assert.deepEqual(searchReactions("Red Heart"), ["❤️"], "every word must hit, case-insensitive");
  assert.deepEqual(searchReactions("zzzzz"), []);
  assert.deepEqual(searchReactions("waffle"), ["🧇"]);
  const grid = reactionGridHtml({ "🔥": [{ key: "u1", name: "will" }] }, "u1", "fire");
  assert.ok(grid.includes('class="react-opt on" data-react="🔥"') && !grid.includes("😂"));
  const none = reactionGridHtml({}, "u1", "<b>zz</b>");
  assert.ok(none.includes("react-none") && none.includes("&lt;b&gt;zz&lt;/b&gt;"), "no-match note, query escaped");
});

test("reactions: chip markup — one chip per emoji in list order, count, tooltip of names, no chip for an empty list", async () => {
  const { reactionsHtml } = await import("../public/js/components/reactions.js");
  const html = reactionsHtml({ "👀": [{ key: "a", name: "will" }, { key: "b", name: "mike" }], "😂": [{ key: "a", name: "will" }], "💀": [] }, "zz");
  const chips = html.match(/<button[^>]*class="react[^"]*"/g) || [];
  assert.equal(chips.length, 2, "an empty list draws nothing");
  assert.ok(html.indexOf('data-react="😂"') < html.indexOf('data-react="👀"'), "list order, not insertion order");
  assert.ok(html.includes('title="will, mike"') && html.includes('<span class="react-n">2</span>'));
  assert.ok(!html.includes("mine"));
});
