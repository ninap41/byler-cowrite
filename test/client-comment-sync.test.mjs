// The solo editor's comment-anchor sync (components/comment-sync.ts) — pure,
// so pinned directly — plus the page wiring the four fixes hang off, read from
// the emitted public/js/pages/write.js the way test/pages.test.mjs does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { anchorCids, htmlPushKind, stripAnchorInSource, applySuggestionInSource, pruneSource } from "../public/js/components/comment-sync.js";

const A = "aaaaaaaaaaaa", B = "bbbbbbbbbbbb";
const span = (cid, inner, cls = "cmt") => `<span class="${cls}" data-cid="${cid}">${inner}</span>`;

test("anchorCids lists every anchor once, in order, and ignores junk", () => {
  assert.deepEqual(anchorCids(`<p>x ${span(A, "one")} y ${span(B, "two")} ${span(A, "again")}</p>`), [A, B]);
  assert.deepEqual(anchorCids("<p>plain</p>"), []);
  assert.deepEqual(anchorCids('<span data-cid="short">no</span>'), [], "only 12-hex ids count");
  assert.deepEqual(anchorCids(""), []);
});

test("htmlPushKind: an arrival, a removal, or the same set", () => {
  const none = "<p>the words</p>";
  const one = `<p>the ${span(A, "words")}</p>`;
  const two = `<p>${span(B, "the")} ${span(A, "words")}</p>`;
  assert.equal(htmlPushKind(none, one), "added", "someone commented");
  assert.equal(htmlPushKind(one, none), "removed", "a comment was deleted/decided");
  assert.equal(htmlPushKind(two, one), "removed");
  assert.equal(htmlPushKind(one, one), "same");
  assert.equal(htmlPushKind(one, "<p>the accepted words</p>".replace("accepted ", "")), "removed", "an accepted suggestion drops its anchor");
  assert.equal(htmlPushKind(one, `<p>${span(B, "the")} words</p>`), "added", "a swap counts as an arrival — the author has something new to see");
});

test("stripAnchorInSource unwraps one anchor, nesting-aware, and leaves everything else", () => {
  const src = `<p>a ${span(A, `b <span class="fs-12">c</span> d`)} e ${span(B, "f")}</p>`;
  assert.equal(stripAnchorInSource(src, A), `<p>a b <span class="fs-12">c</span> d e ${span(B, "f")}</p>`);
  assert.equal(stripAnchorInSource(src, B), `<p>a ${span(A, `b <span class="fs-12">c</span> d`)} e f</p>`);
  assert.equal(stripAnchorInSource(src, "cccccccccccc"), src, "absent: untouched");
  const active = `<p>${span(A, "w", "cmt active")}</p>`;
  assert.equal(stripAnchorInSource(active, A), "<p>w</p>", "the active class doesn't hide it");
  const nested = `<p>${span(A, `x ${span(B, "y")} z`)}</p>`;
  assert.equal(stripAnchorInSource(nested, A), `<p>x ${span(B, "y")} z</p>`, "outer goes, inner anchor stays");
  assert.equal(stripAnchorInSource(nested, B), `<p>${span(A, "x y z")}</p>`, "inner goes, outer stays");
  const broken = `<p><span class="cmt" data-cid="${A}">never closed`;
  assert.equal(stripAnchorInSource(broken, A), broken, "unbalanced: refuses to guess");
});

test("applySuggestionInSource swaps the words for the (escaped) proposal", () => {
  const src = `<p>keep ${span(A, "these <b>old</b> words")} too</p>`;
  assert.equal(applySuggestionInSource(src, A, "new <words> & more"), "<p>keep new &lt;words&gt; &amp; more too</p>");
  assert.equal(applySuggestionInSource(src, B, "x"), src, "absent: untouched");
});

test("pruneSource unwraps every anchor without a live comment", () => {
  const src = `<p>${span(A, "one")} ${span(B, "two")}</p>`;
  assert.equal(pruneSource(src, [A]), `<p>${span(A, "one")} two</p>`);
  assert.equal(pruneSource(src, []), "<p>one two</p>");
  assert.equal(pruneSource(src, [A, B]), src, "nothing to do");
});

// ---- the page wiring, from the emitted script ----
const page = readFileSync(new URL("../public/js/pages/write.js", import.meta.url), "utf-8");
const handler = (start, end) => {
  const i = page.indexOf(start);
  assert.ok(i >= 0, "found: " + start);
  const j = page.indexOf(end, i + start.length);
  return page.slice(i, j < 0 ? undefined : j);
};

test("write page: clicking an underline opens a closed drawer before focusing the card", () => {
  const click = handler('$("docEditor").addEventListener("click"', "});");
  assert.match(click, /if \(!prefs\.sideOpen\) setSideOpen\(true\)/);
  assert.ok(click.indexOf("setSideOpen(true)") < click.indexOf("focusComment("), "opened first, then focused");
});

test("write page: a removal never paints the 'new comments arrived' line; only an arrival does", () => {
  const push = handler('s.on("doc-html"', "s.on(");
  assert.match(push, /htmlPushKind\(currentHtml\(\), html \|\| ""\) === "added"/);
});

test("write page: the HTML view is pruned with the editor, and decisions act on it there", () => {
  const prune = handler("function pruneLocalAnchors()", "\nfunction renderComments()");
  assert.match(prune, /if \(sourceMode\)[\s\S]*pruneSource\(src, \[\.\.\.live, \.\.\.pendingCids\]\)/);
  const decide = handler("function decideLocally(", "\n}");
  assert.match(decide, /if \(sourceMode\)[\s\S]*applySuggestionInSource\(src, c\.cid, c\.suggestion\)[\s\S]*stripAnchorInSource\(src, c\.cid\)/);
});

test("write page: acting on a comment drops its cid from the just-sent guard", () => {
  const pane = handler('$("commentPane").addEventListener("click"', "});");
  assert.match(pane, /pendingCids\.delete\(li\.dataset\.cid\)/);
  assert.ok(pane.indexOf("pendingCids.delete") < pane.indexOf('closest(".dc-accept")'), "before any action is dispatched");
});
