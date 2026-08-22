// The gimmick dock (components/gimmick-dock.js) on jsdom: every open gimmick
// HUD gains a minimize control, a minimized panel becomes an icon tab on the
// left edge, and a gimmick leaving takes its tab with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.mjs";

installDom();
const { dockHtml, mountGimmickDock } = await import("../public/js/components/gimmick-dock.js");

const flush = () => new Promise((r) => setTimeout(r, 0)); // MutationObserver microtasks

function mountWithHuds() {
  document.body.innerHTML = `
    <div class="db-hud hidden" id="dbHud"><b>disco</b></div>
    <div class="ar-hud hidden" id="arHud"><b>paint</b></div>`;
  const dock = mountGimmickDock({
    document,
    items: [
      { id: "disco", icon: "🪩", title: "Disco Ball", hud: "#dbHud" },
      { id: "artroom", icon: "🎨", title: "Art Room", hud: "#arHud" },
    ],
  });
  return dock;
}

test("dockHtml + mount: a minimize button folds into each HUD, tabs start hidden", () => {
  assert.match(dockHtml(), /id="gkTabs"/);
  mountWithHuds();
  assert.ok(document.querySelector('#dbHud [data-gk-min="disco"]'), "the disco HUD grew a minimize control");
  assert.ok(document.querySelector('#arHud [data-gk-min="artroom"]'), "so did the art room's");
  assert.equal(document.querySelectorAll("#gkTabs .gk-tab").length, 2);
  assert.equal(document.querySelectorAll("#gkTabs .gk-tab:not(.hidden)").length, 0, "no tab until something minimizes");
});

test("minimize folds the panel to a left-edge tab; the tab click brings it back", async () => {
  const dock = mountWithHuds();
  const hud = document.getElementById("dbHud");
  hud.classList.remove("hidden"); // the gimmick opened
  await flush();
  hud.querySelector('[data-gk-min="disco"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  assert.ok(hud.classList.contains("gk-minned"), "the panel folds away");
  assert.deepEqual(dock.tabs, ["disco"], "its tab stands on the edge");
  const tab = document.querySelector("#gkTabs .gk-tab:not(.hidden)");
  assert.equal(tab.textContent, "🪩");
  tab.dispatchEvent(new window.Event("click", { bubbles: true }));
  assert.ok(!hud.classList.contains("gk-minned"), "the tab brings the panel back");
  assert.deepEqual(dock.tabs, []);
});

test("two gimmicks stack: both minimized tabs stand together; a gimmick leaving takes its tab", async () => {
  const dock = mountWithHuds();
  const db = document.getElementById("dbHud");
  const ar = document.getElementById("arHud");
  db.classList.remove("hidden");
  ar.classList.remove("hidden");
  dock.minimize("disco");
  dock.minimize("artroom");
  assert.deepEqual(dock.tabs.sort(), ["artroom", "disco"], "the panels stack as tabs");
  // the disco gimmick exits: its component hides the HUD, the tab must follow
  db.classList.add("hidden");
  await flush();
  assert.deepEqual(dock.tabs, ["artroom"], "a closed gimmick never leaves a tab behind");
  assert.ok(!db.classList.contains("gk-minned"), "and reopens un-minimized");
});
