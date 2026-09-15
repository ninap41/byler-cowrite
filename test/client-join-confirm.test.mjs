// A game link from Discord confirms before seating: the builder names the
// game, host, seat count and phase, and game.html only joins on the button.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installDom } from "./dom.mjs";

installDom();
const { joinConfirmHtml, needsJoinConfirm } = await import("../public/js/join-confirm.js");

test("only a Discord link needs confirming; plain links join on load", () => {
  assert.ok(needsJoinConfirm("discord") && needsJoinConfirm("Discord"));
  assert.ok(!needsJoinConfirm(null) && !needsJoinConfirm("") && !needsJoinConfirm("dashboard"));
});

test("a lobby offers Join the lobby; a started game says the host will be asked", () => {
  const lobby = joinConfirmHtml({ code: "ABCD", name: "The <Snowball>", phase: "waiting", hostName: "mike", players: 1 });
  assert.ok(lobby.includes('id="joinConfirmBtn"') && lobby.includes("Join the lobby"));
  assert.ok(lobby.includes("The &lt;Snowball&gt;") && lobby.includes("Hosted by mike") && lobby.includes("1 writer ·"));
  assert.match(lobby, /take a seat in the lobby/);
  const live = joinConfirmHtml({ code: "ABCD", name: "", phase: "writing", players: 3 });
  assert.ok(live.includes("Ask to join “ABCD”?") && live.includes("3 writers"));
  assert.match(live, /host will be asked/);
  assert.ok(!live.includes("Hosted by"));
});

// the game page's script is emitted from client/pages/game.ts to public/js/pages/game.js
const script = () => readFileSync(new URL("../public/js/pages/game.js", import.meta.url), "utf-8");

test("game.html routes a from=discord link through the confirm and joins only from the button", () => {
  const html = script();
  assert.ok(html.includes('import { needsJoinConfirm, joinConfirmHtml } from "/js/join-confirm.js"'));
  assert.ok(html.includes('needsJoinConfirm(qs.get("from"))) confirmJoin(code)'));
  assert.ok(/\$\("joinConfirmBtn"\)\.onclick = \(\) => \{[\s\S]*?joinByCode\(code\)/.test(html));
  assert.ok(html.indexOf("confirmJoin(code)") < html.indexOf("else if (code) joinByCode(code)"), "the confirm check comes first");
});

test("the lobby carries its own host-only Share to Discord under the code; the drawer keeps one too", () => {
  const html = readFileSync(new URL("../public/game.html", import.meta.url), "utf-8");
  assert.ok(html.includes('id="discordLobbyBtn"') && html.includes('id="discordShareBtn"'));
  assert.ok(script().includes('$("lobbyShare").classList.toggle("hidden", !host)'), "shown to the host only");
  assert.ok(html.indexOf('id="codeDisplay"') < html.indexOf('id="discordLobbyBtn"') && html.indexOf('id="discordLobbyBtn"') < html.indexOf('id="rosterList"'), "under the code, above the roster");
});

test("both Share menus name the Byler Offscreen Discord and offer Copy game link", () => {
  const html = readFileSync(new URL("../public/game.html", import.meta.url), "utf-8");
  for (const id of ["lobbyShareMenu", "inviteShareMenu"]) {
    const at = html.indexOf(`class="mg-menu seat-menu share-menu" id="${id}"`);
    assert.ok(at > -1, id + " is a share menu");
    const m = html.slice(at, html.indexOf("</span>\n", html.indexOf("</span>\n", at) + 1));
    assert.ok(m.includes(">Share to Byler Offscreen Discord<"), id + " names the server");
    assert.ok(m.includes('data-share="link"') && m.includes(">Copy game link<"), id + " offers the link");
  }
  const inv = html.indexOf('id="inviteShareMenu"');
  assert.ok(inv < html.indexOf('id="inviteFriend"') && html.indexOf('id="inviteBtn"') < html.indexOf('id="inviteNote"'), "the friend picker is a row of the share menu");
  // the menu stands in the session bar's actions, to the right of End game & reveal; no invite section remains
  const acts = html.slice(html.indexOf('id="hostGame"'), html.indexOf('id="inviteNote"'));
  assert.ok(acts.indexOf('id="endBtn"') < acts.indexOf('id="inviteShareMenu"'), "Share ▾ follows End game & reveal");
  assert.ok(!html.includes('id="inviteSec"'), "the invite section is gone");
  assert.ok(html.includes('id="inviteBtn" data-share="invite"'));
  assert.ok(script().includes('const copyGameLink = (note) => async () => {'));
  assert.ok(script().includes('location.origin + "/game?code=" + encodeURIComponent(myCode)'), "the link is the join URL");
});
