// Prompt-generation modes in a live session: the ballot the vote card gets,
// who may change how it is dealt, and the menus the UI builds itself from.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startServer, signup } from "./helpers.mjs";

let ctx;
before(async () => (ctx = await startServer()));
after(async () => ctx.stop());

const CURATED = JSON.parse(readFileSync(new URL("../prompts.json", import.meta.url), "utf-8")).prompts;

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
    controls: { timePeriodId: "post-vecna", toneId: "nostalgic", tensionIntensity: "high", includeCatalyst: true },
  });
  assert.equal(res.ok, true);
  await ctx.wait(120);
  const st = state.current;
  assert.equal(st.promptMode, "intermediate");
  assert.equal(st.promptControls.timePeriodId, "post-vecna");
  assert.equal(st.options.length, 4);
  st.options.forEach((p, i) => {
    assert.ok(!CURATED.includes(p)); // assembled, not curated
    assert.ok(p.split("\n").length >= 6, "each clause on its own line, catalyst included");
    assert.ok(p.split("\n").every((ln) => ln.startsWith("\u2022 ")), "and each one bulleted");
    const meta = st.optionMeta[i];
    assert.equal(meta.selections.timePeriodId, "post-vecna");
    assert.equal(meta.selections.toneId, "nostalgic");
    assert.ok(meta.selections.catalystId);
    assert.ok(meta.seed && meta.labels.location && meta.labels.tension);
  });
});

test("a bad mode or control value narrows instead of reaching the generator", async () => {
  const { A, state } = await choosing();
  await ctx.emit(A, "set-prompt-mode", {
    mode: "telepathy",
    controls: { timePeriodId: "../../etc/passwd", tensionIntensity: "nuclear" },
  });
  await ctx.wait(120);
  assert.equal(state.current.promptMode, "simple");
  assert.equal(state.current.promptControls.timePeriodId, "random");
  assert.equal(state.current.promptControls.tensionIntensity, "medium");
});

test("only the host may change the mode, and start-game can set it up front", async () => {
  const { B, state } = await choosing();
  const denied = await ctx.emit(B, "set-prompt-mode", { mode: "intermediate" });
  assert.equal(denied.ok, false);
  await ctx.wait(100);
  assert.equal(state.current.promptMode, "simple");

  const fresh = await choosing({ promptMode: "intermediate", promptControls: { timePeriodId: "college-au" } });
  assert.equal(fresh.state.current.promptMode, "intermediate");
  assert.equal(fresh.state.current.optionMeta[0].selections.timePeriodId, "college-au");
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
  assert.ok(state.current.optionMeta.every((m) => m?.selections?.tensionId));
});

test("the menu endpoint ships ids and labels, never the clause text", async () => {
  const r = await ctx.api("/api/prompt-options");
  assert.deepEqual(r.data.modes, ["simple", "intermediate"]);
  const d = r.data.intermediate;
  assert.ok(d.timePeriods.length >= 8 && d.tones.length >= 8 && d.categories.length);
  // scenario types come labelled, not as bare ids
  assert.ok(d.categories.every((c) => c.id && c.label && c.label !== c.id));
  assert.ok(d.timePeriods.every((p) => p.id && p.label && p.ageGroup && !p.text));
  // the universes ride along, and each period says which of them admit it
  assert.ok(d.universes.length >= 5 && d.universes.every((u) => u.id && u.label && !u.text));
  const ids = new Set(d.universes.map((u) => u.id));
  assert.ok(d.timePeriods.some((p) => p.universes?.length));
  for (const p of d.timePeriods) for (const u of p.universes || []) assert.ok(ids.has(u), `unknown universe ${u}`);
});
