import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom, mount } from "./dom.mjs";

installDom();
const { absorbFontTags, pruneRedundantSizes, sizesInRange, sizeOf, nearestSize, DEFAULT_SIZE } = await import(
  "../public/js/components/font-size.js"
);
const { FONT_SIZES } = await import("../public/js/components/editor.js");

// The toolbar's size box is a WYSIWYG overwrite: whatever the selection was
// wearing, typing a number puts THAT size on every word of it. execCommand
// gives us <font size="7"> wrappers; everything below is what we do with them.

test("a font tag becomes an fs-* span at the requested ladder size", () => {
  const root = mount('<p>a<font size="7">bc</font>d</p>');
  const made = absorbFontTags(root, 24);
  assert.equal(root.innerHTML, '<p>a<span class="fs-24">bc</span>d</p>');
  assert.equal(made.length, 1);
  assert.equal(made[0].className, "fs-24");
});

test("a mixed-size selection is overwritten, not nested — the old sizes are stripped", () => {
  // execCommand wraps the whole selection, leaving the old sizes INSIDE.
  // The nearest ancestor wins, so without stripping them the resize would
  // silently do nothing to the already-sized words.
  const root = mount('<p><font size="7"><span class="fs-12">small</span> plain <span class="fs-36">big</span></font></p>');
  absorbFontTags(root, 20);
  assert.equal(root.innerHTML, '<p><span class="fs-20">small plain big</span></p>');
  assert.equal(root.querySelectorAll(".fs-12, .fs-36").length, 0);
});

test("other formatting inside the selection survives the overwrite", () => {
  const root = mount('<p><font size="7"><b>bold</b><span class="fs-48"><i>x</i></span></font></p>');
  absorbFontTags(root, 18);
  assert.equal(root.innerHTML, '<p><span class="fs-18"><b>bold</b><i>x</i></span></p>');
});

test("several font tags across blocks all convert, in document order", () => {
  const root = mount('<p><font size="7">one</font></p><p><font size="7">two</font></p>');
  const made = absorbFontTags(root, 28);
  assert.equal(made.length, 2);
  assert.equal(made[0].textContent, "one");
  assert.equal(made[1].textContent, "two");
  assert.equal(root.querySelectorAll("font").length, 0);
});

test("an off-ladder number snaps to the nearest rung", () => {
  const root = mount('<p><font size="7">x</font></p>');
  absorbFontTags(root, 23);
  assert.equal(root.innerHTML, '<p><span class="fs-24">x</span></p>');
  assert.equal(nearestSize(23), 24);
  assert.equal(nearestSize(1), FONT_SIZES[0]);
  assert.equal(nearestSize(999), FONT_SIZES[FONT_SIZES.length - 1]);
});

test("6px is on the ladder and reachable — it is the smallest size", () => {
  assert.equal(FONT_SIZES[0], 6);
  assert.equal(nearestSize(6), 6);
  assert.equal(nearestSize(2), 6);
  const root = mount('<p><font size="7">tiny</font></p>');
  absorbFontTags(root, 6);
  assert.equal(root.innerHTML, '<p><span class="fs-6">tiny</span></p>');
});

test("a size span that governs no text is pruned; one that still owns words stays", () => {
  const outer = mount('<p><span class="fs-20"><span class="fs-32">all of it</span></span></p>');
  pruneRedundantSizes(outer);
  assert.equal(outer.innerHTML, '<p><span class="fs-32">all of it</span></p>');

  const keep = mount('<p><span class="fs-20">mine<span class="fs-32">theirs</span></span></p>');
  pruneRedundantSizes(keep);
  assert.equal(keep.innerHTML, '<p><span class="fs-20">mine<span class="fs-32">theirs</span></span></p>');
});

test("sizeOf reports the nearest fs ancestor, and the base size for bare text", () => {
  const root = mount('<p>bare<span class="fs-20">a<span class="fs-36">b</span></span></p>');
  const [bare, a, b] = [...root.querySelectorAll("p, .fs-20, .fs-36")].map((el) => el);
  assert.equal(sizeOf(bare.firstChild, root), DEFAULT_SIZE);
  assert.equal(sizeOf(a.firstChild, root), 20);
  assert.equal(sizeOf(b.firstChild, root), 36);
});

test("sizesInRange reports every size under the selection — that is what says Multi", () => {
  const root = mount('<p><span class="fs-12">small</span> plain <span class="fs-36">big</span></p>');
  const range = document.createRange();
  range.selectNodeContents(root);
  assert.deepEqual(sizesInRange(root, range).sort((x, y) => x - y), [12, DEFAULT_SIZE, 36].sort((x, y) => x - y));

  // a caret inside one size reports exactly that size
  const caret = document.createRange();
  caret.setStart(root.querySelector(".fs-36").firstChild, 1);
  caret.collapse(true);
  assert.deepEqual(sizesInRange(root, caret), [36]);

  // a range outside the editor belongs to nobody
  const away = mount("<p>elsewhere</p>");
  const out = document.createRange();
  out.selectNodeContents(away);
  assert.deepEqual(sizesInRange(root, out), []);
});

test("resizing twice in a row lands on the second size, with no leftover spans", () => {
  const root = mount('<p><font size="7">words</font></p>');
  absorbFontTags(root, 12);
  // second pass: execCommand would wrap the fs-12 span it just made
  const span = root.querySelector(".fs-12");
  const font = document.createElement("font");
  font.setAttribute("size", "7");
  span.replaceWith(font);
  font.appendChild(span);
  absorbFontTags(root, 48);
  assert.equal(root.innerHTML, '<p><span class="fs-48">words</span></p>');
});
