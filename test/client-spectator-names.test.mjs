import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.mjs";

installDom();
const { SPECTATOR_NAMES, getSpectatorName } = await import("../public/js/spectator-names.js");

test("spectator identity: Stranger Things name + number, minted once, kept in localStorage", () => {
  localStorage.removeItem("cowriteSpecName");
  const name = getSpectatorName();
  const m = name.match(/^(.+) #(\d{1,2})$/);
  assert.ok(m, "looks like 'Something #NN': " + name);
  assert.ok(SPECTATOR_NAMES.includes(m[1]), "base name comes from the list");
  const n = Number(m[2]);
  assert.ok(n >= 1 && n <= 99, "number in range");
  assert.equal(localStorage.getItem("cowriteSpecName"), name, "persisted client-side");
  assert.equal(getSpectatorName(), name, "stable across calls: one identity per browser");
});

test("spectator name list is non-trivial and unique", () => {
  assert.ok(SPECTATOR_NAMES.length >= 15, "a real list to draw from");
  assert.equal(new Set(SPECTATOR_NAMES).size, SPECTATOR_NAMES.length, "no duplicates");
});
