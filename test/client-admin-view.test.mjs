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

// ---- The prompt library editor ----
const { promptEditorHtml, promptRowHtml, readPromptEditor, slugId, PROMPT_POOLS } = await import("../public/js/admin-view.js");
const { mount } = await import("./dom.mjs");
const { readFileSync } = await import("node:fs");
const LIB = JSON.parse(readFileSync(new URL("../content/prompts.json", import.meta.url), "utf-8"));

test("every pool of the library is an editable section, simple scenarios first", () => {
  const html = promptEditorHtml(LIB);
  const pools = [...html.matchAll(/data-pool="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(pools[0], "prompts");
  for (const p of PROMPT_POOLS) assert.ok(pools.includes(p.path.join(".")), p.title);
  assert.ok(pools.includes("intermediate.tropeGroups"));
  assert.ok(html.includes(`(${LIB.prompts.length})`), "the simple pool shows its count");
  assert.equal((html.match(/class="pe-row"/g) || []).length,
    PROMPT_POOLS.filter((p) => p.kind === "items").reduce((n, p) => n + p.path.reduce((o, k) => o[k], LIB).length, 0));
  assert.match(html, /id="promptSave"/);
  // a trope row picks its group from the named groups; a season its age
  assert.match(html, /<select data-field="group">[\s\S]*value="setting-au"/);
  assert.match(html, /<select data-field="ageGroup">/);
  // labels are data, always escaped
  assert.match(promptRowHtml({ id: "x", label: "<b>" }, PROMPT_POOLS[3]), /&lt;b&gt;/);
});

test("the editor round-trips the library byte-for-byte, and edits read back", () => {
  const root = mount(promptEditorHtml(LIB));
  const { doc, errors } = readPromptEditor(root, LIB);
  assert.deepEqual(errors, []);
  assert.deepEqual(doc, LIB, "an untouched editor reads back the document it was built from");

  // edit a label, a weight, a rule, a simple line; add and remove rows
  const tropes = root.querySelector('[data-pool="intermediate.tropes"]');
  const first = tropes.querySelector(".pe-row");
  first.querySelector('[data-field="label"]').value = "Forced Proximity!";
  first.querySelector('[data-field="weight"]').value = "9";
  first.querySelector('[data-field="rules"]').value = '{"tags":["close"],"requiresTags":["together"]}';
  tropes.querySelector(".pe-row:last-child").remove();
  tropes.querySelector("tbody").insertAdjacentHTML("beforeend", promptRowHtml({}, PROMPT_POOLS.find((p) => p.title === "Tropes"), LIB.intermediate.tropeGroups));
  const added = tropes.querySelector(".pe-row:last-child");
  added.querySelector('[data-field="label"]').value = "Practice kissing, again";
  added.querySelector('[data-field="group"]').value = "practice";
  root.querySelector('[data-pool="prompts"] .pe-lines').value = "One.\n\n  Two.  \n";
  const out = readPromptEditor(root, LIB);
  assert.deepEqual(out.errors, []);
  const t0 = out.doc.intermediate.tropes[0];
  assert.equal(t0.id, LIB.intermediate.tropes[0].id, "an existing row keeps its id");
  assert.deepEqual(t0, { id: t0.id, label: "Forced Proximity!", text: "forced proximity!", weight: 9, group: t0.group, tags: ["close"], requiresTags: ["together"] });
  assert.equal(out.doc.intermediate.tropes.length, LIB.intermediate.tropes.length);
  assert.deepEqual(out.doc.intermediate.tropes.at(-1), { id: "practice-kissing-again", label: "Practice kissing, again", text: "practice kissing, again", group: "practice" });
  assert.deepEqual(out.doc.prompts, ["One.", "Two."]);
  assert.equal(slugId("Heat / rut (A/B/O)"), "heat-rut-a-b-o");

  // a rules cell that isn't a JSON object is an error, not a silent drop
  first.querySelector('[data-field="rules"]').value = "tags: close";
  assert.match(readPromptEditor(root, LIB).errors[0], /rules must be a JSON object/);
  first.querySelector('[data-field="rules"]').value = "";
  root.querySelector('[data-pool="intermediate.tropeGroups"] .pe-lines').value = "practice = Practice\nbogus line";
  assert.match(readPromptEditor(root, LIB).errors[0], /isn't "id = Name"/);
});
