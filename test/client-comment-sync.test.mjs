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

// ---- comment mode says it is on: the strip and the cursor ----
test("write page: comment mode shows the banner strip and Done leaves the mode", () => {
  const html = readFileSync(new URL("../public/write.html", import.meta.url), "utf-8");
  assert.match(html, /<div class="cm-banner hidden" id="commentBanner" role="status"/, "the strip sits above the editor, hidden until the mode is on");
  assert.ok(html.indexOf('id="commentBanner"') < html.indexOf('id="docEditor"'), "on the editor's top edge");
  const mode = handler("function setCommentMode(", "\n}");
  assert.match(mode, /renderCommentBanner\(\)/, "every mode change repaints the strip");
  const banner = handler("function renderCommentBanner(", "\n}");
  assert.match(banner, /classList\.toggle\("hidden", !commentMode\)/);
  assert.match(banner, /commentModeBannerHtml\(\{ canExit: canEditDoc\(\), count \}\)/);
  const click = handler('$("commentBanner").addEventListener("click"', "});");
  assert.match(click, /closest\("#commentDone"\)\) setCommentMode\(false\)/);
  const render = handler("function renderComments()", "\nfunction renderDoc()");
  assert.match(render, /renderCommentBanner\(\)/, "the note count follows the comment list");
});

test("write page css: the commenting editor wears a comment cursor and a ring, and the strip can hide", () => {
  const css = readFileSync(new URL("../public/css/base.css", import.meta.url), "utf-8");
  const i = css.indexOf(".doc-editor.commenting {");
  assert.ok(i >= 0);
  const rule = css.slice(i, css.indexOf("}", i));
  assert.match(rule, /cursor: url\("data:image\/svg\+xml,[^"]+"\) \d+ \d+, crosshair;/, "a bubble cursor with a crosshair fallback");
  assert.match(rule, /box-shadow: 0 0 0 2px/, "the ring");
  assert.ok(!/cursor: text/.test(rule), "no longer the I-beam that promises editing");
  // .hidden is only as strong as its source order (CLAUDE.md): the strip's
  // own display: flex comes later than the early .hidden, so it needs the
  // grouped .CLASS.hidden rule, and that rule must come after .cm-banner
  const own = css.indexOf(".cm-banner {");
  const hidden = css.indexOf(".cm-banner.hidden,");
  assert.ok(own >= 0 && hidden > own, ".cm-banner.hidden is declared after .cm-banner's display");
});

test("the rail speaks the thread events, and keeps what you were typing across a re-render", () => {
  for (const ev of ["doc-comment-reply", "doc-comment-edit"]) assert.ok(page.includes(`"${ev}"`), ev + " is emitted");
  assert.match(page, /declined:/, "Reject rides the resolve event");
  const render = page.slice(page.indexOf("function renderComments("), page.indexOf("function renderDoc("));
  assert.ok(render.indexOf("snapshotThreadDrafts()") < render.indexOf(".innerHTML ="), "drafts are lifted out BEFORE the rebuild");
  assert.ok(render.indexOf("restoreThreadDrafts(") > render.indexOf(".innerHTML ="), "and put back after it");
});
