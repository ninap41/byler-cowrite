import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installDom } from "./dom.mjs";

// The page's own body markup, so the test drives the real ids.
const PAGE = readFileSync(new URL("../public/ao3-preview.html", import.meta.url), "utf-8");
const bodyOf = (html) => html.slice(html.indexOf("<body>") + 6, html.indexOf("<script type=\"module\">"));

let pathOf, picker, mountPreview, lintRowHtml, issuesLabel, frameHtml, crumbsHtml, unmatchedRules, NO_MATCH, NO_MATCH_SITE, KEY_KIND, DEFAULT_KIND, DOWNLOAD_NAMES, PAGES, KEY_PAGE, DEFAULT_PAGE, pageFile, KEY_TAB, KEY_LINT_H, LINT_MIN, LINT_DEFAULT, KEY_CSS, KEY_EXPANDED, KEY_THEME, DOWNLOAD_NAME, selectorFor, STYLE_ID, OUTSIDE_CLASS, OUTSIDE_NOTE;
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
  const pickerSrc = readFileSync(new URL("../public/ao3/color-picker.js", import.meta.url), "utf-8").replace('"/vendor/codemirror.js?v=4"', JSON.stringify(abs("../public/vendor/codemirror.js"))).replace('"./css-values.js"', JSON.stringify(abs("../public/ao3/css-values.js")));
  const pickerUrl = asData(pickerSrc);
  const editorSrc = readFileSync(new URL("../public/ao3/editor.js", import.meta.url), "utf-8").replace('"/vendor/codemirror.js?v=4"', JSON.stringify(abs("../public/vendor/codemirror.js"))).replace('"./ao3-rules.js"', JSON.stringify(abs("../public/ao3/ao3-rules.js"))).replace('"./css-values.js"', JSON.stringify(abs("../public/ao3/css-values.js"))).replace('"./color-picker.js"', JSON.stringify(pickerUrl));
  const src = readFileSync(new URL("../public/ao3/preview.js", import.meta.url), "utf-8")
    .replace('"./side-drawer.js"', JSON.stringify(abs("../public/ao3/side-drawer.js")))
    .replace('"./ao3-rules.js"', JSON.stringify(abs("../public/ao3/ao3-rules.js")))
    .replace('"./editor.js"', JSON.stringify(asData(editorSrc)))
    .replace('"./inspect.js"', JSON.stringify(abs("../public/ao3/inspect.js")))
    .replace('"./work-content.js"', JSON.stringify(abs("../public/ao3/work-content.js")))
    .replace('"./html-rules.js"', JSON.stringify(abs("../public/ao3/html-rules.js")));
  ({ mountPreview, lintRowHtml, issuesLabel, frameHtml, crumbsHtml, unmatchedRules, NO_MATCH, NO_MATCH_SITE, KEY_KIND, DEFAULT_KIND, DOWNLOAD_NAMES, PAGES, KEY_PAGE, DEFAULT_PAGE, pageFile, KEY_TAB, KEY_LINT_H, LINT_MIN, LINT_DEFAULT, KEY_CSS, KEY_EXPANDED, KEY_THEME, DOWNLOAD_NAME } = await import(asData(src)));
  ({ selectorFor, pathOf, STYLE_ID, OUTSIDE_CLASS, OUTSIDE_NOTE } = await import(abs("../public/ao3/inspect.js")));
  picker = await import(pickerUrl);
});

function fresh(html = '<div id="workskin"><p>hi</p></div>') {
  document.body.innerHTML = bodyOf(PAGE);
  localStorage.clear();
  return mountPreview(document, { storage: localStorage, loadCss: async () => "#workskin p { color: red }", loadHtml: async () => html, loadSite: async () => "body { margin: 0 }" });
}
// typing into the editor: the adapter's setter dispatches a real CodeMirror change
const type = (m, text) => { m.editor.value = text; };

test("mounting writes the AO3 page into the frame with the site css and the skin, and marks it AO3-clean", async () => {
  const m = fresh();
  await m.ready;
  const fd = m.frameDoc();
  assert.equal(fd.body.innerHTML, '<div id="workskin"><p>hi</p></div>', "the work is the frame's body");
  assert.equal(fd.getElementById("apSite").textContent, "body { margin: 0 }", "AO3's site css is the frame's base");
  assert.match(fd.getElementById("apSkin").textContent, /color: red/, "the skin paints inside the frame");
  assert.equal(m.editor.value, "#workskin p { color: red }");
  assert.ok(document.querySelector("#apCode .cm-editor"), "CodeMirror is mounted in the host");
  assert.ok(document.querySelector("#apCode .cm-gutters"), "with gutters");
  assert.match(document.getElementById("apSkin").textContent, /color: red/);
  assert.equal(document.getElementById("apSkin").getAttribute("type"), "text/plain", "the parent's copy is inert — the skin only ever paints the AO3 page in the frame");
  assert.equal(document.getElementById("apSkin").sheet, null, "no stylesheet on the parent page");
  assert.equal(document.getElementById("apIssues").textContent, "AO3-clean");
  assert.equal(document.getElementById("apLint").innerHTML, "");
});

test("the preview renders the cleaned sheet, as AO3 would; the lint lists what AO3 drops", async () => {
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
  assert.equal(document.getElementById("apStrict"), null, "no raw/strict toggle — the preview is always AO3's rendering");
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

test("the frame is a picture, not a site: links, buttons and forms are inert, hrefs kept, and relative links resolve against AO3 rather than this app", async () => {
  const m = fresh('<div id="workskin"><p>hi</p></div><a id="home" href="/">home</a><a id="w" href="/works">works</a><form id="f" action="/works/search"><input type="submit" id="go" value="Go"></form><button id="b">b</button>');
  await m.ready;
  const fd = m.frameDoc();
  assert.equal(fd.querySelector("base").getAttribute("href"), "https://archiveofourown.org/");
  assert.equal(fd.getElementById("home").href, "https://archiveofourown.org/", "a scraped root-relative link points at AO3, never at /");
  assert.equal(fd.getElementById("w").getAttribute("href"), "/works", "the href attribute is untouched, so a:link styles hold");
  const ME = fd.defaultView.MouseEvent;
  for (const id of ["home", "w", "go", "b"]) {
    const ev = new ME("click", { bubbles: true, cancelable: true });
    fd.getElementById(id).dispatchEvent(ev);
    assert.ok(ev.defaultPrevented, id + " goes nowhere");
  }
  const sub = new fd.defaultView.Event("submit", { bubbles: true, cancelable: true });
  fd.getElementById("f").dispatchEvent(sub);
  assert.ok(sub.defaultPrevented, "forms never submit");
  const p = new ME("click", { bubbles: true, cancelable: true });
  fd.querySelector("p").dispatchEvent(p);
  assert.ok(!p.defaultPrevented, "plain text clicks are left alone");
});

test("frameHtml puts links in a new tab and carries both style blocks", () => {
  const h = frameHtml({ siteCss: "a{}", skinCss: "b{}", body: "<p>x</p>" });
  assert.match(h, /<base href="https:\/\/archiveofourown\.org\/" target="_blank">/);
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
  const content = document.querySelector(".cm-content");
  assert.equal(content.getAttribute("data-gramm"), "false", "Grammarly is told to stay out of the CSS");
  assert.equal(content.getAttribute("spellcheck"), "false");
  assert.equal(content.getAttribute("autocorrect"), "off");
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
  m.setKind("work");
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

test("selectorFor names the element alone and prefixes #workskin inside the work", () => {
  document.body.innerHTML = '<div id="workskin"><p class="x y ap-insp-hover">a</p><span id="me">b</span><em>c</em></div><p class="out">d</p>';
  const $ = (q) => document.querySelector(q);
  assert.equal(selectorFor($("#workskin")), "#workskin");
  assert.equal(selectorFor($("p.x")), "#workskin p.x.y", "the inspector's own class is filtered out");
  assert.equal(selectorFor($("#me")), "#workskin #me");
  assert.equal(selectorFor($("em")), "#workskin em");
  assert.equal(selectorFor($("p.out")), "#workskin p.out", "outside the work too: AO3 prefixes every selector with #workskin on save");
  document.body.innerHTML += '<div id="header" class="a b">h</div><nav>n</nav>';
  assert.equal(selectorFor($("#header")), "#workskin #header");
  assert.equal(selectorFor($("nav")), "#workskin nav");
  assert.equal(selectorFor(null), "");
});

test("the inspector: toggle on, hover outlines + labels, a click appends the selector as an empty rule, a repeat pick finds the existing rule, Escape ends it", async () => {
  const m = fresh('<div id="workskin"><p class="x">hi</p></div><a href="https://example.org" class="out">out</a>');
  await m.ready;
  m.setKind("work");
  const btn = document.getElementById("apInspect");
  assert.equal(btn.getAttribute("aria-pressed"), "false");
  assert.equal(m.inspecting, false);
  btn.click();
  assert.equal(m.inspecting, true);
  assert.equal(btn.getAttribute("aria-pressed"), "true");
  assert.ok(btn.classList.contains("on"));
  const fd = m.frameDoc();
  assert.ok(fd.getElementById(STYLE_ID), "the hover styles are injected into the frame");
  assert.ok(fd.documentElement.classList.contains("ap-inspecting"), "the crosshair class is on the frame's html");
  assert.equal(fd.querySelector(".ap-insp-label").hidden, true, "the in-frame label waits for a hover");
  const p = fd.querySelector("p.x");
  const MouseEvent = fd.defaultView.MouseEvent;
  p.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 10, clientY: 10 }));
  assert.ok(p.classList.contains("ap-insp-hover"), "hovered element outlined");
  const label = fd.querySelector(".ap-insp-label");
  assert.equal(label.textContent, "#workskin p.x");
  assert.equal(label.hidden, false);
  // pick it
  const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
  p.dispatchEvent(ev);
  assert.ok(ev.defaultPrevented, "a click in inspect mode never follows a link");
  assert.equal(m.editor.value, "#workskin p { color: red }\n\n#workskin p.x {\n\t\n}\n");
  const view = m.editor.view;
  assert.equal(view.state.doc.lineAt(view.state.selection.main.head).number, 4, "the caret sits inside the braces");
  assert.equal(document.getElementById("apSave").disabled, false, "the append is an edit");
  assert.equal(m.inspecting, true, "the mode stays on after a pick");
  // the pick opens the property dropdown in the new rule — AO3's whitelist
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(m.editor.completionStatus(), "active", "the property dropdown is open in the picked rule");
  const offered = m.editor.completions().map((c) => c.label);
  assert.ok(offered.includes("color") && offered.includes("margin"));
  assert.ok(!offered.includes("gap"), "what AO3 drops is never offered");
  // picking the same element again goes to the existing rule instead of adding another
  p.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.equal((m.editor.value.match(/#workskin p\.x \{/g) || []).length, 1, "no duplicate rule");
  assert.equal(view.state.doc.lineAt(view.state.selection.main.head).number, 4, "the caret goes inside the existing rule");
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(m.editor.completionStatus(), "active", "and the dropdown opens there too");
  // an element outside the work gets no prefix; a link click is still swallowed
  const a = fd.querySelector("a.out");
  const aev = new MouseEvent("click", { bubbles: true, cancelable: true });
  a.dispatchEvent(aev);
  assert.ok(aev.defaultPrevented);
  assert.match(m.editor.value, /\n#workskin a\.out \{\n/);
  m.apply();
  assert.ok(!m.problems.some((p) => p.code === "workskin_prefix"), "no #workskin warning for a pick outside the work");
  // Escape in the frame ends the mode and cleans up
  fd.dispatchEvent(new fd.defaultView.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(m.inspecting, false);
  assert.equal(btn.getAttribute("aria-pressed"), "false");
  assert.equal(fd.getElementById(STYLE_ID), null, "styles removed");
  assert.equal(fd.querySelector(".ap-insp-label"), null, "label removed");
  assert.ok(!p.classList.contains("ap-insp-hover"));
  assert.ok(!fd.documentElement.classList.contains("ap-inspecting"));
});

test("language data: the CSS language's autocomplete facet carries AO3's whitelist and nothing else", async () => {
  const m = fresh();
  await m.ready;
  type(m, "#workskin p {\n\tcol\n}");
  const view = m.editor.view;
  const pos = view.state.doc.line(2).to;
  const sources = m.editor.languageDataAt("autocomplete", pos);
  assert.equal(sources.length, 1, "exactly one completion source on the facet — AO3's, not CodeMirror's full CSS list");
  const R = await import(new URL("../public/ao3/ao3-rules.js", import.meta.url).href);
  const ctx = { state: view.state, pos, explicit: false, matchBefore: (re) => { const line = view.state.doc.lineAt(pos); const mm = line.text.slice(0, pos - line.from).match(new RegExp(re.source + "$")); return mm ? { from: pos - mm[0].length, to: pos, text: mm[0] } : null; } };
  const res = sources[0](ctx);
  assert.ok(res, "a partial property name in property position completes");
  const labels = res.options.map((o) => o.label);
  assert.ok(labels.includes("color") && labels.includes("margin"), "whitelisted properties and shorthands are offered");
  assert.ok(!labels.includes("gap") && !labels.includes("pointer-events"), "what AO3 drops is never suggested");
  for (const l of labels) assert.ok(R.PROPERTIES.includes(l) || R.SHORTHANDS.includes(l), l);
  assert.equal(typeof res.options.find((o) => o.label === "color").apply, "function", "a property applies as `name: ` and opens its values (pinned below)");
  // value position and outside a block: nothing
  type(m, "#workskin p {\n\tcolor: re\n}");
  const vals = sources[0]({ ...ctx, state: view.state, pos: view.state.doc.line(2).to, matchBefore: () => ({ from: view.state.doc.line(2).to - 2, to: view.state.doc.line(2).to, text: "re" }) });
  assert.ok(vals && vals.options.some((o) => o.label === "red") && !vals.options.some((o) => o.label === "color"), "after the colon come the property's values, not property names");
  type(m, "#works");
  assert.equal(sources[0]({ ...ctx, state: view.state, pos: 6, matchBefore: () => ({ from: 1, to: 6, text: "works" }) }), null, "a selector is not a property");
  // the keymap and the autocompletion extension are live: Ctrl-Space opens the list
  type(m, "#workskin p {\n\tcol\n}");
  view.dispatch({ selection: { anchor: view.state.doc.line(2).to } });
  m.editor.startCompletion();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(m.editor.completionStatus(), "active");
  assert.ok(m.editor.completions().some((c) => c.label === "color"));
});

test("value completions: after the colon the dropdown lists that property's values, AO3-safe, and a chosen property or function flows on", async () => {
  const m = fresh();
  await m.ready;
  const view = m.editor.view;
  const src = () => m.editor.languageDataAt("autocomplete", view.state.selection.main.head)[0];
  const ctxAt = (pos, explicit = false) => ({ state: view.state, pos, explicit, matchBefore: (re) => { const line = view.state.doc.lineAt(pos); const mm = line.text.slice(0, pos - line.from).match(new RegExp(re.source + "$")); return mm ? { from: pos - mm[0].length, to: pos, text: mm[0] } : null; } });
  const labelsAt = (text, explicit = false) => { type(m, text); const pos = view.state.doc.line(2).to; view.dispatch({ selection: { anchor: pos } }); const r = src()(ctxAt(pos, explicit)); return r ? r.options.map((o) => o.label) : null; };
  let l = labelsAt("#workskin p {\n\tdisplay: \n}");
  assert.ok(l && l.includes("block") && l.includes("none") && l.includes("inherit") && l.includes("!important"), "an empty value right after the colon lists the property's values");
  assert.ok(!l.includes("bold") && !l.includes("rgb("), "not another property's values");
  l = labelsAt("#workskin p {\n\tfont-weight: b\n}");
  assert.ok(l.includes("bold") && l.includes("bolder") && l.includes("700"));
  l = labelsAt("#workskin p {\n\tcolor: \n}");
  assert.ok(l.includes("rgb(") && l.includes("rebeccapurple") && l.includes("transparent") && !l.includes("block"));
  assert.ok(!l.some((x) => /^(calc|color-mix|conic-gradient)\(/.test(x)), "nothing AO3 refuses");
  l = labelsAt("#workskin p {\n\t-webkit-transform: \n}");
  assert.ok(l.includes("rotate(") && l.includes("none"), "a vendor prefix is looked through");
  assert.equal(labelsAt("#workskin p {\n\tcolor: red \n}"), null, "after a value and a space: nothing unsolicited");
  assert.ok(labelsAt("#workskin p {\n\tcolor: red \n}", true).includes("blue"), "…but on request");
  assert.equal(labelsAt('#workskin p {\n\tcontent: "a\n}'), null, "inside a string: nothing");
  assert.equal(labelsAt("#workskin p {\n\tcolor: rgb(\n}"), null, "inside a function's parens: nothing");
  // choosing a property writes `name: ` and opens the value list
  type(m, "#workskin p {\n\tdis\n}");
  let pos = view.state.doc.line(2).to;
  view.dispatch({ selection: { anchor: pos } });
  const propOpt = src()(ctxAt(pos)).options.find((o) => o.label === "display");
  propOpt.apply(view, propOpt, pos - 3, pos);
  assert.equal(view.state.doc.line(2).text, "\tdisplay: ");
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(m.editor.completionStatus(), "active", "the value dropdown opened by itself");
  assert.ok(m.editor.completions().some((c) => c.label === "block"));
  // choosing a function lands the caret between its parens
  type(m, "#workskin p {\n\ttransform: ro\n}");
  pos = view.state.doc.line(2).to;
  view.dispatch({ selection: { anchor: pos } });
  const fnOpt = src()(ctxAt(pos)).options.find((o) => o.label === "rotate(");
  fnOpt.apply(view, fnOpt, pos - 2, pos);
  assert.equal(view.state.doc.line(2).text, "\ttransform: rotate()");
  assert.equal(view.state.selection.main.head, view.state.doc.line(2).to - 1, "caret inside the parens");
});

test("a rule that reaches nothing inside #workskin is flagged in the lint; one that does is not", async () => {
  const m = fresh('<div id="header"><button>b</button></div><div id="workskin"><p class="x">hi</p></div>');
  await m.ready;
  m.setKind("work");
  type(m, "#workskin p { color: red }\n#workskin button { color: red }\nbutton { color: blue }\n#workskin .x, #workskin #header { color: red }");
  m.apply();
  const rows = Array.from(document.querySelectorAll(".ap-lint-row"));
  assert.deepEqual(rows.map((r) => r.dataset.line), ["2", "3"], "only the rules that match nothing: the button (as AO3 stores it, #workskin button) — a list with one live selector is fine; and the bare `button` rule gets ONE row, the no-match verdict, not the prefix note as well");
  assert.ok(rows.every((r) => r.classList.contains("warning") && r.textContent.includes("matches no element")));
  assert.equal(document.getElementById("apIssues").textContent, "2 warnings");
  assert.ok(m.problems.every((p) => p.code === "no_match"));
  // pure: judged as AO3 stores the selector; invalid selectors are the lint's business, not this check's
  assert.deepEqual(unmatchedRules([{ selector: "p", line: 1 }, { selector: "#header", line: 2 }, { selector: "p:::bad", line: 3 }], m.frameDoc()).map((p) => p.line), [2]);
  assert.equal(unmatchedRules([{ selector: "#header", line: 1 }], null).length, 0, "no page, no verdict");
  assert.equal(NO_MATCH.length > 20, true);
});

test("the inspector marks chrome outside the work: grey outline and a label that says so; a pick there still lands", async () => {
  const m = fresh('<div id="header"><button class="btn">b</button></div><div id="workskin"><p class="x">hi</p></div>');
  await m.ready;
  m.setKind("work");
  document.getElementById("apInspect").click();
  const fd = m.frameDoc();
  const MouseEvent = fd.defaultView.MouseEvent;
  const btn = fd.querySelector("button");
  btn.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 5, clientY: 5 }));
  assert.ok(btn.classList.contains(OUTSIDE_CLASS), "outside: the grey outline class");
  const label = fd.querySelector(".ap-insp-label");
  assert.equal(label.textContent, "#workskin button.btn \u00b7 " + OUTSIDE_NOTE);
  assert.ok(label.classList.contains(OUTSIDE_CLASS));
  const p = fd.querySelector("p.x");
  p.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 5, clientY: 5 }));
  assert.ok(!p.classList.contains(OUTSIDE_CLASS) && !btn.classList.contains(OUTSIDE_CLASS), "inside: plain hover, the outside mark cleared from the last element");
  assert.equal(label.textContent, "#workskin p.x");
  assert.ok(!label.classList.contains(OUTSIDE_CLASS));
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.match(m.editor.value, /#workskin button\.btn \{/, "the pick is still allowed");
  assert.equal(selectorFor(btn), "#workskin button.btn", "the inspector's own classes never leak into the selector");
});

test("skin kind: Site skin is the default, applies the sheet as written to the whole page, picks bare selectors, and is remembered; Work skin prefixes", async () => {
  const m = fresh('<div id="header"><button class="btn">b</button></div><div id="workskin"><p class="x">hi</p></div>');
  await m.ready;
  assert.equal(DEFAULT_KIND, "site");
  assert.equal(m.kind, "site");
  const sel = document.getElementById("apKind");
  assert.equal(sel.value, "site");
  type(m, "#header { color: red }\nbutton { color: blue }\n.nothing { color: green }\n#workskin p { color: red }");
  m.apply();
  const fd = m.frameDoc();
  assert.equal(fd.getElementById("apSkin").textContent, "#header {\n  color: red;\n}\n\nbutton {\n  color: blue;\n}\n\n.nothing {\n  color: green;\n}\n\n#workskin p {\n  color: red;\n}", "no #workskin prefix — the sheet reaches the whole page");
  assert.equal(fd.defaultView.getComputedStyle(fd.querySelector("button")).color, "rgb(0, 0, 255)", "the header button IS styled by a site skin");
  const rows = Array.from(document.querySelectorAll(".ap-lint-row"));
  assert.deepEqual(rows.map((r) => [r.dataset.line, r.textContent.includes(NO_MATCH_SITE)]), [["3", true]], "only the selector that reaches nothing on the page warns; no #workskin prefix notes at all");
  // the inspector: bare selectors, no outside note
  document.getElementById("apInspect").click();
  const btn = fd.querySelector("button");
  const MouseEvent = fd.defaultView.MouseEvent;
  btn.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 5, clientY: 5 }));
  assert.equal(fd.querySelector(".ap-insp-label").textContent, "button.btn");
  assert.ok(!btn.classList.contains(OUTSIDE_CLASS), "a site skin has no outside");
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.match(m.editor.value, /\nbutton\.btn \{\n/);
  assert.equal(selectorFor(fd.querySelector("p.x"), { kind: "site" }), "#workskin p.x", "inside the work a site-skin pick is still #workskin-prefixed");
  assert.equal(selectorFor(fd.getElementById("workskin"), { kind: "site" }), "#workskin");
  assert.equal(selectorFor(fd.getElementById("header"), { kind: "site" }), "#header", "chrome outside the work is bare");
  const px = fd.querySelector("p.x");
  px.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 5, clientY: 5 }));
  assert.equal(fd.querySelector(".ap-insp-label").textContent, "#workskin p.x");
  px.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.match(m.editor.value, /\n#workskin p\.x \{\n/);
  // download name follows the kind
  assert.deepEqual(DOWNLOAD_NAMES, { work: "work-skin.css", site: "site-skin.css" });
  // switch via the select: remembered, the sheet re-cleaned as a work skin
  sel.value = "work";
  sel.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(m.kind, "work");
  assert.equal(localStorage.getItem(KEY_KIND), "work");
  assert.match(fd.getElementById("apSkin").textContent, /^#workskin #header \{/);
  assert.equal(fd.defaultView.getComputedStyle(fd.querySelector("button")).color, "rgb(0, 0, 0)", "as a work skin the header button is out of reach");
  assert.equal(unmatchedRules([{ selector: "#header", line: 1 }], fd, "site").length, 0);
  assert.equal(unmatchedRules([{ selector: "#header", line: 1 }], fd, "work").length, 1);
  // the choice survives a reload
  document.body.innerHTML = bodyOf(PAGE);
  const m2 = mountPreview(document, { storage: localStorage, loadCss: async () => "p { color: red }", loadHtml: async () => "<p>hi</p>", loadSite: async () => "" });
  await m2.ready;
  assert.equal(m2.kind, "work");
  assert.equal(document.getElementById("apKind").value, "work");
});

test("colour picker: every colour value wears a swatch; the hover tooltip holds a colour input that rewrites the value in place", async () => {
  const m = fresh();
  await m.ready;
  m.setKind("work");
  type(m, "#workskin p {\n\tcolor: #ff0000;\n\tbackground: rgba(0, 128, 255, 0.5) url(https://x.y/a.png);\n\tborder-color: rebeccapurple;\n\tmargin: 1px;\n}");
  await new Promise((r) => setTimeout(r, 30));
  const swatches = document.querySelectorAll(".cm-content .ap-swatch");
  assert.equal(swatches.length, 3, "hex, rgba and a named colour; not `margin: 1px`, not `url`");
  assert.equal(swatches[0].style.backgroundColor, "rgb(255, 0, 0)");
  const view = m.editor.view;
  const line2 = view.state.doc.line(2);
  const at = line2.from + line2.text.indexOf("#ff");
  const hit = picker.colorAt(view.state, at + 2);
  assert.deepEqual(hit, { from: at, to: at + 7, text: "#ff0000" });
  view.dispatch({ effects: picker.setPicker.of({ from: hit.from, to: hit.to }) });
  await new Promise((r) => setTimeout(r, 30));
  const tip = document.querySelector(".cm-tooltip.ap-color-tip");
  assert.ok(tip, "the picker tooltip is shown");
  const input = tip.querySelector("input[type=color]");
  assert.equal(input.value, "#ff0000");
  assert.equal(tip.querySelector(".ap-color-cap").textContent, "Color picker", "the floating tip says what it is");
  assert.equal(tip.firstElementChild.className, "ap-color-cap", "the caption comes first — above the picker");
  assert.ok(tip.querySelector(".ap-color-row input[type=color]"), "the input sits in the row under it");
  assert.equal(input.getAttribute("aria-label"), "Color picker");
  assert.equal(input.title, "Color picker");
  input.value = "#00ff00";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.match(view.state.doc.line(2).text, /color: #00ff00;/, "the value is rewritten in place");
  assert.equal(document.getElementById("apSave").disabled, false, "which is an edit");
  view.dispatch({ effects: picker.setPicker.of(null) });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(document.querySelector(".cm-tooltip.ap-color-tip"), null, "and the tooltip goes");
  const line3 = view.state.doc.line(3);
  const rg = picker.colorAt(view.state, line3.from + line3.text.indexOf("rgba") + 3);
  assert.equal(rg.text, "rgba(0, 128, 255, 0.5)");
  view.dispatch({ effects: picker.setPicker.of({ from: rg.from, to: rg.to }) });
  await new Promise((r) => setTimeout(r, 30));
  const input2 = document.querySelector(".ap-color-tip input[type=color]");
  assert.equal(input2.value, "#0080ff");
  input2.value = "#ffffff";
  input2.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.match(view.state.doc.line(3).text, /background: rgba\(255, 255, 255, 0\.5\) url/, "alpha survives a pick");
  assert.deepEqual(picker.parseColor("#abc"), { r: 170, g: 187, b: 204, a: 1 });
  assert.deepEqual(picker.parseColor("hsl(120, 100%, 50%)"), { r: 0, g: 255, b: 0, a: 1 });
  assert.equal(picker.parseColor("rgb(1, 2)"), null);
  assert.equal(picker.parseColor("notacolour"), null);
  assert.equal(picker.replacement("#F00", "#00ff00"), "#00ff00");
  assert.equal(picker.replacement("#ff000080", "#00ff00"), "rgba(0, 255, 0, 0.502)");
  assert.deepEqual(picker.colorSpans("color: red; border: 1px solid #123; x: border-red-x; y: rgb(1,2,3)").map((c) => c.text), ["red", "#123", "rgb(1,2,3)"]);
});

test("the Page dropdown: lists every scraped page in order, defaults to the work, swaps the frame's body on change, is remembered, and every file exists script-free", async () => {
  const { readdirSync } = await import("node:fs");
  const dir = new URL("../public/ao3/html/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".html")).sort();
  assert.deepEqual(files, PAGES.map((p) => p.id + ".html").sort(), "one file per page, no strays");
  for (const f of files) {
    const html = readFileSync(new URL(f, dir), "utf-8");
    assert.ok(html.includes('id="main"') && html.includes('id="header"') && html.includes('id="footer"'), f + " is a whole AO3 page body");
    assert.ok(!/<script|<body|<\/head>/i.test(html), f + " has no scripts and is body-only");
    assert.ok(!/authenticity_token/.test(html), f + " carries no CSRF token");
  }
  assert.equal(DEFAULT_PAGE, "work");
  assert.equal(pageFile("bookmarks"), "/ao3/html/bookmarks.html");
  assert.equal(pageFile("junk"), "/ao3/html/work.html");
  // the select mirrors PAGES
  document.body.innerHTML = bodyOf(PAGE);
  localStorage.clear();
  const sel = document.getElementById("apPage");
  assert.deepEqual(Array.from(sel.options).map((o) => [o.value, o.textContent]), PAGES.map((p) => [p.id, p.label]));
  assert.equal(document.querySelector('label[for="apPage"]').textContent, "Page");
  const asked = [];
  const m = mountPreview(document, { storage: localStorage, loadCss: async () => "#header { color: red }", loadHtml: async (id) => { asked.push(id); return `<div id="header">${id}</div><div id="workskin"><p>hi</p></div>`; }, loadSite: async () => "" });
  await m.ready;
  assert.deepEqual(asked, ["work"], "the work page loads first");
  assert.equal(m.page, "work");
  assert.equal(m.kind, "site", "defaults: the Work page, a Site skin");
  assert.match(document.getElementById("apTabCss").textContent, /CSS/);
  assert.equal(sel.value, "work");
  sel.value = "tags";
  sel.dispatchEvent(new window.Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(asked, ["work", "tags"]);
  assert.equal(m.frameDoc().getElementById("header").textContent, "tags", "the frame shows the chosen page");
  assert.equal(localStorage.getItem(KEY_PAGE), "tags");
  assert.equal(m.frameDoc().getElementById("apSkin").textContent.trim().length > 0, true, "the skin is re-applied to the new page");
  await m.setPage("nope");
  assert.equal(m.page, "work", "an unknown id falls back to the work");
  // remembered across a mount
  localStorage.setItem(KEY_PAGE, "collections");
  document.body.innerHTML = bodyOf(PAGE);
  const asked2 = [];
  const m2 = mountPreview(document, { storage: localStorage, loadCss: async () => "", loadHtml: async (id) => { asked2.push(id); return "<p>x</p>"; }, loadSite: async () => "" });
  await m2.ready;
  assert.deepEqual(asked2, ["collections"]);
  assert.equal(document.getElementById("apPage").value, "collections");
});

test("the grip between editor and warnings resizes the warnings panel — drag, arrow keys, double-click reset — and the height is remembered like the drawer's width", async () => {
  const m = fresh();
  await m.ready;
  const side = document.getElementById("apSide");
  const split = document.getElementById("apSplit");
  assert.equal(split.getAttribute("role"), "separator");
  assert.ok(split.classList.contains("hidden"), "no warnings, no grip");
  assert.equal(m.lintHeight, LINT_DEFAULT);
  assert.equal(side.style.getPropertyValue("--ap-lint-h"), LINT_DEFAULT + "px");
  type(m, "#workskin p { color: red; gap: 1px }");
  m.apply();
  assert.ok(!split.classList.contains("hidden"), "a warning brings the grip");
  // drag up 60px → 60px taller; saved on release
  const PE = window.PointerEvent || window.MouseEvent;
  split.dispatchEvent(new PE("pointerdown", { bubbles: true, clientY: 500, pointerId: 1 }));
  assert.ok(document.body.classList.contains("resizing-lint"));
  split.dispatchEvent(new PE("pointermove", { bubbles: true, clientY: 440, pointerId: 1 }));
  assert.equal(m.lintHeight, LINT_DEFAULT + 60);
  assert.equal(side.style.getPropertyValue("--ap-lint-h"), LINT_DEFAULT + 60 + "px");
  assert.equal(localStorage.getItem(KEY_LINT_H), null, "not saved mid-drag");
  split.dispatchEvent(new PE("pointerup", { bubbles: true, clientY: 440, pointerId: 1 }));
  assert.ok(!document.body.classList.contains("resizing-lint"));
  assert.equal(localStorage.getItem(KEY_LINT_H), String(LINT_DEFAULT + 60), "saved on release");
  // keys
  split.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  assert.equal(m.lintHeight, LINT_DEFAULT + 48);
  split.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowUp", shiftKey: true, bubbles: true }));
  assert.equal(m.lintHeight, LINT_DEFAULT + 88);
  // floor
  m.setLintHeight(1);
  assert.equal(m.lintHeight, LINT_MIN);
  // reset
  split.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
  assert.equal(m.lintHeight, LINT_DEFAULT);
  // remembered
  localStorage.setItem(KEY_LINT_H, "333");
  const m2 = fresh();
  localStorage.setItem(KEY_LINT_H, "333");
  document.body.innerHTML = bodyOf(PAGE);
  const m3 = mountPreview(document, { storage: localStorage, loadCss: async () => "", loadHtml: async () => "<p>x</p>", loadSite: async () => "" });
  await m3.ready;
  assert.equal(m3.lintHeight, 333);
  assert.equal(document.getElementById("apSide").style.getPropertyValue("--ap-lint-h"), "333px");
  void m2;
});

test("the ⌖ toggle wears an instant tooltip titled Element Selector instead of a native title", () => {
  document.body.innerHTML = bodyOf(PAGE);
  const btn = document.getElementById("apInspect");
  assert.equal(btn.getAttribute("title"), null, "no native title — it would show late and double up");
  const tip = document.getElementById("apInspectTip");
  assert.equal(btn.getAttribute("aria-describedby"), "apInspectTip");
  assert.equal(tip.getAttribute("role"), "tooltip");
  assert.equal(tip.querySelector("b").textContent, "Element Selector");
  assert.match(tip.textContent, /click an element to add its rule/);
  assert.ok(btn.parentElement.classList.contains("ap-tipwrap"), "the hover wrapper is what shows it");
  const css = readFileSync(new URL("../public/ao3/preview.css", import.meta.url), "utf-8");
  assert.match(css, /\.ap-tipwrap:hover \.ap-tip,\s*\.ap-tipwrap:focus-within \.ap-tip \{/, "shown on hover and focus");
  assert.ok(!/\.ap-tip[^{]*\{[^}]*transition-delay/.test(css), "no delay");
});

test("the CSS drawer has no width cap: it may be dragged to nearly the whole window, and the warnings may take nearly the whole drawer", async () => {
  const D = await import(new URL("../public/ao3/side-drawer.js", import.meta.url).href);
  assert.equal(D.SIDE_MAX, undefined, "no fixed maximum");
  window.innerWidth = 2000;
  assert.equal(D.clampWidth(1800), 1800);
  assert.equal(D.clampWidth(5000), 2000 - D.SIDE_KEEP, "only the window bounds it");
  assert.equal(D.clampWidth(10), D.SIDE_MIN);
  const m = fresh();
  await m.ready;
  m.setLintHeight(100000);
  assert.ok(m.lintHeight >= 1e6 - 240 || m.lintHeight > 5000, "jsdom has no layout: the cap is effectively none");
});

test("inspecting shows the element hierarchy as breadcrumbs: hover a crumb to outline that ancestor, click it to pick it", async () => {
  const m = fresh('<div id="outer" class="wrapper"><div id="main" class="region"><div id="workskin"><div class="userstuff"><p class="x">hi</p></div></div></div></div>');
  await m.ready;
  const crumbs = document.getElementById("apCrumbs");
  assert.equal(crumbs.hidden, true, "nothing until inspecting and hovering");
  document.getElementById("apInspect").click();
  const fd = m.frameDoc();
  const ME = fd.defaultView.MouseEvent;
  const p = fd.querySelector("p.x");
  // pathOf: outermost first, html/body left out
  assert.deepEqual(pathOf(p).map((s) => s.text), ["div#outer.wrapper", "div#main.region", "div#workskin", "div.userstuff", "p.x"]);
  assert.equal(crumbsHtml(pathOf(p)).match(/class="ap-crumb( leaf)?"/g).length, 5);
  assert.match(crumbsHtml([{ text: "<b>" }]), /&lt;b&gt;/, "escaped");
  p.dispatchEvent(new ME("mousemove", { bubbles: true, clientX: 5, clientY: 5 }));
  assert.equal(crumbs.hidden, false);
  assert.equal(crumbs.nextElementSibling?.id, "apFrame", "the strip sits at the top of the preview, above the frame");
  const css = readFileSync(new URL("../public/ao3/preview.css", import.meta.url), "utf-8");
  assert.match(css, /\.ap-crumbs \{[^}]*\btop: 0;/, "pinned to the top");
  const chips = Array.from(crumbs.querySelectorAll(".ap-crumb"));
  assert.deepEqual(chips.map((c) => c.textContent), ["div#outer.wrapper", "div#main.region", "div#workskin", "div.userstuff", "p.x"]);
  assert.ok(chips[4].classList.contains("leaf"), "the hovered element is the leaf");
  assert.equal(m.crumbs.length, 5);
  // hovering the .userstuff crumb outlines that ancestor in the page and names it
  chips[3].dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
  const us = fd.querySelector(".userstuff");
  assert.ok(us.classList.contains("ap-insp-hover"), "the ancestor is outlined");
  assert.ok(!p.classList.contains("ap-insp-hover"), "and the leaf no longer is");
  assert.equal(fd.querySelector(".ap-insp-label").textContent, "#workskin div.userstuff");
  // clicking it picks the ancestor, not the leaf
  chips[3].click();
  assert.match(m.editor.value, /\n#workskin div\.userstuff \{\n\t\n\}\n$/);
  assert.ok(!/p\.x \{/.test(m.editor.value));
  // the pointer leaving the frame keeps the crumbs (that is where it is going); ending the mode clears them
  fd.dispatchEvent(new ME("mouseleave", { bubbles: true }));
  assert.equal(crumbs.hidden, false);
  fd.dispatchEvent(new fd.defaultView.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(crumbs.hidden, true);
  assert.equal(m.crumbs.length, 0);
});

test("the drawer's tabs: CSS | Work Content — the choice persists; the Work panel holds the edit-form fields with the shipped work's values, html fields as CodeMirror HTML editors; edits re-render the work live; Save/Reset", async () => {
  const W = await import(new URL("../public/ao3/work-content.js", import.meta.url).href);
  const tpl = readFileSync(new URL("../public/ao3/html/work.html", import.meta.url), "utf-8");
  document.body.innerHTML = bodyOf(PAGE);
  localStorage.clear();
  const m = mountPreview(document, { storage: localStorage, loadCss: async () => "", loadHtml: async () => tpl, loadSite: async () => "" });
  await m.ready;
  // tabs
  const tCss = document.getElementById("apTabCss"), tWork = document.getElementById("apTabWork");
  const pCss = document.getElementById("apPanelCss"), pWork = document.getElementById("apPanelWork");
  assert.equal(m.tab, "css");
  assert.ok(tCss.classList.contains("on") && !pCss.classList.contains("hidden") && pWork.classList.contains("hidden"));
  tWork.click();
  assert.equal(m.tab, "work");
  assert.equal(localStorage.getItem(KEY_TAB), "work");
  assert.ok(tWork.classList.contains("on") && tWork.getAttribute("aria-selected") === "true" && pCss.classList.contains("hidden") && !pWork.classList.contains("hidden"));
  // the form: one control per field, boilerplate values
  const form = document.getElementById("apWorkForm");
  for (const f of W.WORK_FIELDS) {
    if (f.kind === "checks") assert.ok(form.querySelector(`input[name="${f.id}"]`), f.id);
    else assert.ok(form.querySelector(`[name="${f.id}"]`), f.id);
  }
  assert.equal(form.querySelector('[name="title"]').value, "Bottled Up, Falling Down");
  assert.equal(form.querySelector('[name="rating"]').value, "Teen And Up Audiences");
  assert.equal(form.querySelector('[name="characters"]').value, "Mike Wheeler, Will Byers, Dustin Henderson, Lucas Sinclair, Robin Buckley");
  assert.ok(form.querySelector('input[name="categories"][value="M/M"]').checked);
  assert.equal(form.querySelectorAll(".ap-work-code .cm-editor").length, W.WORK_FIELDS.filter((f) => f.kind === "html").length, "every html field is a CodeMirror editor");
  assert.match(m.workEditor("summary").value, /^<p>He almost didn't see/);
  assert.match(m.workEditor("chapterText").value, /Mike stood on the edge/);
  assert.equal(document.getElementById("apWorkSave").textContent, "Saved");
  assert.equal(document.getElementById("apWorkSave").disabled, true);
  // the frame shows the rendered template — no token survives
  let fd = m.frameDoc();
  assert.equal(fd.querySelector("h2.title").textContent.trim(), "Bottled Up, Falling Down");
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(fd.body.innerHTML), "no token left in the page");
  assert.equal(fd.querySelectorAll("dd.character.tags a.tag").length, 5);
  // edit the title → re-rendered
  const title = form.querySelector('[name="title"]');
  title.value = "A New Title";
  title.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(m.work.title, "A New Title");
  assert.equal(document.getElementById("apWorkSave").disabled, false);
  await new Promise((r) => setTimeout(r, 200));
  fd = m.frameDoc();
  assert.equal(fd.querySelector("h2.title").textContent.trim(), "A New Title");
  // edit the summary in its editor → re-rendered; an emptied one omits the module
  m.workEditor("summary").value = "<p>Short.</p>";
  await new Promise((r) => setTimeout(r, 200));
  fd = m.frameDoc();
  assert.equal(fd.querySelector(".summary.module blockquote").innerHTML.trim(), "<p>Short.</p>");
  m.workEditor("summary").value = "";
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(m.frameDoc().querySelector(".summary.module"), null, "an empty summary has no module, as on AO3");
  // a chapter preface appears only when filled
  m.workEditor("chapterNotes").value = "<p>cn</p>";
  await new Promise((r) => setTimeout(r, 200));
  fd = m.frameDoc();
  assert.equal(fd.querySelector("#chapters .chapter.preface #notes blockquote").innerHTML, "<p>cn</p>");
  // tags: a checkbox and a comma list
  form.querySelector('input[name="warnings"][value="Major Character Death"]').checked = true;
  form.querySelector('input[name="warnings"]').dispatchEvent(new window.Event("input", { bubbles: true }));
  const fand = form.querySelector('[name="fandoms"]');
  fand.value = "Stranger Things (TV 2016), Byler <x>";
  fand.dispatchEvent(new window.Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  fd = m.frameDoc();
  assert.deepEqual(Array.from(fd.querySelectorAll("dd.warning.tags a.tag")).map((a) => a.textContent), ["Creator Chose Not To Use Archive Warnings", "Major Character Death"]);
  assert.deepEqual(Array.from(fd.querySelectorAll("dd.fandom.tags a.tag")).map((a) => a.textContent), ["Stranger Things (TV 2016)", "Byler <x>"], "tag text is escaped, not markup");
  // Save → localStorage; a remount restores it; Reset → boilerplate
  document.getElementById("apWorkSave").click();
  assert.equal(JSON.parse(localStorage.getItem(W.KEY_WORK)).title, "A New Title");
  assert.equal(document.getElementById("apWorkSave").textContent, "Saved");
  document.body.innerHTML = bodyOf(PAGE);
  const m2 = mountPreview(document, { storage: localStorage, loadCss: async () => "", loadHtml: async () => tpl, loadSite: async () => "" });
  await m2.ready;
  assert.equal(m2.tab, "work", "the tab is remembered");
  assert.equal(m2.work.title, "A New Title");
  assert.equal(m2.frameDoc().querySelector("h2.title").textContent.trim(), "A New Title");
  document.getElementById("apWorkReset").click();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(localStorage.getItem(W.KEY_WORK), null);
  assert.equal(m2.work.title, "Bottled Up, Falling Down");
  assert.equal(m2.frameDoc().querySelector("h2.title").textContent.trim(), "Bottled Up, Falling Down");
  // on another page the values stay but the frame is that page, untouched
  await m2.setPage("tags");
  const before = m2.frameDoc().body.innerHTML;
  const t2 = document.getElementById("apWorkForm").querySelector('[name="title"]');
  t2.value = "Elsewhere";
  t2.dispatchEvent(new window.Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(m2.frameDoc().body.innerHTML, before);
  assert.equal(m2.work.title, "Elsewhere");
});

test("Work Content fields are validated under AO3's HTML rules: diagnostics in the editor, a count on the label, messages under a title input", async () => {
  const tpl = readFileSync(new URL("../public/ao3/html/work.html", import.meta.url), "utf-8");
  document.body.innerHTML = bodyOf(PAGE);
  localStorage.clear();
  const m = mountPreview(document, { storage: localStorage, loadCss: async () => "", loadHtml: async () => tpl, loadSite: async () => "" });
  await m.ready;
  m.setTab("work");
  const form = document.getElementById("apWorkForm");
  const badge = (id) => form.querySelector(`.ap-work-issues[data-for="${id}"]`);
  assert.equal(badge("summary").hidden, true, "the boilerplate is clean");
  m.workEditor("summary").value = '<p class="note" style="color:red">s</p><script>1</script>';
  assert.deepEqual(m.workProblems("summary").map((p) => p.code), ["removed_with_contents", "class_not_here", "inline_style"]);
  assert.equal(badge("summary").hidden, false);
  assert.equal(badge("summary").textContent, "3 problems");
  assert.ok(badge("summary").classList.contains("error"));
  await new Promise((r) => setTimeout(r, 80));
  const view = m.workEditor("summary").view;
  const { forEachDiagnostic } = await import(new URL("../public/vendor/codemirror.js", import.meta.url).href).catch(() => ({}));
  assert.ok(view.dom.querySelector(".cm-lintRange, .cm-lint-marker") || forEachDiagnostic, "diagnostics are rendered in the editor");
  // the same markup is fine in the work text (class allowed there)
  m.workEditor("chapterText").value = '<p class="note">s</p>';
  assert.deepEqual(m.workProblems("chapterText"), []);
  assert.equal(badge("chapterText").hidden, true);
  // a title with HTML gets its message under the input
  const t = form.querySelector('[name="title"]');
  t.value = "<b>T</b>";
  t.dispatchEvent(new window.Event("input", { bubbles: true }));
  const warn = form.querySelector('.ap-work-warn[data-for="title"]');
  assert.equal(warn.hidden, false);
  assert.match(warn.textContent, /takes no HTML/);
  assert.equal(badge("title").textContent, "1 note");
});

test("the tab bar follows the Editor Tabs design: a glyph per tab, CSS yellow and Work Content orange on top of the active tab, count pills that follow the lint", async () => {
  const tpl = readFileSync(new URL("../public/ao3/html/work.html", import.meta.url), "utf-8");
  document.body.innerHTML = bodyOf(PAGE);
  localStorage.clear();
  const m = mountPreview(document, { storage: localStorage, loadCss: async () => "#workskin p { color: red }", loadHtml: async () => tpl, loadSite: async () => "" });
  await m.ready;
  const css = readFileSync(new URL("../public/ao3/preview.css", import.meta.url), "utf-8");
  assert.match(css, /--ap-tab-css: #ffd766;/, "CSS accent is yellow");
  assert.match(css, /--ap-tab-work: #f6a13a;/, "Work Content accent is orange");
  assert.match(css, /\.ap-tab-css\.on \{\s*border-top-color: var\(--ap-tab-css\);/);
  assert.match(css, /\.ap-tab-work\.on \{\s*border-top-color: var\(--ap-tab-work\);/);
  assert.match(css, /\.ap-tab \{[^}]*border-top: 2px solid transparent;[^}]*border-right: 1px solid var\(--ap-tab-sep\);/s, "the reference's 2px top accent and right separator");
  assert.match(css, /\.doc-side-head \{[^}]*height: 40px;[^}]*background: var\(--ap-tabbar\);/s, "a 40px bar in the darker ink");
  const tCss = document.getElementById("apTabCss"), tWork = document.getElementById("apTabWork");
  assert.equal(tCss.querySelector(".ap-tab-ico").textContent, "{}");
  assert.equal(tWork.querySelector(".ap-tab-ico").textContent, "</>");
  assert.ok(tCss.classList.contains("ap-tab-css") && tWork.classList.contains("ap-tab-work"));
  // count pills: CSS follows the lint, Work Content the fields' problems
  const cssN = document.getElementById("apTabCssN"), workN = document.getElementById("apTabWorkN");
  assert.equal(cssN.hidden, true);
  type(m, "#workskin p { color: red; gap: 1px }\n#nothing { color: red }");
  m.apply();
  assert.equal(cssN.hidden, false);
  assert.equal(cssN.textContent, "2");
  assert.equal(workN.hidden, true, "the boilerplate is clean");
  m.workEditor("summary").value = '<p style="x">a</p><font>b</font>';
  assert.equal(workN.hidden, false);
  assert.equal(workN.textContent, "2");
  m.workEditor("summary").value = "<p>ok</p>";
  assert.equal(workN.hidden, true);
});
