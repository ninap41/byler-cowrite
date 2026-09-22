// The solo editor's comment-anchor sync (components/comment-sync.ts) — pure,
// so pinned directly — plus the page wiring the four fixes hang off, read from
// the emitted public/js/pages/write.js the way test/pages.test.mjs does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installDom, mount } from "./dom.mjs";
installDom();
const { anchorCids, stripAnchorInSource, applySuggestionInSource, pruneSource, placeAnchor, locateText, rangeOfText } = await import("../public/js/components/comment-sync.js");

const A = "aaaaaaaaaaaa", B = "bbbbbbbbbbbb";
const span = (cid, inner, cls = "cmt") => `<span class="${cls}" data-cid="${cid}">${inner}</span>`;

test("anchorCids lists every anchor once, in order, and ignores junk", () => {
  assert.deepEqual(anchorCids(`<p>x ${span(A, "one")} y ${span(B, "two")} ${span(A, "again")}</p>`), [A, B]);
  assert.deepEqual(anchorCids("<p>plain</p>"), []);
  assert.deepEqual(anchorCids('<span data-cid="short">no</span>'), [], "only 12-hex ids count");
  assert.deepEqual(anchorCids(""), []);
});

// ---- an arriving comment, merged into an editor with unsaved typing ----
const posOf = (before, text, after) => ({ start: before.length, text, before: before.slice(-32), after: after.slice(0, 32) });

test("placeAnchor underlines the words where they were recorded, and is a no-op the second time", () => {
  const root = mount("<p>first</p><p>his striped shirt hangs</p>");
  const pos = posOf("firsthis ", "striped shirt", " hangs");
  assert.equal(placeAnchor(root, A, pos), true);
  assert.equal(root.innerHTML, `<p>first</p><p>his ${span(A, "striped shirt")} hangs</p>`);
  assert.equal(placeAnchor(root, A, pos), true, "already there");
  assert.equal(anchorCids(root.innerHTML).length, 1);
});

test("placeAnchor finds the words after the author has typed above them, and keeps the author's typing", () => {
  const root = mount("<p>first, and a whole new sentence typed just now</p><p>his striped shirt hangs</p>");
  assert.equal(placeAnchor(root, A, posOf("firsthis ", "striped shirt", " hangs")), true);
  assert.ok(root.innerHTML.includes("typed just now"));
  assert.ok(root.innerHTML.includes(`his ${span(A, "striped shirt")} hangs`));
});

test("locateText picks the occurrence whose surroundings match, not the first one", () => {
  const full = "the door. NEW WORDS. he opened the door slowly";
  const at = locateText(full, { start: 20, text: "the door", before: "he opened ", after: " slowly" });
  assert.equal(at, full.lastIndexOf("the door"));
  assert.equal(locateText("nothing alike", { start: 0, text: "the door", before: "", after: "" }), -1);
  assert.equal(locateText("anything", { start: 0, text: "", before: "", after: "" }), -1, "no words, no anchor");
});

test("placeAnchor wraps words that start or end inside italics, entities and all", () => {
  const root = mount("<p>he <i>really didn&#39;t</i> mean it</p>");
  assert.equal(placeAnchor(root, A, posOf("he really ", "didn't mean", " it")), true);
  const a = root.querySelector("span.cmt");
  assert.equal(a.textContent, "didn't mean");
  assert.equal(root.textContent, "he really didn't mean it", "not a word moved");
});

test("placeAnchor refuses words that are gone, a bad cid, and a range across two paragraphs", () => {
  const html = "<p>one two</p><p>three four</p>";
  const root = mount(html);
  assert.equal(placeAnchor(root, A, posOf("", "deleted words", "")), false);
  assert.equal(placeAnchor(root, "nope", posOf("one ", "two", "three")), false);
  assert.equal(placeAnchor(root, A, posOf("one ", "twothree", " four")), false, "an anchor never wraps a block");
  assert.equal(root.innerHTML, html, "and nothing was touched");
});

test("placeAnchor leaves the caret where the author was typing", () => {
  const root = mount("<p>his striped shirt hangs</p>");
  const text = root.querySelector("p").firstChild;
  const sel = document.getSelection();
  sel.collapse(text, 20); // …shirt ha|ngs
  assert.equal(placeAnchor(root, A, posOf("his ", "striped shirt", " hangs")), true);
  const now = document.getSelection();
  assert.equal(now.anchorNode.data.slice(0, now.anchorOffset), " ha", "still between the same two letters");
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

test("write page: an author with unsaved typing keeps their own html and underlines an arriving comment in place", () => {
  const push = handler('s.on("doc-html"', "s.on(");
  assert.match(push, /if \(dirty && doc\?\.mine\) return/, "the server's html is not taken over unsaved words");
  assert.ok(push.indexOf("doc?.mine) return") < push.indexOf("ch.html = html"), "…for any chapter, open or not");
  assert.ok(!page.includes("New comments arrived"), "and the author is no longer told to save to see them");
  const rows = handler('s.on("doc-comments"', "s.on(");
  assert.ok(rows.indexOf("mergeArrivedAnchors()") > 0 && rows.indexOf("mergeArrivedAnchors()") < rows.indexOf("renderComments()"), "placed before the rail prunes and renders");
  const merge = handler("function mergeArrivedAnchors()", "\nfunction ");
  assert.match(merge, /if \(!canEditDoc\(\) \|\| !dirty\) return;\s*placeArrivedAnchors\(\)/, "the dirty gate, then the shared loop");
  const loop = handler("function placeArrivedAnchors()", "\nfunction ");
  assert.match(loop, /placeAnchor\(\$\("docEditor"\), c\.cid, c\.pos\)/);
  assert.match(loop, /c\.resolved \|\| c\.orphaned/, "only comments the server still has anchored");
});

test("write page: every save names the SAVE it started from, never a timestamp; only the conflict bar forces", () => {
  assert.match(page, /if \(!force && typeof doc\.rev === "number"\) body\.baseRev = doc\.rev/);
  assert.ok(!/if \(quiet[^\n]*baseRev/.test(page), "the Save button and Ctrl+S are checked too — a stale tab must not overwrite newer words");
  assert.equal((page.match(/save\(\{ force: true \}\)/g) || []).length, 1, "one way to overwrite");
  assert.match(page, /id: "conflictSave"[^\n]*save\(\{ force: true \}\)/, "and it is the button that says so");
  assert.ok(!page.includes("baseUpdatedAt"));
});

test("write page: a tab that was away catches up before it can save a stale copy", () => {
  const fn = handler("async function catchUp()", "\ndocument.addEventListener");
  assert.match(fn, /r\.doc\.rev[\s\S]*doc\.rev/, "compares saves, not timestamps");
  assert.match(fn, /if \(dirty\)[\s\S]*conflictBar[\s\S]*else location\.reload\(\)/, "unsaved typing is kept and warned; a clean tab follows");
  assert.match(page, /if \(connectedOnce\) void catchUp\(\)/, "on reconnect");
  assert.match(page, /visibilitychange[\s\S]{0,120}catchUp\(\)/, "and on coming back to the tab");
});

test("write page: reloading from the conflict bar keeps what was typed here as a draft", () => {
  const bar = handler('id: "conflictReload"', 'id: "conflictSave"');
  assert.match(bar, /if \(dirty\) saveDraft\(docId, draftChapters\(\)/, "the words go to the crash-cache first");
  assert.ok(bar.indexOf("saveDraft(") < bar.indexOf("location.reload()"), "before the page goes");
  assert.match(bar, /setDirty\(false\)/, "through setDirty, so the label and the leave guard agree");
  assert.ok(!/\bdirty = false/.test(bar));
});

test("write page: the HTML view is pruned with the editor, and decisions act on it there", () => {
  const prune = handler("function pruneLocalAnchors()", "\nfunction renderComments()");
  assert.match(prune, /if \(sourceMode\)[\s\S]*pruneSource\(src, \[\.\.\.live, \.\.\.pendingCids, \.\.\.arrivedCids\]\)/);
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

// ---- the save path can't strand words in the page ----
test("write page: a save that never answers is given up on, so `saving` always clears", () => {
  const fn = handler("async function save(", "\nconst SAVE_TIMEOUT_MS");
  assert.match(fn, /timeoutMs: SAVE_TIMEOUT_MS/);
  assert.match(fn, /finally \{\s*saving = false/);
  assert.match(page, /const SAVE_TIMEOUT_MS = 2e4|const SAVE_TIMEOUT_MS = 20000/);
});

test("write page: what changed while a save was out is kept — nothing is replaced, repainted or cleared", () => {
  const fn = handler("async function save(", "\nconst SAVE_TIMEOUT_MS");
  const ahead = fn.slice(fn.indexOf("if (editSeq !== seqAtSend)"), fn.indexOf("chapters = (doc.chapters"));
  assert.ok(ahead.length > 0, "the page-is-ahead branch comes before the wholesale replace");
  assert.match(ahead, /c\.id == null && rows\[i\]\?\.id/, "sent chapters only learn their new ids");
  assert.match(ahead, /saveDraft\(/);
  assert.ok(!ahead.includes("clearDraft") && !ahead.includes("innerHTML") && !ahead.includes("setDirty(false)"));
  assert.match(page, /editSeq\+\+/, "every edit counts, not just the clock's millisecond");
});

test("write page: a failed save, every autosave tick, and a hidden tab all write the browser's draft", () => {
  const fn = handler("async function save(", "\nconst SAVE_TIMEOUT_MS");
  const failed = fn.slice(fn.lastIndexOf("} catch (e) {"));
  assert.match(failed, /saveDraft\(docId, draftChapters\(\)/, "offline, timed out, signed out, too large: the words stay somewhere");
  const tick = /setInterval\(\(\) => \{\s*if \(!dirty \|\| !doc\?\.mine\) return;?([\s\S]*?)\}, AUTOSAVE_MS\)/.exec(page)?.[1] || "";
  assert.ok(tick.indexOf("saveDraft(") >= 0 && tick.indexOf("saveDraft(") < tick.indexOf("save({ quiet: true })"), "the draft first, whatever the save then does");
  assert.match(page, /visibilityState === "hidden"\) draftIfDirty\(\)/);
  assert.match(page, /addEventListener\("pagehide", draftIfDirty\)/);
  assert.match(page, /saveDraft\(docId, draftChapters\(\), input\("docTitle"\)\.value, (void 0|undefined), doc\?\.rev\)/, "naming the save it was working from");
});

test("write page: a page replaced from outside forgets its undo history, and a draft restore asks before replacing new typing", () => {
  const upd = handler('s.on("doc-updated"', 's.on("doc-html"');
  assert.match(upd, /applyServerCopy\(/, "the whole-copy path is shared with catchUp");
  const apply = handler("function applyServerCopy(", "\nasync function catchUp");
  assert.match(apply, /undoHistory\.reset\(\)/, "or Ctrl+Z pastes the old page over the new one");
  const restore = handler('id: "restoreYes"', 'id: "restoreNo"');
  assert.match(restore, /if \(d && dirty\)[\s\S]*confirmDialog/);
});

test("write page: deleting a chapter with words in it asks first, by name — never a double-click", () => {
  const del = handler('b.classList.contains("chap-del")', '$("chapPanel").addEventListener("dblclick"');
  assert.match(del, /confirmDialog\(/);
  assert.match(del, /wordsLabel\(words\)/, "it says how much goes");
  assert.match(del, /chapters\.indexOf\(ch\)/, "and deletes THAT chapter, even if the list moved while it asked");
  assert.ok(!page.includes("dataset.armed = \"1\";\n      b.textContent = \"Delete?\""), "the two-click arm is gone");
  assert.ok(!/chap-del[\s\S]{0,400}armed/.test(del));
});

test("write page: restoring a draft takes only the chapters its page edited; the rest stay as the server has them", () => {
  assert.match(page, /touched\.add\(ch\)/, "an edit marks the open chapter");
  assert.match(page, /touched: c\.id == null \|\| touched\.has\(/, "and the draft carries the mark (a never-saved chapter always counts)");
  const restore = handler('id: "restoreYes"', 'id: "restoreNo"');
  assert.match(restore, /const merged = mergeDraft\(d, doc\)/, "the restore is laid over the server's chapter list (a chapter added, deleted or renamed elsewhere survives)");
  assert.match(restore, /merged\[i\]\.touched && touched\.add\(c\)/, "only what came from the draft is unsaved work again");
  assert.ok(!/d\.chapters\.map\(/.test(restore), "the draft alone never decides the chapter list");
  assert.ok(!/saveDraft\(docId, allChapters\(\)/.test(page), "every draft write goes through draftChapters()");
});

test("write page: the Save button is disabled when there is nothing to save, while a save is out, and behind the conflict bar", () => {
  const fn = page.slice(page.indexOf("const refreshSaveBtn = "), page.indexOf("};", page.indexOf("const refreshSaveBtn = ")));
  assert.match(fn, /b\.disabled = !dirty \|\| saving \|\| conflicted/);
  assert.match(fn, /saving \? "Saving…" : "Save"/, "and says when one is out");
  const setDirtyFn = page.slice(page.indexOf("const setDirty = "), page.indexOf("const refreshSaveBtn = "));
  assert.match(setDirtyFn, /refreshSaveBtn\(\)/, "every dirty change refreshes it");
  const saveFn = page.slice(page.indexOf("async function save("), page.indexOf("const SAVE_TIMEOUT_MS"));
  assert.match(saveFn, /saving = true;\s*refreshSaveBtn\(\)/, "a save going out disables it");
  assert.match(saveFn, /finally \{\s*saving = false;\s*refreshSaveBtn\(\)/, "and coming back re-enables it");
  const sets = page.match(/(?<!let )conflicted = (?:true|false);/g) || [];
  const followed = page.match(/conflicted = (?:true|false);\s*refreshSaveBtn\(\)/g) || [];
  assert.ok(sets.length >= 4 && followed.length === sets.length, "every conflicted change refreshes it");
});

test("write page: the save request never carries the draft's touched flag, and the button is hidden for a reader", () => {
  const all = page.slice(page.indexOf("const allChapters = "), page.indexOf("const openChapter = "));
  assert.match(all, /chapters\.map\(\(\{ id, title, html \}\) => \(\{ id: id \?\? null, title: title \?\? "", html: html \?\? "" \}\)\)/, "allChapters is id, title, html and nothing else");
  const saveFn = page.slice(page.indexOf("async function save("), page.indexOf("const SAVE_TIMEOUT_MS"));
  assert.match(saveFn, /const list = allChapters\(\);/);
  assert.match(saveFn, /chapters: list \}/, "the PUT body is built from it");
  assert.ok(!/body\.chapters = draftChapters|chapters: draftChapters/.test(saveFn), "never from the draft shape");
  assert.match(page, /\$\("saveBtn"\)\.classList\.add\("hidden"\)/, "a beta reader has no Save at all");
});

// ---- the author writes while a reader comments ----

test("rangeOfText finds a note's words again in a repainted page, across inline tags; gone words give null", () => {
  const root = mount('<p>his <i>striped</i> shirt hangs</p><p>and <b>the quarry</b> at night</p>');
  const r = rangeOfText(root, "striped shirt");
  assert.ok(r, "found across the </i>");
  assert.equal(r.toString(), "striped shirt");
  assert.equal(rangeOfText(root, "  the quarry ").toString(), "the quarry", "trimmed");
  assert.equal(rangeOfText(root, "checked shirt"), null, "words that changed");
  assert.equal(rangeOfText(root, "   "), null);
});

test("write page: a save's answer never takes back a thread or an underline the page already has", () => {
  const saveFn = page.slice(page.indexOf("async function save("), page.indexOf("const SAVE_TIMEOUT_MS"));
  assert.match(saveFn, /const commentsAtSend = commentsSeq/, "the rail's version when the request left");
  assert.match(saveFn, /if \(commentsSeq === commentsAtSend\) comments = doc\.comments \|\| \[\]/, "the answer's threads are taken only if nothing arrived meanwhile");
  assert.match(saveFn, /replaceMissingAnchors\(\);\s*renderComments\(\)/, "underlines the answer didn't carry go back BEFORE the rail prunes");
  const rows = handler('s.on("doc-comments"', "s.on(");
  assert.match(rows, /commentsSeq\+\+/);
  const fn = handler("function replaceMissingAnchors()", "\nfunction ");
  assert.match(fn, /if \(placeArrivedAnchors\(\)\) \{\s*setDirty\(true\);\s*renderComments\(\)/, "a put-back underline is unsaved work, and its note is a card");
  const restore = handler('id: "restoreYes"', 'id: "restoreNo"');
  assert.match(restore, /replaceMissingAnchors\(\)/, "a restored draft predates any note made since");
  const mode = handler("function setMode(", "\nfunction ");
  assert.match(mode, /if \(!toSource\) replaceMissingAnchors\(\)/, "leaving the HTML view too, dirty or not");
});

test("write page: a reader keeps their half-written note when the story moves under them, and is told", () => {
  const send = handler("function sendComment()", "\nfunction ");
  assert.match(send, /sentNotes\.set\(cid, \{ quote: [^}]*text, suggestion \}\)/, "the words wait until the server takes them");
  const rows = handler('s.on("doc-comments"', "s.on(");
  assert.match(rows, /sentNotes\.delete\(cid\)/, "taken: forgotten");
  const refused = handler('s.on("doc-comment-refused"', "s.on(");
  assert.match(refused, /reason === "moved"[\s\S]*restoreComposer\(note, /, "moved: the note goes back on its words");
  assert.ok(refused.indexOf('reason === "moved"') < refused.indexOf("conflicted = true"), "and never raises the conflict bar — a reader has no save to force");
  assert.match(refused, /reason === "closed"/, "a reply on a thread that closed first is explained");
  const apply = handler("function applyServerCopy(", "\nasync function catchUp");
  assert.match(apply, /const keep = snapshotComposer\(\)[\s\S]*innerHTML[\s\S]*if \(keep\) restoreComposer\(keep, /, "an open composer survives the author's save");
  const push = handler('s.on("doc-html"', "s.on(");
  assert.match(push, /const keep = snapshotComposer\(\)[\s\S]*if \(keep\) restoreComposer\(keep, /, "and another reader's note");
  const composer = handler("function renderComposer()", "\nfunction ");
  assert.match(composer, /const prefill = composerDraft/, "the next composer opens with the kept words");
  const restore = handler("function restoreComposer(", "\nfunction ");
  assert.match(restore, /rangeOfText\(\$\("docEditor"\), d\.quote\)/, "found again by the quoted words");
  assert.match(restore, /select the words again/, "or waits for a new selection");
});

test("write page: a reader that was away catches up too", () => {
  const fn = handler("async function catchUp()", "\ndocument.addEventListener");
  assert.ok(!/!doc\?\.mine \|\| saving/.test(fn), "no longer the author's alone");
  assert.match(fn, /if \(!doc\.mine\) \{[\s\S]*applyServerCopy\(r\.doc\)/, "a reader takes the newer copy in place");
  assert.match(fn, /if \(dirty\) \{[\s\S]*conflicted = true/, "an author's dirty tab still gets the bar");
});

test("write page: deleting a chapter names the open comments in it", () => {
  const del = handler('b.classList.contains("chap-del")', '$("chapPanel").addEventListener("dblclick"');
  assert.match(del, /const notes = comments\.filter\(\(c\) => !c\.resolved/);
  assert.match(del, /open comment\$\{notes === 1 \? "" : "s"\}/);
});

test("write page: a reply being typed when its thread closes is kept, and prefills the box after a reopen", () => {
  const open = handler("function openReplyBox(", "\nfunction ");
  assert.match(open, /if \(replying\.value\.trim\(\)\) \{\s*lostReply = \{ \.\.\.replying \}/, "the words are kept, not dropped with the box");
  assert.match(open, /closed while you were typing/);
  const click = handler('replying = { commentId, parentId, value: back }', "\n");
  assert.ok(click, "the next box on that thread opens with them");
  assert.match(page, /const back = lostReply\?\.commentId === commentId \? lostReply\.value : ""/);
});

test("write page: an underline that arrives in a server html push is never pruned before its comment list lands", () => {
  const push = handler('s.on("doc-html"', "s.on(");
  assert.match(push, /for \(const cid of anchorCids\(html \|\| ""\)\) arrivedCids\.add\(cid\)/, "the pushed anchors are protected…");
  const rows = handler('s.on("doc-comments"', "s.on(");
  assert.match(rows, /arrivedCids\.clear\(\)/, "…until the list they belong to is here");
  const prune = handler("function pruneLocalAnchors()", "\nfunction ");
  assert.match(prune, /live\.has\(cid\) \|\| pendingCids\.has\(cid\) \|\| arrivedCids\.has\(cid\)/);
});
