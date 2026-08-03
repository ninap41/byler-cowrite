import { test } from "node:test";
import assert from "node:assert/strict";
import { PALETTE, esc, safeColor, whoMarks, miniAvatar } from "../public/js/util.js";

test("miniAvatar: img with fit class when set, empty otherwise, url escaped", () => {
  const cover = miniAvatar({ avatar: "https://img.com/a.png" });
  assert.ok(cover.includes('class="mini-avatar fit-cover"'), "cover is the default fit");
  assert.ok(cover.includes('src="https://img.com/a.png"'));
  assert.ok(miniAvatar({ avatar: "https://img.com/a.png", avatarFit: "contain" }).includes("fit-contain"));
  assert.ok(miniAvatar({ avatar: "https://img.com/a.png", avatarFit: "junk" }).includes("fit-cover"), "unknown fit falls back");
  assert.equal(miniAvatar({ avatar: "" }), "");
  assert.equal(miniAvatar(null), "");
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

test("whoMarks: crown for hosts (either flag), nothing otherwise", () => {
  assert.match(whoMarks({ host: true }), /👑/);
  assert.match(whoMarks({ isHost: true }), /👑/);
  assert.equal(whoMarks({ host: false }), "");
  assert.equal(whoMarks(null), "");
});
