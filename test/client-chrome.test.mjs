import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installDom } from "./dom.mjs";

installDom();
const { mountChrome, mountKofi, setUserChip, KOFI_ACCOUNT, KOFI_EMBED, KOFI_PAGE } = await import("../public/js/chrome.js");
const { THEMES, THEME_LABELS, initTheme, themeAllowed, lockTip, DEFAULT_THEME } = await import("../public/js/theme.js");

test("theme registry: all nineteen themes present with labels", () => {
  assert.equal(THEMES.length, 19);
  for (const id of [
    "neon", "aurora", "ink", "wall", "snowball", "upside", "starcourt", "arcade", "cerebro",
    "hawkinslab", "castlebyers", "vecna", "void", "video", "hellfire", "rink", "cleradin", "bunker", "clouds",
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
  assert.equal(THEME_LABELS.cleradin, "Cleradin");
  assert.equal(THEME_LABELS.bunker, "Russian Bunker");
  assert.equal(THEME_LABELS.clouds, "I Miss the Clouds");
});

test("previewTheme wears a theme for this page only: nothing saved, the gate never steps back from it, a real pick ends it", () => {
  document.body.innerHTML = "";
  localStorage.setItem("cowriteTheme", "neon");
  const theme = mountChrome({ page: "write" });
  assert.equal(theme.current, "neon");
  theme.previewTheme("vecna");
  assert.equal(document.documentElement.getAttribute("data-theme"), "vecna");
  assert.equal(theme.current, "vecna");
  assert.equal(localStorage.getItem("cowriteTheme"), "neon", "the visitor's own theme is untouched");
  // the author's theme may be one the reader hasn't unlocked — it stays on
  theme.setGate({ locks: { vecna: "Rank 9" }, unlocked: [] });
  assert.equal(document.documentElement.getAttribute("data-theme"), "vecna", "the gate leaves a preview alone");
  theme.previewTheme("not-a-theme");
  assert.equal(theme.current, "vecna", "junk is ignored");
  theme.applyTheme("snowball");
  assert.equal(localStorage.getItem("cowriteTheme"), "snowball", "a pick in the menu saves as ever");
  theme.setGate({ locks: { snowball: "Rank 9" }, unlocked: [] });
  assert.equal(theme.current, DEFAULT_THEME, "and a locked pick is stepped back from, as ever");
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
  assert.ok(!document.querySelector(".bg-set.upside .vines") && document.querySelectorAll(".bg-set.upside .mtn").length === 1,
    "upside landscape: one traced svg mountain range, vines removed");
  assert.equal(document.querySelectorAll(".bg-set.wall .lights").length, 2, "chasing light strings");
  theme.applyTheme("snowball");
  assert.equal(document.documentElement.getAttribute("data-theme"), "snowball");
  assert.equal(localStorage.getItem("cowriteTheme"), "snowball");
  assert.equal(theme.current, "snowball");
  assert.ok(document.querySelector('[data-theme-btn="snowball"]').classList.contains("active"));
  assert.equal(document.getElementById("themeCurLabel").textContent, "Snow Ball");
});

test("the theme menu's Font row overrides the site font: data-font + storage, survives a theme change", async () => {
  const { SITE_FONTS } = await import("../public/js/fonts.js");
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-font");
  localStorage.removeItem("cowriteTheme");
  localStorage.removeItem("cowriteFont");
  const theme = mountChrome({ page: "dashboard" });
  const pick = document.getElementById("themeFont");
  assert.ok(pick && document.getElementById("themeMenu").contains(pick), "the flip select lives inside the theme menu");
  assert.ok(pick.classList.contains("flip-select"), "a flip menu, not a native select, each row previews its own face");
  assert.ok(!pick.closest("[data-theme-btn]"), "and is not a theme row (setGate never rewrites it)");
  const rows = [...document.querySelectorAll("#themeFontMenu [data-val]")];
  assert.equal(rows[0].dataset.val, "theme");
  assert.equal(rows[0].textContent, "Theme default");
  assert.deepEqual(rows.slice(1).map((o) => o.dataset.val), SITE_FONTS.map((f) => f.key), "one row per site font, registry order");
  for (const f of SITE_FONTS) {
    const o = rows.find((x) => x.dataset.val === f.key);
    assert.equal(o.textContent, f.label);
    assert.ok(o.getAttribute("style").includes("font-family:"), f.key + " previews itself in its own face");
  }
  // fresh browser: no override
  assert.equal(theme.font, "theme");
  assert.equal(document.documentElement.getAttribute("data-font"), null);
  // pick one from the menu itself: open the theme menu, open the font list
  // (it lifts to <body> — a portal — so it can fold past the menu's edge and
  // scroll on its own), choose a row
  document.getElementById("themeToggle").click();
  document.getElementById("themeFontToggle").click();
  const list = document.getElementById("themeFontMenu");
  assert.equal(list.parentNode, document.body, "open: the list is portaled to <body>");
  assert.ok(list.classList.contains("flip-portal") && list.classList.contains("open"));
  list.querySelector('[data-val="georgia"]').click();
  assert.equal(document.documentElement.getAttribute("data-font"), "georgia");
  assert.equal(localStorage.getItem("cowriteFont"), "georgia");
  assert.equal(theme.font, "georgia");
  assert.ok(document.getElementById("themeFontCur").getAttribute("style").includes("Georgia"), "the closed toggle wears the choice");
  assert.ok(document.getElementById("themeSwitch").classList.contains("open"), "picking a font keeps the theme menu open");
  assert.equal(list.parentNode, pick, "closed: the list is home again");
  // a theme change leaves the font alone, and vice versa
  theme.applyTheme("snowball");
  assert.equal(document.documentElement.getAttribute("data-font"), "georgia");
  assert.equal(document.documentElement.getAttribute("data-theme"), "snowball");
  // back to the theme's own face
  theme.applyFont("theme");
  assert.equal(document.documentElement.getAttribute("data-font"), null);
  assert.equal(localStorage.getItem("cowriteFont"), null);
  assert.equal(document.getElementById("themeFontCur").textContent, "Theme default");
  assert.equal(document.getElementById("themeFontCur").getAttribute("style"), "");
});

test("a saved site font is applied on mount; junk in storage is dropped, not worn", () => {
  document.body.innerHTML = "";
  localStorage.setItem("cowriteFont", "verdana");
  let theme = mountChrome({ page: "dashboard" });
  assert.equal(theme.font, "verdana");
  assert.equal(document.documentElement.getAttribute("data-font"), "verdana");
  assert.equal(document.getElementById("themeFontCur").textContent, "Verdana");
  document.body.innerHTML = "";
  localStorage.setItem("cowriteFont", "comic-sans-forever");
  document.documentElement.setAttribute("data-font", "comic-sans-forever"); // what the head script would have done
  theme = mountChrome({ page: "dashboard" });
  assert.equal(theme.font, "theme");
  assert.equal(document.documentElement.getAttribute("data-font"), null, "initTheme validates what the head script trusted");
  assert.equal(localStorage.getItem("cowriteFont"), null);
  localStorage.removeItem("cowriteFont");
});

test("mountChrome injects shared chrome + the foot bar", () => {
  document.body.innerHTML = "";
  mountChrome({ page: "dashboard" });
  assert.ok(document.querySelector(".bg-layers"), "background layers injected");
  assert.ok(document.getElementById("navDrawer"), "nav drawer injected");
  assert.ok(document.getElementById("themeSwitch"), "theme switch injected");
  assert.equal(document.querySelector('#navDrawer a[aria-current="page"]').getAttribute("href"), "/dashboard");
  // The drawer is site pages only — everything you DO lives in the dashboard rail's flyouts.
  assert.deepEqual([...document.querySelectorAll("#navDrawer a")].map((a) => a.getAttribute("href")), ["/dashboard", "/announcements", "/stories", "/ranks", "/admin"]);
  assert.ok(!document.querySelector("#navDrawer .nav-sep"), "no separators in a four-row menu");
  assert.ok(document.getElementById("navAdmin").classList.contains("hidden"), "Admin hides until the account says so");
  setUserChip({ username: "kip", admin: true });
  assert.ok(!document.getElementById("navAdmin").classList.contains("hidden"));
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

test("a locked theme can't be worn: by click, by call, or by stale localStorage", () => {
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

test("the two rebuilt backgrounds ship the layers their themes animate", () => {
  const chrome = readFileSync(new URL("../public/js/chrome.js", import.meta.url), "utf-8");
  // Cleradin: the distant keep and the tower, each declaring how far it parallaxes
  assert.ok(chrome.includes('class="castle c-far" data-par="0.08"'), "the distant keep creeps");
  // the tower's rate is not a number in the markup: it is derived from the page
  assert.ok(chrome.includes('class="tower" data-par="auto"'), "the tower measures itself");
  assert.ok(chrome.includes('class="bg-set cleradin"') && chrome.includes("towerSvg()"));
  // Crazy Together: four cloud bands, back (palest) to front
  const depths = [...chrome.matchAll(/class="cloud-band" data-depth="(\d)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(depths, [0, 1, 2, 3], "four bands, in depth order");
  assert.ok(!chrome.includes("pollywog") && !chrome.includes('bg-set camp'), "the old sets are gone");
});

test("the Cleradin tower is drawn from its own numbers, part by part", async () => {
  const { towerSvg, TOWER, radiusAt, bow, lancet } = await import("../public/js/components/cleradin-tower.js");
  const svg = towerSvg();
  // every named part is present and separately editable
  for (const id of ["shaft", "openings", "door", "moss", "balcony", "roof", "dormer", "spire"])
    assert.ok(svg.includes(`id="cl-${id}"`), id + " group");
  // back to front: the roof is drawn after the shaft it sits on, the flag last
  assert.ok(svg.indexOf('id="cl-shaft"') < svg.indexOf('id="cl-roof"'));
  assert.ok(svg.indexOf('id="cl-roof"') < svg.indexOf('id="cl-spire"'));
  // the shaft tapers: narrower at the top than at the foot, and monotonically
  assert.ok(radiusAt(TOWER.shaftTopY) < radiusAt(TOWER.shaftBottomY));
  assert.ok(radiusAt(500) < radiusAt(700) && radiusAt(700) < radiusAt(TOWER.shaftBottomY));
  // the stair band is gone on purpose: plain stone, no diagonal stripes
  assert.ok(!svg.includes("cl-spiral") && !svg.includes("cl-tread"), "no spiral band");
  // shared shapes, not copy-paste: the bow and the lancet are functions
  assert.match(bow(100, 40, 120), /^M 80 100 Q 120 116 160 100$/);
  assert.ok(lancet(50, 100, 20, 30, "x").includes('class="x"'));
  // it is a drawing, not a document: no ids that could collide with the page
  assert.ok(!/\sid="(?!cl-)/.test(svg), "every id is namespaced cl-");
});


test("Vecna's clock is a grandfather clock, and its pendulum still swings", async () => {
  const { clockSvg, CLOCK } = await import("../public/js/components/vecna-clock.js");
  const svg = clockSvg();
  for (const id of ["case", "glass", "dial"]) assert.ok(svg.includes(`id="vc-${id}"`), id + " group");
  // the case reads as one object: nothing hangs off it, nothing perches on top
  assert.ok(!/vc-vine|vc-pediment|vc-finial/.test(svg), "no vines and no cornice ornament");
  // a long case is stacked boxes, each narrower than the one under it
  assert.ok(CLOCK.waistHalf < CLOCK.hoodHalf && CLOCK.waistHalf < CLOCK.baseHalf, "the waist is the narrow part");
  // twelve numerals, the clockmaker's IIII among them
  assert.ok(svg.includes(">XII<") && svg.includes(">IIII<") && svg.includes(">IX<"));
  assert.equal(svg.match(/class="vc-num"/g).length, 12);
  // the pendulum hangs inside the door and is clipped by it, so the bob passes
  // out of sight at the extremes the way it does behind a real case
  assert.ok(svg.includes('clip-path="url(#vc-door)"') && svg.indexOf('id="vc-pend"') > svg.indexOf("vc-door"));
  const css = readFileSync(new URL("../public/css/base.css", import.meta.url), "utf-8");
  const swing = css.slice(css.indexOf(".bg-set.vecna #vc-pend"), css.indexOf("@keyframes vc-swing") + 120);
  assert.ok(swing.includes(`transform-origin: ${CLOCK.cx}px ${CLOCK.pivotY}px`), "hinged at the pivot, not the middle");
  assert.ok(swing.includes("prefers-reduced-motion") === false, "the guard is outside this slice");
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{\n\t\.bg-set\.vecna #vc-pend/, "it only swings when motion is welcome");
  // the chrome mounts it, and the old ghost dial stays as sky behind it
  const chrome = readFileSync(new URL("../public/js/chrome.js", import.meta.url), "utf-8");
  assert.ok(chrome.includes('class="grandfather"') && chrome.includes("clockSvg()"));
  assert.ok(chrome.includes('class="clockface"'), "the turning dial is still the sky");
});

test("Castle Byers stands on ground, and the ground is under the fort", () => {
  const chrome = readFileSync(new URL("../public/js/chrome.js", import.meta.url), "utf-8");
  const set = chrome.slice(chrome.indexOf('class="bg-set castlebyers"'), chrome.indexOf('class="bg-set vecna"'));
  assert.ok(set.includes('class="cbground"'), "there is a forest floor");
  assert.ok(set.indexOf("cbground") < set.indexOf("fortpic"), "the fort is planted in it, not floating over it");
  assert.ok(set.indexOf("trees") < set.indexOf("cbground"), "and the treeline is behind both");
});

test("anything the markup calls hidden can actually be hidden", () => {
  // `.hidden { display: none }` sits early in base.css, so ANY later rule that
  // sets `display:` on a class of equal specificity silently outranks it — the
  // stories toolbar (.chat-row) and the guided knobs (.guided-controls) both
  // stayed on screen that way. This is that whole class of bug, caught once.
  const css = readFileSync(new URL("../public/css/base.css", import.meta.url), "utf-8");
  const cut = css.indexOf("\n.hidden {");
  assert.ok(cut > 0, "the generic rule exists");
  const after = css.slice(cut + 1);
  const pages = ["index", "dashboard", "game", "archive", "stories", "profile", "settings", "write", "writes", "admin", "inbox", "games"];
  const chrome = readFileSync(new URL("../public/js/chrome.js", import.meta.url), "utf-8");
  const sources = [chrome, ...pages.map((p) => readFileSync(new URL(`../public/${p}.html`, import.meta.url), "utf-8"))];

  const offenders = new Set();
  for (const src of sources)
    for (const [, attr] of src.matchAll(/class="([^"]*\bhidden\b[^"]*)"/g))
      for (const cls of attr.split(/\s+/).filter((c) => c && c !== "hidden")) {
        // does a later rule give this class its own display?
        const rule = new RegExp(`(^|,|\\})\\s*\\.${cls.replace(/[.*+?^$()|[\]\\]/g, "\\$&")}\\s*(,[^{]*)?\\{[^}]*display:`, "m");
        if (!rule.test(after)) continue;
        // ...and if so, is it re-hidden at the same specificity?
        if (!after.includes(`.${cls}.hidden`)) offenders.add(cls);
      }
  assert.deepEqual([...offenders], [], "these classes outrank .hidden and need a `.CLASS.hidden { display: none }`");
});

test("with GSAP loaded, the Font list and the theme menu both keep transition:none across a close, so a second open is GSAP's alone; closing the theme menu lands the font list", () => {
  // a synchronous stand-in: every tween completes on the spot
  const calls = [];
  window.gsap = {
    to: (t, v) => { calls.push(["to", v]); v.onComplete?.(); return {}; },
    fromTo: (t, a, v) => { calls.push(["fromTo", v]); v.onComplete?.(); return {}; },
    set: (t, v) => {
      calls.push(["set", v]);
      const els = t?.nodeType === 1 ? [t] : typeof t === "string" ? [...document.querySelectorAll(t)] : [...(t || [])];
      for (const el of els) {
        if (v.clearProps === "all") el.removeAttribute("style");
        else if (v.clearProps) for (const p of v.clearProps.split(",")) el.style[p.trim()] = "";
        if (v.visibility) el.style.visibility = v.visibility;
      }
    },
    killTweensOf: () => {},
  };
  try {
    document.body.innerHTML = "";
    localStorage.removeItem("cowriteFont");
    mountChrome({ page: "dashboard" });
    const sw = document.getElementById("themeSwitch");
    const themeMenu = document.getElementById("themeMenu");
    const pick = document.getElementById("themeFont");
    const list = document.getElementById("themeFontMenu");
    const toggle = pick.querySelector(".flip-toggle");
    document.getElementById("themeToggle").click();
    assert.ok(sw.classList.contains("open"));
    toggle.click(); // open the font list
    assert.equal(list.parentNode, document.body, "portaled while open");
    toggle.click(); // close it
    assert.equal(list.parentNode, pick, "home after close");
    assert.equal(list.style.transition, "none", "the CSS fallback transition stays off under GSAP");
    toggle.click(); // second open must still portal + open
    assert.equal(list.parentNode, document.body);
    assert.ok(list.classList.contains("open"));
    // closing the theme menu takes the font list with it
    document.getElementById("themeToggle").click();
    assert.ok(!sw.classList.contains("open"));
    assert.equal(list.parentNode, pick, "the font list never outlives the menu");
    assert.equal(themeMenu.style.transition, "none", "the theme menu keeps transition:none too");
    assert.ok(!calls.some(([, v]) => v.clearProps === "all"), "no tween clears every inline prop");
  } finally {
    delete window.gsap;
  }
});
