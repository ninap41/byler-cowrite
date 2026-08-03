import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom, mount } from "./dom.mjs";

installDom();
const { wireAuthForms } = await import("../public/js/components/auth-forms.js");

// Minimal homepage auth markup (same ids as index.html).
const MARKUP = `
  <div id="authChoice">
    <button id="chLogin"></button><button id="chSignup"></button>
    <a id="chForgot"></a><a id="chForgotUser"></a>
  </div>
  <div id="authPanes" class="hidden">
    <div data-auth-pane="login" class="hidden">
      <input id="liUser" /><input id="liPass" /><button id="liBtn"></button>
      <a id="liForgot"></a><a id="liForgotUser"></a>
    </div>
    <div data-auth-pane="signup" class="hidden">
      <input id="suEmail" /><input id="suUser" /><input id="suPass" /><button id="suBtn"></button>
    </div>
    <div data-auth-pane="forgot" class="hidden">
      <input id="fgEmail" /><button id="fgFind"></button>
      <div id="fgResult" class="hidden"><b id="fgUser"></b><button id="fgSend"></button></div>
    </div>
    <div data-auth-pane="forgotuser" class="hidden">
      <input id="fuEmail" /><button id="fuFind"></button>
      <p id="fuResult" class="hidden"><b id="fuUser"></b></p>
    </div>
    <div id="authErr"></div>
    <a id="authBack"></a>
  </div>`;

function setup() {
  document.body.innerHTML = "";
  mount(MARKUP);
  const calls = [];
  let next = () => ({});
  const api = async (path, body) => {
    calls.push({ path, body });
    return next(path, body);
  };
  const signedIn = [];
  wireAuthForms(document, { api, onSignedIn: (u, t) => signedIn.push({ u, t }) });
  const $ = (id) => document.getElementById(id);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { $, calls, signedIn, setNext: (f) => (next = f), tick };
}

test("pane switching: choice -> login pane -> back", () => {
  const { $ } = setup();
  $("chLogin").onclick();
  assert.ok($("authChoice").classList.contains("hidden"));
  assert.ok(!$("authPanes").classList.contains("hidden"));
  assert.ok(!document.querySelector('[data-auth-pane="login"]').classList.contains("hidden"));
  assert.ok(document.querySelector('[data-auth-pane="signup"]').classList.contains("hidden"));
  $("authBack").onclick({ preventDefault: () => {} });
  assert.ok(!$("authChoice").classList.contains("hidden"));
});

test("login success calls onSignedIn; failure shows the server message", async () => {
  const { $, calls, signedIn, setNext, tick } = setup();
  $("liUser").value = " willthewise ";
  $("liPass").value = "1234";
  setNext(() => ({ user: { username: "willthewise" }, token: "tok1" }));
  $("liBtn").onclick();
  await tick();
  assert.deepEqual(calls[0], { path: "/api/login", body: { user: "willthewise", password: "1234" } });
  assert.equal(signedIn[0].t, "tok1");

  setNext(() => { throw new Error("Wrong password."); });
  $("liBtn").onclick();
  await tick();
  assert.equal($("authErr").textContent, "Wrong password.");
  assert.equal(signedIn.length, 1, "no extra sign-in");
});

test("signup posts email/username/password", async () => {
  const { $, calls, signedIn, setNext, tick } = setup();
  $("suEmail").value = "will@byers.com";
  $("suUser").value = "willthewise";
  $("suPass").value = "1234";
  setNext(() => ({ user: {}, token: "tok2" }));
  $("suBtn").onclick();
  await tick();
  assert.deepEqual(calls[0].body, { email: "will@byers.com", username: "willthewise", password: "1234" });
  assert.equal(signedIn[0].t, "tok2");
});

test("forgot flow reveals the username then sends the reset link", async () => {
  const { $, calls, setNext, tick } = setup();
  $("fgEmail").value = "will@byers.com";
  setNext(() => ({ username: "willthewise" }));
  $("fgFind").onclick();
  await tick();
  assert.equal($("fgUser").textContent, "willthewise");
  assert.ok(!$("fgResult").classList.contains("hidden"));
  setNext(() => ({ ok: true }));
  $("fgSend").onclick();
  await tick();
  assert.equal(calls[1].path, "/api/send-reset");
  assert.equal($("fgSend").disabled, true);
  assert.match($("fgSend").textContent, /Link sent/);
});
