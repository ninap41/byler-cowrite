import { test } from "node:test";
import assert from "node:assert/strict";
import { installLocalStorage } from "./client-storage.mjs";

installLocalStorage();
const { setToken, getToken } = await import("../public/js/api.js");
const { requireAuth, redirectIfSignedIn } = await import("../public/js/auth-guard.js");

let navved = null;
const nav = (url) => (navved = url);

test("requireAuth: no token -> redirect, resolves null", async () => {
  setToken(null);
  navved = null;
  assert.equal(await requireAuth("/", nav), null);
  assert.equal(navved, "/");
});

test("requireAuth: valid token -> resolves the account, no redirect", async () => {
  setToken("tok");
  navved = null;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ user: { username: "will" } }) });
  const u = await requireAuth("/", nav);
  assert.equal(u.username, "will");
  assert.equal(navved, null);
});

test("requireAuth: stale token -> cleared + redirect", async () => {
  setToken("stale");
  navved = null;
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: "Not signed in." }) });
  assert.equal(await requireAuth("/index.html", nav), null);
  assert.equal(navved, "/index.html");
  assert.equal(getToken(), null, "stale token cleared");
});

test("requireAuth: a network blip or a 5xx redirects but keeps the token", async () => {
  setToken("fine");
  navved = null;
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  assert.equal(await requireAuth("/", nav), null);
  assert.equal(navved, "/");
  assert.equal(getToken(), "fine", "not logged out by a blip");
  globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => ({}) });
  assert.equal(await requireAuth("/", nav), null);
  assert.equal(getToken(), "fine", "nor by a bad gateway");
});

test("redirectIfSignedIn only bounces when a token exists", () => {
  setToken(null);
  navved = null;
  assert.equal(redirectIfSignedIn("/dashboard.html", nav), false);
  assert.equal(navved, null);
  setToken("tok");
  assert.equal(redirectIfSignedIn("/dashboard.html", nav), true);
  assert.equal(navved, "/dashboard.html");
});
