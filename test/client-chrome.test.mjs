import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installDom } from "./dom.mjs";

installDom();
const { mountChrome, mountKofi, KOFI_ACCOUNT, KOFI_CONFIG } = await import("../public/js/chrome.js");
const { THEMES, THEME_LABELS, initTheme } = await import("../public/js/theme.js");

test("theme registry: all nine themes present with labels", () => {
  assert.equal(THEMES.length, 9);
  for (const id of ["neon", "aurora", "ink", "wall", "snowball", "upside", "starcourt", "arcade", "cerebro"])
    assert.ok(THEMES.includes(id), id + " registered");
  assert.equal(THEME_LABELS.wall, "The Wall");
  assert.equal(THEME_LABELS.snowball, "Snow Ball");
  assert.equal(THEME_LABELS.upside, "Upside Down");
  assert.equal(THEME_LABELS.starcourt, "Starcourt");
  assert.equal(THEME_LABELS.arcade, "Palace Arcade");
  assert.equal(THEME_LABELS.cerebro, "Cerebro");
});

test("background layers sit behind the UI and never intercept clicks", () => {
  const css = readFileSync(new URL("../public/css/base.css", import.meta.url), "utf-8");
  const layerBlock = css.slice(css.indexOf(".bg-layers {"), css.indexOf(".bg-wash"));
  assert.ok(layerBlock.includes("z-index: -1"), "layers stack behind all content");
  assert.ok(/\.bg-layers,\s*\n\.bg-layers \* \{\s*\n\tpointer-events: none !important;/.test(css),
    "every layer descendant is click-transparent");
});

test("every theme has CSS tokens, a background set, and a picker swatch", () => {
  const css = readFileSync(new URL("../public/css/base.css", import.meta.url), "utf-8");
  for (const id of THEMES) {
    assert.ok(css.includes(`[data-theme="${id}"] {`), id + " token block");
    assert.ok(css.includes(`[data-theme="${id}"] .bg-set.${id}`), id + " background reveal rule");
    assert.ok(css.includes(`.sw-${id}`), id + " swatch");
  }
});

test("chrome menu lists every theme and switching updates data-theme + storage", () => {
  document.body.innerHTML = "";
  localStorage.removeItem("cowriteTheme");
  const theme = mountChrome({ page: "game" });
  const buttons = [...document.querySelectorAll("[data-theme-btn]")];
  assert.equal(buttons.length, THEMES.length, "one menu entry per theme");
  for (const id of THEMES) {
    assert.ok(buttons.some((b) => b.getAttribute("data-theme-btn") === id), id + " button");
    assert.ok(document.querySelector(`.bg-set.${id}`), id + " background layers injected");
  }
  // intensified scenery layers
  assert.equal(document.querySelectorAll(".bg-set.arcade .galaga").length, 4, "galaga fleet");
  assert.ok(document.querySelector(".bg-set.arcade .ship") && document.querySelector(".bg-set.arcade .shot"));
  assert.equal(document.querySelectorAll(".bg-set.starcourt .tri").length, 2, "starcourt triangles");
  assert.equal(document.querySelectorAll(".bg-set.starcourt .ring").length, 2, "starcourt circles");
  assert.equal(document.querySelectorAll(".bg-set.starcourt .zig").length, 2, "starcourt zigzags");
  assert.ok(document.querySelector(".bg-set.starcourt .memdots"), "starcourt dot grid");
  assert.equal(document.querySelectorAll(".bg-set.upside .dust").length, 3, "upside dust layers");
  assert.ok(document.querySelector(".bg-set.upside .vines") && document.querySelectorAll(".bg-set.upside .mtn").length === 2,
    "upside landscape: vines + two mountain ridges");
  assert.equal(document.querySelectorAll(".bg-set.wall .lights").length, 2, "chasing light strings");
  theme.applyTheme("snowball");
  assert.equal(document.documentElement.getAttribute("data-theme"), "snowball");
  assert.equal(localStorage.getItem("cowriteTheme"), "snowball");
  assert.equal(theme.current, "snowball");
  assert.ok(document.querySelector('[data-theme-btn="snowball"]').classList.contains("active"));
  assert.equal(document.getElementById("themeCurLabel").textContent, "Snow Ball");
});

test("mountChrome injects shared chrome + the ko-fi widget loader", () => {
  document.body.innerHTML = "";
  mountChrome({ page: "dashboard" });
  assert.ok(document.querySelector(".bg-layers"), "background layers injected");
  assert.ok(document.getElementById("navDrawer"), "nav drawer injected");
  assert.ok(document.getElementById("themeSwitch"), "theme switch injected");
  assert.equal(document.querySelector('#navDrawer a[aria-current="page"]').getAttribute("href"), "/dashboard");
  const s = document.querySelector('script[src^="https://storage.ko-fi.com/"]');
  assert.ok(s, "ko-fi loader script appended");
  assert.equal(s.async, true);
});

test("ko-fi widget draws with the right account + floating-chat config once loaded", () => {
  document.body.innerHTML = "";
  const calls = [];
  window.kofiWidgetOverlay = { draw: (acct, cfg) => calls.push({ acct, cfg }) };
  const s = mountKofi(document);
  s.onload(); // simulate the CDN script arriving
  assert.equal(calls.length, 1, "widget rendered");
  assert.equal(calls[0].acct, "justthegatekeeper");
  assert.equal(calls[0].acct, KOFI_ACCOUNT);
  assert.equal(calls[0].cfg.type, "floating-chat");
  assert.equal(calls[0].cfg["floating-chat.donateButton.text"], "Support me");
  assert.equal(calls[0].cfg["floating-chat.donateButton.background-color"], "#00b9fe");
  assert.equal(calls[0].cfg["floating-chat.donateButton.text-color"], "#fff");
  assert.deepEqual(calls[0].cfg, KOFI_CONFIG);
  delete window.kofiWidgetOverlay;
});

test("ko-fi loader survives the CDN script failing to define the overlay", () => {
  document.body.innerHTML = "";
  const s = mountKofi(document);
  s.onload(); // no kofiWidgetOverlay global -> must not throw
});
