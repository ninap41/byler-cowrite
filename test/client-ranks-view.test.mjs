// The ranks & unlocks page's pure builders (public/js/ranks-view.js) — the
// ladder joined from the three public endpoints, theme screenshot cards with
// their no-image fallback, secret vs open word badges, and the gimmick
// rundown. Also pins that the page stays data-driven: builders read only
// what the APIs ship, so a future fandom pack redraws it without code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.mjs";
import { readFileSync } from "node:fs";

installDom();
const {
  buildLadder, ladderHtml, tierCardHtml, progressHtml, freeThemes, freeThemesHtml,
  usageListHtml, gimmickListHtml, gimmickCardHtml, themeThumbHtml, themeShotSrc,
} = await import("../public/js/ranks-view.js");

const TIERS = [
  { id: "outloud", name: "🔫 There. Out Loud.", min: 0, desc: "Made an account." },
  { id: "puppymike", name: "🐶 Puppy Mike", min: 5000, desc: "Write 5,000 words." },
  { id: "sorcerer", name: "🧙 Sorcerer", min: 20000, desc: "Write 20,000 words." },
];
// the wire shape: themeLocks()/gimmickLocks() ship {tier, name, min} — the
// builders also take a bare tier-id string (the gimmick test below uses those)
const LOCKS = {
  ink: { tier: "outloud", name: "🔫 There. Out Loud.", min: 0 },
  rink: { tier: "puppymike", name: "🐶 Puppy Mike", min: 5000 },
  hellfire: { tier: "sorcerer", name: "🧙 Sorcerer", min: 20000 },
};
const LABELS = { ink: "Inkwell", rink: "Rink-O-Mania", hellfire: "Hellfire Club", neon: "Neon Dusk" };
const GIMMICKS = [
  { id: "d20", icon: "🎲", name: "Hellfire d20", theme: "hellfire", desc: "Throw a d20." },
  { id: "supersoaker", icon: "🔫", name: "SuperSoaker", theme: "ink", desc: "Soak the game." },
];

test("buildLadder joins tiers to their themes and the gimmicks riding them", () => {
  const rows = buildLadder({ tiers: TIERS, themeLocks: LOCKS, themeLabels: LABELS, gimmicks: GIMMICKS });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0].themes.map((t) => t.label), ["Inkwell"]);
  assert.equal(rows[0].gimmicks[0].id, "supersoaker", "the gimmick rides its theme's tier");
  assert.equal(rows[1].gimmicks.length, 0, "a tier whose themes carry no gimmick gets none");
  assert.equal(rows[2].gimmicks[0].id, "d20");
});

test("a feature rides its rung as a chip, locked until the rung is earned", () => {
  const features = { labels: { reference: "Writers' reference palette" }, locks: { reference: { tier: "puppymike", name: "🐶 Puppy Mike", min: 5000 } } };
  const rows = buildLadder({ tiers: TIERS, themeLocks: LOCKS, themeLabels: LABELS, gimmicks: GIMMICKS, features });
  assert.deepEqual(rows[1].features, [{ id: "reference", name: "Writers' reference palette" }]);
  assert.deepEqual(rows[0].features, []);
  assert.match(tierCardHtml(rows[1], { me: { wordCount: 0 } }), /rk-feature-chip(?! unlocked)[^>]*>📖 Writers&#39; reference palette/);
  assert.match(tierCardHtml(rows[1], { me: { wordCount: 6000 } }), /rk-feature-chip unlocked/);
  assert.equal(buildLadder({ tiers: TIERS })[1].features.length, 0, "no features payload → none");
});

test("tier cards: earned/current from the viewer's words, theme thumbs wear lock or check", () => {
  const rows = buildLadder({ tiers: TIERS, themeLocks: LOCKS, themeLabels: LABELS, gimmicks: GIMMICKS });
  const html = ladderHtml(rows, { me: { wordCount: 6000 }, unlockedThemes: ["ink", "rink"] });
  document.body.innerHTML = html;
  const cards = [...document.querySelectorAll(".rk-tier")];
  assert.equal(cards.length, 3);
  assert.ok(cards[0].classList.contains("earned"));
  assert.ok(cards[1].classList.contains("earned"));
  assert.ok(cards[1].classList.contains("current"), "the highest reached rung is current");
  assert.ok(!cards[2].classList.contains("earned"));
  assert.match(cards[1].querySelector(".rk-theme figcaption").textContent, /✓ Rink-O-Mania/);
  assert.match(cards[2].querySelector(".rk-theme figcaption").textContent, /🔒 Hellfire Club/, "an unearned theme wears the lock");
  // signed out: nothing earned, nothing current
  document.body.innerHTML = ladderHtml(rows, {});
  assert.equal(document.querySelectorAll(".rk-tier.earned, .rk-tier.current").length, 0);
});

test("theme thumbs point at /img/themes/<id>.jpg and fall back to a swatch when the shot is missing", () => {
  assert.equal(themeShotSrc("cleradin"), "/img/themes/cleradin.jpg");
  document.body.innerHTML = themeThumbHtml({ id: "rink", label: "Rink-O-Mania" }, { unlocked: true });
  const img = document.querySelector(".rk-theme img");
  assert.equal(img.getAttribute("src"), "/img/themes/rink.jpg");
  assert.match(img.getAttribute("onerror"), /noshot/, "a missing shot degrades to the swatch card");
});

test("progress: signed out invites, mid-ladder counts down to the next rung, maxed celebrates", () => {
  const rows = buildLadder({ tiers: TIERS, themeLocks: LOCKS, themeLabels: LABELS, gimmicks: GIMMICKS });
  assert.match(progressHtml(rows, null), /Sign in/);
  const mid = progressHtml(rows, { wordCount: 6000 });
  assert.match(mid, /14,000 to go/, "counts words to the next rung");
  assert.match(mid, /Sorcerer/);
  assert.match(progressHtml(rows, { wordCount: 20000 }), /nothing left to unlock/);
});

test("word badges: secret ones hide their descriptions until earned, open ones never do", () => {
  const ach = {
    usage: [{ name: "🐺 Omega Badge" }, { name: "🧇 Waffle" }],
    usageOpen: [{ name: "🖋 Opening Line", desc: "Write “once upon a time”." }],
  };
  document.body.innerHTML = usageListHtml(ach, {
    badges: ["🐺 Omega Badge"],
    badgeDescs: { "🐺 Omega Badge": "Write “puppy” into a story line." },
  });
  const cards = [...document.querySelectorAll(".rk-usage")];
  assert.equal(cards.length, 3);
  assert.match(cards[0].textContent, /puppy/, "an earned secret badge shows its real description");
  assert.ok(cards[0].classList.contains("earned"));
  assert.match(cards[1].textContent, /Secret: /, "an unearned secret badge stays a mystery");
  assert.ok(cards[1].classList.contains("mystery"));
  assert.match(cards[2].textContent, /once upon a time/, "open badges always show their description");
  // signed out: secrets are all mysteries
  document.body.innerHTML = usageListHtml(ach, null);
  assert.equal(document.querySelectorAll(".rk-usage.mystery").length, 2);
});

test("gimmick rundown: every catalogue entry gets a card with its icon, desc and gate line", () => {
  document.body.innerHTML = gimmickListHtml(
    { catalogue: GIMMICKS, locks: { d20: "sorcerer", supersoaker: "outloud" }, unlocked: ["supersoaker"], admin: false },
    { tiers: TIERS, themeLabels: LABELS },
  );
  const cards = [...document.querySelectorAll(".rk-gimmick")];
  assert.equal(cards.length, 2);
  assert.match(cards[0].querySelector(".rk-gate").innerHTML, /🔒 unlocks with the Hellfire Club theme/);
  assert.match(cards[0].querySelector(".rk-gate").textContent, /20,000 words/);
  assert.match(cards[1].querySelector(".rk-gate").textContent, /✓ yours/);
  assert.ok(cards[1].classList.contains("earned"));
  // admin holds everything
  document.body.innerHTML = gimmickListHtml(
    { catalogue: GIMMICKS, locks: { d20: "sorcerer" }, unlocked: [], admin: true },
    { tiers: TIERS, themeLabels: LABELS },
  );
  assert.equal(document.querySelectorAll(".rk-gimmick.earned").length, 2);
});

test("free themes: everything no tier claims, always unlocked", () => {
  const free = freeThemes(["neon", "ink", "rink"], LOCKS, LABELS);
  assert.deepEqual(free.map((t) => t.id), ["neon"]);
  document.body.innerHTML = freeThemesHtml(free);
  assert.match(document.querySelector(".rk-theme figcaption").textContent, /✓ Neon Dusk/);
});

test("the live registry ships what the page needs: every gimmick has an icon, every theme a screenshot", async () => {
  const { GIMMICKS: REG } = await import("../lib/gimmicks.js");
  for (const g of Object.values(REG)) assert.ok(g.icon, g.id + " has an icon");
  const { THEMES } = await import("../public/js/theme.js");
  for (const id of THEMES)
    assert.doesNotThrow(() => readFileSync(new URL(`../public/img/themes/${id}.jpg`, import.meta.url)), id + ".jpg screenshot exists");
});

test("an admin's payload shows every badge's description and trigger recipe; anyone else's keeps the mystery", async () => {
  const { usageListHtml, recipeText } = await import("../public/js/ranks-view.js");
  const secretForAll = usageListHtml({ usage: [{ name: "🐺 Omega" }], usageOpen: [] }, null);
  assert.ok(secretForAll.includes("Secret: ") && secretForAll.includes("mystery"));
  const forAdmin = usageListHtml({ usage: [{ name: "🐺 Omega", desc: "Write puppy.", triggers: ["puppy"], combos: [["good", "boy"]] }], usageOpen: [] }, null);
  assert.ok(forAdmin.includes("Write puppy.") && forAdmin.includes("Unlocks with: puppy · good + boy"));
  assert.ok(!forAdmin.includes("mystery"));
  assert.equal(recipeText({ triggers: ["a"], combos: [["b", "c"]] }), "a · b + c");
  assert.equal(recipeText({}), "");
});
