// The animation budget: what may run forever, and where.
//
// The dashboard used to blink blank while scrolling on every theme. Chrome
// scrolls cheaply only while the page's tiles stay valid; anything that
// repaints every frame invalidates them, so a scroll reveals tiles that
// aren't rasterized yet. Two things did that: infinite CSS animations of
// box-shadow / top (main-thread repaints, a layout pass) in the scrolling
// content, and fixed chrome with backdrop-filter, which re-composites the
// strip beneath it on every scroll frame, on every page. This test keeps
// both from creeping back, and pins the helper that pauses GSAP loops off
// screen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { installDom } from "./dom.mjs";

const root = new URL("..", import.meta.url).pathname;
const css = (f) => readFileSync(join(root, "public/css", f), "utf-8");
const SHEETS = ["base.css", "dashboard.css", "home.css"];
// what the compositor animates without a repaint
const COMPOSITED = new Set(["opacity", "transform"]);

// every `animation:`/`animation-name:` declaration that runs forever, with
// the selector of the rule it sits in and the keyframes it names
function infiniteAnimations(src) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g; // flat rules; @media wrappers just nest one level
  for (const m of src.matchAll(re)) {
    const sel = m[1].trim().split("\n").pop().trim();
    const body = m[2];
    for (const d of body.matchAll(/animation(?:-name)?:\s*([^;]+);/g)) {
      const value = d[1];
      if (!/\binfinite\b/.test(value) && !/animation-iteration-count:\s*infinite/.test(body)) continue;
      const names = value.split(",").map((part) => part.trim().split(/\s+/)[0]).filter((n) => n && n !== "none");
      for (const name of names) out.push({ sel, name });
    }
  }
  return out;
}
function keyframeProps(src, name) {
  const i = src.indexOf(`@keyframes ${name} {`);
  if (i < 0) return null;
  let depth = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) break;
  }
  const body = src.slice(i, j);
  return [...new Set([...body.matchAll(/(?:^|[{;\s])([a-z-]+)\s*:/g)].map((m) => m[1]))];
}

test("an infinite CSS animation in the page animates only opacity and transform", () => {
  const offenders = [];
  for (const f of SHEETS) {
    const src = css(f);
    for (const { sel, name } of infiniteAnimations(src)) {
      // the theme backgrounds are a fixed layer BEHIND the page (and
      // display: none when their theme isn't worn); they are not in the
      // scrolling content and get their own budget
      if (/\.bg-set\b/.test(sel)) continue;
      const props = keyframeProps(src, name) ?? keyframeProps(css("base.css"), name);
      if (!props) continue; // keyframes defined elsewhere (vendor) — not ours to judge
      const bad = props.filter((p) => !COMPOSITED.has(p));
      if (bad.length) offenders.push(`${f}: ${sel} → @keyframes ${name} animates ${bad.join(", ")}`);
    }
  }
  assert.deepEqual(offenders, [], "move the effect to a pseudo-element and animate its opacity/transform");
});

test("the fixed and sticky chrome never blurs what scrolls beneath it", () => {
  const src = css("base.css");
  // the solo editor's two sticky panels are chrome too: a backdrop blur on
  // them re-samples the prose and the theme art every scroll frame
  for (const sel of [".user-chip", ".theme-toggle", ".hamburger", ".foot-bar", ".doc-shell", ".doc-side-card"]) {
    const i = src.indexOf(`\n${sel} {\n`);
    assert.ok(i >= 0, sel + " rule found");
    const body = src.slice(i, src.indexOf("\n}\n", i));
    assert.doesNotMatch(body, /backdrop-filter: blur/, sel + " carries no backdrop blur");
    assert.match(body, /var\(--panel-solid\)/, sel + " stands on the solid surface instead");
  }
  assert.match(src, /--panel-solid: color-mix\(in srgb, var\(--bg-2\) \d+%, var\(--panel\)\)/, "the surface is derived from each theme's own tokens");
});

test("a GSAP loop lives only where it is paused off screen (or behind the page)", () => {
  const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : []; });
  const ALLOWED = new Set(["theme.ts", "components/tendril-border.ts", "pages/dashboard.ts"]);
  for (const f of walk(join(root, "client"))) {
    const rel = f.slice(join(root, "client").length + 1);
    const src = readFileSync(f, "utf-8");
    if (!/repeat:\s*-1/.test(src)) continue;
    assert.ok(ALLOWED.has(rel), `${rel} runs a GSAP loop: either put it behind the page (theme.ts) or gate it with whenVisible and list it here`);
    if (rel !== "theme.ts") assert.match(src, /whenVisible\(/, rel + " gates its loop with whenVisible");
  }
});

// ---- the helper itself, on jsdom with a fake IntersectionObserver ----
installDom();
const { whenVisible } = await import("../public/js/components/when-visible.js");

test("whenVisible: shows while on screen in a visible tab, hides when either stops, stops cleanly", () => {
  const seen = [];
  let cb = null, observed = null, disconnected = false;
  class FakeIO {
    constructor(fn) { cb = fn; }
    observe(el) { observed = el; }
    disconnect() { disconnected = true; }
  }
  const el = document.createElement("div");
  document.body.appendChild(el);
  const stop = whenVisible(el, { onShow: () => seen.push("show"), onHide: () => seen.push("hide") }, { IntersectionObserver: FakeIO });
  assert.equal(observed, el);
  assert.deepEqual(seen, [], "nothing is reported until the observer speaks");
  cb([{ isIntersecting: true }]);
  assert.deepEqual(seen, ["show"]);
  cb([{ isIntersecting: true }]);
  assert.deepEqual(seen, ["show"], "no repeat while the state holds");
  cb([{ isIntersecting: false }]);
  assert.deepEqual(seen, ["show", "hide"], "scrolled away");
  cb([{ isIntersecting: true }]);
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
  assert.deepEqual(seen, ["show", "hide", "show", "hide"], "a background tab hides it too");
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
  assert.deepEqual(seen, ["show", "hide", "show", "hide", "show"]);
  stop();
  assert.ok(disconnected);
  document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(seen.length, 5, "nothing after stop");
});

test("whenVisible: without IntersectionObserver the element counts as on screen and only the tab gates it", () => {
  const seen = [];
  const el = document.createElement("div");
  const stop = whenVisible(el, { onShow: () => seen.push("show"), onHide: () => seen.push("hide") }, {});
  assert.deepEqual(seen, ["show"], "settled at once");
  stop();
});
