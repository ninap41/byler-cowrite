// The solo editor's banners (components/doc-banner.ts): the pure builder and
// the mount — register once, show/hide by id, remeasure on every change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { bannerHtml, mountDocBanners } from "../public/js/components/doc-banner.js";

const spec = (over = {}) => ({
  id: "restoreBar",
  html: "You have unsaved changes.",
  actions: [
    { id: "restoreYes", label: "Restore them", primary: true, onClick: () => {} },
    { id: "restoreNo", label: "Discard", onClick: () => {} },
  ],
  ...over,
});

test("bannerHtml: hidden strip, note or warn tone, ghost + linky buttons, labels escaped", () => {
  const h = bannerHtml(spec());
  assert.match(h, /^<div class="doc-banner hidden" id="restoreBar">/);
  assert.match(h, /<span>You have unsaved changes.<\/span>/);
  assert.match(h, /<button class="ghost" id="restoreYes" type="button">Restore them<\/button>/);
  assert.match(h, /<button class="linky" id="restoreNo" type="button">Discard<\/button>/);
  const w = bannerHtml(spec({ id: "conflictBar", kind: "warn", html: "<b>Changed</b> elsewhere.", actions: [{ id: "x", label: "Save & go", onClick: () => {} }] }));
  assert.match(w, /^<div class="doc-banner warn hidden" id="conflictBar" role="alert">/, "a warning is an alert");
  assert.match(w, /<b>Changed<\/b> elsewhere\./, "the message is html");
  assert.match(w, />Save &amp; go</, "a label is text");
});

test("mountDocBanners: add wires the actions; show/hide toggle .hidden and report a change once", () => {
  const dom = new JSDOM('<div id="host"></div>');
  const host = dom.window.document.getElementById("host");
  let changes = 0, yes = 0;
  const b = mountDocBanners(host, { onChange: () => changes++ });
  b.add(spec({ actions: [{ id: "restoreYes", label: "Restore", primary: true, onClick: () => yes++ }] }));
  const bar = dom.window.document.getElementById("restoreBar");
  assert.ok(bar.classList.contains("hidden"), "born hidden");
  assert.equal(b.shown("restoreBar"), false);
  b.show("restoreBar");
  assert.ok(!bar.classList.contains("hidden"));
  assert.equal(b.shown("restoreBar"), true);
  b.show("restoreBar");
  assert.equal(changes, 1, "showing a shown banner is a no-op");
  dom.window.document.getElementById("restoreYes").click();
  assert.equal(yes, 1, "the action fires");
  b.hide("restoreBar");
  b.hide("restoreBar");
  assert.ok(bar.classList.contains("hidden"));
  assert.equal(changes, 2);
  b.show("nope");
  assert.equal(changes, 2, "an unknown id does nothing");
});

test("the write page mounts both banners through the component, and nothing else paints them", () => {
  const js = readFileSync(new URL("../public/js/pages/write.js", import.meta.url), "utf8");
  assert.match(js, /mountDocBanners\(/);
  assert.match(js, /id: "restoreBar"/);
  assert.match(js, /id: "conflictBar"/);
  assert.match(js, /kind: "warn"/, "the conflict is the warning tone");
  assert.ok(!/\$\("(restoreBar|conflictBar)"\)\.classList/.test(js), "the page never toggles a banner by hand");
});
