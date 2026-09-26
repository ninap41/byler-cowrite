// Hot Keys — the one shortcut table, the "?" popover and the Cmd/Ctrl
// dispatcher shared by the solo editor and the game's writer box.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { installDom } from "./dom.mjs";

installDom();
const { HOT_KEYS, keyLabel, matchHotKey, hotKeysHtml, mountHotKeys } = await import("../public/js/components/hot-keys.js");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf-8");

const kd = (target, key, mods = {}) => {
  const e = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ctrlKey: true, ...mods });
  target.dispatchEvent(e);
  return e;
};

test("the table: seven editor keys plus the game's submit; the divider is Shift+H because macOS hides the app on ⌘H", () => {
  assert.deepEqual(Object.keys(HOT_KEYS), ["find", "save", "emDash", "hr", "link", "image", "bold", "italic", "underline", "submit"]);
  assert.equal(HOT_KEYS.link.key, "K");
  assert.ok(!HOT_KEYS.link.shift);
  assert.equal(HOT_KEYS.image.key, "I");
  assert.equal(HOT_KEYS.image.shift, true, "⌘I is italic; the image takes Shift");
  assert.equal(keyLabel(HOT_KEYS.image, true), "⌘ ⇧ I");
  assert.equal(keyLabel(HOT_KEYS.link, false), "Ctrl + K");
  assert.equal(HOT_KEYS.hr.key, "H");
  assert.equal(HOT_KEYS.hr.shift, true);
  for (const id of ["bold", "italic", "underline"]) assert.equal(HOT_KEYS[id].handled, false, `${id} stays the browser's own`);
  assert.equal(HOT_KEYS.emDash.shift, true, "⌘E belongs to browser extensions");
  assert.equal(keyLabel(HOT_KEYS.hr, true), "⌘ ⇧ H");
  assert.equal(keyLabel(HOT_KEYS.hr, false), "Ctrl + Shift + H");
  assert.equal(keyLabel(HOT_KEYS.find, true), "⌘ F");
  assert.equal(keyLabel(HOT_KEYS.submit, false), "Ctrl + Enter");
});

test("matchHotKey: modifier + letter, shift must agree, alt never, only the ids the page offers", () => {
  const ev = (key, m = {}) => ({ key, metaKey: false, ctrlKey: true, altKey: false, shiftKey: false, ...m });
  assert.equal(matchHotKey(ev("e"), ["emDash"]), null, "plain Ctrl+E is not ours");
  assert.equal(matchHotKey(ev("E", { shiftKey: true }), ["emDash"])?.id, "emDash");
  assert.equal(matchHotKey(ev("E", { ctrlKey: false, metaKey: true, shiftKey: true }), ["emDash"])?.id, "emDash", "⌘ on a Mac");
  assert.equal(matchHotKey(ev("h"), ["hr"]), null, "plain Ctrl+H is not ours");
  assert.equal(matchHotKey(ev("H", { shiftKey: true }), ["hr"])?.id, "hr");
  assert.equal(matchHotKey(ev("s"), ["emDash", "hr"]), null, "save is not offered on this page");
  assert.equal(matchHotKey(ev("E", { shiftKey: true, altKey: true }), ["emDash"]), null);
  assert.equal(matchHotKey(ev("E", { shiftKey: true, ctrlKey: false }), ["emDash"]), null);
  assert.equal(matchHotKey(ev("Enter"), ["submit"])?.id, "submit");
  assert.equal(matchHotKey(ev("i"), ["image"]), null, "plain Ctrl+I is not the image");
  assert.equal(matchHotKey(ev("i"), ["italic", "image"])?.id, "italic");
  assert.equal(matchHotKey(ev("I", { shiftKey: true }), ["italic", "image"])?.id, "image");
  assert.equal(matchHotKey(ev("k"), ["link"])?.id, "link");
});

test("the markup: a round ? button that owns a dialog listing exactly the rows asked for, in order", () => {
  document.body.innerHTML = hotKeysHtml("t", ["emDash", "hr", "bold"], false);
  const btn = document.getElementById("tHkBtn");
  assert.equal(btn.textContent, "?");
  assert.equal(btn.getAttribute("aria-expanded"), "false");
  assert.equal(btn.getAttribute("aria-controls"), "tHkMenu");
  assert.equal(document.getElementById("tHkMenu").getAttribute("role"), "dialog");
  assert.deepEqual([...document.querySelectorAll("#tHkMenu kbd")].map((k) => k.textContent), ["Ctrl + Shift + E", "Ctrl + Shift + H", "Ctrl + B"]);
  assert.deepEqual([...document.querySelectorAll("#tHkMenu dd")].map((k) => k.textContent), ["Em dash —", "Divider", "Bold"]);
});

test("mount: the editing keys fire only with the caret in the editor and the page active; find/save from anywhere; B/I/U are never prevented", () => {
  document.body.innerHTML = '<span id="slot"></span><div id="ed" contenteditable="true" tabindex="0"><p>words</p></div><input id="other">';
  const ed = document.getElementById("ed");
  const calls = [];
  let active = true;
  const hk = mountHotKeys(document.getElementById("slot"), {
    prefix: "t",
    keys: ["find", "save", "emDash", "hr", "link", "image", "bold", "italic", "underline"],
    editor: ed,
    isActive: () => active,
    mac: false,
    actions: { find: () => calls.push("find"), save: () => calls.push("save"), emDash: () => calls.push("emDash"), hr: () => calls.push("hr"), link: () => calls.push("link"), image: () => calls.push("image") },
  });
  ed.focus();
  assert.equal(kd(ed, "e").defaultPrevented, false, "plain Ctrl+E is left to the browser");
  assert.equal(kd(ed, "E", { shiftKey: true }).defaultPrevented, true);
  assert.deepEqual(calls, ["emDash"]);
  assert.equal(kd(ed, "h").defaultPrevented, false, "plain Ctrl+H is left to the browser");
  assert.equal(kd(ed, "H", { shiftKey: true }).defaultPrevented, true);
  assert.deepEqual(calls, ["emDash", "hr"]);
  for (const k of ["b", "i", "u"]) assert.equal(kd(ed, k).defaultPrevented, false, `${k}: the browser formats, we only list it`);
  assert.deepEqual(calls, ["emDash", "hr"]);
  assert.equal(kd(ed, "k").defaultPrevented, true);
  assert.equal(kd(ed, "I", { shiftKey: true }).defaultPrevented, true);
  assert.deepEqual(calls, ["emDash", "hr", "link", "image"]);
  calls.length = 0;
  calls.push("emDash", "hr");

  const other = document.getElementById("other");
  other.focus();
  assert.equal(kd(other, "E", { shiftKey: true }).defaultPrevented, false, "an em dash in a text field is not ours");
  assert.equal(kd(other, "f").defaultPrevented, true, "find works from anywhere");
  assert.equal(kd(other, "s").defaultPrevented, true, "so does save");
  assert.deepEqual(calls, ["emDash", "hr", "find", "save"]);

  active = false;
  ed.focus();
  assert.equal(kd(ed, "E", { shiftKey: true }).defaultPrevented, false, "source view / a reader: the editing keys sleep");
  assert.equal(kd(ed, "f").defaultPrevented, true, "a reader still finds");
  assert.deepEqual(calls, ["emDash", "hr", "find", "save", "find"]);

  hk.destroy();
  assert.equal(kd(ed, "f").defaultPrevented, false, "destroy stops the dispatcher");
});

test("mount: the ? opens the sheet, Escape closes it and gives the button focus back, an outside click closes it", () => {
  document.body.innerHTML = '<span id="slot"></span><div id="ed" contenteditable="true"></div><p id="away">x</p>';
  const hk = mountHotKeys(document.getElementById("slot"), { prefix: "g", keys: ["emDash", "submit"], editor: document.getElementById("ed"), mac: true, actions: {} });
  const btn = document.getElementById("gHkBtn");
  const menu = document.getElementById("gHkMenu");
  assert.deepEqual([...menu.querySelectorAll("kbd")].map((k) => k.textContent), ["⌘ ⇧ E", "⌘ ↩"]);
  btn.click();
  assert.ok(hk.isOpen() && menu.classList.contains("open"));
  assert.equal(btn.getAttribute("aria-expanded"), "true");
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.ok(!hk.isOpen());
  assert.equal(document.activeElement, btn);
  btn.click();
  assert.ok(hk.isOpen());
  document.getElementById("away").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.ok(!hk.isOpen(), "a click elsewhere closes it");
  hk.destroy();
});

test("both pages mount the same component: a slot in each editor's foot hint, no hand-written shortcut text", () => {
  const write = read("public/write.html");
  const game = read("public/game.html");
  assert.ok(write.includes('id="hotKeysSlot"'), "solo: the slot sits in #editorHint");
  assert.ok(game.includes('id="gameHotKeysSlot"'), "game: the slot sits in the writer hint");
  assert.ok(!write.includes("⌘+S to save"), "the old one-line hint is gone");
  const writeJs = read("public/js/pages/write.js");
  const gameJs = read("public/js/pages/game.js");
  assert.ok(writeJs.includes('mountHotKeys($("hotKeysSlot")'));
  assert.ok(gameJs.includes('mountHotKeys($("gameHotKeysSlot")'));
  assert.ok(!/toLowerCase\(\) === "s"/.test(writeJs) && !/toLowerCase\(\) === "f"/.test(writeJs), "solo's own S/F handlers are gone: one dispatcher");
  assert.ok(!/e\.key === "Enter" && \(e\.metaKey \|\| e\.ctrlKey\)\)/.test(gameJs), "the game's own Ctrl+Enter handler is gone");
  const css = read("public/css/base.css");
  assert.ok(css.includes(".hk-btn") && css.includes(".hk-menu.open"), "the ? and its sheet are styled in base.css");
  assert.ok(!/\.hk-menu\.hidden/.test(css), "a class-open popover, never .hidden");
});
