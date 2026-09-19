// Share / Download ▾ — the one export control: signatures per line (bold
// name, no colour, inside the line's own block), the flyout's placement so it
// stays on screen, and the wiring on jsdom.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom, mount } from "./dom.mjs";

installDom();
const { buildExports, signLine, signature, exportFileName } = await import("../public/js/export.js");
const { pdfLine, storyToPdf } = await import("../public/js/export-pdf.js");
const { exportMenuHtml, placeMenu, mountExportMenu, readBylines, BYLINES_KEY } = await import(
  "../public/js/components/export-menu.js"
);

const story = [
  { name: "justthegatekeeper", color: "#6c8cff", html: "just <b>inline</b>" },
  { name: "mike", color: "#e63946", html: '<p class="al-c">centred words</p>' },
  { name: "will", color: "#6c8cff", html: "<h2>A heading</h2>" },
  { name: "will", color: "#6c8cff", html: "<hr>" },
  { name: "el", color: "#111111", html: "<ul><li>one</li><li>two</li></ul>" },
  { name: "<dustin>", color: "#111111", html: "<blockquote><p>quoted</p></blockquote>" },
];

test("signLine: a bold `name:` opens the line INSIDE its first block, so alignment and headings survive", () => {
  assert.equal(signLine("just <b>inline</b>", "will"), "<p><b>will:</b> just <b>inline</b></p>", "inline line wrapped, then signed");
  assert.equal(signLine('<p class="al-c">centred</p>', "mike"), '<p class="al-c"><b>mike:</b> centred</p>', "the signature keeps the block's alignment");
  assert.equal(signLine("<h2>A heading</h2>", "will"), "<h2><b>will:</b> A heading</h2>", "a heading stays a heading");
  assert.equal(signLine("<hr>", "will"), "<hr>", "a rule has no words and no name");
  assert.equal(signLine("<ul><li>one</li><li>two</li></ul>", "el"), "<ul><li><b>el:</b> one</li><li>two</li></ul>", "a list signs its first item");
  assert.equal(signLine("<blockquote><p>quoted</p></blockquote>", "<dustin>"), "<blockquote><p><b>&lt;dustin&gt;:</b> quoted</p></blockquote>", "a quote signs its first paragraph; the name is escaped");
  assert.equal(signature(""), "<b>someone:</b> ", "a seat with no name still signs");
  assert.ok(!signLine("<p>x</p>", "will").includes("style="), "never a colour: AO3 and pasted documents get bold only");
});

test("buildExports: prose only by default; with bylines every line is signed in html AND plain text", () => {
  const off = buildExports("A prompt", story);
  assert.ok(!off.html.includes("justthegatekeeper") && !off.plain.includes("mike:"), "no names unless asked");
  assert.ok(off.html.includes("\n<ul><li>one</li><li>two</li></ul>\n"), "a list is a block: never wrapped in a <p>");
  assert.ok(off.html.endsWith("\n<blockquote><p>quoted</p></blockquote>"), "so is a blockquote");

  const on = buildExports("A prompt", story, document, { bylines: true });
  assert.ok(on.html.includes("<p><b>justthegatekeeper:</b> just <b>inline</b></p>"));
  assert.ok(on.html.includes('<p class="al-c"><b>mike:</b> centred words</p>'));
  assert.ok(on.html.includes("<h2><b>will:</b> A heading</h2>"));
  assert.ok(on.html.includes("\n<hr>\n"), "the rule stays bare");
  assert.ok(!on.html.includes("color:") && !on.html.includes("style="), "bold name, no colour");
  assert.ok(on.plain.includes("justthegatekeeper: just inline"), "plain text signs the same way");
  assert.ok(on.plain.includes("mike: centred words") && on.plain.includes("<dustin>: quoted"));
  assert.ok(on.plain.includes("el: one\ntwo"), "list items break onto lines in plain text");
  assert.ok(on.plain.includes("\n\n\n\n"), "a rule contributes an empty line, not `will: `");
  assert.ok(!on.plain.includes("will: \n") , "no dangling signature on the rule");
});

test("exportFileName slugs the site name and the code", () => {
  assert.equal(exportFileName("AB1Z", "pdf"), "cowrite-ab1z.pdf", "no site meta on this page → the generic name");
  assert.equal(exportFileName(undefined, "html"), "cowrite-story.html");
});

test("pdfLine reads a story line's tag, alignment and text; list items break onto lines", () => {
  assert.deepEqual(pdfLine('<p class="al-c">hi <b>there</b></p>'), { tag: "p", align: "center", text: "hi there" });
  assert.deepEqual(pdfLine("<h1>Big</h1>"), { tag: "h1", align: "left", text: "Big" });
  assert.deepEqual(pdfLine("<ul><li>a</li><li>b</li></ul>"), { tag: "ul", align: "left", text: "• a\n• b" }, "list items keep their bullets");
  assert.equal(pdfLine("<hr>").tag, "hr");
  assert.deepEqual(pdfLine("loose &amp; inline"), { tag: "p", align: "left", text: "loose & inline" });
});

// a jsPDF stand-in that records what was drawn
function fakePdf() {
  const calls = [];
  const doc = {
    internal: { pageSize: { getWidth: () => 595, getHeight: () => 842 } },
    font: "normal",
    setFont(_n, style) { doc.font = style; },
    setFontSize() {},
    setDrawColor() {},
    // like jsPDF: a newline always breaks, then width does (6pt a character here)
    splitTextToSize: (t, w) => t.split("\n").flatMap((s) => {
      const out = [];
      const per = Math.max(1, Math.floor(w / 6));
      while (s.length > per) { out.push(s.slice(0, per)); s = s.slice(per); }
      out.push(s); return out;
    }),
    getTextWidth: (t) => t.length * 6,
    text(t, x, y, opts) { calls.push({ t, x, y, font: doc.font, align: opts?.align }); },
    line() { calls.push({ rule: true }); },
    addPage() {},
    save(name) { calls.push({ saved: name }); },
  };
  return { jsPDF: function () { return doc; }, calls };
}

test("storyToPdf: with bylines the name is a bold run and the words follow on the same baseline; without, prose only", () => {
  const on = fakePdf();
  storyToPdf(on, "The prompt", story.slice(0, 3), "x.pdf", { bylines: true });
  const names = on.calls.filter((c) => /:$/.test(c.t || ""));
  assert.deepEqual(names.map((c) => c.t), ["justthegatekeeper:", "mike:", "will:"], "every line signed");
  assert.ok(names.every((c) => c.font === "bold"), "in bold");
  const first = on.calls.findIndex((c) => c.t === "justthegatekeeper:");
  const words = on.calls[first + 1];
  assert.equal(words.y, on.calls[first].y, "the words sit on the signature's baseline");
  assert.equal(words.x, on.calls[first].x + "justthegatekeeper: ".length * 6, "right after it");
  assert.equal(words.font, "normal");
  const centred = on.calls.find((c) => c.t === "mike:");
  const cw = on.calls[on.calls.indexOf(centred) + 1];
  assert.ok(Math.abs((centred.x + cw.x + cw.t.length * 6) / 2 - 595 / 2) < 1, "a centred line is centred as one run, name included");
  assert.equal(on.calls.at(-1).saved, "x.pdf");
  const list = fakePdf();
  storyToPdf(list, "", [story[4]], "l.pdf", { bylines: true });
  assert.deepEqual(list.calls.slice(0, 3).map((c) => c.t), ["• el:", "one", "• two"], "a signed list keeps its bullet ahead of the name");

  const off = fakePdf();
  storyToPdf(off, "The prompt", story.slice(0, 3), "y.pdf");
  assert.ok(!off.calls.some((c) => /:$/.test(c.t || "")), "no names");
  assert.ok(off.calls.some((c) => c.t === "centred words" && c.align === "center"));
  assert.ok(off.calls.some((c) => c.t === "A heading" && c.font === "bold"), "a heading is bold");
});

test("placeMenu: flips above the button when the page ends first, hangs right when the side does", () => {
  const view = { width: 1000, height: 600 };
  const menu = { width: 300, height: 220 };
  assert.deepEqual(placeMenu({ top: 100, bottom: 130, left: 100, right: 200 }, menu, view), { up: false, right: false });
  assert.deepEqual(placeMenu({ top: 500, bottom: 530, left: 100, right: 200 }, menu, view), { up: true, right: false }, "near the bottom → up");
  assert.deepEqual(placeMenu({ top: 100, bottom: 130, left: 850, right: 980 }, menu, view), { up: false, right: true }, "near the right edge → right");
  assert.deepEqual(placeMenu({ top: 100, bottom: 130, left: 850, right: 980 }, menu, { width: 900, height: 600 }), { up: false, right: true });
  // no room either way keeps it below (scrolling reaches it) rather than clipping it above the top
  assert.equal(placeMenu({ top: 50, bottom: 80, left: 0, right: 100 }, { width: 300, height: 900 }, view).up, false);
  // a menu wider than the button's left offset can't hang right without leaving the screen
  assert.equal(placeMenu({ top: 100, bottom: 130, left: 900, right: 1000 }, { width: 1200, height: 100 }, view).right, false);
});

test("exportMenuHtml: one button, a menu with the switch, copy, .html and .pdf, ids prefixed", () => {
  const h = exportMenuHtml("arch");
  for (const id of ["archExportBtn", "archExportMenu", "archBylines", "archCopy", "archHtml", "archPdf", "archExportNote"])
    assert.ok(h.includes(`id="${id}"`), id);
  assert.ok(h.includes('aria-haspopup="menu"') && h.includes('aria-controls="archExportMenu"'));
  assert.ok(h.includes("Share / Download"), "the button says what it is");
  assert.ok(h.indexOf('id="archBylines"') < h.indexOf('id="archCopy"'), "the switch comes first: choose, then export");
});

test("mountExportMenu: opens/closes, remembers the switch, copies with the choice applied, downloads with a named file", async () => {
  localStorage.setItem(BYLINES_KEY, "1");
  assert.equal(readBylines(), true);
  const root = mount("<div></div>");
  const written = [];
  globalThis.ClipboardItem = class { constructor(parts) { this.parts = parts; } };
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: { write: async (items) => written.push(items[0].parts), writeText: async () => {} },
    configurable: true,
  });
  const menu = mountExportMenu(root, {
    prefix: "t",
    source: () => ({ prompt: "P", story: story.slice(0, 2), code: "ab12" }),
  });
  const btn = document.getElementById("tExportBtn");
  const list = document.getElementById("tExportMenu");
  assert.equal(document.getElementById("tBylines").checked, true, "the remembered choice is painted");
  btn.click();
  assert.ok(menu.isOpen() && list.classList.contains("open") && btn.getAttribute("aria-expanded") === "true");
  document.body.click();
  assert.ok(!menu.isOpen(), "an outside click closes it");
  btn.click();
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
  assert.ok(!menu.isOpen(), "Escape closes it");

  document.getElementById("tCopy").click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(written.length, 1);
  const html = await new Response(written[0]["text/html"]).text();
  assert.ok(html.includes("<p><b>justthegatekeeper:</b> just <b>inline</b></p>"), "signed, because the box is ticked");
  assert.equal(document.getElementById("tExportNote").textContent, "Copied: paste into AO3, Docs or Word");

  document.getElementById("tBylines").checked = false;
  document.getElementById("tBylines").dispatchEvent(new window.Event("change"));
  assert.equal(localStorage.getItem(BYLINES_KEY), "0", "the switch is remembered");
  document.getElementById("tCopy").click();
  await new Promise((r) => setTimeout(r, 0));
  const plain = await new Response(written[1]["text/plain"]).text();
  assert.ok(!plain.includes("justthegatekeeper"), "unsigned now");

  // .html download: a blob anchor named after the site and the code
  const clicked = [];
  globalThis.URL.createObjectURL = () => "blob:x";
  globalThis.URL.revokeObjectURL = () => {};
  const proto = window.HTMLAnchorElement.prototype;
  const orig = proto.click;
  proto.click = function () { clicked.push(this.download); };
  btn.click();
  document.getElementById("tHtml").click();
  proto.click = orig;
  assert.deepEqual(clicked, ["cowrite-ab12.html"]);
  assert.ok(!menu.isOpen(), "a download closes the menu");
});
