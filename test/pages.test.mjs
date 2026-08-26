import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.mjs";

let ctx;
before(async () => (ctx = await startServer()));
after(async () => ctx.stop());

const page = async (path) => {
  const r = await fetch(ctx.url + path);
  return { status: r.status, body: await r.text(), headers: r.headers };
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
  assert.ok(list.body.includes("docShelfHtml(docs)"), "grouped into mine / beta reading");
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
  for (const id of ["delModal", "archDelete", "delHtml", "delPdf", "delConfirm", "delCancel", "archNotice"])
    assert.ok(arch.body.includes(`id="${id}"`), id + " in the delete flow");
  const prof = await page("/profile");
  assert.equal(prof.status, 200);
  assert.ok(prof.body.includes('id="ladder"') && prof.body.includes('id="usageCase"'));
  const set = await page("/settings");
  assert.equal(set.status, 200);
  assert.ok(set.body.includes('id="savePass"'));
  // color picker leads; username/email/password are collapsed behind toggles
  assert.ok(set.body.indexOf('id="swatches"') < set.body.indexOf('data-toggle="secUsername"'), "color first");
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
  assert.ok(body.includes("renderComments() {\n\t\t\t\tpruneLocalAnchors()"), "…on every comments update, and after an undo");
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
  assert.ok(write.body.includes("history(e.shiftKey)"), "shift+z redoes, through the same path as the button");
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
  assert.ok(inbox.body.includes("mountInbox"), "the whole panel: rows, chains and composer");

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
  assert.match(css.body, /\.chat-dock \{[^}]*bottom: var\(--footbar-h\)/s, "so does the game's chat dock");
  assert.match(css.body, /\.doc-side \{[^}]*bottom: var\(--footbar-h\)/s, "and the comments sheet");
});

test("both shelves can be read as a list or as 3/4/6 across", async () => {
  const { body } = await page("/stories");
  assert.ok(body.includes('id="stViewWrap"'), "the picker has a home in the tools row");
  assert.ok(body.includes("mountViewPicker"), "wired to the shared picker");

  // /archive gets the same control, and shares the stored choice with it
  const arch = await page("/archive");
  assert.ok(arch.body.includes('id="archViewWrap"') && arch.body.includes("mountViewPicker"), "same picker on the archive");
  assert.ok(arch.body.includes("arch-group"), "its group headings stay outside the grids");

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
  const { body } = await page("/stories");
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
  assert.ok(card.indexOf('id="rankFill"') < card.indexOf('id="achStrip"'), "achievements last");
  const rail = body.slice(body.indexOf("RIGHT RAIL"));
  assert.ok(!rail.includes('id="achStrip"') && !rail.includes('id="streakBox"'), "and none of it is in the rail");
});

test("pause and end-and-reveal live in the session bar, host-only", async () => {
  const { body } = await page("/game");
  const bar = body.slice(body.indexOf('<div id="game"'), body.indexOf('id="gamePrompt"'));
  assert.ok(bar.includes('id="hostGame"'), "the two game-level actions sit in the writing card's session bar");
  assert.ok(bar.includes('id="pauseBtn"') && bar.includes('id="endBtn"'), "pause and reveal, both of them");
  assert.ok(bar.includes('class="sess-acts hidden"'), "hidden until you are the host");
  // one condition drives both places, so they can never disagree
  assert.match(body, /\$\("hostGame"\)\.classList\.toggle\("hidden", !host\)/);
  // and the host panel keeps only the settings — the rules form and the cover
  const panel = body.slice(body.indexOf('id="hostPanel"'), body.indexOf("</aside>"));
  assert.ok(!panel.includes('id="pauseBtn"') && !panel.includes('id="endBtn"'), "not left behind in the panel too");
});

test("host controls are the comments drawer, on the game page", async () => {
  const { body } = await page("/game");
  // the same classes as the solo editor's rail — one set of CSS, one behaviour
  const write = (await page("/write")).body;
  for (const cls of ["doc-side", "doc-side-card", "doc-side-grip", "doc-side-head", "doc-side-close", "doc-side-tab"])
    assert.ok(body.includes(cls) && write.includes(cls), cls + " is shared with the write page");
  assert.ok(body.includes('id="hostSide"') && body.includes('id="hostOpen"'), "drawer and the tab that reopens it");
  assert.ok(body.includes("mountSideDrawer"), "wired by the shared component");
  // the settings moved INTO it, and the prompt moved into the main column so
  // the side runs beside it
  const drawer = body.slice(body.indexOf('id="hostSide"'), body.indexOf('id="hostOpen"'));
  assert.ok(drawer.includes('id="hostRules"') && drawer.includes('id="coverInput2"'), "rules and cover live in the drawer");
  const main = body.slice(body.indexOf('class="game-main"'), body.indexOf("</aside>"));
  assert.ok(main.includes('id="gamePrompt"'), "the prompt banner is inside the main column");
  // and the drawer is a real column that can close
  const css = (await page("/css/base.css")).body;
  assert.match(css, /\.game-cols \{[^}]*var\(--doc-side-w/, "the drawer's width is the rail's own variable");
  assert.match(css, /\.game-cols\.side-closed \{/, "closing it gives the width back");
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
  const src = readFileSync(new URL("../public/game.html", import.meta.url), "utf-8");
  assert.match(src, /const setPageTitle = \(\) => \{\s*document\.title = "\{\{SITE_NAME\}\}: " \+ \(sessName \|\| PAGE_TITLES\[shownCard\] \|\| "Game"\)/, "the name leads, the phase is the fallback");
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
  const twoCol = [...css.matchAll(/\.dash-wrap \{[^}]*grid-template-columns: minmax\(0, 1fr\) \d+px/g)];
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

test("every page loads the Font Awesome kit", async () => {
  for (const p of ["/", "/dashboard", "/game", "/archive", "/inbox", "/profile", "/settings", "/write", "/writes", "/stories", "/games", "/ranks", "/announcements", "/admin", "/reset"]) {
    const html = (await page(p)).body;
    assert.ok(html.includes('<script src="https://kit.fontawesome.com/60a456108b.js" crossorigin="anonymous"></script>'), p + " carries the kit");
  }
});

test("the caret is visible inside a gradient-text heading in every editor", async () => {
  const css = (await page("/css/base.css")).body;
  assert.match(css, /\.editor h1, \.doc-editor h1, \[contenteditable="true"\] h1,[\s\S]*?caret-color: var\(--accent-2\);/, "h1 in the game and solo editors names its caret");
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
