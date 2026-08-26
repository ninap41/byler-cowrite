// The announcement's border (components/tendril-border.js): the pure frame
// geometry and the mount's wiring on jsdom with a stub GSAP (jsdom has no
// getTotalLength and runs no rAF): entrance, then the gradient glimmer loop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.mjs";

installDom();
const { RADIUS, DRAW, SWEEP, frameD, vineSvgHtml, mountTendrilBorder } =
  await import("../public/js/components/tendril-border.js");

test("frameD: a rounded rectangle traced clockwise from the top-left, inset off the edge", () => {
  const d = frameD(300, 100);
  assert.equal(d, `M${1 + RADIUS},1 H${299 - RADIUS} A14,14 0 0 1 299,15 V85 A14,14 0 0 1 285,99 H15 A14,14 0 0 1 1,85 V15 A14,14 0 0 1 15,1 Z`);
  assert.ok(DRAW > 0 && SWEEP > 0);
});

test("vineSvgHtml: glow, line, and a shine stroked by a per-card gradient — no vines", () => {
  const h = vineSvgHtml(3);
  for (const c of ["vine-glow", "vine-line", "vine-shine"]) assert.match(h, new RegExp(`class="${c}"`));
  assert.match(h, /id="vine-grad-3"/);
  assert.match(h, /stroke="url\(#vine-grad-3\)"/);
  assert.doesNotMatch(h, /shoots/);
});

test("mount: the svg goes behind the content, the theme's colours paint the gradient, the entrance hands over to the glimmer loop", () => {
  document.body.innerHTML = `<div class="card" id="c"><p><span class="horn">📣</span> hi</p></div>`;
  const el = document.getElementById("c");
  el.style.setProperty("--accent-2", "#22d3ee");
  el.style.setProperty("--ink", "#f4ecff");
  Object.defineProperty(el, "offsetWidth", { value: 400 });
  Object.defineProperty(el, "offsetHeight", { value: 120 });
  const calls = [];
  let onComplete = null;
  const fakeTl = (opts) => {
    const t = { to: () => t, fromTo: () => t, set: () => t, kill: () => calls.push("kill"), isActive: () => false, progress: () => 1 };
    if (opts?.onComplete) onComplete = opts.onComplete;
    calls.push(opts?.repeat === -1 ? "loop" : "timeline");
    return t;
  };
  const gsap = { set: () => {}, timeline: fakeTl };
  const m = mountTendrilBorder(el, { horn: el.querySelector(".horn"), gsap });
  assert.equal(el.firstElementChild.getAttribute("class"), "vine", "the border sits first, behind the content");
  assert.ok(el.classList.contains("tendril"));
  assert.ok(m.svg.querySelector(".vine-line").getAttribute("d").startsWith("M"), "the frame is built");
  assert.equal(m.svg.querySelector(".vg-a").getAttribute("stop-color"), "#22d3ee", "gradient ends are the theme's second accent");
  assert.equal(m.svg.querySelector(".vg-b").getAttribute("stop-color"), "#f4ecff", "its middle is the ink");
  assert.deepEqual(calls, ["timeline"], "the entrance ran once");
  assert.equal(typeof onComplete, "function");
  onComplete();
  assert.ok(calls.includes("loop"), "once the border has drawn, the gradient sweep loops");
  assert.equal(mountTendrilBorder(el, { gsap }), null, "mounts once");
  m.settle();
  assert.equal(m.svg.querySelector(".vine-shine").style.opacity, "0", "settled: plain frame");
  m.destroy();
  assert.equal(el.querySelector(".vine"), null);
});

test("without GSAP the frame simply appears", () => {
  document.body.innerHTML = `<div class="card" id="c2"><p>hi</p></div>`;
  const el = document.getElementById("c2");
  Object.defineProperty(el, "offsetWidth", { value: 300 });
  Object.defineProperty(el, "offsetHeight", { value: 80 });
  const m = mountTendrilBorder(el, { gsap: null });
  assert.equal(m.svg.querySelector(".vine-line").style.strokeDasharray, "none");
  m.destroy();
});
