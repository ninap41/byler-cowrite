// The SuperSoaker gimmick's client half (components/super-soaker.js) on
// jsdom: the gun builder, the shared layer, the relay, and firing asking the
// server first. The water runs on rAF, which jsdom doesn't do — the mount
// guards it, so here we pin the wiring, not the splash.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.mjs";

installDom();
const { GUN_W, gunHtml, layerHtml, mountSuperSoaker } =
  await import("../public/js/components/super-soaker.js");

test("gunHtml: the water-pistol emoji, with the owner's colour riding along for the water; junk colours fall back", () => {
  const a = gunHtml("me", "#e63946");
  assert.match(a, /class="sk-gun3d"/, "the positioned wrapper stays (setPos rotates it)");
  assert.match(a, /class="sk-emoji">🔫</, "the gun IS the green water-pistol emoji");
  assert.match(a, /--sk-c:#e63946/, "tinted in the owner's colour");
  assert.ok(!gunHtml("me", "red;url(x)").includes("url(x)"), "junk colours fall back");
});

test("layerHtml: water box, my gun, others' box, HUD with fire/way out", () => {
  const h = layerHtml();
  for (const id of ["skLayer", "skWater", "skOthers", "skGun", "skHud", "skHint"]) assert.match(h, new RegExp(`id="${id}"`));
  for (const act of ["sk-fire", "sk-exit"]) assert.match(h, new RegExp(`data-act="${act}"`));
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

test("mountSuperSoaker: start draws MY gun (relayed as fractions + angle), fire asks the server, exit puts it away for the room", () => {
  document.body.innerHTML = "";
  const socket = fakeSocket(() => ({ ok: true }));
  const m = mountSuperSoaker({ socket, getMyUserId: () => "u1", getMyColor: () => "#6c8cff", getMyName: () => "me", document });
  const layer = document.getElementById("skLayer");
  assert.ok(layer.classList.contains("hidden"), "closed until a gun is out");
  m.start();
  assert.equal(m.open, true);
  assert.ok(!layer.classList.contains("hidden"));
  const rep = socket.sent.find(([ev]) => ev === "gimmick-gun");
  assert.ok(rep, "the gun is relayed");
  assert.equal(rep[1].on, true);
  assert.ok(rep[1].x >= 0 && rep[1].x <= 1 && rep[1].y >= 0 && rep[1].y <= 1, "as fractions");
  assert.ok(typeof rep[1].angle === "number", "with its aim");
  m.fire();
  assert.ok(socket.sent.some(([ev]) => ev === "gimmick-squirt"), "a shot asks the server first");
  m.exit();
  assert.equal(m.open, false);
  assert.ok(layer.classList.contains("hidden"));
  assert.deepEqual(socket.sent.at(-1), ["gimmick-gun", { on: false }], "the table sees the gun leave");
});

test("a refused shot shows the server's reason and no water flies", () => {
  document.body.innerHTML = "";
  const socket = fakeSocket((d) => (d && Object.keys(d).length === 0 ? { ok: false, error: "Pump it up first…" } : { ok: true }));
  const m = mountSuperSoaker({ socket, getMyUserId: () => "u1", getMyColor: () => "#6c8cff", document });
  m.start();
  m.fire();
  assert.equal(document.getElementById("skHint").textContent, "Pump it up first…");
  assert.equal(m.dropCount, 0, "no water without the server's ok");
  m.exit();
});

test("others' guns are painted + tagged and leave; a relayed squirt spawns a bounded burst for its owner", () => {
  document.body.innerHTML = "";
  const socket = fakeSocket();
  const m = mountSuperSoaker({ socket, getMyUserId: () => "u1", getMyColor: () => "#6c8cff", document });
  const layer = document.getElementById("skLayer");
  socket.fire("gimmick-gun", { userId: "u2", name: "Mike", color: "#e63946", x: 0.5, y: 0.5, angle: -20, on: true });
  assert.ok(!layer.classList.contains("hidden"), "someone else's gun shows the layer");
  assert.equal(document.querySelector("#skOthers .sk-tag").textContent, "Mike");
  socket.fire("gimmick-guns", [{ userId: "u3", name: "Dustin", color: "#3ddc84", x: 0.2, y: 0.1, angle: 10 }]);
  assert.deepEqual(m.others.sort(), ["u2", "u3"], "the late list lands whole");
  // one relayed shot = one burst of drops
  socket.fire("gimmick-squirt", { userId: "u2", name: "Mike", color: "#e63946", x: 0.5, y: 0.5, angle: -20, seed: 42 });
  assert.ok(m.dropCount > 0, "the water flies from the relay");
  const one = m.dropCount;
  for (let i = 0; i < 5; i++) socket.fire("gimmick-squirt", { userId: "u2", color: "#e63946", x: 0.5, y: 0.5, angle: -20, seed: i });
  assert.ok(m.dropCount <= one * 3, "concurrent bursts are capped, the oldest dries first");
  socket.fire("gimmick-gun", { userId: "u2", on: false });
  socket.fire("gimmick-gun", { userId: "u3", on: false });
  assert.deepEqual(m.others, [], "the guns leave");
});

test("gimmicksOff: a friendly switch sweeps every gun and drop away and reports whether anything was out", () => {
  document.body.innerHTML = "";
  const socket = fakeSocket();
  const m = mountSuperSoaker({ socket, getMyUserId: () => "u1", getMyColor: () => "#6c8cff", document });
  assert.equal(m.gimmicksOff(), false, "nothing out, nothing to say");
  m.start();
  socket.fire("gimmick-gun", { userId: "u2", name: "Mike", color: "#e63946", x: 0.5, y: 0.5, angle: 0, on: true });
  socket.fire("gimmick-squirt", { userId: "u2", color: "#e63946", x: 0.5, y: 0.5, angle: 0, seed: 7 });
  assert.equal(m.gimmicksOff(), true);
  assert.equal(m.open, false);
  assert.equal(m.dropCount, 0);
  assert.equal(document.querySelectorAll("#skOthers .sk-gunbtn").length, 0);
  assert.ok(document.getElementById("skLayer").classList.contains("hidden"));
});
