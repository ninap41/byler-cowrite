import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.mjs";

installDom();
const { adminGamesHtml, adminUsersHtml, agoLabel } = await import("../public/js/admin-view.js");

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

test("finished games are not offered for ending — only live ones are listed", () => {
  const html = adminGamesHtml([
    { code: "AAAA", name: "Snow Ball", phase: "writing", players: 3, lines: 12, hostName: "will" },
    { code: "BBBB", name: "", phase: "over", players: 2, lines: 40, hostName: "mike" },
  ]);
  assert.ok(html.includes("AAAA") && html.includes("Snow Ball"));
  assert.ok(!html.includes("BBBB"), "a finished game has nothing to moderate here");
  assert.ok(html.includes('data-admin-act="end" data-admin-target="AAAA"'));
  assert.ok(html.includes('data-admin-act="delete-game" data-admin-target="AAAA"'));
  assert.ok(html.includes('href="/game?code=AAAA"'), "and a way in");
  assert.match(adminGamesHtml([]), /No games are running/);
});

test("admin accounts are protected in the markup, everyone else gets a Remove button", () => {
  const html = adminUsersHtml(
    [
      { username: "ninaadmin", email: "n@x.com", admin: true, wordCount: 10, games: 1, lastSeen: NOW, online: true },
      { username: "jonathanb", email: "j@x.com", admin: false, wordCount: 0, games: 0, lastSeen: NOW - 40 * DAY },
    ],
    NOW,
  );
  assert.ok(!html.includes('data-admin-target="ninaadmin"'), "no Remove button for an admin");
  assert.ok(html.includes("protected"));
  assert.ok(html.includes('data-admin-act="delete-user" data-admin-target="jonathanb"'));
  assert.ok(html.includes("1 month ago"), "inactivity is spelled out, not a raw timestamp");
  assert.match(adminUsersHtml([], NOW), /No accounts yet/);
});

test("names, emails and titles are escaped — a moderator's page is not an injection surface", () => {
  const g = adminGamesHtml([{ code: "CCCC", name: "<img src=x onerror=1>", phase: "writing", players: 1, lines: 0, hostName: "<b>x</b>" }]);
  assert.ok(!g.includes("<img") && !g.includes("<b>x</b>"));
  const u = adminUsersHtml([{ username: "<script>", email: "<b>@x.com", admin: false, wordCount: 0, games: 0, lastSeen: NOW }], NOW);
  assert.ok(!u.includes("<script>") && !u.includes("<b>@"));
});

test("agoLabel reads as a gap, and says so when there is no sign-in at all", () => {
  assert.equal(agoLabel(NOW, NOW), "today");
  assert.equal(agoLabel(NOW - DAY, NOW), "yesterday");
  assert.equal(agoLabel(NOW - 5 * DAY, NOW), "5 days ago");
  assert.equal(agoLabel(NOW - 400 * DAY, NOW), "1y ago");
  assert.equal(agoLabel(null, NOW), "never signed in");
});
