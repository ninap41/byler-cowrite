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
    for (const name of Object.keys(fonts.families))
      assert.ok(html.includes("family=" + name.replaceAll(" ", "+")), `${p}.html is missing ${name}`);
  }
});

test("each theme's label is the one the switcher shows", () => {
  const themeJs = read("public/js/theme.js");
  for (const [name, row] of Object.entries(fonts.themes))
    assert.ok(themeJs.includes(`${name}: "${row.label}"`), `${name} label drifted`);
});
