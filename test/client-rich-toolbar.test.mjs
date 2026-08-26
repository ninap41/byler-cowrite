// The shared WYSIWYG toolbar. The point of the module is that the game and the
// solo editor CANNOT drift, so most of this compares the two pages' markup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { installDom } from "./dom.mjs";

installDom();
const { toolbarHtml, mountRichToolbar, TOOLBAR_CONTROLS } = await import("../public/js/components/rich-toolbar.js");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf-8");

test("the toolbar ships every control, grouped and borderless", () => {
  const html = toolbarHtml();
  for (const id of ["undoBtn", "redoBtn", "blockFormat", "fontStepper", "fsInput", "listSelect", "alignSelect", "emDashBtn", "clearFmtBtn"])
    assert.ok(html.includes(`id="${id}"`), id + " is on the toolbar");
  for (const cmd of ["bold", "italic", "underline", "strikeThrough", "insertHorizontalRule"])
    assert.ok(html.includes(`data-cmd="${cmd}"`), cmd + " is on the toolbar");
  assert.equal((html.match(/class="tb-group"/g) || []).length, 6, "grouped, not one flat run");
  assert.ok(!html.includes("<a "), "no link button: sanitizeRich would strip it anyway");
  assert.ok(!html.includes("imgBtn"), "and no image button");
});

test("an id prefix keeps two toolbars on one page from colliding", () => {
  const html = toolbarHtml("g");
  assert.ok(html.includes('id="gfsInput"') && html.includes('id="gblockFormat"'));
  assert.ok(!html.includes('id="fsInput"'));
});

test("mounting wires the editor without throwing, and syncs on mount", () => {
  document.body.innerHTML = '<div id="tb"></div><div id="ed" contenteditable="true"><p>hello</p></div>';
  const tb = document.getElementById("tb");
  const ed = document.getElementById("ed");
  tb.innerHTML = toolbarHtml();
  const t = mountRichToolbar(ed, tb, {});
  assert.ok(t.sync && t.history && t.destroy, "the handle exposes what a page needs");
  assert.doesNotThrow(() => t.sync());
  assert.doesNotThrow(() => t.destroy());
});

test("the game page mounts the shared toolbar rather than hand-rolling one", () => {
  const game = read("public/game.html");
  assert.ok(game.includes("rich-toolbar.js"), "it imports the component");
  assert.ok(game.includes("mountRichToolbar($(\"writerEditor\")"), "and mounts it on the writing box");
  assert.ok(!/<button class="ghost" data-cmd=/.test(game), "no hand-written toolbar buttons remain");
});

test("the game's editor emits the same subset it can produce, minus urls", () => {
  const game = read("public/game.html");
  const calls = [...game.matchAll(/cleanHtml\(.*?\}\)/g)].map((m) => m[0]);
  assert.ok(calls.length >= 3, "submit, edit and live-typing all clean the html");
  for (const c of calls) assert.match(c, /doc: true, urls: false/, "every call asks for the same subset: " + c);
});

test("both editors offer the same controls, this is the drift guard", () => {
  const write = read("public/write.html");
  const shared = toolbarHtml();
  for (const id of ["undoBtn", "redoBtn", "blockFormat", "fsInput", "fsUp", "fsDown", "listSelect", "alignSelect", "emDashBtn", "clearFmtBtn"])
    assert.ok(write.includes(`id="${id}"`) && shared.includes(`id="${id}"`), id + " exists on both");
  for (const cmd of ["bold", "italic", "underline", "strikeThrough", "insertHorizontalRule"])
    assert.ok(write.includes(`data-cmd="${cmd}"`) && shared.includes(`data-cmd="${cmd}"`), cmd + " exists on both");
  assert.ok(TOOLBAR_CONTROLS.includes("fontSize") && TOOLBAR_CONTROLS.includes("clearFormatting"));
});
