import { test } from "node:test";
import assert from "node:assert/strict";
import { PALETTE, esc, safeColor, whoMarks, miniAvatar, oneLinePrompt } from "../public/js/util.js";

test("miniAvatar: img with fit class when set, empty otherwise, url escaped", () => {
  const cover = miniAvatar({ avatar: "https://img.com/a.png" });
  assert.ok(cover.includes('class="mini-avatar fit-cover"'), "cover is the default fit");
  assert.ok(cover.includes('src="https://img.com/a.png"'));
  assert.ok(miniAvatar({ avatar: "https://img.com/a.png", avatarFit: "contain" }).includes("fit-contain"));
  assert.ok(miniAvatar({ avatar: "https://img.com/a.png", avatarFit: "junk" }).includes("fit-cover"), "unknown fit falls back");
  assert.equal(miniAvatar({ avatar: "" }), "", "no picture and no name renders nothing");
  assert.equal(miniAvatar(null), "");
  // no picture but a name -> colored disc with the initial
  const disc = miniAvatar({ name: "willthewise", color: "#6c8cff" });
  assert.ok(disc.includes("mini-initial"));
  assert.ok(disc.includes("background:#6c8cff"), "disc takes the chosen color");
  assert.ok(disc.includes(">W<"), "first letter, uppercased");
  assert.ok(miniAvatar({ username: "mikey", color: "bad" }).includes(">M<"), "username works too; bad colors fall back");
  assert.ok(miniAvatar({ avatar: 'https://a.com/"x"' }).includes("&quot;x&quot;"), "attr escaped");
});

test("esc escapes every HTML-significant character", () => {
  assert.equal(esc(`<b>&"'`), "&lt;b&gt;&amp;&quot;&#39;");
  assert.equal(esc("plain text"), "plain text");
  assert.equal(esc(123), "123", "coerces non-strings");
  assert.equal(esc('<img src=x onerror="a()">'), "&lt;img src=x onerror=&quot;a()&quot;&gt;");
});

test("safeColor only passes palette colors through", () => {
  for (const c of PALETTE) assert.equal(safeColor(c), c);
  assert.equal(safeColor("red"), PALETTE[0]);
  assert.equal(safeColor('"><script>'), PALETTE[0]);
  assert.equal(safeColor(undefined), PALETTE[0]);
});

test("whoMarks: (host) tag for hosts (either flag), nothing otherwise", () => {
  assert.match(whoMarks({ host: true }), /\(host\)/);
  assert.match(whoMarks({ isHost: true }), /\(host\)/);
  assert.equal(whoMarks({ host: false }), "");
  assert.equal(whoMarks(null), "");
});

// ---- prompts used as titles ----
test("oneLinePrompt collapses a bulleted guided prompt for card titles", () => {
  const guided = "\u2022 Set this after Vecna.\n\u2022 They are alone in the basement.\n\u2022 Keep it tender.";
  assert.equal(oneLinePrompt(guided), "Set this after Vecna. They are alone in the basement. Keep it tender.");
  // a curated prompt passes through untouched, and blanks stay blank
  assert.equal(oneLinePrompt("Mike finds the drawing."), "Mike finds the drawing.");
  for (const blank of ["", null, undefined]) assert.equal(oneLinePrompt(blank), "");
  // a bullet inside a clause is not a line start and survives
  assert.equal(oneLinePrompt("\u2022 a \u2022 b\n\u2022 c"), "a \u2022 b c");
  assert.equal(oneLinePrompt("\n\n\u2022 only\n\n"), "only");
});
