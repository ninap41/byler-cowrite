import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom, mount } from "./dom.mjs";

installDom();
const { absorbFontTags, pruneRedundantSizes, sizesInRange, sizeOf, nearestSize, parseSize, clearSizesInBlocks, headingOnly, DEFAULT_SIZE } = await import(
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

test("letters are trimmed out of the size box — the number is what counts", () => {
  // People type units, and pasting from a stylesheet brings a whole
  // declaration. Every one of these means 24, not "unparseable".
  for (const raw of ["24", "24px", "24 px", " 24PX ", "24pt", "font-size: 24px;", "24em", "x24y"])
    assert.equal(parseSize(raw), 24, JSON.stringify(raw));
  assert.equal(parseSize("18.5px"), 18.5, "a decimal survives, to be snapped later");
});

test("a box with no number in it yields null — the caller keeps the current size", () => {
  // This is the whole point: NaN used to slide through nearestSize and land on
  // the smallest rung, silently shrinking text the user never meant to touch.
  for (const raw of ["Multi", "", "   ", "px", "abc", null, undefined, "0"])
    assert.equal(parseSize(raw), null, JSON.stringify(raw));
  // a stray sign is just another character to trim — "-4" is a size of 4
  assert.equal(parseSize("-4"), 4);
});

test("a mistyped size never collapses to the smallest rung by accident", () => {
  assert.notEqual(parseSize("Multi"), FONT_SIZES[0]);
  // and the real path: digits pulled out, then snapped to the ladder
  assert.equal(nearestSize(parseSize("23px")), 24);
  assert.equal(nearestSize(parseSize("7 pt")), 6);
});

// ---- block format vs explicit sizes ----
// A heading IS a size statement. An fs-* span inside one wins on
// nearest-ancestor, so converting a 12px paragraph to Heading 1 produced a
// heading that still rendered at 12px — the control looked broken.

test("applying a block format drops the explicit sizes inside those blocks", () => {
  const root = mount('<h1><span class="fs-12">was a small paragraph</span></h1>');
  const range = document.createRange();
  range.selectNodeContents(root.querySelector("h1"));
  assert.equal(clearSizesInBlocks(root, range), 1);
  assert.equal(root.innerHTML, "<h1>was a small paragraph</h1>", "the heading is free to be heading-sized");
});

test("other formatting inside the block is untouched", () => {
  const root = mount('<h2><b>bold</b> <span class="fs-36"><i>big italic</i></span></h2>');
  const range = document.createRange();
  range.selectNodeContents(root.querySelector("h2"));
  clearSizesInBlocks(root, range);
  assert.equal(root.innerHTML, "<h2><b>bold</b> <i>big italic</i></h2>");
});

test("blocks the selection doesn't touch keep their sizes", () => {
  const root = mount('<h1><span class="fs-12">changed</span></h1><p><span class="fs-24">left alone</span></p>');
  const range = document.createRange();
  range.selectNodeContents(root.querySelector("h1"));
  clearSizesInBlocks(root, range);
  assert.equal(root.querySelector("h1").innerHTML, "changed");
  assert.equal(root.querySelector("p").innerHTML, '<span class="fs-24">left alone</span>', "a paragraph elsewhere is none of its business");
});

test("a selection spanning several blocks clears all of them", () => {
  const root = mount('<h3><span class="fs-12">one</span></h3><h3><span class="fs-48">two</span></h3>');
  const range = document.createRange();
  range.setStart(root.querySelector("h3"), 0);
  range.setEnd(root.querySelectorAll("h3")[1], 1);
  clearSizesInBlocks(root, range);
  assert.equal(root.querySelectorAll("span[class^=fs-]").length, 0);
});

test("nothing to clear is not an error, and a missing range is a no-op", () => {
  const root = mount("<p>plain</p>");
  const range = document.createRange();
  range.selectNodeContents(root);
  assert.equal(clearSizesInBlocks(root, range), 0);
  assert.equal(clearSizesInBlocks(root, null), 0);
  assert.equal(clearSizesInBlocks(null, range), 0);
});

test("headingOnly spots a selection that lives entirely in headings", () => {
  const root = mount("<h1>a title</h1><p>a paragraph</p>");
  const inH = document.createRange();
  inH.selectNodeContents(root.querySelector("h1"));
  assert.equal(headingOnly(root, inH), true, "the size box has nothing to say here");

  const inP = document.createRange();
  inP.selectNodeContents(root.querySelector("p"));
  assert.equal(headingOnly(root, inP), false);

  const both = document.createRange();
  both.setStart(root.querySelector("h1"), 0);
  both.setEnd(root.querySelector("p"), 1);
  assert.equal(headingOnly(root, both), false, "one word of body text and the box works again");
});

test("headingOnly handles a caret in an empty heading, and no range at all", () => {
  const root = mount("<h2></h2>");
  const caret = document.createRange();
  caret.setStart(root.querySelector("h2"), 0);
  caret.collapse(true);
  assert.equal(headingOnly(root, caret), true);
  assert.equal(headingOnly(root, null), false);
  assert.equal(headingOnly(null, caret), false);
});

test("nested formatting inside a heading is still a heading", () => {
  const root = mount("<h3>plain <b>bold <i>and italic</i></b></h3>");
  const r = document.createRange();
  r.selectNodeContents(root.querySelector("i"));
  assert.equal(headingOnly(root, r), true);
});
