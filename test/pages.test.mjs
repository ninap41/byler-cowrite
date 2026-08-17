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
  const bank = JSON.parse(readFileSync(new URL("../quotes.json", import.meta.url), "utf-8"));
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

test("the thesaurus is no longer a toolbar button — it moved into the reference palette", async () => {
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

test("the write page's right-hand icons are borderless too — the mode switch is not", async () => {
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

test("a heading's size is the heading's — spans inside can't shrink it", async () => {
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
  assert.ok(body.includes("if (canEditDoc()) {"), "by the author only — a reader's html must stay byte-identical");
});

test("the composer's motion is GSAP, with a reduced-motion path", async () => {
  const { body } = await page("/write");
  assert.ok(body.includes("prefers-reduced-motion"), "motion is optional");

  assert.ok(!body.includes('id="commentHelp"'), "the how-to-start line is a tooltip, not a standing line of the rail");
  assert.ok(body.includes('$("newComment").classList.toggle("hidden", on)'), "checking Suggest swaps the note out for the rewrite — a straight swap, no wobble");
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
  assert.ok(body.includes("DOC_FONTS.map"), "built from the shared list, not hand-written options");
  assert.ok(body.includes('setProperty("--doc-font"'), "applied as a css variable on the surfaces");
  const css = await page("/css/base.css");
  assert.match(css.body, /\.doc-editor,\n\.doc-source \{\s*font-family: var\(--doc-font, var\(--font-story\)\)/);
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
  assert.ok(inbox.body.includes("mountInbox"), "same rows and actions as the dashboard preview");

  const dash = await page("/dashboard");
  assert.ok(dash.body.includes('href="/inbox"'), "the dashboard links to it");
  assert.ok(dash.body.includes("limit: 5"), "and only previews the newest few");

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

test("prose stays selectable on a phone — highlighting it is how you comment", async () => {
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

test("the all-stories shelf can be read as a list or as 3/4/6 across", async () => {
  const { body } = await page("/stories");
  assert.ok(body.includes('id="stViewWrap"'), "the picker has a home in the tools row");
  assert.ok(body.includes("cowriteStoriesView"), "the choice is a habit, so it's remembered");
  assert.ok(body.includes("viewToggleHtml") && body.includes("cleanStoryView"), "wired to the shared builders");

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
