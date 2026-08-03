import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.mjs";

installDom();
const { mountChrome, mountKofi, KOFI_ACCOUNT, KOFI_CONFIG } = await import("../public/js/chrome.js");

test("mountChrome injects shared chrome + the ko-fi widget loader", () => {
  document.body.innerHTML = "";
  mountChrome({ page: "dashboard" });
  assert.ok(document.querySelector(".bg-layers"), "background layers injected");
  assert.ok(document.getElementById("navDrawer"), "nav drawer injected");
  assert.ok(document.getElementById("themeSwitch"), "theme switch injected");
  assert.equal(document.querySelector('#navDrawer a[aria-current="page"]').getAttribute("href"), "/dashboard");
  const s = document.querySelector('script[src^="https://storage.ko-fi.com/"]');
  assert.ok(s, "ko-fi loader script appended");
  assert.equal(s.async, true);
});

test("ko-fi widget draws with the right account + floating-chat config once loaded", () => {
  document.body.innerHTML = "";
  const calls = [];
  window.kofiWidgetOverlay = { draw: (acct, cfg) => calls.push({ acct, cfg }) };
  const s = mountKofi(document);
  s.onload(); // simulate the CDN script arriving
  assert.equal(calls.length, 1, "widget rendered");
  assert.equal(calls[0].acct, "justthegatekeeper");
  assert.equal(calls[0].acct, KOFI_ACCOUNT);
  assert.equal(calls[0].cfg.type, "floating-chat");
  assert.equal(calls[0].cfg["floating-chat.donateButton.text"], "Support me");
  assert.equal(calls[0].cfg["floating-chat.donateButton.background-color"], "#00b9fe");
  assert.equal(calls[0].cfg["floating-chat.donateButton.text-color"], "#fff");
  assert.deepEqual(calls[0].cfg, KOFI_CONFIG);
  delete window.kofiWidgetOverlay;
});

test("ko-fi loader survives the CDN script failing to define the overlay", () => {
  document.body.innerHTML = "";
  const s = mountKofi(document);
  s.onload(); // no kofiWidgetOverlay global -> must not throw
});
