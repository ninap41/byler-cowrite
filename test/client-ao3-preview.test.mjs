import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installDom } from "./dom.mjs";

// The page's own body markup, so the test drives the real ids.
const PAGE = readFileSync(new URL("../public/ao3-preview.html", import.meta.url), "utf-8");
const bodyOf = (html) => html.slice(html.indexOf("<body>") + 6, html.indexOf("<script type=\"module\">"));

let picker, mountPreview, lintRowHtml, issuesLabel, frameHtml, unmatchedRules, NO_MATCH, NO_MATCH_SITE, KEY_KIND, DEFAULT_KIND, DOWNLOAD_NAMES, KEY_CSS, KEY_EXPANDED, KEY_THEME, DOWNLOAD_NAME, selectorFor, STYLE_ID, OUTSIDE_CLASS, OUTSIDE_NOTE;
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
  const pickerSrc = readFileSync(new URL("../public/ao3/color-picker.js", import.meta.url), "utf-8").replace('"/vendor/codemirror.js?v=3"', JSON.stringify(abs("../public/vendor/codemirror.js"))).replace('"./css-values.js"', JSON.stringify(abs("../public/ao3/css-values.js")));
  const pickerUrl = asData(pickerSrc);
  const editorSrc = readFileSync(new URL("../public/ao3/editor.js", import.meta.url), "utf-8").replace('"/vendor/codemirror.js?v=3"', JSON.stringify(abs("../public/vendor/codemirror.js"))).replace('"./ao3-rules.js"', JSON.stringify(abs("../public/ao3/ao3-rules.js"))).replace('"./css-values.js"', JSON.stringify(abs("../public/ao3/css-values.js"))).replace('"./color-picker.js"', JSON.stringify(pickerUrl));
  const src = readFileSync(new URL("../public/ao3/preview.js", import.meta.url), "utf-8")
    .replace('"/js/components/side-drawer.js"', JSON.stringify(abs("../public/js/components/side-drawer.js")))
    .replace('"./ao3-rules.js"', JSON.stringify(abs("../public/ao3/ao3-rules.js")))
    .replace('"./editor.js"', JSON.stringify(asData(editorSrc)))
    .replace('"./inspect.js"', JSON.stringify(abs("../public/ao3/inspect.js")));
  ({ mountPreview, lintRowHtml, issuesLabel, frameHtml, unmatchedRules, NO_MATCH, NO_MATCH_SITE, KEY_KIND, DEFAULT_KIND, DOWNLOAD_NAMES, KEY_CSS, KEY_EXPANDED, KEY_THEME, DOWNLOAD_NAME } = await import(asData(src)));
  ({ selectorFor, STYLE_ID, OUTSIDE_CLASS, OUTSIDE_NOTE } = await import(abs("../public/ao3/inspect.js")));
  picker = await import(pickerUrl);
});

function fresh(html = "<p>hi</p>") {
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
  assert.equal(fd.body.innerHTML, "<p>hi</p>", "the work is the frame's body");
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
