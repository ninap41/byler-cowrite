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
      { id: "s3", label: "Season 3", ageGroup: "minor", excludes: ["explicit"] },
      { id: "s4", label: "Season 4", ageGroup: "minor", tags: ["explicit-ok"] },
      { id: "s5", label: "Season 5", ageGroup: "minor", tags: ["explicit-ok"] },
      { id: "post-canon", label: "Post-canon", ageGroup: "adult" },
    ],
    canon: [{ id: "au", label: "Alternate universe" }, { id: "canon-compliant", label: "Canon-compliant" }],
    worlds: [{ id: "cleradin", label: "Cleradin", tags: ["fantasy", "cleradin"] }, { id: "coffee-shop", label: "coffee shop" }, { id: "college", label: "college", ageGroups: ["adult"] }],
    places: [{ id: "church", label: "Church" }, { id: "nyc", label: "New York City" }],
    auPlaces: [
      { id: "au-cleradin-the-tower", label: "the tower", requires: ["au-cleradin"] },
      { id: "au-cleradin-the-bathhouse", label: "the bathhouse", requires: ["au-cleradin", "explicit"], adultOnly: true },
      { id: "au-coffee-shop-the-back-room", label: "the back room", requires: ["au-coffee-shop"] },
    ],
    situations: [{ id: "reunion", label: "Reunion", tags: ["reunion"] }, { id: "first-meeting", label: "First meeting", tags: ["first-meeting"] }],
    relationships: [{ id: "pining", label: "Pining", tags: ["not-together"], excludes: ["first-meeting"] }, { id: "established", label: "Established", tags: ["together"], excludes: ["first-meeting", "reunion"] }, { id: "exes", label: "Exes", ageGroups: ["adult"], tags: ["exes"], excludes: ["first-meeting"] }],
    tones: [{ id: "angst", label: "Angst" }, { id: "fluff", label: "Fluff", tags: ["no-explicit"], excludes: ["explicit"] }],
    setups: [{ id: "hotel", label: "Hotel" }, { id: "car", label: "Car", excludes: ["fantasy"] }],
    dynamics: [{ id: "switch", label: "Switch" }],
    acts: [{ id: "kissing", label: "Kissing" }],
    kinks: [{ id: "praise", label: "Praise" }],
    explicitLevels: [
      { id: "none", label: "None", adultOnly: false },
      { id: "suggestive", label: "Suggestive", adultOnly: false }, // an old pack's row: deprecated, never shown
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
  assert.equal(root.querySelector("#t1Season").options.length, 5); // Random + 4
  assert.equal(root.querySelector("#t1Place").options.length, 3); // Random + 2
  assert.equal(root.querySelector("#t1Explicit").options.length, 2); // Random season: None and Explicit (suggestive is deprecated)
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
  assert.deepEqual(levelsFor(explicitLevels, seasons, "random").map((l) => l.id), ["none", "explicit"], "Random season offers both; suggestive is deprecated");
  assert.deepEqual(levelsFor(explicitLevels, seasons, "s3").map((l) => l.id), ["none"], "an early season has no room for explicit");
  assert.deepEqual(levelsFor(explicitLevels, seasons, "s4").map((l) => l.id), ["none", "explicit"], "S4 admits it");
  assert.deepEqual(levelsFor(explicitLevels, seasons, "post-canon").map((l) => l.id), ["none", "explicit"]);
});

test("choosing an early season drops Explicit from the menu and falls back to None", () => {
  const root = mount('<div id="pm"></div>');
  const api = mountPromptModes(root, { prefix: "t" });
  api.setMenus(MENUS).setState("intermediate", { seasonId: "post-canon", explicitLevel: "explicit" });
  const season = root.querySelector("#tSeason");
  const level = root.querySelector("#tExplicit");
  assert.equal(level.value, "explicit");
  season.value = "s3";
  fire(season, "change");
  assert.deepEqual([...level.options].map((o) => o.value), ["none"]);
  assert.equal(level.value, "none", "a level this season has no room for falls back to None");
  assert.equal(api.values().promptControls.explicitLevel, "none");
  // the server's echo of an early season + explicit paints the same narrowing
  api.setState("intermediate", { seasonId: "s3", explicitLevel: "explicit" });
  assert.equal(level.value, "none");
  // …while S5 keeps it
  api.setState("intermediate", { seasonId: "s5", explicitLevel: "explicit" });
  assert.equal(level.value, "explicit");
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
  assert.deepEqual([...root.querySelector("#cExplicit").options].map((o) => o.value), ["none"], "explicit left the menu");
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

test("Simple mode shows no guided knobs, and the stylesheet agrees", async () => {
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

test("the explicit dropdowns appear past None, are enabled only at Explicit, and ride along in the controls", () => {
  const root = mount("");
  const pm = mountPromptModes(root, { prefix: "x" }).setMenus(MENUS);
  fire(root.querySelector("#xMode-intermediate"));
  const wrap = (s) => root.querySelector("#x" + s + "Wrap");
  for (const s of ["Setup", "Dynamic", "Act", "Kink"]) assert.ok(wrap(s).classList.contains("hidden"), s + " hidden under None");
  assert.equal(root.querySelector("#xRegister"), null, "registers are deprecated: no menu");
  root.querySelector("#xSeason").value = "post-canon";
  fire(root.querySelector("#xSeason"), "change");
  root.querySelector("#xExplicit").value = "explicit";
  fire(root.querySelector("#xExplicit"), "change");
  assert.equal(root.querySelector("#xKink").disabled, false);
  root.querySelector("#xKink").value = "praise";
  fire(root.querySelector("#xKink"), "change");
  root.querySelector("#xSetup").value = "hotel";
  fire(root.querySelector("#xSetup"), "change");
  const c = pm.values().promptControls;
  assert.equal(c.kinkId, "praise");
  assert.equal(c.setupId, "hotel");
  assert.equal(c.dynamicId, "random");
  // a modern setup is greyed under a fantasy world
  root.querySelector("#xCanon").value = "au";
  fire(root.querySelector("#xCanon"), "change");
  root.querySelector("#xWorld").value = "cleradin";
  fire(root.querySelector("#xWorld"), "change");
  assert.equal(root.querySelector('#xSetup option[value="car"]').disabled, true);
  // back to None: hidden again and forgotten
  root.querySelector("#xExplicit").value = "none";
  fire(root.querySelector("#xExplicit"), "change");
  assert.ok(wrap("Setup").classList.contains("hidden"));
  assert.equal(pm.values().promptControls.setupId, "random");
});

test("a checkbox beside Tone and each explicit part leaves it out: the menu greys to Random, the flag rides in the controls, and setState paints it back", () => {
  const root = mount("");
  const pm = mountPromptModes(root, { prefix: "o" }).setMenus(MENUS);
  fire(root.querySelector("#oMode-intermediate"));
  const box = (s) => root.querySelector("#o" + s + "Off");
  assert.ok(box("Situation") && box("Tone") && box("Setup") && box("Dynamic") && box("Act") && box("Kink"), "one checkbox per switchable part");
  assert.equal(box("Season"), null, "season, canon, place… can't be left out");
  root.querySelector("#oTone").value = "angst";
  fire(root.querySelector("#oTone"), "change");
  assert.equal(pm.values().promptControls.toneId, "angst");
  box("Tone").checked = true;
  fire(box("Tone"), "change");
  let c = pm.values().promptControls;
  assert.equal(c.toneOff, true);
  assert.equal(c.toneId, "random", "a part that's out has no pick");
  assert.equal(root.querySelector("#oTone").disabled, true);
  box("Tone").checked = false;
  fire(box("Tone"), "change");
  assert.equal(root.querySelector("#oTone").disabled, false);
  box("Situation").checked = true;
  fire(box("Situation"), "change");
  assert.equal(pm.values().promptControls.situationOff, true);
  assert.equal(root.querySelector("#oSituation").disabled, true);
  box("Situation").checked = false;
  fire(box("Situation"), "change");
  // explicit parts: their boxes wake with the menus, at Explicit
  root.querySelector("#oSeason").value = "post-canon";
  fire(root.querySelector("#oSeason"), "change");
  root.querySelector("#oExplicit").value = "explicit";
  fire(root.querySelector("#oExplicit"), "change");
  assert.equal(box("Kink").disabled, false);
  // Setup has its own off switch, live with the level like the rest
  assert.ok(box("Setup"), "a Setup off box exists");
  assert.equal(box("Setup").disabled, false, "enabled once Explicit is chosen");
  box("Setup").checked = true;
  fire(box("Setup"), "change");
  assert.equal(pm.values().promptControls.setupOff, true);
  assert.equal(root.querySelector("#oSetup").disabled, true, "its menu greys while off");
  box("Setup").checked = false;
  fire(box("Setup"), "change");
  assert.equal(root.querySelector("#oSetup").disabled, false, "and wakes when switched back on");
  box("Kink").checked = true;
  fire(box("Kink"), "change");
  c = pm.values().promptControls;
  assert.equal(c.kinkOff, true);
  assert.equal(c.setupOff, false);
  // the server's state paints the boxes without firing back
  let fired = 0;
  const pm2 = mountPromptModes(mount(""), { prefix: "p", onChange: () => fired++ }).setMenus(MENUS);
  pm2.setState("intermediate", { seasonId: "post-canon", explicitLevel: "explicit", toneOff: true, actOff: true });
  assert.equal(fired, 0);
  const v = pm2.values().promptControls;
  assert.equal(v.toneOff, true);
  assert.equal(v.actOff, true);
});

test("the off checkbox is drawn from scratch so its mark sits dead centre", async () => {
  const css = readFileSync(new URL("../public/css/base.css", import.meta.url), "utf-8");
  const rule = css.match(/\.guided-controls \.pm-off \{[^}]*\}/)?.[0] || "";
  assert.match(rule, /appearance: none/);
  assert.match(rule, /display: inline-grid/);
  assert.match(rule, /place-content: center/);
  assert.match(css, /\.guided-controls \.pm-off:checked::before \{\s*transform:\s*scale\(1\);\s*\}/);
});

test("First meeting switches the Relationship menu off: every row greyed, the select disabled and read as Random; another situation gives it back", () => {
  const root = mount("");
  const pm = mountPromptModes(root, { prefix: "fm" }).setMenus(MENUS);
  fire(root.querySelector("#fmMode-intermediate"));
  root.querySelector("#fmRel").value = "pining";
  fire(root.querySelector("#fmRel"), "change");
  assert.equal(pm.values().promptControls.relationshipId, "pining");
  root.querySelector("#fmSituation").value = "first-meeting";
  fire(root.querySelector("#fmSituation"), "change");
  const rel = root.querySelector("#fmRel");
  assert.equal(rel.disabled, true, "the whole menu is off");
  assert.equal(rel.title, "A first meeting has no relationship yet");
  assert.equal(pm.values().promptControls.relationshipId, "random", "the pick is dropped");
  assert.ok([...rel.options].filter((o) => o.value !== "random").every((o) => o.disabled), "and every row is greyed by the shared rule");
  root.querySelector("#fmSituation").value = "reunion";
  fire(root.querySelector("#fmSituation"), "change");
  assert.equal(root.querySelector("#fmRel").disabled, false, "back with any other situation");
});

test("Reunion greys the couple relationships and drops such a pick back to Random", () => {
  const root = mount("");
  const pm = mountPromptModes(root, { prefix: "re" }).setMenus(MENUS);
  fire(root.querySelector("#reMode-intermediate"));
  root.querySelector("#reRel").value = "established";
  fire(root.querySelector("#reRel"), "change");
  assert.equal(pm.values().promptControls.relationshipId, "established");
  root.querySelector("#reSituation").value = "reunion";
  fire(root.querySelector("#reSituation"), "change");
  assert.equal(root.querySelector('#reRel option[value="established"]').disabled, true);
  assert.equal(root.querySelector('#reRel option[value="pining"]').disabled, false, "a not-together relationship is still on");
  assert.equal(pm.values().promptControls.relationshipId, "random", "the impossible pick fell back");
  assert.equal(root.querySelector("#reRel").disabled, false, "the menu itself stays usable, unlike a first meeting");
});

test("the Place menu follows the AU world: a chosen world lists its own rooms (Random first), another world its own, canon the generic places; a pick from the other pool falls back to Random; explicit rooms grey under a soft rating", () => {
  const root = mount("");
  const pm = mountPromptModes(root, { prefix: "pl" }).setMenus(MENUS);
  fire(root.querySelector("#plMode-intermediate"));
  const values = () => [...root.querySelector("#plPlace").options].map((o) => o.value);
  assert.deepEqual(values(), ["random", "church", "nyc"], "canon: the generic pool");
  root.querySelector("#plPlace").value = "nyc";
  fire(root.querySelector("#plPlace"), "change");
  assert.equal(pm.values().promptControls.placeId, "nyc");
  root.querySelector("#plCanon").value = "au";
  fire(root.querySelector("#plCanon"), "change");
  root.querySelector("#plWorld").value = "cleradin";
  fire(root.querySelector("#plWorld"), "change");
  assert.deepEqual(values(), ["random", "au-cleradin-the-tower", "au-cleradin-the-bathhouse"], "Cleradin's rooms, Random first");
  assert.equal(pm.values().promptControls.placeId, "random", "the canon pick fell back");
  assert.equal(root.querySelector('#plPlace option[value="au-cleradin-the-bathhouse"]').disabled, true, "an explicit room is greyed under no rating");
  root.querySelector("#plPlace").value = "au-cleradin-the-tower";
  fire(root.querySelector("#plPlace"), "change");
  assert.equal(pm.values().promptControls.placeId, "au-cleradin-the-tower", "a room can be pinned");
  root.querySelector("#plWorld").value = "coffee-shop";
  fire(root.querySelector("#plWorld"), "change");
  assert.deepEqual(values(), ["random", "au-coffee-shop-the-back-room"], "another world, its own rooms");
  assert.equal(pm.values().promptControls.placeId, "random", "the Cleradin room fell back");
  root.querySelector("#plCanon").value = "canon-compliant";
  fire(root.querySelector("#plCanon"), "change");
  assert.deepEqual(values(), ["random", "church", "nyc"], "back to canon: the generic places render again");
});

test("the two gates agree: an early season takes Explicit off the menu, and Explicit greys the early seasons", () => {
  const root = mount("");
  const pm = mountPromptModes(root, { prefix: "g" }).setMenus(MENUS);
  fire(root.querySelector("#gMode-intermediate"));
  const opt = (sel, id) => root.querySelector(`#g${sel} option[value="${id}"]`);
  root.querySelector("#gExplicit").value = "explicit";
  fire(root.querySelector("#gExplicit"), "change");
  assert.equal(opt("Season", "s3").disabled, true, "pre-canon through S3 are greyed under Explicit");
  assert.equal(opt("Season", "s4").disabled, false);
  assert.equal(opt("Season", "post-canon").disabled, false);
  assert.equal(pm.values().promptControls.explicitLevel, "explicit");
  root.querySelector("#gExplicit").value = "none";
  fire(root.querySelector("#gExplicit"), "change");
  assert.equal(opt("Season", "s3").disabled, false, "back on None the early seasons return");
  root.querySelector("#gSeason").value = "s3";
  fire(root.querySelector("#gSeason"), "change");
  assert.deepEqual([...root.querySelector("#gExplicit").options].map((o) => o.value), ["none"], "and an early season takes Explicit off");
  assert.equal(root.querySelector("#gExplicit").querySelector('option[value="suggestive"]'), null, "suggestive never appears");
});

test("a kink count sits beside the Kink menu: default 1, offered 1–3, rides in the controls, disabled with the menu, painted back by setState", () => {
  const root = mount("");
  const pm = mountPromptModes(root, { prefix: "kc" }).setMenus(MENUS);
  fire(root.querySelector("#kcMode-intermediate"));
  const kn = root.querySelector("#kcKinkN");
  assert.ok(kn, "the count exists");
  assert.deepEqual([...kn.options].map((o) => o.value), ["1", "2", "3"]);
  assert.equal(kn.value, "1", "default one");
  assert.equal(pm.values().promptControls.kinkCount, 1);
  root.querySelector("#kcSeason").value = "post-canon";
  fire(root.querySelector("#kcSeason"), "change");
  root.querySelector("#kcExplicit").value = "explicit";
  fire(root.querySelector("#kcExplicit"), "change");
  assert.equal(kn.disabled, false);
  kn.value = "3";
  fire(kn, "change");
  assert.equal(pm.values().promptControls.kinkCount, 3);
  root.querySelector("#kcKinkOff").checked = true;
  fire(root.querySelector("#kcKinkOff"), "change");
  assert.equal(kn.disabled, true, "no kinks, no count");
  root.querySelector("#kcKinkOff").checked = false;
  fire(root.querySelector("#kcKinkOff"), "change");
  const pm2 = mountPromptModes(mount(""), { prefix: "kd" }).setMenus(MENUS);
  pm2.setState("intermediate", { seasonId: "post-canon", explicitLevel: "explicit", kinkCount: 2 });
  assert.equal(pm2.values().promptControls.kinkCount, 2);
});
