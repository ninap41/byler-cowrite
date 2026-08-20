// The Starcourt Milkshake gimmick's client half (components/milkshake-spill.js)
// on jsdom: the tinted cup builder, the shared layer, the relay, and the pour
// asking the server first. The physics runs on canvas + rAF, which jsdom
// doesn't do — the mount guards both, so here we pin the wiring, not the drips.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.mjs";

installDom();
const { CUP_W, POUR_ROT, shade, cupSvg, layerHtml, mountMilkshake } =
  await import("../public/js/components/milkshake-spill.js");

test("shade darkens and lightens a hex, and passes junk through", () => {
  assert.equal(shade("#ff8fb1", 1), "#ff8fb1");
  assert.equal(shade("#100000", 0.5), "#080000");
  assert.equal(shade("#800000", 2), "#ff0000", "clamped at the top");
  assert.equal(shade("not-a-hex", 0.5), "not-a-hex");
});

test("cupSvg: tinted to its owner, ids suffixed per cup so two cups can share a page", () => {
  const a = cupSvg("#e63946", "me");
  assert.match(a, /stop-color="#e63946"/, "the shake is the owner's colour");
  assert.match(a, /stop-color="#b32c37"/, "shaded darker below");
  assert.match(a, /id="msgradme"/);
  const b = cupSvg("#3ddc84", "u2");
  assert.match(b, /id="msgradu2"/);
  assert.ok(!b.includes("msgradme"), "no id collisions between cups");
  assert.ok(!cupSvg("red;url(x)", "k").includes("url(x)"), "junk colours fall back");
});

test("layerHtml: canvases, my cup, others' box, HUD with meter/refill/wipe/way out", () => {
  const h = layerHtml();
  for (const id of ["msLayer", "msGround", "msDrops", "msOthers", "msCup", "msHud", "msLevel", "msHint"]) assert.match(h, new RegExp(`id="${id}"`));
  for (const act of ["ms-refill", "ms-wipe", "ms-exit"]) assert.match(h, new RegExp(`data-act="${act}"`));
});

function fakeSocket(reply = () => ({ ok: true })) {
  const handlers = {};
  const sent = [];
  return {
    sent,
    on: (ev, fn) => (handlers[ev] = fn),
    emit: (ev, data, ack) => (sent.push([ev, data]), ack?.(reply(data))),
    fire: (ev, data) => handlers[ev]?.(data),
  };
}

test("mountMilkshake: start puts MY tinted cup out (relayed full), pour asks the server, exit puts it away for the room", () => {
  document.body.innerHTML = "";
  const socket = fakeSocket(() => ({ ok: true }));
  const m = mountMilkshake({ socket, getMyUserId: () => "u1", getMyColor: () => "#6c8cff", document });
  const layer = document.getElementById("msLayer");
  assert.ok(layer.classList.contains("hidden"), "closed until a cup is out");
  m.start();
  assert.equal(m.open, true);
  assert.ok(!layer.classList.contains("hidden"));
  assert.match(document.getElementById("msCup").innerHTML, /#6c8cff/, "my shake wears my colour");
  const rep = socket.sent.find(([ev]) => ev === "gimmick-cup");
  assert.ok(rep, "the cup is relayed");
  assert.equal(rep[1].on, true);
  assert.equal(rep[1].level, 1, "starts full");
  m.pour();
  assert.ok(socket.sent.some(([ev]) => ev === "gimmick-pour"), "a pour asks the server first");
  m.exit();
  assert.equal(m.open, false);
  assert.ok(layer.classList.contains("hidden"));
  assert.deepEqual(socket.sent.at(-1), ["gimmick-cup", { on: false }], "the table sees the cup leave");
});

test("a refused pour shows the server's reason and pours nothing", () => {
  document.body.innerHTML = "";
  const socket = fakeSocket((d) => (d && Object.keys(d).length === 0 ? { ok: false, error: "Still dripping…" } : { ok: true }));
  const m = mountMilkshake({ socket, getMyUserId: () => "u1", getMyColor: () => "#6c8cff", document });
  m.start();
  m.pour();
  assert.equal(document.getElementById("msHint").textContent, "Still dripping…");
  m.exit();
});

test("others' cups: relayed cups are painted tinted and tagged, tip with their rot, and leave; a late list lands whole", () => {
  document.body.innerHTML = "";
  const socket = fakeSocket();
  const m = mountMilkshake({ socket, getMyUserId: () => "u1", getMyColor: () => "#6c8cff", document });
  const layer = document.getElementById("msLayer");
  socket.fire("gimmick-cup", { userId: "u2", name: "Mike", color: "#e63946", x: 0.5, y: 0.5, rot: 40, level: 0.8, on: true });
  assert.ok(!layer.classList.contains("hidden"), "someone else's cup shows the layer");
  const cup = document.querySelector("#msOthers .ms-cup");
  assert.match(cup.innerHTML, /#e63946/, "their shake wears their colour");
  assert.equal(cup.querySelector(".ms-cup-tag").textContent, "Mike");
  assert.equal(cup.querySelector("svg").style.transform, "rotate(40deg)");
  // my own echo is ignored
  socket.fire("gimmick-cup", { userId: "u1", name: "me", color: "#6c8cff", x: 0, y: 0, rot: 0, level: 1, on: true });
  assert.equal(document.querySelectorAll("#msOthers .ms-cup").length, 1);
  // a late joiner's list
  socket.fire("gimmick-cups", [{ userId: "u3", name: "Dustin", color: "#3ddc84", x: 0.2, y: 0.1, rot: 0, level: 1 }]);
  assert.equal(document.querySelectorAll("#msOthers .ms-cup").length, 2);
  assert.deepEqual(m.others.sort(), ["u2", "u3"]);
  socket.fire("gimmick-cup", { userId: "u2", on: false });
  socket.fire("gimmick-cup", { userId: "u3", on: false });
  assert.equal(document.querySelectorAll("#msOthers .ms-cup").length, 0);
  assert.ok(layer.classList.contains("hidden"), "no cups, no layer");
});

test("gimmicksOff: a friendly switch sweeps every cup (and the mess) away and reports whether anything was out", () => {
  document.body.innerHTML = "";
  const socket = fakeSocket();
  const m = mountMilkshake({ socket, getMyUserId: () => "u1", getMyColor: () => "#6c8cff", document });
  assert.equal(m.gimmicksOff(), false, "nothing out, nothing to say");
  m.start();
  socket.fire("gimmick-cup", { userId: "u2", name: "Mike", color: "#e63946", x: 0.5, y: 0.5, rot: 0, level: 1, on: true });
  assert.equal(m.gimmicksOff(), true);
  assert.equal(m.open, false);
  assert.equal(document.querySelectorAll("#msOthers .ms-cup").length, 0);
  assert.ok(document.getElementById("msLayer").classList.contains("hidden"));
});
