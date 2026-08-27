// The homepage tour (public/js/tour-screens.js): eight chapters, each a
// claim beside a screen rebuilt from the real UI, drawn on theme tokens only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { TOUR, TOUR_THEMES, tourHtml, tourDotsHtml, tourPanelHtml } from "../public/js/tour-screens.js";

test("eight chapters, each with a kicker, a claim and a screen", () => {
  assert.equal(TOUR.length, 8);
  const html = tourHtml();
  TOUR.forEach((ch, i) => {
    assert.ok(html.includes(`id="tour-${ch.id}"`), ch.id + " has its panel");
    assert.ok(html.includes(`<p class="tour-kicker">${ch.kicker.toUpperCase()}</p>`), ch.id + " has its kicker, unnumbered");
    assert.ok(typeof ch.screen() === "string" && ch.screen().length > 200, ch.id + " renders a screen");
  });
  assert.equal((tourDotsHtml().match(/class="tour-dot/g) || []).length, 8, "one rail dot per chapter");
  assert.ok(tourDotsHtml().startsWith('<a class="tour-dot on"'), "the first dot starts lit");
});

test("the screens are themed by tokens: no hard-coded surface colours, only PALETTE writer colours", () => {
  const html = tourHtml();
  // Writer names/avatars may carry their PALETTE colour; nothing else names a hex.
  const hexes = new Set(html.match(/#[0-9a-f]{6}\b/gi).map((h) => h.toLowerCase()));
  for (const h of hexes) assert.ok(["#7dd3fc", "#ff9ecb", "#a78bfa", "#37e0a0"].includes(h), "stray colour " + h);
  assert.ok(!/rgba?\(/.test(html), "no inline rgb() surface colours — surfaces come from the theme");
});

test("the themes screen shows real screenshots and marks nothing 'on' until the page says which", () => {
  const html = tourPanelHtml(TOUR[7], 7);
  for (const [id, label] of TOUR_THEMES) {
    assert.ok(existsSync(new URL(`../public/img/themes/${id}.jpg`, import.meta.url)), id + " has a screenshot");
    assert.ok(html.includes(`data-theme-id="${id}"`) && html.includes(`alt="${label}"`), label);
  }
  assert.ok(!html.includes('class="ts-theme on"'), "the wearing theme is marked at mount time, from data-theme");
  assert.ok(html.includes("+ 8 more"), "counts the rest of the nineteen");
});

test("the gimmick screen's dice ship with the site", () => {
  assert.ok(existsSync(new URL("../public/img/d20.png", import.meta.url)));
  assert.ok(TOUR[5].screen().includes('src="/img/d20.png"'));
});

test("index.html mounts the tour: sticky bar, start section, tour, closing card, and its stylesheet", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf-8");
  for (const id of ["tourBar", "tourDots", "start", "tour", "heroMore", "closeSignup", "closeWatch"]) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(html.includes('href="/css/home.css"'), "the tour stylesheet");
  assert.ok(html.indexOf('id="hero"') < html.indexOf('id="tourBar"') && html.indexOf('id="tourBar"') < html.indexOf('id="authChoice"') && html.indexOf('id="authChoice"') < html.indexOf('id="tour"'), "hero → bar → auth → tour");
  assert.ok(!/<h1[\s>]/.test(html.slice(html.indexOf('<div class="wrap">'))), "the wordmark lives in the hero and the bar, not a page h1");
  const css = readFileSync(new URL("../public/css/home.css", import.meta.url), "utf-8");
  assert.ok(!/#[0-9a-f]{6}/i.test(css.replace(/#ff6b6b/g, "").replace(/#fff\b/g, "")), "home.css is drawn on theme tokens");
});
