// The liquid card (components/liquid-card.js): a rippling squircle drawn
// behind a card in the theme's colours. The geometry is pure and pinned here;
// the mount is checked on jsdom for its wiring (rAF doesn't run there).
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.mjs";

installDom();
const { N, squircle, normals, displace, shape, toPath, liquidSvgHtml, mountLiquidCard, PAD } =
  await import("../public/js/components/liquid-card.js");

test("squircle: N points around the centre, normals point outward, wave stack closes seamlessly", () => {
  const base = squircle(100, 50, 80, 30);
  assert.equal(base.length, N);
  assert.ok(Math.abs(base[0].x - 180) < 1e-9 && Math.abs(base[0].y - 50) < 1e-9, "starts on the right edge");
  const norm = normals(base);
  assert.ok(norm[0].x > 0.99, "the right edge's normal points right");
  assert.ok(norm[Math.floor(N / 4)].y > 0.99, "the bottom edge's normal points down");
  // every harmonic is whole-numbered, so sample N equals sample 0
  assert.ok(Math.abs(displace(0, 1.3) - displace(N, 1.3)) < 1e-9, "the loop closes");
  assert.notEqual(displace(3, 0), displace(3, 2), "and moves with time");
});

test("shape + toPath: rest is the squircle, a ring lifts the edge near it, the path is closed cubics", () => {
  const base = squircle(100, 50, 80, 30), norm = normals(base);
  const rest = shape({ base, norm, amp: 0, t: 0 });
  assert.deepEqual(rest[5], base[5], "no amplitude, no ring: the resting shape");
  const ringed = shape({ base, norm, amp: 0, t: 0, now: 0.05, rings: [{ x: 180, y: 50, born: 0 }] });
  assert.ok(ringed[0].x > base[0].x + 5, "a fresh ring at the right edge pushes it outward");
  assert.deepEqual(shape({ base, norm, amp: 0, t: 0, now: 5, rings: [{ x: 180, y: 50, born: 0 }] })[0], base[0], "a ring older than its life is ignored");
  const d = toPath(rest);
  assert.match(d, /^M[\d.]+,[\d.]+C/);
  assert.ok(d.endsWith("Z"));
  assert.equal((d.match(/C/g) || []).length, N, "one cubic per sample");
});

test("liquidSvgHtml: glow/under/surface/glint/crest, gradients keyed per card", () => {
  const h = liquidSvgHtml(7);
  for (const c of ["lq-glow", "lq-under", "lq-surface", "lq-well", "lq-glint", "lq-clip"]) assert.match(h, new RegExp(`class="${c}"`));
  assert.match(h, /id="lq-body-7"/);
  assert.match(h, /fill="url\(#lq-body-7\)"/);
  assert.notEqual(h, liquidSvgHtml(8), "two cards don't share gradient ids");
  assert.doesNotMatch(h, /lq-crest|stroke=/, "no outline: the blob has no border");
});

test("mountLiquidCard: slips the svg behind the content, paints theme colours, mounts once, destroys clean", () => {
  document.body.innerHTML = `<div class="card" id="c"><p>hi</p></div>`;
  document.documentElement.style.setProperty("--accent", "#ff3ea5");
  const el = document.getElementById("c");
  const m = mountLiquidCard(el);
  assert.ok(el.classList.contains("liquid"));
  assert.equal(el.firstElementChild.getAttribute("class"), "liquid-svg", "the water goes first, behind the content");
  assert.equal(el.querySelector(".lq-content > p").textContent, "hi", "content moved into the clipped wrapper");
  assert.match(el.querySelector(".lq-content").style.clipPath, /url\("?#lq-mask-\d+"?\)/, "the content is clipped to the water");
  assert.ok(m.svg.querySelector(".lq-mask").getAttribute("d").startsWith("M"), "the mask path is painted with the surface");
  assert.equal(m.svg.querySelector(".lq-c2").getAttribute("stop-color"), "#ff3ea5", "the surface is the theme's accent");
  assert.match(m.svg.getAttribute("viewBox"), /^0 0 [\d.]+ [\d.]+$/, "sized to the card (+PAD)");
  assert.ok(m.svg.querySelector(".lq-surface").getAttribute("d").startsWith("M"), "painted at least once");
  assert.equal(mountLiquidCard(el), null, "a second mount is a no-op");
  m.destroy();
  assert.equal(el.querySelector(".liquid-svg"), null);
  assert.equal(el.querySelector(".lq-content"), null, "the wrapper is unwound");
  assert.equal(el.querySelector("p").textContent, "hi");
  assert.ok(!el.classList.contains("liquid"));
  assert.ok(PAD > 0);
});
