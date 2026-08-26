// The editor's own undo stack. The browser's native one can't be used: the
// editor rewrites the DOM by hand in several places (font sizes, clear
// formatting, comment anchors) and those edits never reach it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom, mount } from "./dom.mjs";

installDom();
const { createHistory, pathTo, nodeAt } = await import("../public/js/components/history.js");

const editor = (html) => mount(html);

test("a fresh history has nothing to undo", () => {
  const h = createHistory(editor("<p>one</p>"), { getSelection: () => null });
  assert.equal(h.canUndo(), false);
  assert.equal(h.canRedo(), false);
  assert.equal(h.undo(), false, "undoing does nothing rather than throwing");
});

test("undo walks back through recorded states and redo walks forward", () => {
  const el = editor("<p>one</p>");
  const h = createHistory(el, { getSelection: () => null });
  el.innerHTML = "<p>one two</p>";
  h.record();
  el.innerHTML = "<p>one two three</p>";
  h.record();

  assert.equal(h.undo(), true);
  assert.equal(el.innerHTML, "<p>one two</p>");
  h.undo();
  assert.equal(el.innerHTML, "<p>one</p>");
  assert.equal(h.canUndo(), false, "back at the beginning");

  h.redo();
  assert.equal(el.innerHTML, "<p>one two</p>");
  h.redo();
  assert.equal(el.innerHTML, "<p>one two three</p>");
  assert.equal(h.canRedo(), false);
});

test("a font-size rewrite undoes cleanly, no stranded empty span", () => {
  // this is the exact case the browser's native undo got wrong
  const el = editor("<p>his striped shirt hangs</p>");
  const h = createHistory(el, { getSelection: () => null });
  el.innerHTML = '<p>his <span class="fs-28">striped shirt</span> hangs</p>';
  h.record();
  h.undo();
  assert.equal(el.innerHTML, "<p>his striped shirt hangs</p>");
  assert.ok(!el.innerHTML.includes("span"), "the size span is gone entirely");
});

test("recording identical html is not a new state", () => {
  const el = editor("<p>one</p>");
  const h = createHistory(el, { getSelection: () => null });
  h.record();
  h.record();
  h.record();
  assert.equal(h.size(), 1);
  assert.equal(h.canUndo(), false);
});

test("a new edit after undoing discards the redo branch", () => {
  const el = editor("<p>a</p>");
  const h = createHistory(el, { getSelection: () => null });
  el.innerHTML = "<p>ab</p>";
  h.record();
  h.undo();
  assert.equal(h.canRedo(), true);
  el.innerHTML = "<p>ac</p>";
  h.record();
  assert.equal(h.canRedo(), false, "you can't redo into a future that no longer happened");
  assert.equal(el.innerHTML, "<p>ac</p>");
});

test("restoring does not record itself as a new state", () => {
  const el = editor("<p>a</p>");
  const h = createHistory(el, { getSelection: () => null });
  el.innerHTML = "<p>ab</p>";
  h.record();
  const size = h.size();
  h.undo();
  h.record(); // the input event an innerHTML change would fire
  assert.equal(h.size(), size, "an undo is not itself an edit");
});

test("the stack is bounded", () => {
  const el = editor("<p>0</p>");
  const h = createHistory(el, { limit: 5, getSelection: () => null });
  for (let i = 1; i < 20; i++) {
    el.innerHTML = `<p>${i}</p>`;
    h.record();
  }
  assert.equal(h.size(), 5);
});

test("reset starts over from the current text", () => {
  const el = editor("<p>a</p>");
  const h = createHistory(el, { getSelection: () => null });
  el.innerHTML = "<p>ab</p>";
  h.record();
  el.innerHTML = "<p>a different document</p>";
  h.reset();
  assert.equal(h.canUndo(), false, "you can't undo into the previous document");
});

// ---- selection paths ----
test("a selection path survives the round trip through innerHTML", () => {
  const el = editor("<p>one</p><p>two</p>");
  const target = el.querySelectorAll("p")[1].firstChild;
  const saved = pathTo(el, target, 2);
  assert.deepEqual(saved.path, [1, 0]);
  const html = el.innerHTML;
  el.innerHTML = html; // fresh nodes, same shape
  const found = nodeAt(el, saved);
  assert.equal(found.node.nodeValue, "two");
  assert.equal(found.offset, 2);
});

test("a path into text that shrank clamps instead of throwing", () => {
  const el = editor("<p>a long line</p>");
  const saved = pathTo(el, el.firstChild.firstChild, 9);
  el.innerHTML = "<p>ab</p>";
  const found = nodeAt(el, saved);
  assert.equal(found.offset, 2, "clamped to what's there now");
});

test("a node outside the editor has no path", () => {
  const el = editor("<p>in</p>");
  assert.equal(pathTo(el, document.body, 0), null);
  assert.equal(nodeAt(el, null), null);
});
