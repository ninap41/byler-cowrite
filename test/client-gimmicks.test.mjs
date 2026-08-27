// The gimmick die layer's pure builders + the d20 die's geometry, on jsdom.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.mjs";

installDom();
// jsdom has no CSS.escape / matchMedia / rAF; the components guard the last
// two, CSS.escape is polyfilled here (every modern browser has it).
globalThis.CSS = { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => "\\" + c) };
const { NUM, FACES, faceFor, restQuatFlat, qRotate, paletteRamps, createDie } = await import("../public/js/components/d20-die.js");
const { menuHtml, resultHtml, hintHtml, mountGimmickDice, LAYER_HTML, STEAL_KEY } =
  await import("../public/js/components/gimmick-dice.js");
const { PALETTE } = await import("../public/js/util.js");

// ---- the die ----

test("d20 geometry: twenty faces, opposite faces sum to 21, each value has one face", () => {
  assert.equal(FACES.length, 20);
  assert.equal(NUM.length, 20);
  for (let v = 1; v <= 20; v++) assert.equal(NUM.filter((n) => n === v).length, 1, `one face says ${v}`);
  for (let i = 0; i < 20; i++) {
    const opp = FACES.findIndex((f, j) => j !== i && FACES[i].ez.every((c, k) => Math.abs(c + f.ez[k]) < 1e-6));
    assert.equal(NUM[i] + NUM[opp], 21);
  }
  assert.equal(NUM[faceFor(7)], 7);
});

test("restQuatFlat(i) turns face i's normal to point straight at the eye (+z)", () => {
  for (let i = 0; i < 20; i++) {
    const n = qRotate(restQuatFlat(i), FACES[i].ez);
    assert.ok(n[2] > 0.999, `face ${NUM[i]} faces the eye (z=${n[2].toFixed(4)})`);
  }
});

test("paletteRamps: every palette colour yields dark→light resin/edge and light pips; junk falls back", () => {
  for (const hex of PALETTE) {
    const r = paletteRamps(hex);
    const lum = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
    assert.ok(lum(r.resin[0]) < lum(r.resin[1]), "resin: shadow darker than light");
    assert.ok(lum(r.edge[0]) < lum(r.edge[1]));
    assert.ok(lum(r.pip[1]) > 200, "pip highlight is cream");
  }
  assert.deepEqual(paletteRamps("javascript:alert(1)"), paletteRamps(PALETTE[0]));
});

test("createDie builds 20 faces into the host and rollTo lands on the asked value (reduced motion snaps)", () => {
  const host = document.createElement("button");
  document.body.appendChild(host);
  const die = createDie(host, { color: "#6c8cff", size: 120, reduceMotion: true });
  assert.ok(host.classList.contains("d20-stage"));
  assert.equal(host.querySelectorAll(".d20-face").length, 20);
  assert.equal(host.style.getPropertyValue("--die-size"), "120px");
  let landed = null;
  die.rollTo(7, { onLand: (v) => (landed = v) });
  assert.equal(landed, 7);
  assert.equal(die.face, 7);
  assert.equal(die.rolling, false);
  die.rollTo(20);
  assert.ok(host.classList.contains("crit"));
  die.rollTo(1);
  assert.ok(host.classList.contains("fumble"));
  assert.ok(!host.classList.contains("crit"));
  die.rollTo(99);
  assert.equal(die.face, 20, "clamped");
  die.setColor("#3ddc84");
  die.setSize(90);
  assert.equal(host.querySelectorAll(".d20-face").length, 20);
  die.destroy();
  assert.equal(host.innerHTML, "");
});

// ---- the layer's builders ----
const gate = { catalogue: [{ id: "d20", name: "Hellfire d20", desc: "d", theme: "hellfire" }], locks: { d20: { tier: "sorcerer", name: "🧙 Sorcerer", min: 20000 } } };

test("menuHtml: friendly game / unseated / locked / a tablemate's unlock / play", () => {
  assert.match(menuHtml({ ...gate, friendly: true }), /friendly game, gimmicks are off/);
  assert.match(menuHtml({ ...gate, friendly: false, seated: false }), /Take a seat/);
  const locked = menuHtml({ ...gate, friendly: false, unlocked: [] });
  assert.match(locked, /🔒 Hellfire d20/);
  assert.match(locked, /Unlocks at 🧙 Sorcerer · 20,000 words/);
  assert.ok(!/data-act="play"/.test(locked) && /disabled/.test(locked), "a locked row is disabled");
  const table = menuHtml({ ...gate, friendly: false, unlocked: [], table: ["d20"] });
  assert.match(table, /class="gd-menu-item locked table"[^>]*disabled[^>]*>🔓 Hellfire d20/, "a tablemate's rank opens the lock but not the row");
  assert.match(table, /A tablemate has this unlocked · Unlocks at 🧙 Sorcerer · 20,000 words to play it yourself/);
  assert.match(menuHtml({ ...gate, friendly: false, unlocked: ["d20"], table: ["d20"] }), /🎲 Hellfire d20 · Play/, "my own rank wins");
  assert.match(menuHtml({ ...gate, friendly: false, unlocked: ["d20"] }), /data-act="play">🎲 Hellfire d20 · Play/);
  assert.match(menuHtml({ ...gate, friendly: false, admin: true }), /🎲 Hellfire d20 · Play/, "admins have every gimmick");
});

test("resultHtml / hintHtml: the readout for every landing", () => {
  assert.match(hintHtml(), /flick or click to roll/);
  assert.match(resultHtml({ value: 13, kind: "plain" }), /gd-result">13</);
  assert.match(resultHtml({ value: 1, kind: "fumble" }), /Natural 1/);
  assert.match(resultHtml({ value: 20, kind: "crit", stole: true }), /You stole the turn/);
  assert.match(resultHtml({ value: 20, kind: "crit", stole: false }), /wasn't anyone else's/);
  assert.match(resultHtml({ value: 20, kind: "crit", stole: false, declined: true }), /let the writer keep the turn/);
});

// ---- the mount, on a fake socket ----
function fakeSocket(reply = () => ({ ok: true, value: 13, kind: "plain", stole: false })) {
  const handlers = {};
  const sent = [];
  return {
    sent,
    on: (ev, fn) => (handlers[ev] = fn),
    emit: (ev, data, ack) => {
      sent.push([ev, data]);
      ack?.(reply(data));
    },
    fire: (ev, data) => handlers[ev]?.(data),
  };
}

test("mountGimmickDice: menu → my die is out (reported to the room), a click rolls with the steal preference and lands on the server's value, others' dice appear/move/leave, put away", async () => {
  document.body.innerHTML = `<div class="foot-bar"><span class="foot-dot hidden" id="gimmickDot"></span><button class="foot-btn hidden" id="gimmickBtn">🎲 Play gimmick</button></div>`;
  const socket = fakeSocket();
  let friendly = false;
  const t = mountGimmickDice({
    socket, getMyUserId: () => "u1", getMyColor: () => "#6c8cff", isSeated: () => true, isFriendly: () => friendly,
  });
  const btn = document.getElementById("gimmickBtn");
  const layer = document.getElementById("gimmickLayer");
  assert.ok(btn.classList.contains("hidden"), "hidden until seated");
  t.setSeated(true);
  assert.ok(!btn.classList.contains("hidden"));
  t.setGate({ ...gate, unlocked: ["d20"] });
  btn.click();
  const menu = document.getElementById("gimmickMenu");
  assert.ok(!menu.classList.contains("hidden"));
  menu.querySelector('[data-act="play"]').click();
  assert.ok(t.open, "playing puts my die out");
  assert.ok(menu.classList.contains("hidden"));
  assert.ok(!layer.classList.contains("hidden"));
  assert.ok(!document.body.classList.contains("ui-peek"), "no peek: the game UI stays, that's the point");
  assert.match(document.getElementById("gdTitle").textContent, /Hellfire d20/);
  assert.equal(document.querySelectorAll("#gdDie .d20-face").length, 20, "a die is built into the layer");
  assert.match(btn.textContent, /Put the die away/);
  const shown = socket.sent.find(([ev]) => ev === "gimmick-die");
  assert.ok(shown, "the room is told my die is out");
  assert.equal(shown[1].on, true);
  assert.ok(shown[1].x >= 0 && shown[1].x <= 1 && shown[1].y >= 0 && shown[1].y <= 1, "position as fractions of my screen");

  // the steal box defaults on and persists
  const steal = document.getElementById("gdSteal");
  assert.equal(steal.checked, true);
  steal.checked = false;
  steal.dispatchEvent(new window.Event("change"));
  assert.equal(localStorage.getItem(STEAL_KEY), "0");

  t.roll();
  assert.deepEqual(socket.sent.at(-1), ["gimmick-roll", { id: "d20", steal: false }]);
  await new Promise((r) => setTimeout(r, 0));
  assert.match(document.getElementById("gdRead").innerHTML, /gd-result">13</, "landed on the server's 13");

  // someone else's die appears where they put it, in their colour, named; moves; rolls; leaves
  socket.fire("gimmick-die", { userId: "u2", name: "Mike", color: "#e63946", x: 1, y: 0, on: true });
  assert.deepEqual(t.others, ["u2"]);
  const mike = document.querySelector("#gdOthers .gd-die.remote");
  assert.ok(mike, "a remote die element");
  assert.equal(mike.querySelectorAll(".d20-face").length, 20);
  assert.match(mike.querySelector(".gd-die-tag").textContent, /Mike/);
  const right = parseFloat(mike.style.left);
  socket.fire("gimmick-die", { userId: "u2", name: "Mike", color: "#e63946", x: 0, y: 0, on: true });
  assert.ok(parseFloat(mike.style.left) < right, "moved left with the fraction");
  socket.fire("gimmick-roll", { userId: "u2", value: 20, kind: "crit", stole: true });
  socket.fire("gimmick-die", { userId: "u1", name: "me", color: "#6c8cff", x: 0.5, y: 0.5, on: true });
  assert.deepEqual(t.others, ["u2"], "my own broadcast is ignored");
  socket.fire("gimmick-die", { userId: "u2", on: false });
  assert.deepEqual(t.others, []);
  assert.equal(document.querySelectorAll("#gdOthers .gd-die").length, 0);
  assert.ok(!layer.classList.contains("hidden"), "my die is still out");

  // put away: the room hears it, the layer goes when nothing is out
  document.querySelector('#gdHud [data-act="exit"]').click();
  assert.ok(!t.open);
  assert.deepEqual(socket.sent.at(-1), ["gimmick-die", { on: false }]);
  assert.ok(layer.classList.contains("hidden"));
  // a list on (re)join paints dice without my own
  socket.fire("gimmick-dice", [{ userId: "u1", name: "me", color: "#6c8cff", x: 0, y: 0 }, { userId: "u3", name: "Dustin", color: "#3ddc84", x: 0.5, y: 1 }]);
  assert.deepEqual(t.others, ["u3"]);
  assert.ok(!layer.classList.contains("hidden"), "someone else's die shows even when mine is away");

  // a friendly game: the menu explains
  friendly = true;
  btn.click();
  assert.match(menu.innerHTML, /friendly game/);
  t.setSeated(false);
  assert.ok(btn.classList.contains("hidden"));
});

test("a refused roll shows the server's reason and unlocks the die", async () => {
  document.body.innerHTML = `<button class="foot-btn" id="gimmickBtn"></button>`;
  const socket = fakeSocket(() => ({ ok: false, error: "This is a friendly game, gimmicks are off." }));
  const t = mountGimmickDice({ socket, isFriendly: () => false });
  t.setGate(gate);
  t.enter("d20");
  t.roll();
  await new Promise((r) => setTimeout(r, 0));
  assert.match(document.getElementById("gdNote").textContent, /friendly game/);
  t.roll();
  assert.equal(socket.sent.filter(([ev]) => ev === "gimmick-roll").length, 2, "not locked out by the refusal");
});

test("LAYER_HTML markup carries the ids the mount reads", () => {
  for (const id of ["gimmickLayer", "gdOthers", "gdHud", "gdTitle", "gdRead", "gdSteal", "gdNote", "gdDie", "gimmickMenu"])
    assert.match(LAYER_HTML, new RegExp(`id="${id}"`));
});

test("gimmicksOff: a friendly switch sweeps every die away and reports whether anything was out", () => {
  document.body.innerHTML = `<button class="foot-btn" id="gimmickBtn"></button>`;
  const socket = fakeSocket();
  const t = mountGimmickDice({ socket, getMyUserId: () => "u1", getMyColor: () => "#6c8cff", isSeated: () => true, isFriendly: () => false, document });
  t.setGate({ catalogue: [{ id: "d20", name: "Hellfire d20" }], unlocked: ["d20"] });
  assert.equal(t.gimmicksOff(), false, "nothing out, nothing to say");
  t.enter("d20");
  socket.fire("gimmick-die", { userId: "u2", name: "Mike", color: "#e63946", x: 0.5, y: 0.5, on: true });
  assert.equal(t.gimmicksOff(), true);
  assert.equal(t.open, false);
  assert.deepEqual(t.others, []);
  assert.ok(document.getElementById("gimmickLayer").classList.contains("hidden"));
});
