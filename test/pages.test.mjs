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
  assert.match(css.body, /@media \(max-width: 860px\) \{\s*\.doc-side-card \{[^}]*position: static/, "one column: not pinned");

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
