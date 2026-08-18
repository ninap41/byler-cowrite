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
    universes: [{ id: "hawkins-canon", label: "Hawkins, as it happened" }, { id: "high-seas", label: "The high seas" }],
    timePeriods: [
      { id: "post-vecna", label: "Post-Vecna", ageGroup: "minor", universes: ["hawkins-canon"] },
      { id: "modern-au", label: "Modern AU", ageGroup: "adult", universes: ["hawkins-canon"] },
      { id: "age-of-sail", label: "The age of sail", ageGroup: "adult", universes: ["high-seas"] },
    ],
    relationshipContexts: [{ id: "mutual-unspoken", label: "Mutual but unspoken" }],
    tones: [{ id: "nostalgic", label: "Nostalgic" }],
    categories: [{ id: "confession", label: "Confession" }, "forced-proximity"],
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
  const html = menuHtml(MENUS.intermediate.timePeriods, "modern-au");
  assert.match(html, /<option value="random">Random<\/option>/);
  assert.match(html, /<option value="modern-au" selected>Modern AU<\/option>/);
  assert.equal(html.match(/selected/g).length, 1);
  assert.match(menuHtml([{ id: "a", label: "A" }]), /value="random" selected/);
  assert.match(menuHtml(null), /Random/);
  // A bare-string pool (tension categories) gets derived labels.
  assert.match(menuHtml(["forced-proximity"]), /value="forced-proximity">Forced proximity</);
  assert.match(menuHtml([{ id: "x", label: "<script>" }]), /&lt;script&gt;/);
});

test("optionChipsHtml: guided options get chips in scene order, curated get none", () => {
  assert.equal(optionChipsHtml(null), "");
  assert.equal(optionChipsHtml({ selections: {} }), "");
  const html = optionChipsHtml({
    labels: { timePeriod: "Post-Vecna", location: "Wheeler basement", tension: "<b>", tone: "Nostalgic" },
  });
  assert.match(html, /class="opt-chips"/);
  assert.equal(html.match(/class="opt-chip"/g).length, 4);
  assert.match(html, /&lt;b&gt;/); // labels are data, always escaped
  assert.ok(html.indexOf("Post-Vecna") < html.indexOf("Wheeler basement"));
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
  assert.ok(a.includes("lobbyPmIntensity") && a.includes("lobbyPmCatalyst"));
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
  assert.equal(root.querySelector("#t1Period").options.length, 4); // Random + 3
  assert.equal(root.querySelector("#t1Universe").options.length, 3); // Random + 2
  assert.equal(root.querySelector("#t1Category").options[1].textContent, "Confession");
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
  root.querySelector("#t3Period").value = "post-vecna";
  fire(root.querySelector("#t3Period"), "change");
  root.querySelector("#t3Intensity").value = "high";
  fire(root.querySelector("#t3Intensity"), "change");
  root.querySelector("#t3Catalyst").checked = true;
  fire(root.querySelector("#t3Catalyst"), "change");
  assert.deepEqual(seen.at(-1).controls, {
    ...DEFAULT_CONTROLS, timePeriodId: "post-vecna", tensionIntensity: "high", includeCatalyst: true,
  });
  // values() is what start-game sends from the lobby
  assert.deepEqual(pm.values(), { promptMode: "intermediate", promptControls: seen.at(-1).controls });
});

test("setState paints the server's state without firing a change back", () => {
  const root = mount("");
  const seen = [];
  const pm = mountPromptModes(root, { prefix: "t4", onChange: (v) => seen.push(v) }).setMenus(MENUS);
  pm.setState("intermediate", { timePeriodId: "modern-au", tensionIntensity: "low", includeCatalyst: true });
  assert.equal(seen.length, 0); // echoing the broadcast must not re-emit it
  assert.equal(root.querySelector("#t4Period").value, "modern-au");
  assert.equal(root.querySelector("#t4Intensity").value, "low");
  assert.equal(root.querySelector("#t4Catalyst").checked, true);
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

test("periodsIn narrows the time periods to the chosen universe", async () => {
  const { periodsIn } = await import("../public/js/components/prompt-modes.js");
  const all = MENUS.intermediate.timePeriods;
  assert.equal(periodsIn(all, "random").length, 3, "Random universe offers every period");
  assert.deepEqual(periodsIn(all, "high-seas").map((p) => p.id), ["age-of-sail"]);
  // a period that belongs to no universe in particular belongs everywhere
  assert.ok(periodsIn([{ id: "any", label: "Any" }], "high-seas").length);
});

test("choosing a universe reshapes the period menu and drops an impossible period", () => {
  const root = mount('<div id="pm"></div>');
  const api = mountPromptModes(root, { prefix: "t" });
  api.setMenus(MENUS).setState("intermediate", { timePeriodId: "post-vecna" });
  const uni = root.querySelector("#tUniverse");
  const per = root.querySelector("#tPeriod");
  assert.equal(per.value, "post-vecna");
  uni.value = "high-seas";
  fire(uni, "change");
  assert.deepEqual([...per.options].map((o) => o.value), ["random", "age-of-sail"]);
  assert.equal(per.value, "random", "a period this universe has no room for falls back to Random");
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
