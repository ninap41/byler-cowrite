import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installDom } from "./dom.mjs";

// The page's own body markup, so the test drives the real ids.
const PAGE = readFileSync(new URL("../public/ao3-preview.html", import.meta.url), "utf-8");
const bodyOf = (html) => html.slice(html.indexOf("<body>") + 6, html.indexOf("<script type=\"module\">"));

let mountPreview, lintRowHtml, issuesLabel, frameHtml, KEY_CSS, KEY_EXPANDED, KEY_THEME, DOWNLOAD_NAME;
before(async () => {
  installDom();
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  // the page imports the drawer by absolute path; node needs a resolvable one
  const src = readFileSync(new URL("../public/ao3/preview.js", import.meta.url), "utf-8")
    .replace('"/js/components/side-drawer.js"', '"../js/components/side-drawer.js"');
  const url = "data:text/javascript;base64," + Buffer.from(src.replace(/from "\.\.\/js/g, 'from "' + new URL("../public/js", import.meta.url).href).replace(/from "\.\/ao3-rules\.js"/, 'from "' + new URL("../public/ao3/ao3-rules.js", import.meta.url).href + '"').replace(/from "\.\/css-highlight\.js"/, 'from "' + new URL("../public/ao3/css-highlight.js", import.meta.url).href + '"')).toString("base64");
  ({ mountPreview, lintRowHtml, issuesLabel, frameHtml, KEY_CSS, KEY_EXPANDED, KEY_THEME, DOWNLOAD_NAME } = await import(url));
});

function fresh() {
  document.body.innerHTML = bodyOf(PAGE);
  localStorage.clear();
  return mountPreview(document, { storage: localStorage, loadCss: async () => "#workskin p { color: red }", loadHtml: async () => "<p>hi</p>", loadSite: async () => "body { margin: 0 }" });
}
const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));

test("mounting writes the AO3 page into the frame with the site css and the skin, and marks it AO3-clean", async () => {
  const m = fresh();
  await m.ready;
  const fd = m.frameDoc();
  assert.equal(fd.body.innerHTML, "<p>hi</p>", "the work is the frame's body");
  assert.equal(fd.getElementById("apSite").textContent, "body { margin: 0 }", "AO3's site css is the frame's base");
  assert.match(fd.getElementById("apSkin").textContent, /color: red/, "the skin paints inside the frame");
  assert.equal(document.getElementById("apCss").value, "#workskin p { color: red }");
  assert.match(document.getElementById("apSkin").textContent, /color: red/);
  assert.equal(document.getElementById("apIssues").textContent, "AO3-clean");
  assert.equal(document.getElementById("apLint").innerHTML, "");
});

test("the strict toggle renders the cleaned sheet, raw otherwise; the lint lists what AO3 drops", async () => {
  const m = fresh();
  await m.ready;
  const css = document.getElementById("apCss");
  css.value = "#workskin p { color: red; gap: 4px }";
  fire(css, "input");
  m.apply();
  const skin = document.getElementById("apSkin");
  assert.ok(!skin.textContent.includes("gap"), "strict: gap stripped");
  assert.equal(m.frameDoc().getElementById("apSkin").textContent, skin.textContent, "the frame's copy follows");
  assert.equal(localStorage.getItem(KEY_CSS), null, "typing alone saves nothing");
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
  const css = document.getElementById("apCss");
  const saveBtn = document.getElementById("apSave");
  assert.equal(saveBtn.disabled, true, "nothing to save yet");
  assert.equal(saveBtn.textContent, "Saved");
  css.value = "#workskin p { color: blue }";
  fire(css, "input");
  assert.equal(saveBtn.disabled, false, "an edit lights Save");
  assert.equal(saveBtn.textContent, "Save CSS");
  saveBtn.click();
  assert.equal(localStorage.getItem(KEY_CSS), "#workskin p { color: blue }");
  assert.equal(saveBtn.disabled, true);
  // a fresh mount with the same storage finds the saved CSS, not the default
  document.body.innerHTML = bodyOf(PAGE);
  const m2 = mountPreview(document, { storage: localStorage, loadCss: async () => "#workskin p { color: red }", loadHtml: async () => "<p>hi</p>", loadSite: async () => "" });
  await m2.ready;
  assert.equal(document.getElementById("apCss").value, "#workskin p { color: blue }");
  assert.equal(document.getElementById("apSave").disabled, true, "matches the store");
  document.getElementById("apResetCss").click();
  assert.equal(document.getElementById("apCss").value, "#workskin p { color: red }");
  assert.equal(localStorage.getItem(KEY_CSS), null);
  assert.equal(document.getElementById("apSave").disabled, true, "the default counts as saved");
  assert.equal(document.getElementById("apResetHtml"), null, "no Reset HTML");
});

test("Cmd/Ctrl+S in the editor saves", async () => {
  const m = fresh();
  await m.ready;
  const css = document.getElementById("apCss");
  css.value = "#workskin p { color: green }";
  fire(css, "input");
  css.dispatchEvent(new window.KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true, cancelable: true }));
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

test("the highlight layer mirrors the textarea and tints lint lines", async () => {
  const m = fresh();
  await m.ready;
  const code = document.querySelector("#apHl code");
  assert.ok(code.innerHTML.includes('<span class="hl-sel-id">#workskin</span>'), "the default skin is highlighted on load");
  const css = document.getElementById("apCss");
  css.value = "#workskin p { color: red }\n#workskin q { gap: 1px }";
  fire(css, "input");
  assert.ok(code.innerHTML.includes('<span class="hl-sel">q</span>'), "typing repaints at once");
  assert.ok(!code.innerHTML.includes("hl-bad"), "no tint until the lint runs");
  m.apply();
  assert.match(code.innerHTML, /<span class="hl-line hl-bad"><span class="hl-sel-id">#workskin<\/span> <span class="hl-sel">q/, "the lint's line is tinted");
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
