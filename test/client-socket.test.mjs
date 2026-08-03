import { test } from "node:test";
import assert from "node:assert/strict";
import { installLocalStorage } from "./client-storage.mjs";

installLocalStorage();
const { loadRejoin, saveRejoin, clearRejoin } = await import("../public/js/socket-client.js");

test("rejoin blob round-trips through localStorage", () => {
  assert.equal(loadRejoin(), null, "empty storage -> null");
  saveRejoin("AB12", "seat-token");
  assert.deepEqual(loadRejoin(), { code: "AB12", token: "seat-token" });
  clearRejoin();
  assert.equal(loadRejoin(), null);
});

test("loadRejoin rejects corrupt or partial blobs", () => {
  localStorage.setItem("cowriteRejoin", "{not json");
  assert.equal(loadRejoin(), null);
  localStorage.setItem("cowriteRejoin", JSON.stringify({ code: "AB12" })); // no token
  assert.equal(loadRejoin(), null);
  localStorage.setItem("cowriteRejoin", JSON.stringify({ token: "t" })); // no code
  assert.equal(loadRejoin(), null);
  localStorage.setItem("cowriteRejoin", "null");
  assert.equal(loadRejoin(), null);
});
