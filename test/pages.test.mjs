import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.mjs";
import { existsSync, readFileSync } from "node:fs";
import * as fsSync from "node:fs";

let ctx;
before(async () => (ctx = await startServer()));
after(async () => ctx.stop());

const page = async (path) => {
  const r = await fetch(ctx.url + path);
  let body = await r.text();
  // The write page's script is emitted from client/pages/write.ts to
  // /js/pages/write.js; the assertions below read the page and its script as
  // one text, the way they did when the script was inline.
  if (path === "/write") body += "\n" + (await (await fetch(ctx.url + "/js/pages/write.js")).text());
  return { status: r.status, body, headers: r.headers };
};

test("pages/modules/css are never cached (stale-module mixing breaks handlers)", async () => {
  for (const path of ["/", "/dashboard", "/write", "/writes", "/js/chrome.js", "/js/theme.js", "/css/base.css"]) {
    const r = await page(path);
    assert.equal(r.headers.get("cache-control"), "no-store", path + " uncacheable");
  }
  const snd = await fetch(ctx.url + "/sounds/incomingline.mp3");
  assert.match(snd.headers.get("cache-control") || "", /max-age=6048/, "sounds may cache");
});

test("the solo-write pages serve at their clean URLs", async () => {
  const list = await page("/writes");
  assert.equal(list.status, 200);
  assert.ok(list.body.includes('id="docList"'));
  assert.ok(list.body.includes('id="newDocBtn"'));
  // the shelf builds its own grids, one per group — the container holds none
  // (the page's script is emitted from client/pages/writes.ts)
  assert.ok((await page("/js/pages/writes.js")).body.includes("docShelfHtml(docs)"), "grouped into mine / beta reading");
  assert.ok(!/id="docList" class="doc-grid"/.test(list.body), "the grid moved into each group");

  const editor = await page("/write");
  assert.equal(editor.status, 200);
  assert.ok(editor.body.includes('id="docEditor"'), "the wysiwyg surface");
  assert.ok(editor.body.includes('id="modeRich"') && editor.body.includes('id="modeHtml"'), "the two-way html source toggle");
  assert.ok(editor.body.includes('aria-pressed="true"'), "the active mode is announced, not just styled");
  assert.ok(editor.body.includes('id="leaveModal"'), "the unsaved-changes guard");
  assert.ok(editor.body.includes('id="listSelect"') && editor.body.includes('id="alignSelect"'), "list + alignment dropdowns");
  assert.ok(editor.body.includes('id="emDashBtn"'), "the em dash button");
  assert.ok(editor.body.includes('id="presenceRow"'), "beta-reader presence");
});

test("homepage serves the hero + auth card", async () => {
  const { status, body } = await page("/");
  assert.equal(status, 200);
  assert.ok(body.includes('id="hero"'));
  assert.ok(body.includes('id="authChoice"'));
  assert.ok(!body.includes("Play as guest"), "guest path fully removed");
  assert.ok(body.includes('id="liveWatch"'), "spectate list on the homepage");
});

test("GET /api/quote returns a quote from quotes.json", async () => {
  const r = await fetch(ctx.url + "/api/quote");
  assert.equal(r.status, 200);
  const { quote } = await r.json();
  const { readFileSync } = await import("node:fs");
  const bank = JSON.parse(readFileSync(new URL("../content/quotes.json", import.meta.url), "utf-8"));
  assert.ok(bank.includes(quote), "quote comes from the bank: " + quote);
});

test("clean URLs serve each page", async () => {
  const dash = await page("/dashboard");
  assert.equal(dash.status, 200);
  assert.ok(dash.body.includes('id="writersList"'), "writers directory present");
  assert.ok(dash.body.includes('id="inviteBtn"'));
  const game = await page("/game");
  assert.equal(game.status, 200);
  assert.ok(game.body.includes('id="writerEditor"'));
  assert.ok(game.body.includes('id="playersRow"'));
  assert.ok(game.body.includes('id="hostPanel"'), "host controls sidebar");
  assert.ok(game.body.includes('id="doomFx"'), "low-time demogorgon layer");
  assert.ok(!game.body.includes('id="headerInput"'), "chapter-header control removed");
  const arch = await page("/archive");
  assert.equal(arch.status, 200);
  assert.ok(arch.body.includes('id="archiveList"'));
  for (const id of ["delModal", "archDelete", "delConfirm", "delCancel", "archNotice"])
    assert.ok(arch.body.includes(`id="${id}"`), id + " in the delete flow");
  // exports live on the story itself, not inside the delete modal
  for (const id of ["archExport", "archCopy", "archHtml", "archPdf"]) assert.ok(arch.body.includes(`id="${id}"`), id + " export row");
  assert.ok(!arch.body.includes('id="delHtml"') && !arch.body.includes('id="delPdf"'), "no export inside the modal");
  const modal = arch.body.slice(arch.body.indexOf('id="delModal"'));
  assert.ok(!modal.includes('id="archHtml"'), "export row precedes the modal");
  const prof = await page("/profile");
  assert.equal(prof.status, 200);
  assert.ok(prof.body.includes('id="ladder"') && prof.body.includes('id="usageCase"'));
  const set = await page("/settings");
  assert.equal(set.status, 200);
  assert.ok(set.body.includes('id="savePass"'));
  // color picker leads; username/email/password are collapsed behind toggles
  assert.ok(set.body.indexOf('id="swatches"') < set.body.indexOf('data-toggle="secUsername"'), "color first");
  // any colour at all: a native picker and a hex box beside the swatches — no
  // Save button, a pick (or Enter / leaving the hex box) saves on its own
  assert.ok(set.body.includes('<input type="color" id="colorPick"'), "colour picker");
  assert.ok(set.body.includes('id="colorHex"'), "hex box");
  assert.ok(!set.body.includes('id="colorSave"'), "no save button");
  for (const sec of ["secUsername", "secEmail", "secPass"]) {
    assert.ok(set.body.includes(`data-toggle="${sec}"`), sec + " toggle");
    assert.ok(new RegExp(`id="${sec}" class="sec-body hidden"`).test(set.body), sec + " starts collapsed");
  }
});

test("the editor offers a three-way paper colour beside line spacing", async () => {
  const { body } = await page("/write");
  assert.ok(body.includes('id="paperSelect"'), "the control is on the toolbar");
  for (const v of ["theme", "light", "dark"]) assert.ok(body.includes(`value="${v}"`), v + " is offered");
  assert.ok(body.indexOf('id="lineStepper"') < body.indexOf('id="paperSelect"'), "it sits next to line spacing");
  assert.ok(body.includes("applyPaper"), "and is applied on load, not just on change");
});

test("the thesaurus is no longer a toolbar button, it moved into the reference palette", async () => {
  const { body } = await page("/write");
  assert.ok(!body.includes("thesaurusLink"), "the toolbar button is gone");
  assert.ok(!body.includes("powerthesaurus"), "and the URL doesn't linger in the markup");
  const palette = await page("/js/components/slash-palette.js");
  assert.ok(palette.body.includes("powerthesaurus.org"), "it lives in the palette now");
});

test("the toolbar is one borderless strip: no boxed groups, pressed state instead", async () => {
  const css = await page("/css/base.css");
  const group = css.body.slice(css.body.indexOf("\n.tb-group {"), css.body.indexOf("\n.tb-group + .tb-group"));
  assert.match(group, /border: 0/, "the group pills lost their border");
  assert.match(group, /background: none/, "and their fill");
  assert.match(css.body, /\.tb-group \+ \.tb-group \{[^}]*border-left/, "groups are divided by a hairline instead");
  assert.match(css.body, /\.tb-group > button\.ghost\.on \{/, "a pressed button is the one thing that stays filled");

  const { body } = await page("/write");
  assert.ok(body.includes('classList.toggle("on"'), "bold/italic/underline follow the caret");
});

test("the write page's right-hand icons are borderless too, the mode switch is not", async () => {
  const css = await page("/css/base.css");
  assert.match(css.body, /\.toolbar-right > \.icon-btn \{[^}]*border: 0/, "the icon buttons lost their box");
  assert.match(css.body, /\.mode-switch \{[^}]*border: 1px solid/, "the segmented control keeps its track");
});

test("comment mode explains itself on hover", async () => {
  const { body } = await page("/write");
  const btn = body.slice(body.indexOf('id="commentToggle"'), body.indexOf('id="commentToggle"') + 400);
  assert.match(btn, /data-tip="Comment mode/, "the site's own tooltip");
  assert.match(btn, /title="Comment mode/, "and the native one for keyboard/AT users");
  assert.match(btn, /aria-label="Comment mode"/, "the emoji alone is not a name");
});

test("the game page carries the shared toolbar, not its own", async () => {
  const { body } = await page("/game");
  assert.ok(body.includes('id="gameToolbar"'), "one mount point");
  assert.ok(body.includes("rich-toolbar.js"));
  assert.ok(!body.includes('data-cmd="justifyLeft"'), "the old hand-rolled buttons are gone");
});

test("visibility is a chip in the editor head, not a checkbox in the share modal", async () => {
  const { body } = await page("/write");
  assert.ok(!body.includes('id="visToggle"'), "the ambiguous checkbox is gone");
  assert.ok(body.includes('id="visWrap"'), "the chip sits with the title and word count");
  assert.ok(body.indexOf('id="visWrap"') < body.indexOf('id="shareModal"'), "in the head, ahead of the modal");
  assert.ok(body.includes("visChipHtml") && body.includes("visMenuHtml"));
  assert.ok(body.includes('id="sharePrivateNote"'), "the modal warns when readers can't actually see it");
});

test("the unsaved-draft bar is sticky under the toolbar", async () => {
  const { body } = await page("/write");
  const shell = body.slice(body.indexOf('id="docShell"'), body.indexOf('id="docErr"'));
  assert.ok(shell.includes('id="restoreBar"'), "it lives inside the sticky shell");
  assert.ok(shell.indexOf('id="docToolbar"') < shell.indexOf('id="restoreBar"'), "below the toolbar");
  const css = await page("/css/base.css");
  assert.match(css.body, /\.restore-bar \{[^}]*border-top/, "it reads as attached to the toolbar above it");
});

test("the comments pane sticks under the head, and jumps land clear of it", async () => {
  const css = await page("/css/base.css");
  assert.match(css.body, /\.doc-side-card \{[^}]*position: sticky/, "the pane is pinned");
  assert.match(css.body, /\.doc-side-card \{[^}]*top: calc\(var\(--doc-sticky/, "…directly under the sticky head");
  assert.match(css.body, /#commentPane \{[^}]*overflow-y: auto/, "a long list scrolls inside the pane");
  assert.match(css.body, /span\.cmt \{[^}]*scroll-margin-top: calc\(var\(--doc-sticky/, "a jumped-to word clears the toolbar");
  // One column: the rail stops being a pinned column and becomes a bottom
  // sheet, sized by the same saved number the desktop drawer uses for width.
  assert.match(css.body, /@media \(max-width: 860px\) \{\s*\.doc-side \{[^}]*position: fixed/, "one column: a sheet, not a pinned rail");
  assert.match(css.body, /\.doc-side-card \{[^}]*height: var\(--doc-side-w/, "the sheet's height is the writer's own");

  const { body } = await page("/write");
  assert.ok(body.includes("--doc-sticky"), "the head's real height is published, not guessed");
  assert.ok(body.includes("ResizeObserver"), "and re-measured when the head grows");
});

test("clicking a comment scrolls the document to the words it is about", async () => {
  const { body } = await page("/write");
  assert.ok(body.includes('focusComment(li.dataset.cid || null, { scroll: "anchor" })'), "card click jumps to the text");
  assert.ok(body.includes('focusComment(a.dataset.cid, { scroll: "card" })'), "and an underline jumps to the card");
  assert.ok(body.includes("scrollToAnchor(anchor)"), "to a computed position, clear of the sticky head");
  assert.ok(body.includes('window.scrollTo({ top, behavior: "smooth" })'), "smoothly…");
  assert.ok(body.includes("Math.abs(window.scrollY - top) > 4"), "…but it lands even where smooth scrolling is off");
  assert.ok(body.includes("void anchor.offsetWidth"), "the arrival flash replays on a second click");
});

test("the comments column is tall enough for its sticky child to travel", async () => {
  const css = await page("/css/base.css");
  assert.match(css.body, /\.doc-side \{[^}]*align-self: stretch/,
    "grid items don't stretch under align-items:start, and a short column can't stick");
});

test("the editor drops an underline the moment its comment stops existing", async () => {
  const { body } = await page("/write");
  assert.ok(body.includes("function pruneLocalAnchors"), "the editor mirrors the server's rule");
  assert.ok(body.includes("renderComments() {\n  pruneLocalAnchors()"), "…on every comments update, and after an undo"); // esbuild's two-space indent
  assert.ok(body.includes("pendingCids"), "a just-sent comment's anchor is exempt until the server echoes it");
});

test("choosing a block format clears the sizes it supersedes, on both editors", async () => {
  const write = await page("/write");
  assert.ok(write.body.includes("clearSizesInBlocks($(\"docEditor\")"), "the solo editor");
  const toolbar = await page("/js/components/rich-toolbar.js");
  assert.ok(toolbar.body.includes("clearSizesInBlocks(editor"), "and the shared toolbar the game mounts");
});

test("a heading's size is the heading's: spans inside can't shrink it", async () => {
  const css = await page("/css/base.css");
  assert.match(css.body, /:is\(h1, h2, h3\) \[class\*="fs-"\][\s\S]{0,400}font-size: inherit/,
    "an fs span inside a heading renders at the heading's size");
  for (const surface of [".doc-editor", ".story", ".live"])
    assert.ok(css.body.includes(`${surface} :is(h1, h2, h3) [class*="fs-"]`), surface + " is covered");

  const write = await page("/write");
  assert.ok(write.body.includes("headingOnly"), "and the size box turns off in a heading rather than lying");
  assert.ok(write.body.includes("The heading style sets this text's size"), "with a tooltip that says why");
});

test("comment actions are text buttons, not squashed pills", async () => {
  const css = await page("/css/base.css");
  const block = css.body.slice(css.body.indexOf("\n.dc-actions button {"), css.body.indexOf("\n.dc-actions button:hover"));
  assert.match(block, /border: 0/, "the global button pill is reset");
  assert.match(block, /background: none/);
  assert.match(block, /width: auto/, "and they don't stretch to fill the rail");
  assert.match(css.body, /\.dc-actions \.dc-del,\n\.dc-actions \.dc-reject \{\s*color: var\(--accent\)/,
    "the destructive ones read as destructive");
});

test("the composer is pinned above the comments, which scroll under it", async () => {
  const { body } = await page("/write");
  assert.ok(body.includes('id="commentComposer"'), "it has its own slot");
  assert.ok(body.indexOf('id="commentComposer"') < body.indexOf('id="commentPane"'), "above the list");
  const css = await page("/css/base.css");
  assert.match(css.body, /#commentComposer \{\s*flex: 0 0 auto/, "the composer never scrolls away");
  assert.match(css.body, /#commentPane \{[^}]*overflow-y: auto/, "only the list does");
  assert.match(css.body, /\.doc-side-card \{[^}]*flex-direction: column/, "which is what makes the two behave differently");
});

test("a comment anchor can never wrap a block", async () => {
  const { body } = await page("/write");
  assert.ok(body.includes("function clampToBlock"), "a cross-paragraph selection is clamped before it becomes an anchor");
  assert.ok(body.includes("pendingRange = clampToBlock("), "clamped where the quote is taken, so the preview matches");
  assert.ok(body.includes("a.querySelector(BLOCKS_SEL)"), "and existing block-wrapping anchors are repaired");
  assert.ok(body.includes("if (canEditDoc()) {"), "by the author only, a reader's html must stay byte-identical");
});

test("the composer's motion is GSAP, with a reduced-motion path", async () => {
  const { body } = await page("/write");
  assert.ok(body.includes("prefers-reduced-motion"), "motion is optional");

  assert.ok(!body.includes('id="commentHelp"'), "the how-to-start line is a tooltip, not a standing line of the rail");
  assert.ok(body.includes('$("newComment").classList.toggle("hidden", on)'), "checking Suggest swaps the note out for the rewrite, a straight swap, no wobble");
});

test("the composer asks what you're leaving before it asks for the words", async () => {
  const { body } = await page("/write");
  const composer = body.slice(body.indexOf('class="dc-quote"'), body.indexOf('id="newCancel"'));
  assert.ok(composer.indexOf('id="suggestOn"') < composer.indexOf('id="newComment"'),
    "the note/rewrite choice sits above the box it decides");
  assert.ok(composer.includes('rows="5"'), "and the box is tall enough to write in");
  const css = await page("/css/base.css");
  assert.match(css.body, /\.dc-new textarea \{[^}]*min-height: 116px/);
  assert.match(css.body, /\.dc-new textarea \{[^}]*font-size: 0\.84rem/, "sized for a side rail, not for prose");
});

test("how to start a comment lives on the Comments heading's tooltip", async () => {
  const { body } = await page("/write");
  assert.ok(body.includes('id="commentsHeading"'), "the heading is the trigger");
  assert.match(body, /id="commentsHeading" data-tip="Turn on comment mode/, "and carries the hint for the resting state");
  assert.ok(body.includes('$("commentsHeading").dataset.tip = commentMode'), "which follows the mode");
  assert.ok(body.includes("Select any words in the story to comment on them."), "the comment-mode wording is kept");
});

test("Ctrl/⌘+Z undoes from anywhere on the page, on both editors", async () => {
  for (const [where, file] of [["the solo editor", "/write"], ["the game's toolbar", "/js/components/rich-toolbar.js"]]) {
    const { body } = await page(file);
    assert.ok(body.includes('document.addEventListener("keydown"'), where + " listens on the document, not just the editor");
    assert.ok(body.includes("nativeUndoField"), where + " leaves real text fields their own undo");
  }
  const write = await page("/write");
  assert.ok(write.body.includes("undoRedo(e.shiftKey)"), "shift+z redoes, through the same path as the button");
});

test("the typeface dropdown offers the site's own families and never touches the document", async () => {
  const { body } = await page("/write");
  assert.ok(body.includes('id="fontSelect"'), "the control is on the toolbar");
  assert.ok(body.indexOf('id="fontSelect"') < body.indexOf('id="paperSelect"'), "beside the other view preferences");
  // our own dropdown, not a native select: a browser-drawn option list can't be
  // trusted to render a face legibly (see components/flip-select.js)
  assert.ok(body.includes("mountFlipSelect($(\"fontSelect\")"), "the flip menu, mounted on the toolbar slot");
  assert.ok(body.includes("rows: fontRows()"), "built from the shared list, not hand-written options");
  assert.ok(body.includes('setProperty("--doc-font"'), "applied as a css variable");
  // the choice dresses the WHOLE page, so it is set on the page root and the
  // page's hard-coded faces are told to inherit
  assert.match(body, /const root = document\.body/, "set on the page root, not the two surfaces");
  const css = await page("/css/base.css");
  const pageFont = css.body.slice(css.body.indexOf("\n.write-page .write-inner {"), css.body.indexOf("\n.write-page .write-inner :is(.doc-source"));
  assert.match(pageFont, /font-family: var\(--doc-font, var\(--font-body\)\)/, "the page follows the choice");
  assert.match(pageFont, /font-family: inherit/, "and the headings/meta that hard-code a face follow it too");
  // ...except what is deliberately mono: the html source view and the stepper
  assert.match(css.body, /\.write-page \.write-inner :is\(\.doc-source, \.step-input, \.step-value\) \{\s*font-family: var\(--doc-font, var\(--font-mono\)\)/);
  assert.match(css.body, /\.doc-editor,\n\.doc-source \{\s*font-family: var\(--doc-font, var\(--font-story\)\)/);
});

test("a beta reader keeps the view preferences when the formatting toolbar goes", async () => {
  const { body } = await page("/write");
  // the prefs are their own strip OUTSIDE #docToolbar, which is what gets hidden
  const prefs = body.indexOf('id="docViewPrefs"');
  const toolbarEnd = body.indexOf('id="docViewPrefs"');
  assert.ok(prefs > 0, "the view preferences have their own container");
  assert.ok(body.indexOf('id="docToolbar"') < prefs, "the formatting toolbar closes before it");
  for (const id of ["fontSelect", "paperSelect", "lineStepper"])
    assert.ok(body.indexOf(`id="${id}"`) > prefs, id + " is inside the prefs strip");
  // reading someone else's story loses the editing controls, never the comfort ones
  assert.match(body, /\$\("docToolbar"\)\.classList\.add\("hidden"\)/);
  assert.ok(!/\$\("docViewPrefs"\)\.classList\.add\("hidden"\)/.test(body), "the prefs are never hidden");
  const css = await page("/css/base.css");
  assert.match(css.body, /#docToolbar\.hidden \+ \.doc-view-prefs/, "and they lead the row once alone on it");
});

test("prompt surfaces keep a guided prompt's bulleted lines", async () => {
  const css = await page("/css/base.css");
  const banner = css.body.slice(css.body.indexOf("\n.prompt-banner {"), css.body.indexOf("\n.prompt-banner {") + 400);
  const option = css.body.slice(css.body.indexOf("\n.option {"), css.body.indexOf("\n.option:hover"));
  for (const [name, block] of [["the prompt banner", banner], ["the vote options", option]]) {
    assert.match(block, /white-space: pre-line/, name + " keeps the line breaks");
    // a wrapped clause hangs under its own text rather than under the bullet
    assert.match(block, /text-indent: -1\.15em/, name + " hangs the wrap");
    assert.match(block, /padding:[^;]*1\.15em/, name + " leaves room for the bullet");
  }
  const chips = css.body.slice(css.body.indexOf("\n.opt-chips {"), css.body.indexOf("\n.opt-chip {"));
  assert.match(chips, /text-indent: 0/, "the chips row opts out of the prose indent");
});

test("a full-width page keeps a 16px edge, and the write page stays full-bleed", async () => {
  const css = await page("/css/base.css");
  const gutter = css.body.slice(css.body.indexOf("\n.wrap > .archive-inner {"), css.body.indexOf("\n.wrap > .archive-inner {") + 120);
  assert.match(gutter, /padding-left: 16px/);
  assert.match(gutter, /padding-right: 16px/);
  // the multi-column shelf is the case that actually reaches the bezel
  assert.match(css.body, /\.archive-inner\.wide \{\s*max-width: min\(1560px, 100%\)/);
  // ...and the write page is deliberately exempt: only .doc-main is guttered
  const write = css.body.slice(css.body.indexOf("\n.write-inner {"), css.body.indexOf("\n.write-inner {") + 200);
  assert.ok(!/padding-left: 16px/.test(write), "the write page is full-bleed by design");
});

test("the theme menu scrolls and sits above the write page's toolbar", async () => {
  const css = await page("/css/base.css");
  const menu = css.body.slice(css.body.indexOf("\n.theme-menu {"), css.body.indexOf("\n.theme-switch.open .theme-menu"));
  assert.match(menu, /max-height: min\(60vh, 430px\)/, "19 themes don't fit a laptop window");
  assert.match(menu, /overflow-y: auto/);
  assert.match(menu, /z-index: 120/, "and it paints over the sticky toolbar below it");
});

test("the block-format picker shows tag names, with the full name on each option", async () => {
  for (const file of ["/write", "/js/components/rich-toolbar.js"]) {
    const { body } = await page(file);
    for (const [value, label] of [["p", ">p<"], ["h1", ">h1<"], ["h2", ">h2<"], ["h3", ">h3<"]])
      assert.ok(body.includes(`value="${value}" title=`) && body.includes(label), `${value} reads as its tag in ${file}`);
    assert.ok(!body.includes(">Heading 1<"), "the long labels are gone from " + file);
    assert.ok(body.includes('title="Heading 1"'), "…but survive as the tooltip in " + file);
  }
});

test("readers and comment mode sit with visibility, not on the formatting toolbar", async () => {
  const { body } = await page("/write");
  const head = body.slice(body.indexOf('class="doc-head-meta"'), body.indexOf('id="docHeadRight"'));
  assert.ok(head.includes('id="visWrap"') && head.includes('id="shareBtn"') && head.includes('id="commentToggle"'),
    "all three state controls are in the document head");
  assert.ok(head.indexOf('id="visWrap"') < head.indexOf('id="shareBtn"'), "visibility first, then who can read it");
  const toolbar = body.slice(body.indexOf('class="toolbar-right"'), body.indexOf('id="restoreBar"'));
  assert.ok(!toolbar.includes('id="shareBtn"') && !toolbar.includes('id="commentToggle"'), "and no longer on the toolbar");
  assert.ok(toolbar.includes('id="modeRich"') && toolbar.includes('id="modeHtml"'), "which keeps rich/HTML only");
  const css = await page("/css/base.css");
  assert.match(css.body, /\.head-chip \{[^}]*border-radius: 999px/, "they wear the same chip shape as the visibility one");
  assert.match(css.body, /\.head-chip\.on \{/, "comment mode still shows that it's on");
});

test("the inbox has a page of its own, linked from the dashboard and the nav", async () => {
  const inbox = await page("/inbox");
  assert.equal(inbox.status, 200);
  assert.ok(inbox.body.includes('id="inboxList"'), "the messages land here");
  assert.ok((await page("/js/pages/inbox.js")).body.includes("mountInbox"), "the whole panel: rows, chains and composer (the script is emitted from client/pages/inbox.ts)");

  // The dashboard doesn't preview messages: it carries the fact that some are
  // waiting, and the link to go and read them.
  const dash = await page("/dashboard");
  assert.ok(dash.body.includes('href="/inbox"'), "the dashboard links to it");
  assert.ok(!dash.body.includes('id="inboxList"'), "and renders no messages of its own");
  assert.ok(dash.body.includes('id="navInbox"'), "just the unread count on the link");

  const chrome = await page("/js/chrome.js");
  assert.ok(chrome.body.includes('href="/inbox"'), "it's in the nav drawer too");
});

test("the messages you type are fixed boxes, not drag-to-resize ones", async () => {
  const css = await page("/css/dashboard.css");
  assert.match(css.body, /#helpText \{[^}]*resize: none/s, "the ask-the-admin box");
  assert.match(css.body, /\.ib-reply textarea,\s*#helpText \{[^}]*resize: none/s, "and the inline reply");
});

test("a write card's two actions are one matched pair on one side", async () => {
  const css = await page("/css/base.css");
  assert.match(css.body, /\.doc-card-actions \{[^}]*justify-content: flex-start/, "both sit at one end");
  assert.match(css.body, /\.doc-card-actions > \* \{[^}]*width: 96px/, "and Open and Delete are the same size");
});

test("the comments rail is a drawer: it opens, it closes, and you can resize it", async () => {
  const { body } = await page("/write");
  assert.ok(body.includes('id="docSideGrip"'), "a grip to drag");
  assert.ok(body.includes('id="commentsClose"') && body.includes('id="commentsOpen"'), "closed by the ✕, reopened by the edge tab");
  assert.ok(body.includes("sideWidth") && body.includes("sideOpen"), "both are remembered as editor prefs");
  assert.ok(body.includes("window.innerHeight - e.clientY"), "on a phone the sheet is dragged by its height");
  assert.ok(body.includes('e.key === "ArrowLeft"'), "and the grip answers to the keyboard, not only a drag");

  const css = await page("/css/base.css");
  assert.match(css.body, /\.doc-main \{[^}]*grid-template-columns: minmax\(0, 1fr\) var\(--doc-side-w/, "the writer's width drives the column");
  assert.match(css.body, /\.doc-main\.side-closed \{[^}]*grid-template-columns: minmax\(0, 1fr\);/, "closed, the prose gets the page");
});

test("prose stays selectable on a phone, highlighting it is how you comment", async () => {
  const css = await page("/css/base.css");
  assert.match(css.body, /\.doc-editor \{[^}]*-webkit-user-select: text/s, "the surface says it is selectable");
  assert.match(css.body, /\.doc-editor \{[^}]*-webkit-touch-callout: default/s, "including the long-press callout iOS suppresses");

  const { body } = await page("/write");
  assert.ok(body.includes("coarsePointer"), "touch is treated differently from a mouse");
  assert.ok(body.includes("if (!coarsePointer()) $(\"newComment\").focus()"),
    "autofocus is desktop-only: focusing a box mid-gesture drops the selection you just made");
  assert.ok(body.includes("if (!touchingText) composerTimer"), "and the composer waits for the finger to lift");
});

test("the theme peek and the tip jar live in one thin foot bar, not two floating chips", async () => {
  const chrome = await page("/js/chrome.js");
  assert.ok(chrome.body.includes('class="foot-bar"'), "one strip holds both");
  assert.ok(!chrome.body.includes("storage.ko-fi.com"), "the third-party floating widget script is gone");
  assert.ok(chrome.body.includes("embed=true"), "replaced by ko-fi's own panel in our modal");
  assert.ok(chrome.body.includes('frame.setAttribute("src"'), "and the iframe is built only when asked for");

  const css = await page("/css/base.css");
  assert.match(css.body, /--footbar-h: 32px/, "one number the rest of the page clears itself by");
  assert.match(css.body, /\.foot-bar \{[^}]*height: var\(--footbar-h\)/s);
  assert.match(css.body, /body \{[^}]*padding: 20px 0 var\(--footbar-h\)/s, "page content ends above it");
  assert.match(css.body, /\.doc-side \{[^}]*bottom: var\(--footbar-h\)/s, "and the comments sheet");
});

test("both shelves can be read as a list or as 3/4/6 across", async () => {
  const { body } = await page("/stories");
  assert.ok(body.includes('id="stViewWrap"'), "the picker has a home in the tools row");
  // the page scripts are emitted from client/pages/<page>.ts
  assert.ok((await page("/js/pages/stories.js")).body.includes("mountViewPicker"), "wired to the shared picker");

  // /archive gets the same control, and shares the stored choice with it
  const arch = await page("/archive");
  const archScript = (await page("/js/pages/archive.js")).body;
  assert.ok(arch.body.includes('id="archViewWrap"') && archScript.includes("mountViewPicker"), "same picker on the archive");
  assert.ok(archScript.includes("arch-group"), "its group headings stay outside the grids");

  const picker = await page("/js/components/view-picker.js");
  assert.ok(picker.body.includes("cowriteStoriesView"), "the choice is a habit, so it's remembered");
  assert.ok(picker.body.includes("cleanStoryView"), "and validated before it's used");

  const css = await page("/css/base.css");
  assert.match(css.body, /\.st-grid \{[^}]*grid-template-columns: repeat\(\s*auto-fill/s,
    "auto-fill, so too many columns degrade instead of shredding the cards");
  assert.match(css.body, /\.st-grid \{[^}]*var\(--st-cols, 3\)/s, "the chosen count drives the floor");
  assert.match(css.body, /\.archive-inner\.wide \{[^}]*max-width: min\(1560px/, "multi-column views get more page");
});

test("the write page is full-bleed and square, not a centred card", async () => {
  const { body } = await page("/write");
  assert.ok(body.includes('<body class="write-page">'), "the page owns the layout switch");

  const css = await page("/css/base.css");
  assert.match(css.body, /\.write-inner \{[^}]*max-width: none/s, "the drafting surface gets the whole window");
  assert.match(css.body, /body\.write-page \{\s*padding-top: 0;/, "and starts at the top of it");
  assert.match(css.body, /\.write-page \.doc-shell \{[^}]*border-radius: 0/s, "the sticky slab runs edge to edge");
  assert.match(css.body, /\.write-page \.doc-editor,[^{]*\{\s*border-radius: 0/s, "so nothing inside it keeps a rounded corner");
  assert.match(css.body, /\.write-page \.doc-main \{\s*padding: 0 14px/, "only the prose keeps a gutter off the bezel");
});

test("reading one story hides everything that describes the list", async () => {
  const { body } = await page("/js/pages/stories.js"); // the page's script, emitted from client/pages/stories.ts
  // the toolbar, the pager and the shelf's subtitle all describe the shelf
  const hide = body.slice(body.indexOf("async function openStory"), body.indexOf("$(\"stListLink\")"));
  for (const id of ["storiesList", "storiesTools", "stPager", "storiesSub"])
    assert.ok(hide.includes(`"${id}"`), id + " is hidden while a story is open");
  const show = body.slice(body.indexOf("function showList()"), body.indexOf("async function openStory"));
  for (const id of ["storiesList", "storiesTools", "storiesSub"])
    assert.ok(show.includes(`"${id}"`), id + " comes back with the list");
});

test("the dashboard's first card holds the whole of how you're doing", async () => {
  const { body } = await page("/dashboard");
  const card = body.slice(body.indexOf('class="welcome"'), body.indexOf("games in progress"));
  // three counts of a kind in one row — words, badges, streak — then the rank
  // bar spanning under them, then what the counts have earned
  const row = card.slice(card.indexOf('class="stat-row"'), card.indexOf('class="rank-bar"'));
  for (const id of ["statWords", "statBadges", "streakBox"]) assert.ok(row.includes(`id="${id}"`), id + " is a column");
  assert.ok(card.indexOf('id="streakBox"') < card.indexOf('id="rankFill"'), "the rank bar spans underneath");
  const first = card.slice(0, card.indexOf('id="dashTabs"'));
  assert.ok(!first.includes('id="achStrip"'), "achievements moved under the Dashboard tab");
  const rail = body.slice(body.indexOf("============ RAIL"));
  assert.ok(!rail.includes('id="achStrip"') && !rail.includes('id="streakBox"'), "and none of it is in the rail");
});

test("the column under the profile is two tabs: Dashboard (mine) and Community (everyone)", async () => {
  const { body } = await page("/dashboard");
  const tabs = body.slice(body.indexOf('id="dashTabs"'), body.indexOf('id="tabDashboard"'));
  assert.ok(tabs.includes('data-tab="dashboard"') && tabs.includes('data-tab="community"'), "two tabs");
  assert.ok(!tabs.includes('id="tabCommunityN"'), "Community wears no writer count");
  assert.ok(tabs.includes('id="tabCommunityLive"'), "Community wears the live-games pill");
  assert.ok(tabs.includes('id="tabCommunityDot"'), "and a dot for unseen announcements");
  const script = (await page("/js/pages/dashboard.js")).body // the page's script, emitted from client/pages/dashboard.ts
  assert.ok(script.includes('"cowriteAnnSeen"') && script.includes("markAnnouncementsSeen()"), "seen on opening the tab, remembered per browser");
  const mine = body.slice(body.indexOf('id="tabDashboard"'), body.indexOf('id="tabCommunity"'));
  for (const id of ["achStrip", "myGames", "dashWrites", "recentGames"]) assert.ok(mine.includes(`id="${id}"`), id + " is mine");
  for (const id of ["dashLive", "writersList", "annCard", "helpCard"]) assert.ok(!mine.includes(`id="${id}"`), id + " is not");
  const everyone = body.slice(body.indexOf('id="tabCommunity"'), body.indexOf("============ RAIL"));
  for (const id of ["annCard", "dashLive", "writersList", "helpCard"]) assert.ok(everyone.includes(`id="${id}"`), id + " is community");
  assert.ok(everyone.indexOf('id="annCard"') < everyone.indexOf('id="dashLive"'), "the announcement leads");
  assert.ok(everyone.includes('id="annSec"') && everyone.includes('id="annMore"') && everyone.includes('href="/announcements"'), "an Announcements section with the page linked");
  // the rail stands left of the column on desktop, by grid placement
  const css = (await page("/css/dashboard.css")).body;
  assert.match(css, /\.dash-wrap \{[^}]*grid-template-columns: 280px minmax\(0, 1fr\)/, "rail column first");
  assert.match(css, /\.dash-rail \{\s*grid-column: 1;/, "the rail is placed in it");
});

test("pause and end-and-reveal live in the session bar, host-only", async () => {
  const { body } = await page("/game");
  const bar = body.slice(body.indexOf('<div id="game"'), body.indexOf('id="gamePrompt"'));
  assert.ok(bar.includes('id="hostGame"'), "the two game-level actions sit in the writing card's session bar");
  assert.ok(bar.includes('id="pauseBtn"') && bar.includes('id="endBtn"'), "pause and reveal, both of them");
  assert.ok(bar.includes('class="sess-acts hidden"'), "hidden until you are the host");
  assert.ok(bar.indexOf('id="endBtn"') < bar.indexOf('id="inviteShareMenu"'), "Share ▾ stands to the right of End game & reveal");
  // one condition drives both places, so they can never disagree (the page's
  // script is emitted from client/pages/game.ts to /js/pages/game.js)
  const script = (await page("/js/pages/game.js")).body;
  assert.match(script, /\$\("hostGame"\)\.classList\.toggle\("hidden", !host\)/);
  // and the host panel keeps only the settings — the rules form and the cover
  const panel = body.slice(body.indexOf('id="hostPanel"'), body.indexOf("</aside>"));
  assert.ok(!panel.includes('id="pauseBtn"') && !panel.includes('id="endBtn"'), "not left behind in the panel too");
});

test("host controls are a modal on the game page: the ⚙️ tab opens it, the ✕ in its corner closes it, full-screen on a phone", async () => {
  const { body } = await page("/game");
  assert.ok(body.includes('id="hostModal"') && body.includes('role="dialog"'), "a dialog");
  assert.ok(body.includes('id="hostOpen"') && body.includes('aria-controls="hostModal"'), "the tab that opens it");
  assert.ok(!body.includes('id="hostSide"') && !body.includes("mountSideDrawer"), "no drawer any more");
  const modal = body.slice(body.indexOf('id="hostModal"'), body.indexOf('id="hostPanel"'));
  assert.ok(modal.includes('id="hostClose"') && modal.includes("doc-side-close"), "the ✕ is in the modal's head");
  const panel = body.slice(body.indexOf('id="hostPanel"'), body.indexOf("</div>\n\t\t\t\t\t</div>", body.indexOf('id="hostPanel"')));
  assert.ok(panel.includes('id="hostRules"') && panel.includes('id="coverInput2"'), "rules and cover live in the modal");
  const script = (await page("/js/pages/game.js")).body; // emitted from client/pages/game.ts
  assert.match(script, /\$\("hostOpen"\)\.onclick = openHostModal/);
  assert.match(script, /\$\("gkTabs"\)\.prepend\(\$\("hostOpen"\)\)/, "the ⚙️ tab stacks with the gimmick tabs on the left edge");
  assert.match(body, /id="hostOpen"[^>]*><i class="fa-solid fa-gear"[^>]*><\/i><span class="tab-word">Host settings<\/span>/, "the tab reads [gear] Host settings");
  assert.match(script, /\$\("hostClose"\)\.onclick = closeHostModal/);
  assert.match(script, /e\.key === "Escape" && closeHostModal\(\)/, "Escape closes");
  const main = body.slice(body.indexOf('class="game-main"'), body.indexOf('id="storyBox"'));
  assert.ok(main.includes('id="gamePrompt"'), "the prompt banner is inside the main column");
  const css = (await page("/css/base.css")).body;
  assert.ok(!/\.game-cols[^{]*\{[^}]*--doc-side-w/.test(css), "the grid holds no drawer column");
  assert.match(css, /#hostOpen \.tab-word \{[^}]*writing-mode: vertical-rl/, "the words run sideways down the tab");
  // the modal's card fills a phone screen and the ✕ stands in its corner
  const phone = css.slice(css.indexOf(".host-modal-card {"), css.indexOf("/* ---------- Low-time alarm"));
  assert.match(phone, /@media \(max-width: 860px\) \{[^@]*\.host-modal-card \{[^}]*width: 100%;[^}]*height: 100%;/, "full width and height on a phone");
  assert.match(css, /\.host-modal-head \.doc-side-close \{[^}]*position: absolute;[^}]*right: 10px/, "✕ in the corner");
  // the side column (writers + chat) is one width everywhere: every grid rule
  // reads --game-side-w, no bare pixel column survives
  assert.match(css, /\.game-cols \{[^}]*--game-side-w: 340px/, "the column names its width once");
  const gridRules = [...css.matchAll(/\.game-cols(?:\.side-closed)? \{[^}]*grid-template-columns: ([^;]+);/g)].map((m) => m[1]);
  assert.ok(gridRules.length >= 3, "desktop + the two breakpoints");
  for (const cols of gridRules) assert.ok(cols === "1fr" || cols.includes("var(--game-side-w)"), "no hard-coded side width: " + cols);
  assert.match(css, /#game \.chat-sec \.chat-row,\n#over \.chat-sec \.chat-row \{[^}]*flex-wrap: nowrap/, "the composer stays on one line, on the reveal too");
  // the reveal keeps the two columns: story + controls on the left, the chat
  // as a sidebar (#overSide) on the right, styled like the game's own rail
  const over = body.slice(body.indexOf('id="over"'), body.indexOf("<!-- /main -->"));
  assert.ok(over.includes('class="game-cols"') && over.includes('class="game-main"'), "the reveal is a game-cols grid");
  assert.ok(over.indexOf('id="overStory"') < over.indexOf('id="overSide"'), "the story column comes first");
  assert.match(over, /<aside class="game-side" id="overSide">/);
  assert.match(script, /id === "game" \|\| id === "over"/, "placeChat keeps the chat a sidebar on the reveal");
  assert.match(script, /id === "game" \? chatHome : \$\("overSide"\)/);
  assert.match(script, /home\.insertBefore\(chat, id === "game" \? \$\("doomFx"\) : null\)/, "the chat returns above the demogorgon, never under it");
  assert.match(css, /#game \.game-side,\n#over \.game-side \{/, "the reveal's rail wears the game's rail rule");
  // the player pills are one four-column table, words in the middle
  assert.match(css, /\.side-sec \.player-chip \{[^}]*grid-template-columns: minmax\(7\.6em, auto\) minmax\(0, 1fr\) auto auto/);
  const chip = script.slice(script.indexOf('class="player-chip${'), script.indexOf("seatMenuHtml(w, st.writers)"));
  assert.ok(chip.indexOf("chip-lead") < chip.indexOf("chip-who") && chip.indexOf("chip-who") < chip.indexOf("chip-words") && chip.indexOf("chip-words") < chip.indexOf("chip-tail"), "lead · who · words · tail");
  assert.ok(!chip.includes("w.words != null ?"), "the count is unconditional");
  const who = chip.slice(chip.indexOf("chip-who"), chip.indexOf("chip-words"));
  assert.ok(who.includes("whoMarks(w)"), "the (host) mark sits beside the name, not in the tail");
});

// The app's name comes from the content pack (content/site.json): the server
// renders every page's {{SITE_NAME}}/{{FANDOM}} tokens and injects a
// <meta name="site-name"> the client modules read.
test("pages are rendered from site.json: no raw tokens, name in title, meta injected", async () => {
  const { readFileSync } = await import("node:fs");
  const site = JSON.parse(readFileSync(new URL("../content/site.json", import.meta.url), "utf-8"));
  const NAME = site.name || `${site.fandom} Cowrite`; // derived when the pack doesn't name the app
  for (const path of ["/", "/index.html", "/dashboard", "/game", "/reset.html"]) {
    const r = await page(path);
    assert.equal(r.status, 200, path);
    assert.ok(!r.body.includes("{{"), path + " has no unrendered token");
    assert.ok(r.body.includes(NAME), path + " carries the pack's name");
    assert.ok(r.body.includes(`<meta name="site-name" content="${NAME}"`), path + " injects the meta");
  }
  const home = await page("/");
  assert.ok(home.body.includes('id="heroWord1" class="hero-word-svg" x="450" y="110">Byler<'), "the hero's first word is the fandom");
  assert.ok(home.body.includes("function fitHeroWords"), "and it is fitted to the stage after the fonts land");
  assert.ok(home.body.includes("getComputedTextLength"), "by measuring, not guessing");
});

test("/games is the coming-soon page, linked from the nav drawer and the dashboard rail", async () => {
  const r = await fetch(ctx.url + "/games");
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /Coming soon/);
  assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/, "tokens filled");
  const { readFileSync } = await import("node:fs");
  assert.match(readFileSync(new URL("../public/js/chrome.js", import.meta.url), "utf-8"), /href="\/games"[^>]*>🕹️ Games</, "the hamburger menu lists it");
  assert.match(readFileSync(new URL("../public/dashboard.html", import.meta.url), "utf-8"), /class="dnav" href="\/games"/, "the dashboard rail lists it");
});

test("the game page's tab title is the story's name, refreshed with the session bar, so a rename mid-vote shows at once", async () => {
  const { readFileSync } = await import("node:fs");
  // the page's script is emitted from client/pages/game.ts; a static module never passes
  // through renderPage(), so the site name is read off the meta tag (siteName()) there
  const src = readFileSync(new URL("../public/js/pages/game.js", import.meta.url), "utf-8");
  assert.match(src, /const setPageTitle = \(\) => \{\s*document\.title = siteName\(\) \+ ": " \+ \(sessName \|\| PAGE_TITLES\[shownCard\] \|\| "Game"\)/, "the name leads, the phase is the fallback");
  const bar = src.slice(src.indexOf("function updateSessionBar()"), src.indexOf("async function copyCode"));
  assert.ok(bar.includes("setPageTitle()"), "every session-bar repaint refreshes the title");
  assert.ok(!/onlyShow[\s\S]{0,200}document\.title =/.test(src), "onlyShow no longer sets a phase-only title");
});

test("the dashboard rail breaks below the column on a phone — the LAST word on .dash-wrap's columns is single", async () => {
  const css = (await page("/css/dashboard.css")).body;
  // every un-media'd .dash-wrap column rule must come BEFORE the last
  // 900px collapse, or the collapse loses on source order and the rail
  // overlaps the column (which is exactly what happened)
  const collapse = [...css.matchAll(/@media \(max-width: 900px\) \{\s*\.dash-wrap \{[^}]*grid-template-columns: minmax\(0, 1fr\);/g)];
  assert.ok(collapse.length, "a 900px single-column rule exists");
  const lastCollapse = collapse[collapse.length - 1].index;
  const twoCol = [...css.matchAll(/\.dash-wrap \{[^}]*grid-template-columns: (?:minmax\(0, 1fr\) \d+px|\d+px minmax\(0, 1fr\))/g)];
  assert.ok(twoCol.length, "and a two-column rule");
  for (const m of twoCol) assert.ok(m.index < lastCollapse, "every two-column rule precedes the final collapse");
});

test("touch devices get 16px fields, so iOS never zooms the page on focus", async () => {
  const css = (await page("/css/base.css")).body;
  assert.match(css, /@media \(hover: none\) and \(pointer: coarse\) \{\s*input,\s*select,\s*textarea,\s*\[contenteditable="true"\] \{\s*font-size: max\(1em, 16px\);/, "the rule is the last word on field size");
  for (const p of ["/dashboard", "/inbox", "/game", "/profile"]) {
    const html = (await page(p)).body;
    assert.ok(!/maximum-scale|user-scalable=no/.test(html), p + " never forbids zooming");
  }
});

test("every page loads the self-hosted Font Awesome stylesheet, never the kit", async () => {
  for (const p of ["/", "/dashboard", "/game", "/archive", "/inbox", "/profile", "/settings", "/write", "/writes", "/stories", "/games", "/ranks", "/announcements", "/admin", "/reset"]) {
    const html = (await page(p)).body;
    assert.ok(html.includes('<link rel="stylesheet" href="/vendor/fontawesome/css/fa.min.css" />'), p + " carries the local stylesheet");
    assert.ok(!html.includes("kit.fontawesome.com"), p + " fetches nothing from the kit CDN");
  }
  // the sheet and its two fonts are served, cacheable, and the sheet names only fonts we ship
  const css = await page("/vendor/fontawesome/css/fa.min.css");
  assert.equal(css.status, 200);
  assert.match(css.headers.get("cache-control") || "", /max-age=604800/, "vendor files cache for a week");
  const fonts = [...css.body.matchAll(/url\(\.\.\/webfonts\/([^)]+)\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(fonts)].sort(), ["fa-regular-400.woff2", "fa-solid-900.woff2"]);
  for (const f of fonts) assert.equal((await page("/vendor/fontawesome/webfonts/" + f)).status, 200, f + " is shipped");
  // and every icon the pages use is a free one in a style we ship
  for (const style of ["fa-solid", "fa-regular"]) assert.ok(css.body.includes(`.${style}`), style + " is in the sheet");
});

test("the caret is visible inside a gradient-text heading in every editor", async () => {
  const css = (await page("/css/base.css")).body;
  // whitespace-tolerant: selectors may be one-per-line (Prettier) or inline
  assert.match(css, /\.editor h1,\s*\.doc-editor h1,\s*\[contenteditable="true"\] h1,[\s\S]*?caret-color:\s*var\(--accent-2\);/, "h1 in the game and solo editors names its caret");
});

test("nothing hard-codes the fandom: the repo pack renders as Byler Cowrite everywhere, no 'Fandom Cowrite' anywhere", async () => {
  for (const p of ["/", "/dashboard", "/game", "/profile", "/reset.html"]) {
    const html = (await page(p)).body;
    assert.ok(html.includes("Byler Cowrite"), p + " is Byler Cowrite");
    assert.ok(!html.includes("Fandom Cowrite"), p + " never says Fandom Cowrite");
    assert.ok(!/<h1[^>]*>\s*Cowrite\s*<\/h1>/.test(html), p + " never falls back to the bare default");
  }
  const home = (await page("/")).body;
  assert.ok(home.includes('y="110">Byler<') && home.includes('y="230">Cowrite<'), "the hero writes Byler / Cowrite");
});

test("every page carries Open Graph tags for link previews, and the banner exists at the path they name", async () => {
  const { existsSync } = await import("node:fs");
  const html = await fetch(ctx.url + "/").then((r) => r.text());
  assert.ok(html.includes('property="og:title" content="Byler Cowrite"'));
  assert.ok(html.includes('name="twitter:card" content="summary_large_image"'), "the wide banner layout");
  assert.ok(html.includes('property="og:image" content="/img/og-banner.png"'), "no PUBLIC_APP_URL in tests → root-relative");
  assert.ok(existsSync(new URL("../public/img/og-banner.png", import.meta.url)), "public/img/og-banner.png (scripts/og-banner.sh)");
  const game = await fetch(ctx.url + "/game").then((r) => r.text());
  assert.ok(game.includes('property="og:description"'), "every rendered page, not just the homepage");
});

test("the homepage feature rundown never opens on a touch device while GSAP is loaded (it crashed mobile browsers)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../public/js/pages/index.js", import.meta.url), "utf-8"); // the page's script, emitted from client/pages/index.ts
  assert.match(src, /\(hover: none\) and \(pointer: coarse\)/);
  assert.match(src, /featuresAllowed = \(\) => !\(touchDevice\(\) && typeof window\.gsap !== "undefined"\)/);
  assert.match(src, /if \(featuresAllowed\(\)\) \$\("featuresModal"\)\.classList\.remove\("hidden"\)/);
});

test("archive: tags are read-only chips above the prompt with a ✎ that opens the tag modal; the input lives only in the modal", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(new URL("../public/archive.html", import.meta.url), "utf8");
  const row = html.indexOf('id="archTagRow"'), prompt = html.indexOf('id="archPrompt"'), edit = html.indexOf('id="archTagEdit"');
  assert.ok(row > -1 && edit > row && row < prompt, "tag row (with ＋) sits above the prompt");
  assert.match(html, /id="archTagEdit"[^>]*>＋</, "the edit control is a small plus");
  const modal = html.indexOf('id="tagModal"');
  assert.ok(modal > -1 && html.indexOf('id="archTags"') > modal, "the tag editor mounts inside the modal only");
  const detail = html.slice(html.indexOf('id="archiveDetail"'), html.indexOf('id="tagModal"'));
  assert.ok(!detail.includes('id="archTags"'), "no tag input on the page outside the modal");
});

// The previewer is its own site now: linked out from the tour bar, the nav
// drawer and the dashboard rail, each link glowing (theme tokens only).
test("the AO3 skin previewer is linked out to ao3-skin-previewer.replit.app from the tour bar, the nav drawer and the dashboard rail, and every link glows", async () => {
  const SITE = "https://ao3-skin-previewer.replit.app";
  const home = await page("/");
  const bar = home.body.slice(home.body.indexOf('id="tourBar"'), home.body.indexOf('id="tourDots"'));
  assert.match(bar, new RegExp(`<a class="bar-link bar-link-glow" href="${SITE}" target="_blank" rel="noopener">🎨 AO3 skin previewer</a>`), "the tour bar links it");
  assert.ok(!home.body.includes('href="/ao3-preview"'), "no in-app route link is left");
  const homeCss = (await page("/css/home.css")).body;
  assert.match(homeCss, /\.tour-bar \.bar-link-glow::after \{[^}]*animation: bar-link-glow/s, "the glow breathes on a pseudo-element (opacity, composited) — test/animation-budget.test.mjs");
  const chrome = (await page("/js/chrome.js")).body;
  // esbuild may hoist the export into a trailing `export { … }` list; either spelling names the site once
  assert.match(chrome, new RegExp(`^(?:export )?const AO3_PREVIEWER_URL = "${SITE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "m"));
  assert.match(chrome, /<a href="\$\{AO3_PREVIEWER_URL\}" class="nav-glow" target="_blank" rel="noopener">🎨 AO3 skin previewer<\/a>/, "the nav drawer lists it");
  const base = (await page("/css/base.css")).body;
  assert.match(base, /\.nav-drawer a\.nav-glow::after \{[^}]*animation: nav-glow/s);
  const dash = readFileSync(new URL("../public/dashboard.html", import.meta.url), "utf-8");
  assert.match(dash, new RegExp(`<a class="dnav dnav-glow" href="${SITE}" target="_blank" rel="noopener">`), "the dashboard rail lists it");
  const dashCss = (await page("/css/dashboard.css")).body;
  assert.match(dashCss, /\n\.dnav-glow::after \{[^}]*animation: dnav-glow/s, "the previewer row glows");
  assert.ok(!/#soloBtn[^{]*\{[^}]*animation/s.test(dashCss), "solo write no longer glows — one beacon per rail");
  assert.match(dash, /<span class="dnav-new">New<\/span>/, "with a NEW pill");
  assert.match(dashCss, /\.dnav-new \{[^}]*animation: dnav-new/s, "that pulses");
  for (const css of [homeCss, base, dashCss]) {
    for (const block of css.match(/@keyframes (bar-link-glow|nav-glow|dnav-glow|dnav-new)[^}]*\}[^}]*\}[^}]*\}/g) || []) assert.ok(!/#[0-9a-f]{3,6}\b/i.test(block), "the glow is theme tokens, no hard-coded colour");
  }
});

test("the write page has a chapter panel, a chapter chip, a foot nav and an export menu; the panel is the grid's first column and a phone dropdown", async () => {
  const { body } = await page("/write");
  assert.ok(body.includes('id="chapPanel"'), "the chapter panel");
  assert.ok(body.indexOf('id="chapPanel"') < body.indexOf('class="doc-col"'), "it comes before the prose column");
  assert.ok(body.includes('id="chapChip"'), "the head-row chip");
  assert.ok(body.includes('id="chapNav"'), "prev/next under the editor");
  assert.ok(body.includes('id="exportChapter"') && body.includes('id="exportWork"'), "export this chapter / the whole work");
  assert.ok(body.includes("chapterId: openChapter()?.id"), "a comment names its chapter");
  assert.ok(body.includes("chapters: list"), "a save sends the whole chapter list");
  const css = (await page("/css/base.css")).body;
  assert.match(css, /\.doc-main:not\(\.chap-closed\) \{[^}]*grid-template-columns: 220px minmax\(0, 1fr\) var\(--doc-side-w/, "three columns with the panel first");
  const phone = css.slice(css.indexOf("the chapter panel is a dropdown"));
  assert.match(phone, /\.doc-chapters \{[^}]*position: fixed/, "a dropdown on a phone");
});

// A page-level `function history()` shadows window.history inside the module,
// so `history.replaceState` throws — which once aborted the write page's load
// before its socket connected, and every comment went nowhere.
test("no page declares a `history` of its own (it would shadow window.history)", () => {
  for (const f of fsSync.readdirSync(new URL("../public/", import.meta.url)).filter((x) => x.endsWith(".html"))) {
    const src = readFileSync(new URL("../public/" + f, import.meta.url), "utf-8");
    assert.ok(!/\b(function|const|let|var)\s+history\b/.test(src), f + " shadows window.history");
  }
});
