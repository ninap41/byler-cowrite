// The gimmick dock (components/gimmick-dock.js) on jsdom: every OPEN gimmick
// gets a left-edge tab (the host drawer's tab, mirrored) and only one panel
// is ever on stage — opening one folds the rest, the open tab folds its own,
// and a gimmick leaving takes its tab with it.
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

test("dockHtml + mount: one edge tab per gimmick, all hidden while nothing is out", () => {
  assert.match(dockHtml(), /id="gkTabs"/);
  const dock = mountWithHuds();
  assert.equal(document.querySelectorAll("#gkTabs .gk-tab").length, 2);
  assert.equal(dock.tabs.length, 0, "no tab until a gimmick opens");
  assert.equal(dock.onStage, null);
});

test("an opening gimmick takes the stage; a second one folds the first — only one panel is ever open", async () => {
  const dock = mountWithHuds();
  const db = document.getElementById("dbHud");
  const ar = document.getElementById("arHud");
  db.classList.remove("hidden"); // the disco opened
  await flush();
  assert.deepEqual(dock.tabs, ["disco"], "its tab stands on the edge");
  assert.equal(dock.onStage, "disco");
  assert.ok(!db.classList.contains("gk-minned"), "its panel is the open one");
  ar.classList.remove("hidden"); // the art room opens too
  await flush();
  assert.deepEqual(dock.tabs.sort(), ["artroom", "disco"], "both tabs stand");
  assert.equal(dock.onStage, "artroom", "the newest gimmick takes the stage");
  assert.ok(db.classList.contains("gk-minned"), "…folding the other panel");
  assert.ok(!ar.classList.contains("gk-minned"));
});

test("tab clicks swap the stage, and the open tab folds its own panel", async () => {
  const dock = mountWithHuds();
  const db = document.getElementById("dbHud");
  const ar = document.getElementById("arHud");
  db.classList.remove("hidden");
  ar.classList.remove("hidden");
  await flush();
  const [dbTab, arTab] = document.querySelectorAll("#gkTabs .gk-tab");
  dbTab.dispatchEvent(new window.Event("click", { bubbles: true }));
  assert.equal(dock.onStage, "disco", "the other tab swaps the stage");
  assert.ok(ar.classList.contains("gk-minned") && !db.classList.contains("gk-minned"));
  assert.ok(dbTab.classList.contains("on"), "the open tab is marked");
  dbTab.dispatchEvent(new window.Event("click", { bubbles: true }));
  assert.equal(dock.onStage, null, "the open tab folds its own panel");
  assert.ok(db.classList.contains("gk-minned") && ar.classList.contains("gk-minned"), "everything folded, the table clear");
  arTab.dispatchEvent(new window.Event("click", { bubbles: true }));
  assert.equal(dock.onStage, "artroom");
});

test("a gimmick leaving takes its tab and frees the stage", async () => {
  const dock = mountWithHuds();
  const db = document.getElementById("dbHud");
  db.classList.remove("hidden");
  await flush();
  assert.equal(dock.onStage, "disco");
  db.classList.add("hidden"); // the component closed it (exit / friendly)
  await flush();
  assert.deepEqual(dock.tabs, [], "a closed gimmick never leaves a tab behind");
  assert.equal(dock.onStage, null);
  assert.ok(!db.classList.contains("gk-minned"), "and reopens unfolded");
});
