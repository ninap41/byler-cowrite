import { test } from "node:test";
import assert from "node:assert/strict";
import { reconnectOutcome, adoptSeatId } from "../public/js/components/seat-identity.js";

// The bug behind "kicked after a while, fixed by a refresh": the page kept
// comparing against the socket id it joined with. These pin the client half.

test("reconnectOutcome: a good ack hands the page its NEW id and the host id", () => {
  const out = reconnectOutcome({ ok: true, hostId: "new-host" }, "new-me", "old-host");
  assert.deepEqual(out, { kind: "seated", myId: "new-me", hostId: "new-host" });
});

test("reconnectOutcome: an ack without hostId keeps the host the page knew", () => {
  const out = reconnectOutcome({ ok: true }, "new-me", "old-host");
  assert.equal(out.hostId, "old-host");
  assert.equal(out.myId, "new-me");
});

test("reconnectOutcome: an expired seat or dead game is 'gone', never silent", () => {
  assert.equal(reconnectOutcome({ ok: false, error: "Seat expired." }, "x", "h").kind, "gone");
  assert.equal(reconnectOutcome(undefined, "x", "h").kind, "gone");
});

test("reconnectOutcome: a gated re-entry is 'pending'", () => {
  assert.equal(reconnectOutcome({ ok: true, pending: true }, "x", "h").kind, "pending");
});

test("adoptSeatId: leaves myId alone while a writer still wears it", () => {
  const writers = [{ id: "a", userId: 1 }, { id: "b", userId: 2 }];
  assert.equal(adoptSeatId(writers, "a", 1), null);
});

test("adoptSeatId: adopts the seat wearing my account when my id is gone", () => {
  const writers = [{ id: "a2", userId: 1, connected: true }, { id: "b", userId: 2 }];
  assert.equal(adoptSeatId(writers, "a", 1), "a2");
});

test("adoptSeatId: never adopts a ghost, another account, or without an account", () => {
  assert.equal(adoptSeatId([{ id: "a2", userId: 1, connected: false }], "a", 1), null);
  assert.equal(adoptSeatId([{ id: "b", userId: 2 }], "a", 1), null);
  assert.equal(adoptSeatId([{ id: "b", userId: 2 }], "a", null), null);
  assert.equal(adoptSeatId(undefined, "a", 1), null);
});
