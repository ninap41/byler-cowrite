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

test("game.html routes a from=discord link through the confirm and joins only from the button", () => {
  const html = readFileSync(new URL("../public/game.html", import.meta.url), "utf-8");
  assert.ok(html.includes('import { needsJoinConfirm, joinConfirmHtml } from "/js/join-confirm.js"'));
  assert.ok(html.includes('needsJoinConfirm(qs.get("from"))) confirmJoin(code)'));
  assert.ok(/\$\("joinConfirmBtn"\)\.onclick = \(\) => \{[\s\S]*?joinByCode\(code\)/.test(html));
  assert.ok(html.indexOf("confirmJoin(code)") < html.indexOf("else if (code) joinByCode(code)"), "the confirm check comes first");
});

test("the lobby carries its own host-only Share to Discord under the code; the drawer keeps one too", () => {
  const html = readFileSync(new URL("../public/game.html", import.meta.url), "utf-8");
  assert.ok(html.includes('id="discordLobbyBtn"') && html.includes('id="discordShareBtn"'));
  assert.ok(html.includes('$("lobbyShare").classList.toggle("hidden", !host)'), "shown to the host only");
  assert.ok(html.indexOf('id="codeDisplay"') < html.indexOf('id="discordLobbyBtn"') && html.indexOf('id="discordLobbyBtn"') < html.indexOf('id="rosterList"'), "under the code, above the roster");
});
