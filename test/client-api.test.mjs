import { test } from "node:test";
import assert from "node:assert/strict";
import { installLocalStorage } from "./client-storage.mjs";

installLocalStorage();
localStorage.setItem("cowriteAuth", "boot-token");
const { api, getToken, setToken } = await import("../public/js/api.js");

// fetch stub: records the last request, returns a scripted response
let lastReq = null;
let nextResponse = { ok: true, json: async () => ({}) };
globalThis.fetch = async (path, opts) => {
  lastReq = { path, ...opts };
  return nextResponse;
};

test("token boots from localStorage and setToken persists/clears", () => {
  assert.equal(getToken(), "boot-token");
  setToken("t2");
  assert.equal(getToken(), "t2");
  assert.equal(localStorage.getItem("cowriteAuth"), "t2");
  setToken(null);
  assert.equal(getToken(), null);
  assert.equal(localStorage.getItem("cowriteAuth"), null);
});

test("api attaches Authorization only when signed in, JSON-encodes bodies", async () => {
  setToken(null);
  nextResponse = { ok: true, json: async () => ({ fine: 1 }) };
  await api("/api/login", { user: "will" });
  assert.equal(lastReq.method, "POST");
  assert.equal(lastReq.headers.Authorization, undefined);
  assert.equal(lastReq.body, '{"user":"will"}');

  setToken("tok");
  await api("/api/me", null, "GET");
  assert.equal(lastReq.method, "GET");
  assert.equal(lastReq.headers.Authorization, "Bearer tok");
  assert.equal(lastReq.body, undefined);
});

test("api throws the server's error message on non-ok, with a fallback", async () => {
  nextResponse = { ok: false, json: async () => ({ error: "Wrong password." }) };
  await assert.rejects(() => api("/api/login", { user: "x" }), /Wrong password\./);
  nextResponse = { ok: false, json: async () => { throw new Error("not json"); } };
  await assert.rejects(() => api("/api/login", { user: "x" }), /Something went wrong\./);
});
