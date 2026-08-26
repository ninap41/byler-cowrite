// Prompt-generation modes in a live session: the ballot the vote card gets,
// who may change how it is dealt, and the menus the UI builds itself from.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startServer, signup } from "./helpers.mjs";

let ctx;
before(async () => (ctx = await startServer()));
after(async () => ctx.stop());

const CURATED = JSON.parse(readFileSync(new URL("../content/prompts.json", import.meta.url), "utf-8")).prompts;

// A session parked in `choosing`, with the host's socket tracking game-state.
async function choosing(extra = {}) {
  const host = await signup(ctx, "hostmode" + Math.random().toString(36).slice(2, 7), Math.random() + "@x.com");
  const mate = await signup(ctx, "matemode" + Math.random().toString(36).slice(2, 7), Math.random() + "@x.com");
  const A = await ctx.conn();
  const B = await ctx.conn();
  const state = { current: null };
  A.on("game-state", (st) => (state.current = st));
  const c = await ctx.emit(A, "create-session", { auth: host.token });
  await ctx.emit(B, "join-session", { code: c.code, auth: mate.token });
  await ctx.emit(A, "start-game", { turnSeconds: 60, rounds: 1, ...extra });
  await ctx.wait(150);
  return { A, B, code: c.code, state };
}

test("curated is the default mode and deals untouched curated prompts", async () => {
  const { state } = await choosing();
  assert.equal(state.current.promptMode, "simple");
  assert.equal(state.current.options.length, 4);
  for (const p of state.current.options) assert.ok(CURATED.includes(p));
  assert.equal(new Set(state.current.options).size, 4); // no repeats on one ballot
  assert.deepEqual(state.current.optionMeta, [null, null, null, null]);
});

test("guided mode assembles prompts and ships the component ids with them", async () => {
  const { A, state } = await choosing();
  const res = await ctx.emit(A, "set-prompt-mode", {
    mode: "intermediate",
    controls: { seasonId: "s4", toneId: "angst", explicitLevel: "explicit" },
  });
  assert.equal(res.ok, true);
  await ctx.wait(120);
  const st = state.current;
  assert.equal(st.promptMode, "intermediate");
  assert.equal(st.promptControls.seasonId, "s4");
  assert.equal(st.options.length, 4);
  st.options.forEach((p, i) => {
    assert.ok(!CURATED.includes(p)); // assembled, not curated
    assert.ok(p.split("\n").length >= 7, "each clause on its own line");
    assert.ok(p.split("\n").every((ln) => ln.startsWith("\u2022 ")), "and each one bulleted");
    const meta = st.optionMeta[i];
    assert.equal(meta.selections.seasonId, "s4");
    assert.equal(meta.selections.toneId, "angst");
    assert.equal(meta.selections.tropeIds.length, 1);
    // the gate: S4 is a minor season, so explicit came down to suggestive
    assert.equal(meta.selections.explicitLevel, "suggestive");
    assert.equal(meta.selections.explicit, undefined);
    assert.ok(!p.includes("Rating: explicit") && !p.includes("Kinks:"));
    assert.ok(meta.seed && (meta.labels.place || meta.selections.canonId === "au") && meta.labels.tropes.length === 1);
  });
});

test("a host picks the AU world: every option is Cleradin", async () => {
  const { A, state } = await choosing();
  await ctx.emit(A, "set-prompt-mode", { mode: "intermediate", controls: { worldId: "cleradin" } });
  await ctx.wait(120);
  assert.equal(state.current.promptControls.worldId, "cleradin");
  for (const [i, p] of state.current.options.entries()) {
    assert.ok(p.includes("Canon: alternate universe · Cleradin"), p);
    assert.equal(state.current.optionMeta[i].selections.worldId, "cleradin");
  }
  const menus = await ctx.api("/api/prompt-options");
  assert.ok(menus.data.intermediate.worlds.some((w) => w.id === "cleradin" && w.label && !w.text));
});

test("explicit deals its layer only on an adult season", async () => {
  const { A, state } = await choosing();
  await ctx.emit(A, "set-prompt-mode", { mode: "intermediate", controls: { seasonId: "post-canon", explicitLevel: "explicit" } });
  await ctx.wait(120);
  for (const [i, p] of state.current.options.entries()) {
    assert.ok(p.includes("\u2022 Rating: explicit") && p.includes("\u2022 Kinks: "), p);
    assert.ok(state.current.optionMeta[i].selections.explicit.kinkIds.length >= 1);
  }
});

test("a bad mode or control value narrows instead of reaching the generator", async () => {
  const { A, state } = await choosing();
  await ctx.emit(A, "set-prompt-mode", {
    mode: "telepathy",
    controls: { seasonId: "../../etc/passwd", explicitLevel: "nuclear" },
  });
  await ctx.wait(120);
  assert.equal(state.current.promptMode, "simple");
  assert.equal(state.current.promptControls.seasonId, "random");
  assert.equal(state.current.promptControls.explicitLevel, "none");
});

test("only the host may change the mode, and start-game can set it up front", async () => {
  const { B, state } = await choosing();
  const denied = await ctx.emit(B, "set-prompt-mode", { mode: "intermediate" });
  assert.equal(denied.ok, false);
  await ctx.wait(100);
  assert.equal(state.current.promptMode, "simple");

  const fresh = await choosing({ promptMode: "intermediate", promptControls: { seasonId: "s2" } });
  assert.equal(fresh.state.current.promptMode, "intermediate");
  assert.equal(fresh.state.current.optionMeta[0].selections.seasonId, "s2");
});

test("a hand-written scenario joins a guided ballot with no components, and voting still works", async () => {
  const { A, B, state } = await choosing({ promptMode: "intermediate" });
  const add = await ctx.emit(B, "add-prompt", { prompt: "Mike calls at 2 a.m. and does not say why." });
  assert.equal(add.ok, true);
  await ctx.wait(120);
  assert.equal(state.current.options.length, 5);
  assert.equal(state.current.optionMeta.length, 5);
  assert.equal(state.current.optionMeta[4], null);

  const generated = state.current.options[0];
  A.emit("vote", { prompt: generated });
  B.emit("vote", { prompt: generated });
  await ctx.wait(200);
  assert.equal(state.current.phase, "writing");
  assert.equal(state.current.prompt, generated);
});

test("reshuffling redeals in the mode that is set", async () => {
  const { A, state } = await choosing({ promptMode: "intermediate" });
  const first = state.current.options.join("|");
  await ctx.emit(A, "shuffle-options");
  await ctx.wait(120);
  assert.notEqual(state.current.options.join("|"), first);
  assert.ok(state.current.optionMeta.every((m) => m?.selections?.tropeIds?.length));
});

test("the menu endpoint ships ids and labels, never the clause text", async () => {
  const r = await ctx.api("/api/prompt-options");
  assert.deepEqual(r.data.modes, ["simple", "intermediate"]);
  const d = r.data.intermediate;
  assert.ok(d.seasons.length >= 7 && d.tones.length >= 5 && d.places.length >= 10);
  for (const key of ["seasons", "canon", "worlds", "places", "situations", "relationships", "tones", "explicitLevels", "tropeGroups"])
    assert.ok(d[key].every((x) => x.id && x.label && !x.text), key);
  // each row carries the rules that grey it out beside other choices
  assert.deepEqual(d.relationships.find((r) => r.id === "exes").ageGroups, ["adult"]);
  assert.ok(d.worlds.find((w) => w.id === "cleradin").tags.includes("fantasy"));
  assert.ok(d.tones.find((t) => t.id === "fluff").excludes.includes("explicit"));
  // seasons carry their age group so the client can narrow the Explicit menu
  assert.ok(d.seasons.every((s) => s.ageGroup === "minor" || s.ageGroup === "adult"));
  assert.ok(d.explicitLevels.find((l) => l.id === "explicit").adultOnly);
  // the trope bank itself never ships — the host picks a count, not a tag
  assert.equal(d.tropes, undefined);
  assert.equal(d.explicit, undefined);
});

test("the host rerolls one option and keeps the rest; votes on it drop; nobody else can", async () => {
  const { A, B, state } = await choosing({ promptMode: "intermediate" });
  const before = [...state.current.options];
  B.emit("vote", { prompt: before[1] });
  await ctx.wait(100);
  assert.equal(state.current.tally[1], 1);
  const denied = await ctx.emit(B, "reroll-option", { index: 1 });
  assert.equal(denied.ok, false);
  const ok = await ctx.emit(A, "reroll-option", { index: 1 });
  assert.equal(ok.ok, true);
  await ctx.wait(120);
  const after = state.current.options;
  assert.equal(after.length, 4);
  assert.notEqual(after[1], before[1]);
  assert.deepEqual([after[0], after[2], after[3]], [before[0], before[2], before[3]], "the other three stay");
  assert.equal(state.current.tally[1], 0, "the vote for the old option is gone");
  assert.ok(state.current.optionMeta[1]?.selections?.tropeIds?.length, "the new option carries its meta");
  const bad = await ctx.emit(A, "reroll-option", { index: 9 });
  assert.equal(bad.ok, false);
  // simple mode too
  await ctx.emit(A, "set-prompt-mode", { mode: "simple" });
  await ctx.wait(100);
  const s0 = state.current.options[0];
  await ctx.emit(A, "reroll-option", { index: 0 });
  await ctx.wait(100);
  assert.notEqual(state.current.options[0], s0);
  assert.ok(CURATED.includes(state.current.options[0]));
  assert.equal(state.current.optionMeta[0], null);
});

test("/api/prompt-options ships the explicit dropdown pools as ids + labels, never clause text; set-prompt-mode keeps the pins and the ballot honours them", async () => {
  const r = await ctx.api("/api/prompt-options", undefined);
  const d = r.data.intermediate;
  for (const k of ["setups", "dynamics", "acts", "kinks"]) {
    assert.ok(Array.isArray(d[k]) && d[k].length, k + " shipped");
    assert.ok(d[k].every((x) => x.id && x.label && !("text" in x)), k + " rows are id/label/rules only");
  }
  assert.equal(d.registers, undefined, "registers are deprecated: not shipped");
  const { A, state } = await choosing();
  const adult = d.seasons.find((s) => s.ageGroup === "adult").id;
  const kink = d.kinks[0].id;
  const res = await ctx.emit(A, "set-prompt-mode", {
    mode: "intermediate",
    controls: { seasonId: adult, toneId: "angst", explicitLevel: "explicit", kinkId: kink, setupId: "<bad>" },
  });
  assert.equal(res.ok, true);
  await ctx.wait(120);
  const st = state.current;
  assert.equal(st.promptControls.kinkId, kink);
  assert.equal(st.promptControls.setupId, "random", "junk off the wire reads as random");
  const dealt = st.optionMeta.filter(Boolean);
  assert.ok(dealt.length, "guided options were dealt");
  for (const m of dealt) if (m.selections.explicit) assert.equal(m.selections.explicit.kinkIds[0], kink, "every explicit option leads its kinks with the pin");
});

test("a part switched off never reaches the card: toneOff drops the Tone line and chip from every dealt option; the flags survive the wire", async () => {
  const { A, state } = await choosing();
  const res = await ctx.emit(A, "set-prompt-mode", {
    mode: "intermediate",
    controls: { toneId: "angst", toneOff: true, situationOff: true, explicitLevel: "explicit", seasonId: "post-canon", kinkOff: "yes" },
  });
  assert.equal(res.ok, true);
  await ctx.wait(120);
  const st = state.current;
  assert.equal(st.promptControls.toneOff, true);
  assert.equal(st.promptControls.kinkOff, false, "only a real boolean switches a part off");
  assert.equal(st.promptControls.registerId, undefined, "registers are gone from the controls");
  assert.equal(st.promptControls.situationOff, true);
  for (const p of st.options) assert.ok(!p.includes("Tone:") && !p.includes("Situation:"), "no Tone or Situation line on the card");
  for (const m of st.optionMeta.filter(Boolean)) assert.equal(m.labels.tone, undefined, "no tone chip");
});
