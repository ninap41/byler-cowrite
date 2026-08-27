// The game page wears the theme's full background scene the way the
// dashboard does: the same chrome mount draws it, and no rule keyed to the
// game page is allowed to hide or dim it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf-8");

test("the game page mounts the theme scene exactly like the dashboard", () => {
  const game = read("../public/game.html");
  const dash = read("../public/dashboard.html");
  assert.match(game, /mountChrome\(\{ page: "game" \}\)/, "the same chrome mount (BG + nav + topbar) as every page");
  assert.match(dash, /mountChrome\(\{ page: "dashboard" \}\)/);
  assert.ok(!/<div class="bg-layers"/.test(game) && !/<div class="bg-layers"/.test(dash), "neither page draws its own layers — chrome.js owns the scene");
  const chrome = read("../public/js/chrome.js");
  assert.match(chrome, /insertAdjacentHTML\("afterbegin", BG \+/, "BG is mounted unconditionally, not per page");
});

test("no game-page CSS touches the scene, and the scene sits behind everything", () => {
  const css = read("../public/css/base.css");
  for (const m of css.matchAll(/body\.game-page[^{]*\{[^}]*\}/g))
    assert.ok(!/bg-layers|bg-set|bg-wash/.test(m[0]), "a game-page rule reaches the scene: " + m[0].slice(0, 80));
  assert.ok(!/game-page[^{]*(bg-layers|bg-set)/.test(css), "no selector pairs the game page with the scene");
  assert.match(css, /\.bg-layers \{[^}]*z-index: -1/);
  assert.ok(!/\.game-page[^{]*\.bg-layers[^{]*\{[^}]*(opacity|display|visibility|filter)/.test(css), "nothing dims it on the game page");
});
