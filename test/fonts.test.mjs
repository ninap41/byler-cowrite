// fonts.json is a hand-readable map of theme -> font per role. It is only
// worth having if it's TRUE, so this test re-derives it from base.css and
// theme.js and fails the moment the two drift apart. If you change a theme's
// --font-* value, update fonts.json in the same commit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf-8");

const fonts = JSON.parse(read("fonts.json"));
const css = read("public/css/base.css");
const ROLES = ["display", "body", "story", "mono"];

// theme -> {role: stack}, straight out of the stylesheet
const fromCss = () => {
  const out = {};
  for (const [, name, body] of css.matchAll(/\[data-theme="([a-z]+)"\]\s*\{([\s\S]*?)\n\}/g)) {
    const vars = Object.fromEntries(
      [...body.matchAll(/--font-(display|body|story|mono):([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
    );
    if (ROLES.every((r) => vars[r]) && !out[name]) out[name] = vars;
  }
  return out;
};

test("every theme in theme.js has a font row, and vice versa", () => {
  const themeJs = read("public/js/theme.js");
  const listed = themeJs
    .slice(themeJs.indexOf("export const THEMES = ["), themeJs.indexOf("]", themeJs.indexOf("export const THEMES = [")))
    .match(/"[a-z]+"/g)
    .map((s) => s.replaceAll('"', ""));
  assert.deepEqual(Object.keys(fonts.themes).sort(), [...listed].sort(), "fonts.json covers exactly the real themes");
});

test("fonts.json matches the --font-* values in base.css exactly", () => {
  const css = fromCss();
  assert.deepEqual(Object.keys(fonts.themes).sort(), Object.keys(css).sort());
  for (const [theme, roles] of Object.entries(css))
    for (const r of ROLES)
      assert.equal(fonts.themes[theme][r], roles[r], `${theme}.${r} drifted from base.css`);
});

test("every family a theme names is actually loaded, and nothing is loaded in vain", () => {
  const used = new Set();
  for (const roles of Object.values(fonts.themes))
    for (const r of ROLES) used.add(roles[r].split(",")[0].replaceAll('"', "").trim());
  assert.deepEqual([...used].sort(), Object.keys(fonts.families).sort());
  for (const [name, f] of Object.entries(fonts.families)) {
    assert.ok(fonts.source.googleFontsHref.includes(name.replaceAll(" ", "+")), name + " is in the CDN link");
    assert.ok(f.googleAxes, name + " declares its weights");
  }
});

test("every page requests the same font set — one stale <head> would change a theme's look", () => {
  const pages = ["index", "dashboard", "game", "archive", "stories", "profile", "settings", "write", "writes", "admin", "reset"];
  for (const p of pages) {
    const html = read(`public/${p}.html`);
    for (const name of [...Object.keys(fonts.families), ...Object.keys(extras())])
      assert.ok(html.includes("family=" + name.replaceAll(" ", "+")), `${p}.html is missing ${name}`);
  }
});

test("each theme's label is the one the switcher shows", () => {
  const themeJs = read("public/js/theme.js");
  for (const [name, row] of Object.entries(fonts.themes))
    assert.ok(themeJs.includes(`${name}: "${row.label}"`), `${name} label drifted`);
});

// Loaded, but not by a theme: `extraFamilies` is the editor menu's own shelf.
const extras = () => Object.fromEntries(Object.entries(fonts.extraFamilies || {}).filter(([k]) => k !== "_comment"));

test("the registry's LOADED_FONTS are exactly the families this site loads", async () => {
  // fonts.json is the map of what's loaded; fonts.js is what a menu can offer.
  // A downloaded face in the menu that nothing downloads would silently fall back.
  const { LOADED_FONTS } = await import("../public/js/fonts.js");
  const loaded = { ...fonts.families, ...extras() };
  assert.deepEqual(
    LOADED_FONTS.map((f) => f.label).sort(),
    Object.keys(loaded).sort(),
    "every family, and nothing that isn't loaded",
  );
  for (const f of LOADED_FONTS) assert.equal(f.stack, loaded[f.label].stack, f.label + "'s stack drifted from fonts.json");
});

const systemFonts = () => Object.fromEntries(Object.entries(fonts.systemFonts || {}).filter(([k]) => k !== "_comment"));

test("SYSTEM_FONTS mirror fonts.json's systemFonts, and none of them is a downloaded face", async () => {
  const { SYSTEM_FONTS } = await import("../public/js/fonts.js");
  const sys = systemFonts();
  assert.deepEqual(SYSTEM_FONTS.map((f) => f.label).sort(), Object.keys(sys).sort());
  for (const f of SYSTEM_FONTS) {
    assert.equal(f.stack, sys[f.label], f.label + "'s stack drifted from fonts.json");
    assert.ok(f.stack.includes(","), f.label + " needs a fallback in its stack");
    const first = f.stack.split(",")[0].replaceAll('"', "").trim();
    assert.ok(!(first in fonts.families) && !(first in extras()), first + " is a local face, not a CDN one");
  }
});

test("the solo editor's typeface menu is 'theme' plus the whole registry, in registry order", async () => {
  const { DOC_FONTS } = await import("../public/js/doc-prefs.js");
  const { LOADED_FONTS, SYSTEM_FONTS } = await import("../public/js/fonts.js");
  assert.equal(DOC_FONTS[0].key, "theme");
  assert.deepEqual(DOC_FONTS.slice(1), [...LOADED_FONTS, ...SYSTEM_FONTS]);
});

test("every site font has its html[data-font] rule, overriding body + story and nothing else", async () => {
  const { SITE_FONTS } = await import("../public/js/fonts.js");
  const rules = {};
  for (const [, key, body] of css.matchAll(/html\[data-font="([a-z0-9]+)"\]\s*\{([\s\S]*?)\n\}/g)) rules[key] = body;
  assert.deepEqual(Object.keys(rules).sort(), SITE_FONTS.map((f) => f.key).sort(), "one rule per font, no strays");
  for (const f of SITE_FONTS) {
    const vars = Object.fromEntries([...rules[f.key].matchAll(/--font-(\w+):([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
    assert.deepEqual(vars, { body: f.stack, story: f.stack }, f.key + " overrides exactly body + story with its own stack");
  }
});

test("every page applies the saved site font before first paint, like the theme", () => {
  const pages = ["index", "dashboard", "game", "archive", "stories", "profile", "settings", "write", "writes", "admin", "reset"];
  for (const p of pages) {
    const html = read(`public/${p}.html`);
    assert.ok(html.includes('localStorage.getItem("cowriteFont")'), `${p}.html reads cowriteFont in its head`);
    assert.ok(html.includes('setAttribute("data-font", _f)'), `${p}.html sets data-font before paint`);
  }
});

test("an extra family is downloaded like any other, and belongs to no theme", () => {
  const themeFaces = new Set();
  for (const roles of Object.values(fonts.themes)) for (const r of ROLES) themeFaces.add(roles[r].split(",")[0].replaceAll('"', "").trim());
  for (const name of Object.keys(extras())) {
    assert.ok(fonts.source.googleFontsHref.includes(name.replaceAll(" ", "+")), name + " is in the CDN link");
    assert.ok(!themeFaces.has(name), name + " is an editor face, not a theme face");
  }
});
