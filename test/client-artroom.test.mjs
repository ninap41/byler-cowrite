// Will's Art Room gimmick's client half (components/art-room.js) on jsdom:
// the layer/swatch builders, the relay, and the brush asking the server
// first. jsdom has no canvas 2d context — the mount guards it — so here we
// pin the wiring and the shared stroke state, not the pixels.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.mjs";

installDom();
const { layerHtml, swatchRowHtml, mountArtRoom } =
  await import("../public/js/components/art-room.js");

test("layerHtml: canvas, others' box, the catcher, HUD with wipe/way out", () => {
  const h = layerHtml();
  for (const id of ["arLayer", "arCanvas", "arOthers", "arCatch", "arHud", "arHint", "arColors"]) assert.match(h, new RegExp(`id="${id}"`));
  for (const act of ["ar-wipe", "ar-exit"]) assert.match(h, new RegExp(`data-act="${act}"`));
});

test("swatchRowHtml: my colour leads and starts selected, presets follow, the picker closes the row, junk falls back", () => {
  const h = swatchRowHtml("#6c8cff");
  assert.match(h, /class="ar-swatch on" data-color="#6c8cff"/, "my colour leads, selected");
  assert.ok((h.match(/ar-swatch/g) || []).length > 5, "a real row of presets");
  assert.match(h, /id="arPick"/, "the free picker is there");
  assert.match(h, /data-erase="1"/, "the eraser closes the row");
  assert.ok(!swatchRowHtml("red;url(x)").includes("url(x)"), "junk colours fall back");
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

test("mountArtRoom: start opens the room and asks the server; exit puts the brush away but keeps the paint", () => {
  document.body.innerHTML = "";
  const socket = fakeSocket(() => ({ ok: true }));
  const m = mountArtRoom({ socket, getMyUserId: () => "u1", getMyColor: () => "#6c8cff", getMyName: () => "me", document });
  const layer = document.getElementById("arLayer");
  assert.ok(layer.classList.contains("hidden"), "closed until something's out");
  m.start();
  assert.equal(m.open, true);
  assert.ok(!layer.classList.contains("hidden"));
  assert.ok(!document.getElementById("arCatch").classList.contains("hidden"), "MY catcher takes the pointer");
  assert.equal(m.color, "#6c8cff", "the brush starts in my own colour");
  assert.ok(socket.sent.some(([ev]) => ev === "gimmick-paint"), "the brush coming out asks the server");
  assert.ok(document.getElementById("arColors").querySelector(".ar-swatch.on"), "a swatch is selected");
  m.exit();
  assert.equal(m.open, false);
  assert.ok(document.getElementById("arCatch").classList.contains("hidden"), "the pointer goes back to the page");
  assert.deepEqual(socket.sent.at(-1), ["gimmick-stroke", { on: false }], "the table sees the brush go away");
});

test("a hard refusal shows the server's reason and the brush goes back away; a cooldown paints on", () => {
  document.body.innerHTML = "";
  let error = "Nobody at this table has unlocked that gimmick yet.";
  const socket = fakeSocket((d) => (d && Object.keys(d).length === 0 ? { ok: false, error } : { ok: true }));
  const m = mountArtRoom({ socket, getMyUserId: () => "u1", getMyColor: () => "#6c8cff", document });
  m.start();
  assert.equal(m.open, false, "a hard refusal closes the room");
  assert.equal(document.getElementById("arHint").textContent, error);
  error = "The paint is still wet…";
  m.start();
  assert.equal(m.open, true, "a cooldown just means 'again already?' — paint on");
  m.exit();
});

test("others' strokes land in the shared painting; my own echo is ignored; a late snapshot lands whole", () => {
  document.body.innerHTML = "";
  const socket = fakeSocket();
  const m = mountArtRoom({ socket, getMyUserId: () => "u1", getMyColor: () => "#6c8cff", document });
  const layer = document.getElementById("arLayer");
  socket.fire("gimmick-stroke", { userId: "u2", name: "Mike", color: "#e63946", on: true, cursor: [0.5, 0.5], stroke: { color: "#e63946", size: 6, pts: [[0.1, 0.1], [0.2, 0.2]] }, live: true });
  assert.ok(!layer.classList.contains("hidden"), "someone else's paint shows the layer");
  assert.equal(m.strokeCount, 1, "their live stroke is in the painting");
  const brush = document.querySelector("#arOthers .ar-brush");
  assert.equal(brush.querySelector(".ar-tag").textContent, "Mike", "their brush is tagged");
  socket.fire("gimmick-stroke", { userId: "u2", on: true, stroke: { color: "#e63946", size: 6, pts: [[0.1, 0.1], [0.2, 0.2], [0.3, 0.3]] }, live: false });
  assert.equal(m.strokeCount, 1, "committing replaces the live stroke, not doubles it");
  // my own echo is ignored
  socket.fire("gimmick-stroke", { userId: "u1", on: true, stroke: { color: "#6c8cff", size: 6, pts: [[0.9, 0.9]] }, live: false });
  assert.equal(m.strokeCount, 1);
  // a stroke with no cursor riding along still moves their name tag to its newest point
  socket.fire("gimmick-stroke", { userId: "u2", name: "Mike", color: "#e63946", on: true, stroke: { color: "#e63946", size: 6, pts: [[0.8, 0.6]] }, live: true });
  assert.ok(document.querySelector("#arOthers .ar-brush"), "the painter's name follows their painting");
  // a late joiner's snapshot
  socket.fire("gimmick-paints", [{ userId: "u3", name: "Dustin", color: "#3ddc84", on: true, cursor: [0.2, 0.1], strokes: [{ color: "#3ddc84", size: 6, pts: [[0.4, 0.4]] }], live: null }]);
  assert.equal(m.strokeCount, 3, "the snapshot lands whole");
  assert.deepEqual(m.others.sort(), ["u2", "u3"]);
});

test("paint outlives the brush but not its painter; a wipe clears one painter's strokes", () => {
  document.body.innerHTML = "";
  const socket = fakeSocket();
  const m = mountArtRoom({ socket, getMyUserId: () => "u1", getMyColor: () => "#6c8cff", document });
  const layer = document.getElementById("arLayer");
  socket.fire("gimmick-stroke", { userId: "u2", name: "Mike", color: "#e63946", on: true, cursor: [0.5, 0.5], stroke: { color: "#e63946", size: 6, pts: [[0.1, 0.1]] }, live: false });
  assert.equal(m.strokeCount, 1);
  // brush away: cursor leaves, paint stays
  socket.fire("gimmick-stroke", { userId: "u2", on: false });
  assert.equal(m.others.length, 0, "their brush is gone");
  assert.equal(m.strokeCount, 1, "their paint STAYS");
  assert.ok(!layer.classList.contains("hidden"), "paint keeps the layer up");
  // a wipe clears their strokes
  socket.fire("gimmick-stroke", { userId: "u2", wipe: true, on: true });
  assert.equal(m.strokeCount, 0, "wiped");
  // paint again, then the painter leaves: everything of theirs goes
  socket.fire("gimmick-stroke", { userId: "u2", name: "Mike", color: "#e63946", on: true, stroke: { color: "#e63946", size: 6, pts: [[0.1, 0.1]] }, live: false });
  assert.equal(m.strokeCount, 1);
  socket.fire("gimmick-stroke", { userId: "u2", on: false, wipe: true });
  assert.equal(m.strokeCount, 0, "the paint leaves with its painter");
  assert.ok(layer.classList.contains("hidden"), "nothing left, layer gone");
});

test("my wipe clears my strokes locally and tells the room", () => {
  document.body.innerHTML = "";
  const socket = fakeSocket();
  const m = mountArtRoom({ socket, getMyUserId: () => "u1", getMyColor: () => "#6c8cff", document });
  m.start();
  m.wipe();
  assert.deepEqual(socket.sent.at(-1), ["gimmick-stroke", { wipe: true }], "the room hears the wipe");
  assert.equal(m.strokeCount, 0);
  m.exit();
});

test("gimmicksOff: a friendly switch sweeps every brush and stroke away and reports whether anything was out", () => {
  document.body.innerHTML = "";
  const socket = fakeSocket();
  const m = mountArtRoom({ socket, getMyUserId: () => "u1", getMyColor: () => "#6c8cff", document });
  assert.equal(m.gimmicksOff(), false, "nothing out, nothing to say");
  m.start();
  socket.fire("gimmick-stroke", { userId: "u2", name: "Mike", color: "#e63946", on: true, cursor: [0.5, 0.5], stroke: { color: "#e63946", size: 6, pts: [[0.1, 0.1]] }, live: false });
  assert.equal(m.gimmicksOff(), true);
  assert.equal(m.open, false);
  assert.equal(m.strokeCount, 0);
  assert.equal(document.querySelectorAll("#arOthers .ar-brush").length, 0);
  assert.ok(document.getElementById("arLayer").classList.contains("hidden"));
});
