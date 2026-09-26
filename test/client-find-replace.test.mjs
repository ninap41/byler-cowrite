// Find & replace in the solo editor (components/find-replace.ts): the pure
// matcher, the text-node replace that must never disturb markup — bold, size
// spans, comment anchors — and the bar driven on jsdom, in both views.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installDom, mount } from "./dom.mjs";

installDom();
const { findMatches, replaceInText, textIndex, rangeFor, replaceInDom, mountFindReplace } = await import("../public/js/components/find-replace.js");
const { cleanHtml } = await import("../public/js/components/editor.js");

test("findMatches: case, whole word, no overlaps, nothing for an empty query", () => {
  assert.deepEqual(findMatches("Will and will", "will"), [{ start: 0, end: 4 }, { start: 9, end: 13 }]);
  assert.deepEqual(findMatches("Will and will", "will", { caseSensitive: true }), [{ start: 9, end: 13 }]);
  assert.deepEqual(findMatches("willing Will, will.", "will", { wholeWord: true }), [{ start: 8, end: 12 }, { start: 14, end: 18 }]);
  assert.deepEqual(findMatches("aaaa", "aa"), [{ start: 0, end: 2 }, { start: 2, end: 4 }]);
  assert.deepEqual(findMatches("anything", ""), []);
  assert.deepEqual(findMatches("café éclair", "É"), [{ start: 3, end: 4 }, { start: 5, end: 6 }], "accents fold like any letter");
  assert.deepEqual(findMatches("a.b a*b", "a*b"), [{ start: 4, end: 7 }], "the query is words, never a pattern");
});

test("replaceInText rewrites every range, and a replacement containing the query is not re-matched", () => {
  const text = "<p>Mike</p>\n<p>mike</p>";
  assert.equal(replaceInText(text, findMatches(text, "mike"), "Mike Wheeler"), "<p>Mike Wheeler</p>\n<p>Mike Wheeler</p>");
});

test("the index reads a paragraph break as a newline, so a match never spans two blocks", () => {
  const el = mount("<p>the end</p><p>of it</p>");
  const index = textIndex(el);
  assert.equal(index.text, "the end\nof it");
  assert.deepEqual(findMatches(index.text, "end of"), []);
  assert.equal(findMatches(index.text, "end").length, 1);
});

test("rangeFor selects exactly the matched words, across an inline tag", () => {
  const el = mount("<p>He flipped it to Clo<b>sed</b> again</p>");
  const index = textIndex(el);
  const [m] = findMatches(index.text, "closed");
  assert.equal(rangeFor(index, m).toString(), "Closed");
});

test("a replace edits characters only: bold, size spans and comment anchors survive", () => {
  const el = mount(
    '<p>The <b>sign</b> said <span class="cmt" data-cid="0123456789ab">the sign was old</span>, a <span class="fs-18">sign</span>.</p>'
  );
  const index = textIndex(el);
  assert.equal(replaceInDom(el, findMatches(index.text, "sign"), "banner"), 3);
  assert.equal(
    el.innerHTML,
    '<p>The <b>banner</b> said <span class="cmt" data-cid="0123456789ab">the banner was old</span>, a <span class="fs-18">banner</span>.</p>'
  );
  assert.equal(cleanHtml(el, { doc: true }), el.innerHTML, "and what is left is still a clean document");
});

test("a match that crosses a tag keeps the tag and puts the new word where the old one began", () => {
  const el = mount("<p>Clo<b>sed</b> for good</p>");
  const index = textIndex(el);
  replaceInDom(el, findMatches(index.text, "closed"), "Open");
  assert.equal(el.textContent, "Open for good");
  assert.ok(el.querySelector("b"), "the markup is not torn out");
});

test("a replacement is TEXT: markup typed into the box never becomes markup", () => {
  const el = mount("<p>say hi</p>");
  replaceInDom(el, findMatches(textIndex(el).text, "hi"), "<img src=x onerror=a()>");
  assert.equal(el.querySelector("img"), null);
  assert.ok(el.textContent.includes("<img"));
});

const harness = ({ html = "<p>one two one</p><p>One more</p>", source = false, canReplace = true } = {}) => {
  document.body.innerHTML = ""; // one harness on the page at a time
  const root = mount(`<div id="ed" contenteditable="true">${html}</div><textarea id="src"></textarea><div id="bar" class="hidden"></div>`);
  const editor = root.querySelector("#ed"), src = root.querySelector("#src"), bar = root.querySelector("#bar");
  src.value = html;
  let edits = 0;
  const api = mountFindReplace({ editor, source: src, bar, isSource: () => source, canReplace: () => canReplace, onEdit: () => edits++ });
  const type = (id, value) => {
    const el = bar.querySelector("#" + id);
    el.value = value;
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  const click = (id) => bar.querySelector("#" + id).click();
  return { editor, src, bar, api, type, click, count: () => bar.querySelector("#findCount").textContent, edits: () => edits };
};

test("the bar counts, steps and wraps", () => {
  const h = harness();
  h.api.open();
  assert.ok(h.api.isOpen());
  h.type("findInput", "one");
  assert.equal(h.count(), "1 of 3");
  h.click("findNext");
  h.click("findNext");
  assert.equal(h.count(), "3 of 3");
  h.click("findNext");
  assert.equal(h.count(), "1 of 3", "wraps to the top");
  h.click("findPrev");
  assert.equal(h.count(), "3 of 3");
  h.bar.querySelector("#findCase").click();
  assert.equal(h.count(), "1 of 2", "match case narrows it");
  h.type("findInput", "zebra");
  assert.equal(h.count(), "No matches");
  h.api.close();
  assert.ok(!h.api.isOpen());
});

test("Replace takes the current match and moves on; Replace all takes the rest; each is an edit", () => {
  const h = harness();
  h.api.open();
  h.type("findInput", "one");
  h.bar.querySelector("#replaceInput").value = "1";
  h.click("replaceOne");
  assert.equal(h.editor.innerHTML, "<p>1 two one</p><p>One more</p>");
  assert.equal(h.count(), "1 of 2");
  assert.equal(h.edits(), 1);
  h.click("replaceAll");
  assert.equal(h.editor.innerHTML, "<p>1 two 1</p><p>1 more</p>");
  assert.equal(h.count(), "Replaced 2");
  assert.equal(h.edits(), 2);
});

test("replacing a word with a longer one containing it never loops", () => {
  const h = harness({ html: "<p>Mike and Mike</p>" });
  h.api.open();
  h.type("findInput", "Mike");
  h.bar.querySelector("#replaceInput").value = "Mike Wheeler";
  h.click("replaceOne");
  h.click("replaceOne");
  assert.equal(h.editor.textContent, "Mike Wheeler and Mike Wheeler");
});

test("in the HTML view the same bar works on the raw source", () => {
  const h = harness({ source: true });
  h.api.open();
  h.type("findInput", "one");
  assert.equal(h.count(), "1 of 3");
  h.bar.querySelector("#replaceInput").value = "uno";
  h.click("replaceAll");
  assert.equal(h.src.value, "<p>uno two uno</p><p>uno more</p>");
  assert.equal(h.editor.innerHTML, "<p>one two one</p><p>One more</p>", "the hidden editor is not the one edited");
});

test("a reader can find but never replace", () => {
  const h = harness({ canReplace: false });
  h.api.open();
  assert.ok(h.bar.querySelector("#findReplaceRow").classList.contains("hidden"));
  h.type("findInput", "one");
  assert.equal(h.count(), "1 of 3");
  h.click("replaceAll");
  assert.equal(h.editor.innerHTML, "<p>one two one</p><p>One more</p>");
  assert.equal(h.edits(), 0);
});

test("refresh re-searches when the words change under an open bar", () => {
  const h = harness();
  h.api.open();
  h.type("findInput", "one");
  h.editor.innerHTML = "<p>one</p>";
  h.api.refresh();
  assert.equal(h.count(), "1 of 1");
});

test("the write page mounts it: a toolbar button, a bar in the sticky shell, Ctrl/⌘+F, and styles that can hide", () => {
  const page = readFileSync("public/write.html", "utf8");
  const js = readFileSync("public/js/pages/write.js", "utf8");
  const css = readFileSync("public/css/base.css", "utf8");
  assert.ok(page.includes('id="findBtn"'));
  const shell = page.slice(page.indexOf('id="docShell"'), page.indexOf('id="docErr"'));
  assert.ok(shell.includes('id="findBar"'), "inside the shell, so --doc-sticky measures it");
  assert.match(js, /mountFindReplace\(/);
  assert.match(js, /find: \(\) => toggleFind\(true\)/, "the shortcut: Ctrl/⌘+F is the hot-keys table's find action (components/hot-keys)");
  assert.match(js, /"Escape" ?&& ?findBar\.isOpen\(\)/, "Escape closes it from anywhere on the page");
  assert.match(js, /canReplace: ?\(\) ?=> ?canEditDoc\(\) ?&& ?!commentMode/, "only the author, never in comment mode");
  assert.ok(css.indexOf(".find-bar.hidden") > css.indexOf(".find-bar {"), ".hidden twin comes after the display rule");
  assert.ok(css.includes("::highlight(find-current)"));
});

test("a chapter switch in the HTML view fills the source from the DOM, never from the stored string", () => {
  const js = readFileSync("public/js/pages/write.js", "utf8");
  const go = js.slice(js.indexOf("function goChapter("), js.indexOf("function addChapter("));
  assert.ok(!/formatSource\(ch\??\.html/.test(go), "stored html (with its &#39; entities) must not be pasted into the textarea");
  assert.match(go, /formatSource\(cleanHtml\(/);
  assert.ok(go.indexOf("innerHTML") < go.indexOf("formatSource("), "the editor is filled first");
});
