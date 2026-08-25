// The prompt-mode picker: the pure builders, and the mounted control the lobby
// and the vote card both use.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installDom, mount } from "./dom.mjs";

installDom();
const {
  menuHtml, optionChipsHtml, labelize, promptModeHtml, mountPromptModes,
  PROMPT_MODES, GUIDED_FIELDS, DEFAULT_CONTROLS,
} = await import("../public/js/components/prompt-modes.js");

// The shape /api/prompt-options returns (ids + labels, never clause text).
const MENUS = {
  modes: ["simple", "intermediate"],
  intermediate: {
    seasons: [
      { id: "s4", label: "Season 4", ageGroup: "minor" },
      { id: "s5", label: "Season 5", ageGroup: "minor" },
      { id: "post-canon", label: "Post-canon", ageGroup: "adult" },
    ],
    canon: [{ id: "au", label: "Alternate universe" }, { id: "canon-compliant", label: "Canon-compliant" }],
    worlds: [{ id: "cleradin", label: "Cleradin", tags: ["fantasy", "cleradin"] }, { id: "coffee-shop", label: "coffee shop" }, { id: "college", label: "college", ageGroups: ["adult"] }],
    places: [{ id: "church", label: "Church" }, { id: "nyc", label: "New York City" }],
    situations: [{ id: "reunion", label: "Reunion" }],
    relationships: [{ id: "pining", label: "Pining", tags: ["not-together"] }, { id: "exes", label: "Exes", ageGroups: ["adult"], tags: ["exes"] }],
    tones: [{ id: "angst", label: "Angst" }, { id: "fluff", label: "Fluff", tags: ["no-explicit"], excludes: ["explicit"] }],
    explicitLevels: [
      { id: "none", label: "None", adultOnly: false },
      { id: "suggestive", label: "Suggestive", adultOnly: false },
      { id: "explicit", label: "Explicit", adultOnly: true },
    ],
    tropeGroups: [{ id: "proximity", label: "Proximity & circumstance" }],
  },
};
const fire = (el, type = "click") => el.dispatchEvent(new window.Event(type, { bubbles: true }));

test("both shipped modes are named, simple first", () => {
  assert.deepEqual(PROMPT_MODES.map((m) => m.id), ["simple", "intermediate"]);
  assert.ok(PROMPT_MODES.every((m) => m.label && m.hint));
});

test("labelize turns authored ids into menu labels", () => {
  assert.equal(labelize("forced-proximity"), "Forced proximity");
  assert.equal(labelize(""), "");
});

test("menuHtml always offers Random, marks the current choice, escapes labels", () => {
  const html = menuHtml(MENUS.intermediate.seasons, "post-canon");
  assert.match(html, /<option value="random">Random<\/option>/);
  assert.match(html, /<option value="post-canon" selected>Post-canon<\/option>/);
  assert.equal(html.match(/selected/g).length, 1);
  assert.match(menuHtml([{ id: "a", label: "A" }]), /value="random" selected/);
  assert.match(menuHtml(null), /Random/);
  // A bare-string pool (tension categories) gets derived labels.
  assert.match(menuHtml(["forced-proximity"]), /value="forced-proximity">Forced proximity</);
  assert.match(menuHtml([{ id: "x", label: "<script>" }]), /&lt;script&gt;/);
  // a menu with no Random (explicit level, trope count) selects its first row
  const fixed = menuHtml(MENUS.intermediate.explicitLevels, null, { random: false });
  assert.ok(!fixed.includes("random") && /value="none" selected/.test(fixed));
});

test("optionChipsHtml: guided options get chips in scene order, curated get none", () => {
  assert.equal(optionChipsHtml(null), "");
  assert.equal(optionChipsHtml({ selections: {} }), "");
  const html = optionChipsHtml({
    labels: { season: "Season 4", world: "coffee shop", place: "Church", tropes: ["<b>"], tone: "Angst", explicit: "Suggestive" },
  });
  assert.match(html, /class="opt-chips"/);
  assert.equal(html.match(/class="opt-chip"/g).length, 6); // each trope is its own chip
  assert.match(html, /&lt;b&gt;/); // labels are data, always escaped
  assert.ok(html.indexOf("Season 4") < html.indexOf("Church") && html.indexOf("Angst") < html.indexOf("Suggestive"));
});

test("two mounts on one page never share an id", () => {
  const ids = (prefix) => [...promptModeHtml(prefix).matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const a = ids("lobbyPm");
  const b = ids("votePm");
  assert.equal(new Set(a).size, a.length);
  assert.equal(a.length, b.length);
  assert.equal(a.filter((x) => b.includes(x)).length, 0);
  // every guided knob is present
  for (const f of GUIDED_FIELDS) assert.ok(a.includes("lobbyPm" + f.suffix), f.suffix);
  assert.ok(a.includes("lobbyPmExplicit") && !a.includes("lobbyPmTropes"), "one trope per prompt: no count to pick");
});

test("guided is off until the component pools are known", () => {
  const root = mount("");
  const pm = mountPromptModes(root, { prefix: "t1" });
  const guidedBtn = root.querySelector("#t1Mode-intermediate");
  assert.equal(guidedBtn.disabled, true);
  fire(guidedBtn); // a dead control stays dead
  assert.equal(pm.values().promptMode, "simple");
  assert.ok(root.querySelector("#t1Controls").classList.contains("hidden"));

  pm.setMenus(MENUS);
  assert.equal(guidedBtn.disabled, false);
  assert.equal(root.querySelector("#t1Season").options.length, 4); // Random + 3
  assert.equal(root.querySelector("#t1Place").options.length, 3); // Random + 2
  assert.equal(root.querySelector("#t1Explicit").options.length, 3); // Random season: every level
  assert.equal(root.querySelector("#t1Explicit").value, "none", "explicit defaults to none, never random");
});

test("switching to guided reveals the knobs and reports the mode", () => {
  const root = mount("");
  const seen = [];
  const pm = mountPromptModes(root, { prefix: "t2", onChange: (v) => seen.push(v) }).setMenus(MENUS);
  fire(root.querySelector("#t2Mode-intermediate"));
  assert.equal(root.querySelector("#t2Controls").classList.contains("hidden"), false);
  assert.ok(root.querySelector("#t2Mode-intermediate").classList.contains("on"));
  assert.ok(!root.querySelector("#t2Mode-simple").classList.contains("on"));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].mode, "intermediate");
  assert.deepEqual(seen[0].controls, DEFAULT_CONTROLS);

  // ...and back again: the knobs hide, and simple carries no scene choices.
  fire(root.querySelector("#t2Mode-simple"));
  assert.ok(root.querySelector("#t2Controls").classList.contains("hidden"));
  assert.equal(seen.at(-1).mode, "simple");
});

test("changing any knob reports the whole control set", () => {
  const root = mount("");
  const seen = [];
  const pm = mountPromptModes(root, { prefix: "t3", onChange: (v) => seen.push(v) }).setMenus(MENUS);
  fire(root.querySelector("#t3Mode-intermediate"));
  root.querySelector("#t3Season").value = "post-canon";
  fire(root.querySelector("#t3Season"), "change");
  root.querySelector("#t3Explicit").value = "explicit";
  fire(root.querySelector("#t3Explicit"), "change");
  assert.deepEqual(seen.at(-1).controls, {
    ...DEFAULT_CONTROLS, seasonId: "post-canon", explicitLevel: "explicit",
  });
  // values() is what start-game sends from the lobby
  assert.deepEqual(pm.values(), { promptMode: "intermediate", promptControls: seen.at(-1).controls });
});

test("setState paints the server's state without firing a change back", () => {
  const root = mount("");
  const seen = [];
  const pm = mountPromptModes(root, { prefix: "t4", onChange: (v) => seen.push(v) }).setMenus(MENUS);
  pm.setState("intermediate", { seasonId: "post-canon", explicitLevel: "explicit" });
  assert.equal(seen.length, 0); // echoing the broadcast must not re-emit it
  assert.equal(root.querySelector("#t4Season").value, "post-canon");
  assert.equal(root.querySelector("#t4Explicit").value, "explicit");
  assert.equal(root.querySelector("#t4Controls").classList.contains("hidden"), false);
});

test("show() is how the vote card hides the dials from non-hosts", () => {
  const root = mount("");
  const pm = mountPromptModes(root, { prefix: "t5" }).setMenus(MENUS);
  pm.show(false);
  assert.ok(root.classList.contains("hidden"));
  pm.show(true);
  assert.ok(!root.classList.contains("hidden"));
});

test("game.html mounts the picker in both the lobby and the vote card", () => {
  const html = readFileSync(new URL("../public/game.html", import.meta.url), "utf-8");
  assert.match(html, /id="lobbyPrompt"/);
  assert.match(html, /id="votePrompt"/);
  assert.match(html, /mountPromptModes\(\$\("lobbyPrompt"\)/);
  assert.match(html, /mountPromptModes\(\$\("votePrompt"\)/);
  // the lobby's choice rides along with the rules on Begin
  assert.match(html, /start-game", \{ \.\.\.lobbyRules\.values\(\), \.\.\.lobbyPrompt\.values\(\) \}/);
  // and the chat dock starts minimized
  assert.match(html, /id="chatCard" class="chat-dock hidden collapsed"/);
});

test("levelsFor narrows the explicit levels to what a season admits", async () => {
  const { levelsFor } = await import("../public/js/components/prompt-modes.js");
  const { seasons, explicitLevels } = MENUS.intermediate;
  assert.equal(levelsFor(explicitLevels, seasons, "random").length, 3, "Random season offers every level");
  assert.deepEqual(levelsFor(explicitLevels, seasons, "s4").map((l) => l.id), ["none", "suggestive"]);
  assert.equal(levelsFor(explicitLevels, seasons, "post-canon").length, 3);
});

test("choosing a minor season drops Explicit from the menu and falls back to None", () => {
  const root = mount('<div id="pm"></div>');
  const api = mountPromptModes(root, { prefix: "t" });
  api.setMenus(MENUS).setState("intermediate", { seasonId: "post-canon", explicitLevel: "explicit" });
  const season = root.querySelector("#tSeason");
  const level = root.querySelector("#tExplicit");
  assert.equal(level.value, "explicit");
  season.value = "s4";
  fire(season, "change");
  assert.deepEqual([...level.options].map((o) => o.value), ["none", "suggestive"]);
  assert.equal(level.value, "none", "a level this season has no room for falls back to None");
  assert.equal(api.values().promptControls.explicitLevel, "none");
  // the server's echo of a minor season + explicit paints the same narrowing
  api.setState("intermediate", { seasonId: "s5", explicitLevel: "explicit" });
  assert.equal(level.value, "none");
});

test("the AU world menu appears only while Canon is Alternate universe, and forgets its pick otherwise", () => {
  const root = mount("");
  const seen = [];
  const pm = mountPromptModes(root, { prefix: "w", onChange: (v) => seen.push(v) }).setMenus(MENUS);
  fire(root.querySelector("#wMode-intermediate"));
  const wrap = root.querySelector("#wWorldWrap"), world = root.querySelector("#wWorld"), canon = root.querySelector("#wCanon");
  assert.ok(wrap.classList.contains("hidden"), "hidden on Random canon");
  assert.deepEqual([...world.options].map((o) => o.value), ["random", "cleradin", "coffee-shop", "college"]);
  canon.value = "au";
  fire(canon, "change");
  assert.ok(!wrap.classList.contains("hidden"));
  world.value = "cleradin";
  fire(world, "change");
  assert.equal(seen.at(-1).controls.worldId, "cleradin");
  canon.value = "canon-compliant";
  fire(canon, "change");
  assert.ok(wrap.classList.contains("hidden"));
  assert.equal(seen.at(-1).controls.worldId, "random", "a hidden world reads as Random");
  // the server's echo paints it the same way
  pm.setState("intermediate", { canonId: "au", worldId: "coffee-shop" });
  assert.ok(!wrap.classList.contains("hidden") && world.value === "coffee-shop");
  // and the stylesheet lets a label hide (it sets display:flex itself)
  const css = readFileSync(new URL("../public/css/base.css", import.meta.url), "utf-8");
  assert.ok(css.includes(".guided-controls label.hidden"));
});

test("an option the generator would refuse beside the other choices is greyed out, and a pick that becomes impossible falls back to Random", async () => {
  const { optionAllowed, activeContext } = await import("../public/js/components/prompt-modes.js");
  const root = mount("");
  const pm = mountPromptModes(root, { prefix: "c" }).setMenus(MENUS);
  fire(root.querySelector("#cMode-intermediate"));
  const opt = (sel, id) => root.querySelector(`#c${sel} option[value="${id}"]`);
  // a minor season takes the adult-only relationship and world off the table
  root.querySelector("#cSeason").value = "s4";
  fire(root.querySelector("#cSeason"), "change");
  assert.equal(opt("Rel", "exes").disabled, true);
  assert.equal(opt("Rel", "pining").disabled, false);
  assert.equal(opt("World", "college").disabled, true);
  // fluff and explicit: whichever is picked first greys the other
  root.querySelector("#cSeason").value = "post-canon";
  fire(root.querySelector("#cSeason"), "change");
  root.querySelector("#cExplicit").value = "explicit";
  fire(root.querySelector("#cExplicit"), "change");
  assert.equal(opt("Tone", "fluff").disabled, true);
  root.querySelector("#cExplicit").value = "none";
  fire(root.querySelector("#cExplicit"), "change");
  root.querySelector("#cTone").value = "fluff";
  fire(root.querySelector("#cTone"), "change");
  assert.deepEqual([...root.querySelector("#cExplicit").options].map((o) => o.value), ["none", "suggestive"], "explicit left the menu");
  // a pick that becomes impossible falls back to Random rather than sticking
  root.querySelector("#cTone").value = "angst";
  fire(root.querySelector("#cTone"), "change");
  root.querySelector("#cRel").value = "exes";
  fire(root.querySelector("#cRel"), "change");
  assert.equal(pm.values().promptControls.relationshipId, "exes");
  root.querySelector("#cSeason").value = "s5";
  fire(root.querySelector("#cSeason"), "change");
  assert.equal(pm.values().promptControls.relationshipId, "random");
  // the pure rule
  const ctx = activeContext(MENUS, { seasonId: "s4", canonId: "au", worldId: "cleradin", explicitLevel: "explicit" });
  assert.equal(ctx.ageGroup, "minor");
  assert.ok(ctx.tags.has("fantasy") && ctx.tags.has("explicit"));
  assert.equal(optionAllowed({ id: "x", excludes: ["fantasy"] }, ctx), false);
  assert.equal(optionAllowed({ id: "x", requires: ["cleradin"] }, ctx), true);
  assert.equal(optionAllowed({ id: "x", canon: ["canon-divergent"] }, ctx), false);
  assert.equal(optionAllowed({ id: "random" }, ctx), true);
  // the stylesheet dims a disabled option
  const css = readFileSync(new URL("../public/css/base.css", import.meta.url), "utf-8");
  assert.ok(css.includes(".guided-controls select option:disabled"));
});

test("the vote card's mount gets a 🎲 Reroll all button; the lobby's doesn't", () => {
  const root = mount("");
  const hits = [];
  mountPromptModes(root, { prefix: "r", onReroll: () => hits.push(1) }).setMenus(MENUS);
  fire(root.querySelector("#rReroll"));
  assert.equal(hits.length, 1);
  const lobby = mount("");
  mountPromptModes(lobby, { prefix: "l" });
  assert.equal(lobby.querySelector("#lReroll"), null);
  const html = readFileSync(new URL("../public/game.html", import.meta.url), "utf-8");
  assert.match(html, /onReroll: \(\) => \{[\s\S]*?socket\.emit\("shuffle-options"\)/);
});

test("Simple mode shows no guided knobs — and the stylesheet agrees", async () => {
  const root = mount("");
  const pm = mountPromptModes(root, { prefix: "s1" }).setMenus(MENUS);
  const controls = root.querySelector("#s1Controls");
  assert.ok(controls.classList.contains("hidden"), "simple is the default and hides them");
  fire(root.querySelector("#s1Mode-intermediate"));
  assert.ok(!controls.classList.contains("hidden"), "guided reveals them");
  fire(root.querySelector("#s1Mode-simple"));
  assert.ok(controls.classList.contains("hidden"), "and switching back hides them again");
  // the class only hides if the stylesheet lets it: `.guided-controls` sets
  // display:grid at the same specificity as `.hidden`, so it must be overridden
  // AFTER it, or Simple mode would show the knobs anyway
  const css = readFileSync(new URL("../public/css/base.css", import.meta.url), "utf-8");
  assert.ok(css.includes(".guided-controls.hidden"), "the hidden state is declared for this control");
  assert.ok(css.indexOf(".hidden {") < css.indexOf(".guided-controls.hidden"), "and it comes after the generic rule");
});
