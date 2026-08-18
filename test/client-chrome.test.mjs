import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installDom } from "./dom.mjs";

installDom();
const { mountChrome, mountKofi, KOFI_ACCOUNT, KOFI_EMBED, KOFI_PAGE } = await import("../public/js/chrome.js");
const { THEMES, THEME_LABELS, initTheme, themeAllowed, lockTip, DEFAULT_THEME } = await import("../public/js/theme.js");

test("theme registry: all nineteen themes present with labels", () => {
  assert.equal(THEMES.length, 19);
  for (const id of [
    "neon", "aurora", "ink", "wall", "snowball", "upside", "starcourt", "arcade", "cerebro",
    "hawkinslab", "castlebyers", "vecna", "void", "video", "hellfire", "rink", "camp", "bunker", "pollywog",
  ])
    assert.ok(THEMES.includes(id), id + " registered");
  assert.equal(THEME_LABELS.wall, "The Wall");
  assert.equal(THEME_LABELS.snowball, "Snow Ball");
  assert.equal(THEME_LABELS.upside, "Upside Down");
  assert.equal(THEME_LABELS.starcourt, "Starcourt");
  assert.equal(THEME_LABELS.arcade, "Palace Arcade");
  assert.equal(THEME_LABELS.cerebro, "Cerebro");
  assert.equal(THEME_LABELS.hawkinslab, "Hawkins Lab");
  assert.equal(THEME_LABELS.castlebyers, "Castle Byers");
  assert.equal(THEME_LABELS.vecna, "Vecna's Clock");
  assert.equal(THEME_LABELS.void, "The Void");
  assert.equal(THEME_LABELS.video, "Family Video");
  assert.equal(THEME_LABELS.hellfire, "Hellfire Club");
  assert.equal(THEME_LABELS.rink, "Rink-O-Mania");
  assert.equal(THEME_LABELS.camp, "Camp Know Where");
  assert.equal(THEME_LABELS.bunker, "Russian Bunker");
  assert.equal(THEME_LABELS.pollywog, "The Pollywog");
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
  assert.ok(!document.querySelector(".bg-set.upside .vines") && document.querySelectorAll(".bg-set.upside .mtn").length === 2,
    "upside landscape: two mountain ridges, vines removed");
  assert.equal(document.querySelectorAll(".bg-set.wall .lights").length, 2, "chasing light strings");
  theme.applyTheme("snowball");
  assert.equal(document.documentElement.getAttribute("data-theme"), "snowball");
  assert.equal(localStorage.getItem("cowriteTheme"), "snowball");
  assert.equal(theme.current, "snowball");
  assert.ok(document.querySelector('[data-theme-btn="snowball"]').classList.contains("active"));
  assert.equal(document.getElementById("themeCurLabel").textContent, "Snow Ball");
});

test("mountChrome injects shared chrome + the foot bar", () => {
  document.body.innerHTML = "";
  mountChrome({ page: "dashboard" });
  assert.ok(document.querySelector(".bg-layers"), "background layers injected");
  assert.ok(document.getElementById("navDrawer"), "nav drawer injected");
  assert.ok(document.getElementById("themeSwitch"), "theme switch injected");
  assert.equal(document.querySelector('#navDrawer a[aria-current="page"]').getAttribute("href"), "/dashboard");
  // The two bits of furniture live in one thin strip, not two floating chips.
  assert.ok(document.getElementById("footBar"), "foot bar injected");
  assert.ok(document.getElementById("peekBtn") && document.getElementById("kofiBtn"), "both controls sit in it");
  assert.ok(!document.querySelector(".peek-btn"), "the old floating peek chip is gone");
  assert.ok(!document.querySelector('script[src^="https://storage.ko-fi.com/"]'),
    "and no third-party widget script loads itself onto the page");
});

test("theme peek relabels itself without losing the eye it lives behind", () => {
  document.body.innerHTML = "";
  mountChrome({ page: "dashboard" });
  const btn = document.getElementById("peekBtn");
  btn.click();
  assert.equal(document.body.classList.contains("ui-peek"), true);
  assert.equal(btn.getAttribute("aria-pressed"), "true");
  assert.equal(document.getElementById("peekLabel").textContent, "Show UI");
  btn.click();
  assert.equal(document.body.classList.contains("ui-peek"), false);
  assert.equal(document.getElementById("peekLabel").textContent, "View theme");
});

test("the ko-fi iframe is built only when someone actually asks to tip", () => {
  document.body.innerHTML = '<button id="kofiBtn"></button>';
  const { modal, frame } = mountKofi(document);
  assert.equal(frame.getAttribute("src"), null, "nothing is fetched from ko-fi on a page view");
  assert.ok(modal.classList.contains("hidden"));

  document.getElementById("kofiBtn").click();
  assert.equal(frame.getAttribute("src"), KOFI_EMBED, "the panel loads on the first open");
  assert.ok(KOFI_EMBED.startsWith(KOFI_PAGE) && KOFI_EMBED.includes("embed=true"), "ko-fi's own embeddable panel");
  assert.ok(KOFI_PAGE.endsWith(KOFI_ACCOUNT));
  assert.ok(!modal.classList.contains("hidden"));

  document.getElementById("kofiClose").click();
  assert.ok(modal.classList.contains("hidden"), "the ✕ closes it");
  assert.equal(frame.getAttribute("src"), KOFI_EMBED, "and it isn't refetched on the next open");

  // a way out that doesn't depend on the embed rendering at all
  const out = document.querySelector(".kofi-out");
  assert.equal(out.getAttribute("href"), KOFI_PAGE);
  assert.equal(out.getAttribute("rel"), "noopener noreferrer");
});

test("the user chip is a link to your own profile", () => {
  document.body.innerHTML = "";
  mountChrome();
  const chip = document.getElementById("userChip");
  assert.equal(chip.tagName, "A");
  assert.equal(chip.getAttribute("href"), "/profile"); // no ?user= — /profile is mine
  assert.ok(chip.classList.contains("hidden")); // still hidden until signed in
  // the pieces setUserChip fills in are still inside it
  for (const id of ["ucAvatar", "ucName", "ucBadge"]) assert.ok(chip.querySelector("#" + id), id);
});

// ---- themes as rank rewards ----

const GATE = {
  locks: { vecna: { tier: "clouds", name: "☁️ I miss clouds I miss you", min: 40000 } },
  unlocked: [],
};
const themeBtn = (id) => document.querySelector(`[data-theme-btn="${id}"]`);

test("themeAllowed: unlisted themes are free, listed ones need earning", () => {
  assert.equal(themeAllowed("neon", GATE), true, "not in the lock map at all");
  assert.equal(themeAllowed("vecna", GATE), false);
  assert.equal(themeAllowed("vecna", { ...GATE, unlocked: ["vecna"] }), true);
  // no gate known yet (first paint, or the request failed): nothing is hidden
  assert.equal(themeAllowed("vecna"), true);
  assert.equal(themeAllowed("vecna", {}), true);
});

test("lockTip says which rank earns the theme and what it costs", () => {
  assert.match(lockTip("vecna", GATE.locks), /I miss clouds I miss you/);
  assert.match(lockTip("vecna", GATE.locks), /40,000 words/);
  assert.equal(lockTip("neon", GATE.locks), "", "an unlocked theme has nothing to say");
});

test("setGate marks unearned themes locked and leaves earned ones alone", () => {
  document.body.innerHTML = "";
  localStorage.clear();
  const theme = mountChrome();
  theme.setGate(GATE);

  const locked = themeBtn("vecna");
  assert.ok(locked.classList.contains("locked"));
  assert.equal(locked.getAttribute("aria-disabled"), "true");
  assert.match(locked.dataset.tip, /I miss clouds/);
  assert.match(locked.querySelector("span").textContent, /^🔒 /);

  const free = themeBtn("neon");
  assert.ok(!free.classList.contains("locked"));
  assert.equal(free.dataset.tip, undefined);
  assert.equal(free.querySelector("span").textContent, THEME_LABELS.neon);

  // earning it repaints the same row back to normal
  theme.setGate({ ...GATE, unlocked: ["vecna"] });
  assert.ok(!themeBtn("vecna").classList.contains("locked"));
  assert.equal(themeBtn("vecna").querySelector("span").textContent, THEME_LABELS.vecna);
});

test("a locked theme can't be worn — by click, by call, or by stale localStorage", () => {
  document.body.innerHTML = "";
  localStorage.clear();
  const theme = mountChrome();
  theme.setGate(GATE);

  themeBtn("vecna").dispatchEvent(new window.Event("click", { bubbles: true }));
  assert.notEqual(theme.current, "vecna", "the click does nothing");
  theme.applyTheme("vecna");
  assert.equal(theme.current, DEFAULT_THEME, "and neither does asking directly");

  // an unearned theme left in storage by another account falls back on load
  localStorage.setItem("cowriteTheme", "vecna");
  document.body.innerHTML = "";
  const next = mountChrome();
  next.setGate(GATE);
  assert.equal(next.current, DEFAULT_THEME);
  assert.equal(document.documentElement.getAttribute("data-theme"), DEFAULT_THEME);
});

test("an admin's gate unlocks everything, including what it lists", () => {
  document.body.innerHTML = "";
  localStorage.clear();
  const theme = mountChrome();
  theme.setGate({ locks: GATE.locks, unlocked: Object.keys(GATE.locks) });
  for (const id of THEMES) assert.ok(!themeBtn(id).classList.contains("locked"), id);
  theme.applyTheme("vecna");
  assert.equal(theme.current, "vecna");
});
