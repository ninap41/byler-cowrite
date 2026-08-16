// Editor view preferences. The whole point of this module is that it is NOT
// document content: line spacing lives in the browser, never in the html.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installLocalStorage } from "./client-storage.mjs";

installLocalStorage();
const { loadPrefs, savePrefs, stepLine, LINE_STEPS, DEFAULT_LINE, PAPERS, DEFAULT_PAPER } = await import("../public/js/doc-prefs.js");

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

// ---- paper colour: the same kind of preference as line spacing ----

test("paper defaults to the theme's own colour and round-trips the other two", () => {
  const s = mem();
  assert.deepEqual(PAPERS, ["theme", "light", "dark"]);
  assert.equal(DEFAULT_PAPER, "theme");
  assert.equal(loadPrefs(s).paper, "theme", "nothing stored means the site's own look");
  for (const paper of PAPERS) {
    savePrefs({ paper }, s);
    assert.equal(loadPrefs(s).paper, paper);
  }
});

test("an unknown paper falls back to the theme instead of a blank surface", () => {
  const s = mem();
  for (const junk of ["neon", "", null, 7, "DARK"]) {
    savePrefs({ paper: junk }, s);
    assert.equal(loadPrefs(s).paper, "theme", JSON.stringify(junk));
  }
  s.setItem("cowriteEditorPrefs", '{"paper":"<script>"}');
  assert.equal(loadPrefs(s).paper, "theme", "and it can never reach the DOM as markup");
});

test("the two preferences are stored together — saving one keeps the other", () => {
  const s = mem();
  savePrefs({ lineHeight: 2.0, paper: "dark" }, s);
  const both = loadPrefs(s);
  assert.equal(both.lineHeight, 2.0);
  assert.equal(both.paper, "dark");
  // this is why the page spreads the current prefs into every save
  savePrefs({ ...both, lineHeight: 1.2 }, s);
  assert.equal(loadPrefs(s).paper, "dark", "nudging the line height doesn't reset the paper");
  const dropped = savePrefs({ lineHeight: 1.2 }, s);
  assert.equal(dropped.paper, "theme", "and a save that omits it really does reset it");
});

test("a legacy prefs blob with only a line height still loads", () => {
  const s = mem();
  s.setItem("cowriteEditorPrefs", '{"lineHeight":1.8}');
  assert.deepEqual(loadPrefs(s), { lineHeight: 1.8, paper: "theme" });
});
