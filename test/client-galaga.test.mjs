// The Palace Arcade Galaga gimmick's client half (components/galaga-game.js):
// pure builders + the mount on a fake socket, on jsdom. The rules live on the
// server (lib/gimmicks.js) — here we pin that the shared layer opens/closes,
// my battle is relayed to the room, others' battles are painted in their own
// colours, the run submits its score with the steal preference, and the ack
// paints the end card.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.mjs";

installDom();
const { GALAGA_TARGET, ROUND_SECS, POINTS, STEAL_KEY, galagaHtml, galagaResultHtml, shipShadow, mountGalaga } =
  await import("../public/js/components/galaga-game.js");
const dice = await import("../public/js/components/gimmick-dice.js");

test("the target is 8000 and the steal preference shares the dice's localStorage key", () => {
  assert.equal(GALAGA_TARGET, 8000);
  assert.equal(STEAL_KEY, dice.STEAL_KEY);
  assert.ok(ROUND_SECS > 0 && POINTS.dive > POINTS.bob);
});

test("galagaHtml: layer, my battle, others' box, HUD with score/time/steal/fire/way out", () => {
  const h = galagaHtml();
  for (const id of ["ggLayer", "ggMine", "ggOthers", "ggHud", "ggScore", "ggTime", "ggOver", "ggSteal"]) assert.match(h, new RegExp(`id="${id}"`));
  assert.match(h, /beat 8000 to steal the turn/);
  assert.match(h, /data-act="gg-fire"/);
  assert.match(h, /data-act="gg-exit"/);
});

test("shipShadow re-inks the accent pixels in the owner's colour (validated)", () => {
  assert.match(shipShadow("#e63946"), /0 -8px 0 #e63946/);
  assert.match(shipShadow("#e63946"), /#f6edff/);
  assert.ok(!shipShadow("red; background:url(x)").includes("url"), "junk colours fall back");
});

test("galagaResultHtml: every ending", () => {
  assert.match(galagaResultHtml({ score: 350, kind: "plain" }), /350[\s\S]*The fleet holds/);
  assert.match(galagaResultHtml({ score: 3200, kind: "highscore", stole: true }), /win">3,200[\s\S]*the turn is yours/);
  assert.match(galagaResultHtml({ score: 3200, kind: "highscore", stole: false, declined: true }), /let the writer keep the turn/);
  assert.match(galagaResultHtml({ score: 8200, kind: "highscore", stole: false }), /You beat 8000!/);
  assert.match(galagaResultHtml({ error: "This is a friendly game — gimmicks are off." }), /friendly game/);
  assert.match(galagaResultHtml({ score: 350, kind: "plain" }), /data-act="gg-again"/);
});

function fakeSocket(reply = () => ({ ok: true, score: 0, kind: "plain", stole: false })) {
  const handlers = {};
  const sent = [];
  return {
    sent,
    on: (ev, fn) => (handlers[ev] = fn),
    emit: (ev, data, ack) => (sent.push([ev, data]), ack?.(reply(data))),
    fire: (ev, data) => handlers[ev]?.(data),
  };
}

test("mountGalaga: start opens the shared layer, spawns MY fleet and relays the battle; finishing submits {score, steal}; exit puts the ship away", () => {
  document.body.innerHTML = "";
  const socket = fakeSocket((data) => ({ ok: true, score: data.score, kind: data.score > 8000 ? "highscore" : "plain", stole: false }));
  const g = mountGalaga({ socket, getMyUserId: () => "u1", getMyName: () => "willthewise", getMyColor: () => "#6c8cff", document });
  const layer = document.getElementById("ggLayer");
  assert.ok(layer.classList.contains("hidden"), "closed until a battle is on");
  g.start();
  assert.equal(g.open, true);
  assert.ok(!layer.classList.contains("hidden"));
  assert.ok(document.documentElement.classList.contains("gg-live"), "the arcade theme's own fleet is put away while a battle is on");
  assert.ok(document.querySelectorAll("#ggMine .gg-enemy").length >= 8, "my fleet is out");
  assert.match(document.querySelector("#ggMine .gg-ship").style.boxShadow, /#6c8cff/, "my ship wears my colour");
  assert.equal(document.querySelector("#ggMine .gg-ship-tag").textContent, "willthewise · 0", "my own name rides under my ship");
  const rep = socket.sent.find(([ev]) => ev === "gimmick-ship");
  assert.ok(rep, "the battle is relayed to the room");
  assert.equal(rep[1].on, true);
  assert.equal(rep[1].bees.length, 8);
  g.finishNow();
  const [ev, data] = socket.sent.filter(([e]) => e === "gimmick-galaga").at(-1);
  assert.equal(ev, "gimmick-galaga");
  assert.equal(data.score, 0);
  assert.equal(data.steal, true, "steal preference defaults on");
  const over = document.getElementById("ggOver");
  assert.ok(!over.classList.contains("hidden"), "the end card shows");
  assert.match(over.innerHTML, /The fleet holds/);
  g.exit();
  assert.equal(g.open, false);
  assert.ok(layer.classList.contains("hidden"));
  assert.ok(!document.documentElement.classList.contains("gg-live"), "the theme's fleet comes back");
  assert.deepEqual(socket.sent.at(-1), ["gimmick-ship", { on: false }], "the table sees my ship leave");
});

test("gimmicksOff: a friendly switch sweeps every battle away (instantly without gsap) and reports whether anything was out", () => {
  document.body.innerHTML = "";
  document.documentElement.className = "";
  const socket = fakeSocket();
  const g = mountGalaga({ socket, getMyUserId: () => "u1", getMyName: () => "me", getMyColor: () => "#6c8cff", document });
  assert.equal(g.gimmicksOff(), false, "nothing out, nothing to say");
  g.start();
  socket.fire("gimmick-ship", { userId: "u2", name: "Mike", color: "#e63946", x: 0.5, score: 0, on: true, bees: [], shots: [] });
  assert.equal(g.gimmicksOff(), true);
  assert.equal(g.open, false);
  assert.equal(document.querySelectorAll("#ggOthers .gg-battle").length, 0);
  assert.ok(document.getElementById("ggLayer").classList.contains("hidden"));
  assert.ok(!document.documentElement.classList.contains("gg-live"));
});

test("others' battles: relayed ships/bees/shots are painted in their colour, move, and leave; a late list lands whole; the layer shows for THEIR battle too", () => {
  document.body.innerHTML = "";
  const socket = fakeSocket();
  mountGalaga({ socket, getMyUserId: () => "u1", getMyColor: () => "#6c8cff", document });
  const layer = document.getElementById("ggLayer");
  socket.fire("gimmick-ship", { userId: "u2", name: "Mike", color: "#e63946", x: 0.5, score: 150, on: true, bees: [[0.2, 0.1, 0], [0.4, 0.5, 1]], shots: [[0.5, 0.7]] });
  assert.ok(!layer.classList.contains("hidden"), "someone else's battle shows the layer");
  const battle = document.querySelector("#ggOthers .gg-battle");
  assert.match(battle.querySelector(".gg-ship").style.boxShadow, /#e63946/, "their ship wears their colour");
  assert.equal(battle.querySelector(".gg-ship-tag").textContent, "Mike · 150");
  assert.equal(battle.querySelectorAll(".gg-enemy").length, 2);
  assert.ok(battle.querySelectorAll(".gg-enemy")[1].classList.contains("dive"));
  assert.equal(battle.querySelectorAll(".gg-shot").length, 1);
  // fewer sprites next frame: the extras leave
  socket.fire("gimmick-ship", { userId: "u2", name: "Mike", color: "#e63946", x: 0.6, score: 300, on: true, bees: [[0.3, 0.2, 0]], shots: [] });
  assert.equal(battle.querySelectorAll(".gg-enemy").length, 1);
  assert.equal(battle.querySelectorAll(".gg-shot").length, 0);
  assert.equal(battle.querySelector(".gg-ship-tag").textContent, "Mike · 300");
  // my own echo is ignored
  socket.fire("gimmick-ship", { userId: "u1", name: "me", color: "#6c8cff", x: 0.5, score: 0, on: true, bees: [], shots: [] });
  assert.equal(document.querySelectorAll("#ggOthers .gg-battle").length, 1);
  // a late joiner's list
  socket.fire("gimmick-ships", [{ userId: "u3", name: "Dustin", color: "#3ddc84", x: 0.2, score: 50, bees: [[0.1, 0.1, 0]], shots: [] }]);
  assert.equal(document.querySelectorAll("#ggOthers .gg-battle").length, 2);
  // they put the ship away
  socket.fire("gimmick-ship", { userId: "u2", on: false });
  socket.fire("gimmick-ship", { userId: "u3", on: false });
  assert.equal(document.querySelectorAll("#ggOthers .gg-battle").length, 0);
  assert.ok(layer.classList.contains("hidden"), "no battles, no layer");
});

test("a refused run (friendly game) paints the error instead of a score", () => {
  document.body.innerHTML = "";
  const socket = fakeSocket((data) => (data?.score !== undefined ? { ok: false, error: "This is a friendly game — gimmicks are off." } : undefined));
  const g = mountGalaga({ socket, getMyUserId: () => "u1", document });
  g.start();
  g.finishNow();
  assert.match(document.getElementById("ggOver").innerHTML, /friendly game/);
  g.exit();
});
