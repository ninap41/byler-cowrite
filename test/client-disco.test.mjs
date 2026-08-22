// The Rink-O-Mania Disco Ball gimmick's client half (components/disco-ball.js)
// on jsdom: the mirror-ball builder, the shared layer, the relay, and the spin
// asking the server first. The light sweep runs on rAF, which jsdom doesn't
// do — the mount guards it, so here we pin the wiring, not the sweep.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.mjs";

installDom();
const { BALL_W, ballSvg, layerHtml, spotColors, mountDiscoBall } =
  await import("../public/js/components/disco-ball.js");

test("ballSvg: ids suffixed per ball so two balls can share a page", () => {
  const a = ballSvg("me");
  assert.match(a, /id="dbshineme"/);
  assert.match(a, /class="db-facets"/, "the facet grid is what spins");
  const b = ballSvg("u2");
  assert.match(b, /id="dbshineu2"/);
  assert.ok(!b.includes("dbshineme"), "no id collisions between balls");
});

test("layerHtml: lights box, my ball, others' box, HUD with spin/way out", () => {
  const h = layerHtml();
  for (const id of ["dbLayer", "dbLights", "dbOthers", "dbBall", "dbHud", "dbHint"]) assert.match(h, new RegExp(`id="${id}"`));
  for (const act of ["db-spin", "db-exit"]) assert.match(h, new RegExp(`data-act="${act}"`));
});

test("spotColors: the owner leads, the table follows, junk colours fall back", () => {
  const c = spotColors("#e63946", ["#3ddc84", "#6c8cff"], 5);
  assert.deepEqual(c, ["#e63946", "#3ddc84", "#6c8cff", "#e63946", "#3ddc84"]);
  assert.ok(!spotColors("red;url(x)", [], 1)[0].includes("url(x)"), "junk colours fall back");
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

test("mountDiscoBall: start hangs MY ball (relayed as fractions), spin asks the server, exit puts it away for the room", () => {
  document.body.innerHTML = "";
  const socket = fakeSocket(() => ({ ok: true }));
  const m = mountDiscoBall({ socket, getMyUserId: () => "u1", getMyColor: () => "#6c8cff", getMyName: () => "me", document });
  const layer = document.getElementById("dbLayer");
  assert.ok(layer.classList.contains("hidden"), "closed until a ball is out");
  m.start();
  assert.equal(m.open, true);
  assert.ok(!layer.classList.contains("hidden"));
  assert.ok(document.getElementById("dbBall").querySelector(".db-chain"), "the ball hangs by a chain");
  const rep = socket.sent.find(([ev]) => ev === "gimmick-ball");
  assert.ok(rep, "the ball is relayed");
  assert.equal(rep[1].on, true);
  assert.ok(rep[1].x >= 0 && rep[1].x <= 1 && rep[1].y >= 0 && rep[1].y <= 1, "as fractions");
  m.spin();
  assert.ok(socket.sent.some(([ev]) => ev === "gimmick-spin"), "a spin asks the server first");
  m.exit();
  assert.equal(m.open, false);
  assert.ok(layer.classList.contains("hidden"));
  assert.deepEqual(socket.sent.at(-1), ["gimmick-ball", { on: false }], "the table sees the ball leave");
});

test("a refused spin shows the server's reason and lights nothing", () => {
  document.body.innerHTML = "";
  const socket = fakeSocket((d) => (d && Object.keys(d).length === 0 ? { ok: false, error: "The ball is still spinning…" } : { ok: true }));
  const m = mountDiscoBall({ socket, getMyUserId: () => "u1", getMyColor: () => "#6c8cff", document });
  m.start();
  m.spin();
  assert.equal(document.getElementById("dbHint").textContent, "The ball is still spinning…");
  assert.equal(m.spotCount, 0, "no lights without the server's ok");
  m.exit();
});

test("others' balls: relayed balls are painted and tagged, and leave; a late list lands whole", () => {
  document.body.innerHTML = "";
  const socket = fakeSocket();
  const m = mountDiscoBall({ socket, getMyUserId: () => "u1", getMyColor: () => "#6c8cff", document });
  const layer = document.getElementById("dbLayer");
  socket.fire("gimmick-ball", { userId: "u2", name: "Mike", color: "#e63946", x: 0.5, y: 0.5, on: true });
  assert.ok(!layer.classList.contains("hidden"), "someone else's ball shows the layer");
  const ball = document.querySelector("#dbOthers .db-ball");
  assert.equal(ball.querySelector(".db-tag").textContent, "Mike");
  // my own echo is ignored
  socket.fire("gimmick-ball", { userId: "u1", name: "me", color: "#6c8cff", x: 0, y: 0, on: true });
  assert.equal(document.querySelectorAll("#dbOthers .db-ball").length, 1);
  // a late joiner's list
  socket.fire("gimmick-balls", [{ userId: "u3", name: "Dustin", color: "#3ddc84", x: 0.2, y: 0.1 }]);
  assert.equal(document.querySelectorAll("#dbOthers .db-ball").length, 2);
  assert.deepEqual(m.others.sort(), ["u2", "u3"]);
  socket.fire("gimmick-ball", { userId: "u2", on: false });
  socket.fire("gimmick-ball", { userId: "u3", on: false });
  assert.equal(document.querySelectorAll("#dbOthers .db-ball").length, 0);
  assert.ok(layer.classList.contains("hidden"), "no balls, no layer");
});

test("a relayed spin spawns one bounded show per owner (repeat replaces, cap trims the oldest)", () => {
  document.body.innerHTML = "";
  const socket = fakeSocket();
  const m = mountDiscoBall({ socket, getMyUserId: () => "u1", getMyColor: () => "#6c8cff", getTableColors: () => ["#3ddc84"], document });
  socket.fire("gimmick-ball", { userId: "u2", name: "Mike", color: "#e63946", x: 0.5, y: 0.5, on: true });
  socket.fire("gimmick-spin", { userId: "u2", name: "Mike", color: "#e63946", duration: 8000 });
  assert.equal(m.spotCount, 8, "one show is 8 spots");
  assert.ok(document.querySelectorAll("#dbLights .db-spot").length === 8);
  socket.fire("gimmick-spin", { userId: "u2", name: "Mike", color: "#e63946", duration: 8000 });
  assert.equal(m.spotCount, 8, "a repeat spin replaces its owner's show");
  socket.fire("gimmick-spin", { userId: "u3", name: "Dustin", color: "#3ddc84", duration: 8000 });
  assert.equal(m.spotCount, 16, "two shows side by side");
  socket.fire("gimmick-spin", { userId: "u4", name: "Will", color: "#6c8cff", duration: 8000 });
  assert.equal(m.spotCount, 16, "the cap trims the oldest show");
});

test("gimmicksOff: a friendly switch sweeps every ball and light away and reports whether anything was out", () => {
  document.body.innerHTML = "";
  const socket = fakeSocket();
  const m = mountDiscoBall({ socket, getMyUserId: () => "u1", getMyColor: () => "#6c8cff", document });
  assert.equal(m.gimmicksOff(), false, "nothing out, nothing to say");
  m.start();
  socket.fire("gimmick-ball", { userId: "u2", name: "Mike", color: "#e63946", x: 0.5, y: 0.5, on: true });
  socket.fire("gimmick-spin", { userId: "u2", name: "Mike", color: "#e63946", duration: 8000 });
  assert.equal(m.gimmicksOff(), true);
  assert.equal(m.open, false);
  assert.equal(m.spotCount, 0);
  assert.equal(document.querySelectorAll("#dbOthers .db-ball").length, 0);
  assert.ok(document.getElementById("dbLayer").classList.contains("hidden"));
});
