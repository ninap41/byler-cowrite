import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installDom } from "./dom.mjs";

// The page's own body markup, so the test drives the real ids.
const PAGE = readFileSync(new URL("../public/ao3-preview.html", import.meta.url), "utf-8");
const bodyOf = (html) => html.slice(html.indexOf("<body>") + 6, html.indexOf("<script type=\"module\">"));

let mountPreview, lintRowHtml, issuesLabel, frameHtml, KEY_CSS, KEY_EXPANDED, KEY_THEME, DOWNLOAD_NAME;
before(async () => {
  const dom = installDom();
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  // CodeMirror under jsdom: it measures on a frame and asks for these
  for (const k of ["Window", "MutationObserver", "getComputedStyle", "HTMLElement", "Range", "Selection", "Text", "Element", "DocumentFragment"]) {
    try { if (!globalThis[k]) globalThis[k] = dom.window[k]; } catch (e) {}
  }
  if (!globalThis.ResizeObserver) globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  // no layout in jsdom: measuring selections/coords returns nothing rather than throwing
  for (const proto of [window.Range.prototype, window.Element.prototype]) {
    if (!proto.getClientRects) proto.getClientRects = () => [];
    if (!proto.getBoundingClientRect) proto.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
  }
  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
  }
  // the page imports the drawer by absolute path; node needs a resolvable one
  const asData = (code) => "data:text/javascript;base64," + Buffer.from(code).toString("base64");
  const abs = (rel) => new URL(rel, import.meta.url).href;
  const editorSrc = readFileSync(new URL("../public/ao3/editor.js", import.meta.url), "utf-8").replace('"/vendor/codemirror.js"', JSON.stringify(abs("../public/vendor/codemirror.js")));
  const src = readFileSync(new URL("../public/ao3/preview.js", import.meta.url), "utf-8")
    .replace('"/js/components/side-drawer.js"', JSON.stringify(abs("../public/js/components/side-drawer.js")))
    .replace('"./ao3-rules.js"', JSON.stringify(abs("../public/ao3/ao3-rules.js")))
    .replace('"./editor.js"', JSON.stringify(asData(editorSrc)));
  ({ mountPreview, lintRowHtml, issuesLabel, frameHtml, KEY_CSS, KEY_EXPANDED, KEY_THEME, DOWNLOAD_NAME } = await import(asData(src)));
});

function fresh() {
  document.body.innerHTML = bodyOf(PAGE);
  localStorage.clear();
  return mountPreview(document, { storage: localStorage, loadCss: async () => "#workskin p { color: red }", loadHtml: async () => "<p>hi</p>", loadSite: async () => "body { margin: 0 }" });
}
const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));
// typing into the editor: the adapter's setter dispatches a real CodeMirror change
const type = (m, text) => { m.editor.value = text; };

test("mounting writes the AO3 page into the frame with the site css and the skin, and marks it AO3-clean", async () => {
  const m = fresh();
  await m.ready;
  const fd = m.frameDoc();
  assert.equal(fd.body.innerHTML, "<p>hi</p>", "the work is the frame's body");
  assert.equal(fd.getElementById("apSite").textContent, "body { margin: 0 }", "AO3's site css is the frame's base");
  assert.match(fd.getElementById("apSkin").textContent, /color: red/, "the skin paints inside the frame");
  assert.equal(m.editor.value, "#workskin p { color: red }");
  assert.ok(document.querySelector("#apCode .cm-editor"), "CodeMirror is mounted in the host");
  assert.ok(document.querySelector("#apCode .cm-gutters"), "with gutters");
  assert.match(document.getElementById("apSkin").textContent, /color: red/);
  assert.equal(document.getElementById("apIssues").textContent, "AO3-clean");
  assert.equal(document.getElementById("apLint").innerHTML, "");
});

test("the strict toggle renders the cleaned sheet, raw otherwise; the lint lists what AO3 drops", async () => {
  const m = fresh();
  await m.ready;
  type(m, "#workskin p { color: red; gap: 4px }");
  m.apply();
  const skin = document.getElementById("apSkin");
  assert.ok(!skin.textContent.includes("gap"), "strict: gap stripped");
  assert.equal(m.frameDoc().getElementById("apSkin").textContent, skin.textContent, "the frame's copy follows");
  assert.equal(localStorage.getItem(KEY_CSS), null, "typing alone saves nothing");
  assert.equal(m.problems.length, 1, "the lint's problems are what the editor's diagnostics are built from");
  const rows = document.querySelectorAll("#apLint .ap-lint-row");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dataset.line, "1");
  assert.match(rows[0].textContent, /gap/);
  assert.equal(document.getElementById("apIssues").textContent, "1 dropped");
  const strict = document.getElementById("apStrict");
  strict.checked = false;
  fire(strict, "change");
  assert.ok(skin.textContent.includes("gap"), "raw: everything rendered");
});

test("minimise closes the drawer to its tab, expand toggles the wide class, both persist", async () => {
  const m = fresh();
  await m.ready;
  const root = document.getElementById("apRoot");
  const tab = document.getElementById("apTab");
  assert.ok(!root.classList.contains("side-closed"), "opens by default");
  document.getElementById("apMin").click();
  assert.ok(root.classList.contains("side-closed"));
  assert.ok(!tab.classList.contains("hidden"), "the tab is the way back");
  tab.click();
  assert.ok(!root.classList.contains("side-closed"));
  document.getElementById("apExpand").click();
  assert.ok(root.classList.contains("side-expanded"));
  assert.equal(m.expanded, true);
  assert.equal(localStorage.getItem(KEY_EXPANDED), "1");
  document.getElementById("apExpand").click();
  assert.ok(!root.classList.contains("side-expanded"));
  assert.equal(localStorage.getItem(KEY_EXPANDED), null);
});

test("Save keeps the CSS in localStorage and it comes back on the next mount; Reset restores the default and forgets it", async () => {
  const m = fresh();
  await m.ready;
  const saveBtn = document.getElementById("apSave");
  assert.equal(saveBtn.disabled, true, "nothing to save yet");
  assert.equal(saveBtn.textContent, "Saved");
  type(m, "#workskin p { color: blue }");
  assert.equal(saveBtn.disabled, false, "an edit lights Save");
  assert.equal(saveBtn.textContent, "Save CSS");
  saveBtn.click();
  assert.equal(localStorage.getItem(KEY_CSS), "#workskin p { color: blue }");
  assert.equal(saveBtn.disabled, true);
  // a fresh mount with the same storage finds the saved CSS, not the default
  document.body.innerHTML = bodyOf(PAGE);
  const m2 = mountPreview(document, { storage: localStorage, loadCss: async () => "#workskin p { color: red }", loadHtml: async () => "<p>hi</p>", loadSite: async () => "" });
  await m2.ready;
  assert.equal(m.editor.value, "#workskin p { color: blue }");
  assert.equal(document.getElementById("apSave").disabled, true, "matches the store");
  document.getElementById("apResetCss").click();
  assert.equal(m2.editor.value, "#workskin p { color: red }");
  assert.ok(document.querySelector("#apCode .cm-editor"), "CodeMirror is mounted in the host");
  assert.ok(document.querySelector("#apCode .cm-gutters"), "with gutters");
  assert.equal(localStorage.getItem(KEY_CSS), null);
  assert.equal(document.getElementById("apSave").disabled, true, "the default counts as saved");
  assert.equal(document.getElementById("apResetHtml"), null, "no Reset HTML");
});

test("Cmd/Ctrl+S in the editor saves", async () => {
  const m = fresh();
  await m.ready;
  type(m, "#workskin p { color: green }");
  m.editor.view.contentDOM.dispatchEvent(new window.KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true, cancelable: true }));
  assert.equal(localStorage.getItem(KEY_CSS), "#workskin p { color: green }");
});

test("frameHtml puts links in a new tab and carries both style blocks", () => {
  const h = frameHtml({ siteCss: "a{}", skinCss: "b{}", body: "<p>x</p>" });
  assert.match(h, /<base target="_blank">/);
  assert.match(h, /<style id="apSite">a\{\}<\/style><style id="apSkin">b\{\}<\/style>/);
  assert.match(h, /<body class="logged-in javascript"><p>x<\/p><\/body>/);
});

test("dark is the default theme; the toggle flips and remembers it", async () => {
  const m = fresh();
  await m.ready;
  assert.equal(document.documentElement.getAttribute("data-theme"), "dark");
  assert.equal(m.theme(), "dark");
  const btn = document.getElementById("apTheme");
  assert.equal(btn.textContent, "☾");
  btn.click();
  assert.equal(document.documentElement.getAttribute("data-theme"), "light");
  assert.equal(localStorage.getItem(KEY_THEME), "light");
  assert.equal(btn.textContent, "☀");
  document.body.innerHTML = bodyOf(PAGE);
  const m2 = mountPreview(document, { storage: localStorage, loadCss: async () => "", loadHtml: async () => "", loadSite: async () => "" });
  await m2.ready;
  assert.equal(m2.theme(), "light", "the choice survives a mount");
});

test("the editor is CodeMirror with CSS tokens, follows the theme, and a lint row selects its line", async () => {
  const m = fresh();
  await m.ready;
  const view = m.editor.view;
  assert.ok(view.dom.classList.contains("cm-editor"));
  assert.ok(view.dom.querySelector(".cm-content"), "content dom");
  // the language mode is CSS: a property name gets a token class
  type(m, "#workskin p { color: red }\n#workskin q { gap: 1px }");
  m.apply();
  assert.equal(view.state.doc.lines, 2);
  assert.ok(view.dom.querySelector(".cm-lintRange-error"), "the AO3 lint's finding is a CodeMirror error diagnostic on the line");
  document.querySelector("#apLint .ap-lint-row").click();
  assert.equal(view.state.doc.lineAt(view.state.selection.main.head).number, 2, "the lint row put the selection on its line");
  const before = view.dom.className;
  document.getElementById("apTheme").click();
  assert.notEqual(view.dom.className, before, "the theme reconfigure changed the editor's theme classes");
});

test("download hands the textarea's CSS to the browser as work-skin.css", async () => {
  const m = fresh();
  await m.ready;
  const seen = [];
  const origCreate = URL.createObjectURL, origRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (b) => (seen.push(b), "blob:x");
  URL.revokeObjectURL = () => {};
  const clicked = [];
  const orig = window.HTMLAnchorElement.prototype.click;
  window.HTMLAnchorElement.prototype.click = function () { clicked.push({ download: this.download, href: this.getAttribute("href") }); };
  document.getElementById("apDownload").click();
  window.HTMLAnchorElement.prototype.click = orig;
  URL.createObjectURL = origCreate; URL.revokeObjectURL = origRevoke;
  assert.equal(seen.length, 1);
  assert.equal(seen[0].type, "text/css");
  assert.equal(await seen[0].text(), "#workskin p { color: red }");
  assert.deepEqual(clicked, [{ download: DOWNLOAD_NAME, href: "blob:x" }]);
});

test("builders escape what they print", () => {
  assert.match(lintRowHtml({ line: 3, severity: "error", prop: "<b>", value: "x", message: "<i>" }), /&lt;b&gt;.*&lt;i&gt;/s);
  assert.deepEqual(issuesLabel([]), { text: "AO3-clean", cls: "" });
  assert.deepEqual(issuesLabel([{ severity: "error" }, { severity: "warning" }]), { text: "1 dropped · 1 warning", cls: "has-err" });
  assert.deepEqual(issuesLabel([{ severity: "warning" }, { severity: "warning" }]), { text: "2 warnings", cls: "has-warn" });
});
