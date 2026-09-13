// Will's Art Room gimmick's client half (components/art-room.js) on jsdom:
// the layer/swatch builders, the relay, and the brush asking the server
// first. jsdom has no canvas 2d context — the mount guards it — so here we
// pin the wiring and the shared stroke state, not the pixels.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.mjs";

installDom();
const { layerHtml, swatchRowHtml, sizeRowHtml, BRUSH_SIZES, mountArtRoom } =
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

test("sizeRowHtml: one self-previewing dot per brush size, the default selected", () => {
  const h = sizeRowHtml(6);
  assert.equal((h.match(/ar-size/g) || []).length >= BRUSH_SIZES.length, true, "a dot per size");
  for (const b of BRUSH_SIZES) assert.match(h, new RegExp(`data-size="${b.size}"`), b.id + " on offer");
  assert.match(h, /class="ar-size on" data-size="6"/, "the default wears the ring");
});

test("picking a size changes the brush: the next stroke goes out at that width", () => {
  document.body.innerHTML = "";
  const socket = fakeSocket(() => ({ ok: true }));
  const m = mountArtRoom({ socket, getMyUserId: () => "u1", getMyColor: () => "#6c8cff", document });
  m.start();
  assert.equal(m.size, 6, "the default brush");
  const broad = document.querySelector('#arSizes [data-size="14"]');
  broad.dispatchEvent(new window.Event("click", { bubbles: true }));
  assert.equal(m.size, 14, "the pick sticks");
  assert.ok(broad.classList.contains("on"), "and wears the ring");
  assert.equal(document.querySelectorAll("#arSizes .ar-size.on").length, 1, "one size at a time");
  m.exit();
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
  assert.equal(m.open, true, "a cooldown just means 'again already?', paint on");
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

test("every painter has a layer of their own: an eraser only takes its owner's paint, and the newest painter blits on top", () => {
  document.body.innerHTML = "";
  const socket = fakeSocket();
  const m = mountArtRoom({ socket, getMyUserId: () => "u1", getMyColor: () => "#6c8cff", document });
  socket.fire("gimmick-stroke", { userId: "u2", on: true, stroke: { color: "#e63946", size: 6, pts: [[0.1, 0.1], [0.2, 0.2]] }, live: false });
  socket.fire("gimmick-stroke", { userId: "u3", on: true, stroke: { color: "#3ddc84", size: 6, pts: [[0.1, 0.1], [0.2, 0.2]] }, live: false });
  assert.deepEqual(m.layerOrder, ["u2", "u3"], "later painter on top");
  // u3 erases straight across u2's line: u2's paint is untouched — the erase
  // lives on u3's own layer
  socket.fire("gimmick-stroke", { userId: "u3", on: true, stroke: { color: "#3ddc84", size: 6, erase: true, pts: [[0.0, 0.2], [0.3, 0.0]] }, live: false });
  assert.equal(m.strokesOf("u2"), 1, "u2's stroke is still theirs");
  assert.equal(m.strokesOf("u3"), 2, "the erase is u3's own stroke");
  // u2 paints again and comes to the top
  socket.fire("gimmick-stroke", { userId: "u2", on: true, stroke: { color: "#e63946", size: 6, pts: [[0.5, 0.5]] }, live: true });
  assert.deepEqual(m.layerOrder, ["u3", "u2"], "the newest stroke brings its painter's layer to the top");
  // a wipe empties one layer and no other
  socket.fire("gimmick-stroke", { userId: "u3", wipe: true });
  assert.equal(m.strokesOf("u3"), 0);
  assert.equal(m.strokesOf("u2"), 1);
});

test("swatch state: the picker becomes the selected swatch and the eraser lets go; a swatch click un-selects the picker", () => {
  document.body.innerHTML = "";
  const socket = fakeSocket();
  const m = mountArtRoom({ socket, getMyUserId: () => "u1", getMyColor: () => "#6c8cff", document });
  m.start();
  const eraser = document.querySelector(".ar-eraser");
  eraser.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(m.erase, true);
  assert.ok(eraser.classList.contains("on"));
  const pick = document.getElementById("arPick");
  pick.value = "#123456";
  pick.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(m.erase, false, "picking a colour puts the eraser down");
  assert.equal(m.color, "#123456");
  assert.ok(pick.classList.contains("on"), "the picker is the selected swatch");
  assert.ok(!eraser.classList.contains("on"));
  const sw = document.querySelector(".ar-swatch[data-color]");
  sw.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.ok(sw.classList.contains("on"));
  assert.ok(!pick.classList.contains("on"), "a swatch click un-selects the picker");
});

test("black and white swatches paint as themselves (no palette fallback), and the picker follows the chosen swatch", () => {
  document.body.innerHTML = "";
  const socket = fakeSocket();
  const m = mountArtRoom({ socket, getMyUserId: () => "u1", getMyColor: () => "#6c8cff", document });
  m.start();
  const black = document.querySelector('.ar-swatch[data-color="#16161d"]');
  const white = document.querySelector('.ar-swatch[data-color="#f5f0e8"]');
  assert.ok(black && white, "the presets carry black and white");
  black.click();
  assert.equal(m.color, "#16161d");
  assert.equal(document.getElementById("arPick").value, "#16161d", "the picker shows black");
  white.click();
  assert.equal(m.color, "#f5f0e8");
  assert.equal(document.getElementById("arPick").value, "#f5f0e8");
});

test("the brush never paints over the chat section: a press on it starts nothing, and a stroke dragged into it lifts", () => {
  document.body.innerHTML = '<div id="chatCard"></div>';
  const dock = document.querySelector("#chatCard");
  dock.getBoundingClientRect = () => ({ left: 700, right: 1000, top: 500, bottom: 760, width: 300, height: 260 });
  const socket = fakeSocket();
  const m = mountArtRoom({ socket, getMyUserId: () => "u1", getMyColor: () => "#6c8cff", document });
  m.start();
  const catcher = document.getElementById("arCatch");
  const ev = (type, x, y) => {
    const e = new window.Event(type, { bubbles: true });
    Object.assign(e, { clientX: x, clientY: y, button: 0, pointerId: 1 });
    catcher.dispatchEvent(e);
  };
  ev("pointerdown", 800, 600); // on the chat
  ev("pointermove", 820, 620);
  ev("pointerup", 820, 620);
  const strokesSent = () => socket.sent.filter(([e, d]) => e === "gimmick-stroke" && d?.stroke).length;
  assert.equal(strokesSent(), 0, "a press on the chat paints nothing");
  ev("pointerdown", 100, 100); // clear canvas
  ev("pointermove", 150, 150);
  ev("pointermove", 850, 650); // dragged into the chat: the brush lifts here
  const before = strokesSent();
  ev("pointermove", 860, 660);
  assert.equal(strokesSent(), before, "no more of the stroke lands once it crossed into the chat");
  assert.equal(m.strokesOf("u1"), 1, "the part painted outside the chat is kept");
  const committed = socket.sent.filter(([e, d]) => e === "gimmick-stroke" && d?.stroke && d.live === false).at(-1)[1].stroke;
  assert.ok(committed.pts.every(([x]) => x * window.innerWidth < 700), "and none of its points sit over the chat");
});
