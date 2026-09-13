// The voting stage: approval voting (a seat backs as many scenarios as it
// likes, each click a toggle), a Ready mark per writer, and a host who may
// start only once every other connected seat is ready. Nothing finalizes on
// its own any more.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, signup } from "./helpers.mjs";

let ctx;
before(async () => (ctx = await startServer()));
after(async () => ctx.stop());

let n = 0;
async function lobby(count = 3) {
  n++;
  const accounts = [];
  for (let i = 0; i < count; i++) accounts.push(await signup(ctx, `voter${n}x${i}`, `voter${n}x${i}@x.com`));
  const socks = [];
  const state = { current: null };
  for (let i = 0; i < count; i++) {
    const s = await ctx.conn();
    if (i === 0) s.on("game-state", (st) => (state.current = st));
    socks.push(s);
  }
  const c = await ctx.emit(socks[0], "create-session", { auth: accounts[0].token });
  for (let i = 1; i < count; i++) await ctx.emit(socks[i], "join-session", { code: c.code, auth: accounts[i].token });
  await ctx.emit(socks[0], "start-game", { turnSeconds: 60, rounds: 1 });
  await ctx.wait(150);
  assert.equal(state.current.phase, "choosing");
  return { socks, accounts, state, code: c.code };
}

test("a writer can back several scenarios; each click toggles; the tally counts every vote", async () => {
  const { socks: [A, B, C], state } = await lobby();
  const [o0, o1, o2] = state.current.options;
  assert.equal((await ctx.emit(B, "vote", { prompt: o0 })).on, true);
  assert.equal((await ctx.emit(B, "vote", { prompt: o1 })).on, true);
  const r = await ctx.emit(B, "vote", { prompt: o2 });
  assert.equal(r.on, true);
  assert.deepEqual(r.votes, [o0, o1, o2], "the ack carries the whole ballot");
  await ctx.wait(100);
  assert.deepEqual(state.current.tally.slice(0, 3), [1, 1, 1]);
  assert.equal(state.current.voted, 1, "one seat has voted, however many ticks it put down");
  assert.deepEqual(state.current.ballots[B.id], [0, 1, 2]);
  // the second click on o1 takes it back off
  assert.equal((await ctx.emit(B, "vote", { prompt: o1 })).on, false);
  // `on` forces a direction — no accidental un-vote from a double-tap
  assert.equal((await ctx.emit(B, "vote", { prompt: o0, on: true })).on, true);
  await ctx.wait(100);
  assert.deepEqual(state.current.tally.slice(0, 3), [1, 0, 1]);
  await ctx.emit(C, "vote", { prompt: o2 });
  await ctx.wait(100);
  assert.deepEqual(state.current.tally.slice(0, 3), [1, 0, 2]);
  assert.equal(state.current.voted, 2);
  assert.equal(state.current.phase, "choosing", "everyone voting does NOT start the game");
  assert.equal((await ctx.emit(A, "vote", { prompt: "not on the ballot" })).ok, false);
});

test("the host may start only once every other connected seat is ready; ready can be taken back", async () => {
  const { socks: [A, B, C], state } = await lobby();
  const [o0, o1] = state.current.options;
  await ctx.emit(B, "vote", { prompt: o0 });
  await ctx.emit(C, "vote", { prompt: o1 });
  await ctx.emit(A, "vote", { prompt: o1 });
  const early = await ctx.emit(A, "finalize-vote");
  assert.equal(early.ok, false);
  assert.match(early.error, /ready/i);
  assert.equal(state.current.phase, "choosing");

  assert.equal((await ctx.emit(B, "ready", { ready: true })).ok, true);
  await ctx.wait(100);
  assert.deepEqual(state.current.ready, [B.id]);
  assert.equal(state.current.allReady, false);
  assert.equal((await ctx.emit(A, "finalize-vote")).ok, false, "C hasn't said so yet");

  await ctx.emit(C, "ready", {});
  await ctx.wait(100);
  assert.equal(state.current.allReady, true, "the host's own seat needn't be marked — their Start click is their word");
  // C changes their mind
  await ctx.emit(C, "ready", { ready: false });
  await ctx.wait(100);
  assert.equal(state.current.allReady, false);
  assert.equal((await ctx.emit(A, "finalize-vote")).ok, false);
  await ctx.emit(C, "ready", { ready: true });
  await ctx.wait(100);
  assert.equal((await ctx.emit(B, "finalize-vote")).ok, false, "only the host starts");
  assert.equal((await ctx.emit(A, "finalize-vote")).ok, true);
  await ctx.wait(150);
  assert.equal(state.current.phase, "writing");
  assert.equal(state.current.prompt, o1, "the most-backed scenario wins");
  assert.equal((await ctx.emit(B, "ready", { ready: true })).ok, false, "ready means nothing outside the vote");
});

test("a ghost never blocks the start; a reroll or new deal clears votes and ready", async () => {
  const { socks: [A, B, C], state } = await lobby();
  const o0 = state.current.options[0];
  await ctx.emit(B, "vote", { prompt: o0 });
  await ctx.emit(B, "ready", { ready: true });
  await ctx.emit(C, "vote", { prompt: o0 });
  // a fresh ballot is a fresh question
  await ctx.emit(A, "shuffle-options");
  await ctx.wait(120);
  assert.deepEqual(state.current.ready, []);
  assert.equal(state.current.voted, 0);
  assert.deepEqual(state.current.ballots, {});
  const p = state.current.options[1];
  await ctx.emit(B, "vote", { prompt: p });
  await ctx.emit(B, "ready", { ready: true });
  // a single rerolled card drops only its own votes; ready stands
  await ctx.emit(A, "reroll-option", { index: 1 });
  await ctx.wait(120);
  assert.equal(state.current.tally[1], 0);
  assert.deepEqual(state.current.ready, [B.id], "rerolling one card doesn't unready anyone");
  // C leaves without a word: their seat is a ghost and doesn't count
  C.disconnect();
  await ctx.wait(150);
  assert.equal(state.current.allReady, true, "B ready, C gone: the host can start");
  assert.equal((await ctx.emit(A, "finalize-vote")).ok, true);
  await ctx.wait(150);
  assert.equal(state.current.phase, "writing");
});

test("a ready mark and a ballot follow the seat through a reconnect", async () => {
  const { socks: [A, B], accounts, state } = await lobby(2);
  const o0 = state.current.options[0];
  await ctx.emit(B, "vote", { prompt: o0 });
  await ctx.emit(B, "ready", { ready: true });
  B.disconnect();
  await ctx.wait(100);
  const B2 = await ctx.conn();
  const r = await ctx.emit(B2, "join-session", { code: state.current.code, auth: accounts[1].token });
  assert.equal(r.ok, true);
  await ctx.wait(150);
  assert.deepEqual(state.current.ready, [B2.id], "ready rode along under the new socket id");
  assert.deepEqual(state.current.ballots[B2.id], [0], "so did the ballot");
  assert.equal(state.current.allReady, true);
});
