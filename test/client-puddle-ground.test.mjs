// The puddle ground shared by the milkshake and the SuperSoaker
// (components/puddle-ground.js): the reference's merging-pool model, keyed
// by OWNER so a wipe mops one person's mess and nobody else's. Runs with no
// canvas at all — the model is geometry, the paint is optional.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGround, shade, radiusFor, FLOOR_LIFT } from "../public/js/components/puddle-ground.js";

const fakeWin = (footbar = 40) => ({
  innerWidth: 1000,
  innerHeight: 800,
  devicePixelRatio: 1,
  getComputedStyle: () => ({ getPropertyValue: () => `${footbar}px` }),
});
const fakeDoc = { documentElement: {} };

test("shade darkens and lightens a hex, and passes junk through", () => {
  assert.equal(shade("#808080", 0.5), "#404040");
  assert.equal(shade("#808080", 1.5), "#c0c0c0");
  assert.equal(shade("red", 0.5), "red");
});

test("the floor line sits FLOOR_LIFT above the foot bar, read off --footbar-h", () => {
  const g = createGround({ win: fakeWin(48), doc: fakeDoc });
  g.resize();
  assert.equal(g.floorY, 800 - 48 - FLOOR_LIFT);
});

test("drops pool, and pools of one owner merge while another owner's stay apart", () => {
  const g = createGround({ win: fakeWin(), doc: fakeDoc, random: () => 0.5 });
  g.resize();
  g.add(100, 700, 4, "#ff0000", "u1");
  g.add(102, 700, 4, "#ff0000", "u1"); // right on top: joins the first pool
  assert.equal(g.puddles.length, 1, "same owner, same spot: one pool");
  assert.ok(g.puddles[0].rT > radiusFor(4 * 4 * 2.6) - 1e-9, "and it grew");
  g.add(101, 700, 4, "#ff0000", "u2"); // same spot, same colour, another owner
  assert.equal(g.puddles.length, 2, "another owner never merges in");
  assert.deepEqual(g.puddles.map((p) => p.owner), ["u1", "u2"]);
  assert.equal(g.flecks.length, 3, "every landing flecks");
  assert.ok(g.dirty, "the ground wants a repaint");
});

test("tick eases pools toward their target and reports when to repaint; draw clears the flag", () => {
  const g = createGround({ win: fakeWin(), doc: fakeDoc, random: () => 0.5 });
  g.resize();
  g.draw();
  assert.equal(g.tick(0.016), false, "nothing to do on an empty floor");
  g.add(100, 700, 4, "#ff0000", "u1");
  g.add(300, 700, 4, "#ff0000", "u1");
  assert.equal(g.tick(0.016), true);
  const before = g.puddles[0].r;
  g.tick(0.1);
  assert.ok(g.puddles[0].r > before, "the pool is spreading");
  g.draw();
  assert.equal(g.dirty, false);
});

test("wipe(owner) mops only that owner's mess; wipe() clears the lot", () => {
  const g = createGround({ win: fakeWin(), doc: fakeDoc, random: () => 0.5 });
  g.resize();
  g.add(100, 700, 4, "#ff0000", "u1");
  g.add(500, 700, 4, "#0000ff", "u2");
  g.add(900, 700, 4, "#00ff00", "u3");
  g.wipe("u2");
  assert.deepEqual(g.puddles.map((p) => p.owner), ["u1", "u3"]);
  assert.deepEqual(g.flecks.map((f) => f.owner), ["u1", "u3"]);
  g.wipe();
  assert.equal(g.puddles.length, 0);
  assert.equal(g.flecks.length, 0);
});
