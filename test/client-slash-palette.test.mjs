// The "/" reference palette's state machine (jsdom for the html builder only —
// the navigation logic is pure).
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.mjs";

installDom();
const {
  createPaletteState, visibleItems, move, choose, goBack, setFilter, breadcrumb, paletteHtml, opensPalette,
} = await import("../public/js/components/slash-palette.js");

const BUNDLE = {
  groups: [
    {
      slug: "action-verbs", label: "Action verbs", prefix: "/action", desc: "beats",
      categories: [
        { key: "gaze", label: "Gaze", words: ["looked", "glanced", "stared"] },
        { key: "hands", label: "Hands", words: ["reached", "gripped"] },
      ],
    },
    {
      slug: "romance", label: "Romance", prefix: "/spice", desc: "slow burn",
      categories: [{ key: "kissing", label: "Kissing", words: ["kissed him"] }],
    },
  ],
};
const st = () => createPaletteState(BUNDLE);

test("opens on the group level and lists every group", () => {
  const s = st();
  assert.equal(s.level, "groups");
  assert.deepEqual(visibleItems(s).map((i) => i.label), ["Action verbs", "Romance"]);
  assert.equal(breadcrumb(s), "Reference");
});

test("arrow keys move and wrap", () => {
  const s = st();
  assert.equal(s.index, 0);
  move(s, 1);
  assert.equal(s.index, 1);
  move(s, 1);
  assert.equal(s.index, 0, "wraps past the end");
  move(s, -1);
  assert.equal(s.index, 1, "wraps backwards");
});

test("enter drills group -> category -> word, and inserts the word", () => {
  const s = st();
  assert.equal(choose(s), null, "picking a group doesn't insert");
  assert.equal(s.level, "categories");
  assert.equal(breadcrumb(s), "Action verbs");
  assert.deepEqual(visibleItems(s).map((i) => i.label), ["Gaze", "Hands"]);

  assert.equal(choose(s), null, "picking a category doesn't insert");
  assert.equal(s.level, "words");
  assert.equal(breadcrumb(s), "Action verbs › Gaze");

  move(s, 1); // "glanced"
  assert.deepEqual(choose(s), { inserted: "glanced" });
});

test("typing filters the current level and resets the cursor", () => {
  const s = st();
  setFilter(s, "rom");
  assert.deepEqual(visibleItems(s).map((i) => i.label), ["Romance"]);
  // filtering matches the prefix too, so "/spice" finds it
  setFilter(s, "spice");
  assert.deepEqual(visibleItems(s).map((i) => i.label), ["Romance"]);

  choose(s);
  choose(s); // into Kissing's words
  setFilter(s, "kissed");
  assert.deepEqual(visibleItems(s).map((i) => i.label), ["kissed him"]);
  setFilter(s, "zzz");
  assert.deepEqual(visibleItems(s), [], "no matches is a valid state");
  assert.equal(choose(s), null, "enter on an empty list does nothing");
});

test("backspace walks back up, and reports when it's already at the top", () => {
  const s = st();
  choose(s);
  choose(s);
  assert.equal(s.level, "words");
  assert.equal(goBack(s), true);
  assert.equal(s.level, "categories");
  assert.equal(goBack(s), true);
  assert.equal(s.level, "groups");
  assert.equal(goBack(s), false, "at the top the caller should close instead");
});

test("the breadcrumb hint names the arrow that applies at this level", () => {
  const s = st();
  assert.match(paletteHtml(s), /→ open/, "nowhere to go back to at the top");
  choose(s);
  assert.match(paletteHtml(s), /← back/, "once drilled in, back is offered");
});

test("renders the current level, marking the selected row", () => {
  const s = st();
  move(s, 1);
  const html = paletteHtml(s);
  assert.ok(html.includes("Romance"));
  assert.ok(html.includes('aria-selected="true"'));
  assert.ok(html.includes("Reference"), "breadcrumb is shown");
  assert.ok(html.includes("/action"), "group rows hint their slash prefix");
});

test("escapes reference text rather than trusting it", () => {
  const s = createPaletteState({
    groups: [{ slug: "x", label: "<img src=x onerror=1>", prefix: "/x", desc: "", categories: [{ key: "k", label: "k", words: ["w"] }] }],
  });
  const html = paletteHtml(s);
  assert.ok(!html.includes("<img"), "no raw markup from the data files");
  assert.ok(html.includes("&lt;img"));
});

// A "/" is only a command when it starts a word. Prose is full of slashes and
// none of them should pop the menu mid-sentence.
test("only a word-initial slash opens the palette", () => {
  const text = (s) => document.createTextNode(s);
  const after = (s) => opensPalette(text(s), s.length); // caret at the end

  assert.equal(after(""), true, "start of an empty text node");
  assert.equal(after("He said "), true, "after a space");
  assert.equal(after("line\n"), true, "after a newline");
  assert.equal(opensPalette(document.createElement("p"), 0), true, "at an element boundary");

  assert.equal(after("and"), false, "and/or must not trigger");
  assert.equal(after("24"), false, "24/7 must not trigger");
  assert.equal(after("https:/"), false, "a url's second slash must not trigger");
  assert.equal(after("<"), false, "a hand-typed </p> must not trigger");
  assert.equal(after("word"), false, "mid-word is prose");
  assert.equal(opensPalette(null, 0), false, "no node, no palette");
});

test("an empty or malformed bundle degrades quietly", () => {
  for (const bad of [undefined, null, {}, { groups: null }]) {
    const s = createPaletteState(bad);
    assert.deepEqual(visibleItems(s), []);
    assert.equal(choose(s), null);
    assert.ok(paletteHtml(s).includes("No matches"));
  }
});
