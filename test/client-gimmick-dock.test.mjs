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

test("an opening gimmick takes the stage; a second one folds the first, only one panel is ever open", async () => {
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

test("edge tabs don't take the global button hover lift: the host tab keeps its centring, the dock tabs stay put", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../public/css/base.css", import.meta.url), "utf-8");
  assert.match(css, /\.doc-side-tab:hover \{[^}]*transform: translateY\(-50%\)/);
  assert.match(css, /\.gk-tab:hover \{[^}]*transform: none/);
});

test("hudCtlHtml: the −/× corner controls; the HUD's own − folds it to its tab (the toy stays out)", async () => {
  const { hudCtlHtml } = await import("../public/js/components/gimmick-dock.js");
  assert.match(hudCtlHtml(), /class="gk-hud-ctl"/);
  assert.match(hudCtlHtml(), /data-hud="min"[^>]*>−</);
  assert.match(hudCtlHtml(), /data-hud="close"[^>]*>×</);
  document.body.innerHTML = `
    <div class="db-hud hidden" id="dbHud">${hudCtlHtml()}<b>disco</b></div>
    <div class="ar-hud hidden" id="arHud">${hudCtlHtml()}<b>paint</b></div>`;
  const dock = mountGimmickDock({
    document,
    items: [
      { id: "disco", icon: "🪩", title: "Disco Ball", hud: "#dbHud" },
      { id: "artroom", icon: "🎨", title: "Art Room", hud: "#arHud" },
    ],
  });
  const db = document.getElementById("dbHud");
  db.classList.remove("hidden");
  await flush();
  assert.equal(dock.onStage, "disco");
  db.querySelector('[data-hud="min"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  assert.equal(dock.onStage, null, "− folds the panel");
  assert.ok(db.classList.contains("gk-minned"));
  assert.deepEqual(dock.tabs, ["disco"], "its tab stays — the gimmick is still out");
  assert.ok(!db.classList.contains("hidden"), "and the dock never closes a gimmick");
});

test("every gimmick HUD carries the corner controls, and × closes the gimmick like its own exit", async () => {
  const fake = () => {
    const handlers = {};
    return { sent: [], on: (ev, fn) => (handlers[ev] = fn), emit: (ev, d, ack) => ack?.({ ok: true }), fire: (ev, d) => handlers[ev]?.(d) };
  };
  const { mountDiscoBall } = await import("../public/js/components/disco-ball.js");
  const { mountArtRoom } = await import("../public/js/components/art-room.js");
  for (const [mount, hudId] of [
    [() => mountDiscoBall({ socket: fake(), getMyUserId: () => "u1", getMyColor: () => "#e63946", document }), "dbHud"],
    [() => mountArtRoom({ socket: fake(), getMyUserId: () => "u1", getMyColor: () => "#e63946", document }), "arHud"],
  ]) {
    document.body.innerHTML = "";
    const m = mount();
    const hud = document.getElementById(hudId);
    assert.ok(hud.querySelector('.gk-hud-ctl [data-hud="min"]') && hud.querySelector('.gk-hud-ctl [data-hud="close"]'), hudId + " has −/×");
    m.start();
    assert.ok(!hud.classList.contains("hidden"), hudId + " opened");
    hud.querySelector('[data-hud="close"]').dispatchEvent(new window.Event("click", { bubbles: true }));
    assert.ok(hud.classList.contains("hidden"), hudId + ": × closes it, the toy leaves with it");
  }
  // every HUD builder carries the controls and wires ×
  const { readFileSync } = await import("node:fs");
  for (const f of ["gimmick-dice", "galaga-game", "milkshake-spill", "disco-ball", "art-room", "super-soaker", "vecna-curse"]) {
    const src = readFileSync(new URL(`../public/js/components/${f}.js`, import.meta.url), "utf-8");
    assert.match(src, /glass hidden" id="\w+">\$\{hudCtlHtml\(\)\}/, f + " HUD opens with hudCtlHtml()");
    assert.match(src, /\[data-hud=\\?"close\\?"\]/, f + " handles ×");
  }
});
