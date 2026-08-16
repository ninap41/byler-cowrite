// Editor view preferences. The whole point of this module is that it is NOT
// document content: line spacing lives in the browser, never in the html.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installLocalStorage } from "./client-storage.mjs";

installLocalStorage();
const { loadPrefs, savePrefs, stepLine, LINE_STEPS, DEFAULT_LINE } = await import("../public/js/doc-prefs.js");

const mem = () => {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
};

test("defaults to the editor's own line height when nothing is stored", () => {
  assert.equal(loadPrefs(mem()).lineHeight, DEFAULT_LINE);
});

test("round-trips a preference", () => {
  const s = mem();
  savePrefs({ lineHeight: 2.0 }, s);
  assert.equal(loadPrefs(s).lineHeight, 2.0);
});

test("the ladder bottoms out at 0.8 — tight line spacing is allowed", () => {
  const s = mem();
  assert.equal(LINE_STEPS[0], 0.8);
  assert.equal(savePrefs({ lineHeight: 0.8 }, s).lineHeight, 0.8, "0.8 is valid, not clamped away");
  assert.equal(savePrefs({ lineHeight: 0.5 }, s).lineHeight, 0.8, "below the floor clamps to it");
});

test("clamps anything absurd or unparseable to the ladder's range", () => {
  const s = mem();
  const lo = LINE_STEPS[0];
  const hi = LINE_STEPS[LINE_STEPS.length - 1];
  assert.equal(savePrefs({ lineHeight: 99 }, s).lineHeight, hi);
  assert.equal(savePrefs({ lineHeight: -5 }, s).lineHeight, lo);
  assert.equal(savePrefs({ lineHeight: "nonsense" }, s).lineHeight, DEFAULT_LINE);
  assert.equal(savePrefs({}, s).lineHeight, DEFAULT_LINE);
});

test("survives unreadable storage", () => {
  const s = mem();
  s.setItem("cowriteEditorPrefs", "{not json");
  assert.equal(loadPrefs(s).lineHeight, DEFAULT_LINE, "garbage falls back, doesn't throw");
  const broken = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("quota"); },
    removeItem: () => {},
  };
  assert.equal(loadPrefs(broken).lineHeight, DEFAULT_LINE);
  assert.doesNotThrow(() => savePrefs({ lineHeight: 1.8 }, broken));
});

test("stepping walks the ladder and stops at both ends", () => {
  const lo = LINE_STEPS[0];
  const hi = LINE_STEPS[LINE_STEPS.length - 1];
  assert.equal(stepLine(LINE_STEPS[0], 1), LINE_STEPS[1]);
  assert.equal(stepLine(LINE_STEPS[1], -1), LINE_STEPS[0]);
  assert.equal(stepLine(lo, -1), lo, "cannot go below the first step");
  assert.equal(stepLine(hi, 1), hi, "cannot go above the last step");
  // an off-ladder starting value snaps to the next step in that direction
  assert.equal(stepLine(1.7, 1), 1.8);
  assert.equal(stepLine(1.7, -1), 1.6);
});
