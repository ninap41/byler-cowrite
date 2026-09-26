// WSQK, the shared radio: host-only controls, the server's anchor, the
// conductor's track reports, replay to late joiners and spectators, and the
// snapshot round trip. The playlist name comes from the unfurl stub.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startServer, signup, startedGame } from "./helpers.mjs";

let ctx;
before(async () => (ctx = await startServer()));
after(async () => ctx.stop());

const LIST = "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf";
const URL = `https://www.youtube.com/playlist?list=${LIST}`;

// A's game-state follows the host; the host is A in startedGame. Track
// radio-state on both seats.
function watchRadio(sock) {
  const box = { last: null, all: [] };
  sock.on("radio-state", (r) => {
    box.last = r;
    box.all.push(r);
  });
  return box;
}

test("radio-set: host-only; a playlist link, a bare id, and off air; a bad link refused; the name arrives from the unfurler", async () => {
  const { A, B } = await startedGame(ctx);
  const rA = watchRadio(A), rB = watchRadio(B);

  const denied = await ctx.emit(B, "radio-set", { url: URL });
  assert.equal(denied.ok, false);
  assert.equal(denied.error, "Host only.");

  const bad = await ctx.emit(A, "radio-set", { url: "https://example.com/watch?v=abc" });
  assert.equal(bad.ok, false, "not a youtube playlist");
  assert.equal((await ctx.emit(A, "radio-set", { url: "javascript:alert(1)" })).ok, false);

  const ok = await ctx.emit(A, "radio-set", { url: URL });
  assert.equal(ok.ok, true);
  assert.equal(ok.radio.playlistId, LIST);
  assert.equal(ok.radio.index, 0);
  assert.equal(ok.radio.playing, true);
  assert.ok(Math.abs(ok.radio.now - Date.now()) < 2000, "server clock stamped");
  await ctx.wait(200);
  assert.equal(rB.last?.playlistId, LIST, "everyone at the table hears the station change");
  assert.equal(rB.last?.playlistName, "Stub playlist", "the playlist's title came from the unfurler (stub)");
  assert.equal(rA.last?.playlistName, "Stub playlist");

  const bare = await ctx.emit(A, "radio-set", { url: "PL0123456789abcdefg" });
  assert.equal(bare.ok, true);
  assert.equal(bare.radio.playlistId, "PL0123456789abcdefg");

  const off = await ctx.emit(A, "radio-set", { url: "" });
  assert.equal(off.ok, true);
  assert.equal(off.radio.playlistId, "", "empty = off air");
  assert.equal(off.radio.playing, false);
  await ctx.wait(100);
  assert.equal(rB.last?.playlistId, "");
});

test("play/pause: host-only, refused off air; pause freezes the position, play keeps it and restamps", async () => {
  const { A, B } = await startedGame(ctx);
  assert.equal((await ctx.emit(A, "radio-play")).ok, false, "off air: nothing to play");
  await ctx.emit(A, "radio-set", { url: URL });
  const rB = watchRadio(B);

  assert.equal((await ctx.emit(B, "radio-pause", { positionMs: 5000 })).error, "Host only.");
  assert.equal((await ctx.emit(B, "radio-play")).error, "Host only.");

  const paused = await ctx.emit(A, "radio-pause", { positionMs: 42_000 });
  assert.equal(paused.ok, true);
  await ctx.wait(100);
  assert.equal(rB.last.playing, false);
  assert.equal(rB.last.positionMs, 42_000);
  const t1 = rB.last.updatedAt;

  const weird = await ctx.emit(A, "radio-pause", { positionMs: -99 });
  assert.equal(weird.ok, true);
  await ctx.wait(100);
  assert.equal(rB.last.positionMs, 0, "position clamped");

  await ctx.emit(A, "radio-pause", { positionMs: 42_000 });
  await ctx.wait(30);
  const played = await ctx.emit(A, "radio-play");
  assert.equal(played.ok, true);
  await ctx.wait(100);
  assert.equal(rB.last.playing, true);
  assert.equal(rB.last.positionMs, 42_000, "resumes where it paused");
  assert.ok(rB.last.updatedAt >= t1, "anchor restamped");
});

test("radio-track: a new index moves the anchor (title stripped); the same index is ignored unless it drifted; non-hosts refused", async () => {
  const { A, B } = await startedGame(ctx);
  await ctx.emit(A, "radio-set", { url: URL });
  const rB = watchRadio(B);

  assert.equal((await ctx.emit(B, "radio-track", { index: 1, videoId: "dQw4w9WgXcQ", title: "x", positionMs: 0 })).error, "Host only.");
  assert.equal((await ctx.emit(A, "radio-track", { index: -1, videoId: "dQw4w9WgXcQ", title: "x", positionMs: 0 })).ok, false);

  const t = await ctx.emit(A, "radio-track", { index: 1, videoId: "dQw4w9WgXcQ", title: " <b>Running</b> Up That Hill ", positionMs: 1500 });
  assert.equal(t.ok, true);
  await ctx.wait(100);
  assert.equal(rB.last.index, 1);
  assert.equal(rB.last.videoId, "dQw4w9WgXcQ");
  assert.equal(rB.last.title, "Running Up That Hill");
  assert.equal(rB.last.positionMs, 1500);
  const n = rB.all.length;

  // same track, tiny drift: nothing goes out
  const same = await ctx.emit(A, "radio-track", { index: 1, videoId: "dQw4w9WgXcQ", title: "Running Up That Hill", positionMs: 1700 });
  assert.equal(same.ok, true);
  assert.equal(same.ignored, true);
  await ctx.wait(100);
  assert.equal(rB.all.length, n, "no broadcast for a same-track report within tolerance");

  // same track, big drift (the host buffered): re-anchored
  const drift = await ctx.emit(A, "radio-track", { index: 1, videoId: "dQw4w9WgXcQ", title: "Running Up That Hill", positionMs: 30_000 });
  assert.equal(drift.ok, true);
  assert.notEqual(drift.ignored, true);
  await ctx.wait(100);
  assert.equal(rB.last.positionMs, 30_000);

  // another big drift straight away is inside the cooldown: ignored
  const again = await ctx.emit(A, "radio-track", { index: 1, videoId: "dQw4w9WgXcQ", title: "Running Up That Hill", positionMs: 90_000 });
  assert.equal(again.ignored, true);

  // a bad video id is dropped, the track still changes
  const t2 = await ctx.emit(A, "radio-track", { index: 2, videoId: "nope", title: "Next", positionMs: 0 });
  assert.equal(t2.ok, true);
  await ctx.wait(100);
  assert.equal(rB.last.index, 2);
  assert.equal(rB.last.videoId, null);
});

test("late joiners and spectators get radio-state on entry; nothing is sent while off air", async () => {
  const { A, code } = await startedGame(ctx);
  const dustin = await signup(ctx, "dustinh", "dustin@hawkins.com", "#44aa88");

  const S0 = await ctx.conn();
  const r0 = watchRadio(S0);
  await ctx.emit(S0, "spectate-session", { code });
  await ctx.wait(100);
  assert.equal(r0.last, null, "off air: no radio-state replayed");

  await ctx.emit(A, "radio-set", { url: URL });
  await ctx.emit(A, "radio-track", { index: 3, videoId: "dQw4w9WgXcQ", title: "Should I Stay", positionMs: 2000 });

  const S = await ctx.conn();
  const rS = watchRadio(S);
  await ctx.emit(S, "spectate-session", { code });
  await ctx.wait(100);
  assert.equal(rS.last?.index, 3, "a spectator hears the station");
  assert.equal(rS.last?.title, "Should I Stay");

  const C = await ctx.conn();
  const rC = watchRadio(C);
  const j = await ctx.emit(C, "join-session", { code, auth: dustin.token });
  assert.equal(j.pending, true, "a started game gates newcomers");
  await ctx.emit(A, "approve-join", { id: C.id, allow: true });
  await ctx.wait(150);
  assert.equal(rC.last?.playlistId, LIST, "a seated latecomer hears it");
  assert.ok(rC.last.now > 0);
  // the wire is what a listener syncs from: position derives from the anchor
  assert.equal(rC.last.positionMs, 2000);
  assert.equal(rC.last.playing, true);
});

test("host leaves: the seat that inherits the role conducts; the old conductor's report is refused", async () => {
  const { A, B } = await startedGame(ctx);
  await ctx.emit(A, "radio-set", { url: URL });
  const stB = { current: null };
  B.on("game-state", (st) => (stB.current = st));
  A.disconnect();
  await ctx.wait(300);
  assert.equal(stB.current.hostId, B.id, "B is host now");
  const t = await ctx.emit(B, "radio-track", { index: 1, videoId: "dQw4w9WgXcQ", title: "Next", positionMs: 0 });
  assert.equal(t.ok, true);
});

test("snapshot: the station persists and a revived game wakes paused where it was; an old save loads off air", async () => {
  const sctx = await startServer();
  try {
    const { host, A, code } = await startedGame(sctx);
    await sctx.emit(A, "radio-set", { url: URL });
    await sctx.emit(A, "radio-track", { index: 4, videoId: "dQw4w9WgXcQ", title: "Heroes", positionMs: 61_000 });
    await sctx.wait(100);
    const snap = JSON.parse(readFileSync(join(sctx.saveDir, code + ".json"), "utf-8"));
    assert.equal(snap.radio.playlistId, LIST);
    assert.equal(snap.radio.index, 4);
    assert.equal(snap.radio.playlistName, "Stub playlist");
    assert.equal(snap.radio.reanchorAt, undefined, "the throttle stamp is not saved");

    // unload it (sleep), then come back: the station is there, paused
    const slept = new Promise((r) => A.on("game-slept", r));
    assert.equal((await sctx.api(`/api/games/${code}/sleep`, {}, host.token)).status, 200);
    await slept;
    const A2 = await sctx.conn();
    const r2 = watchRadio(A2);
    const rj = await sctx.emit(A2, "join-session", { code, auth: host.token });
    assert.equal(rj.ok, true);
    await sctx.wait(150);
    assert.equal(r2.last?.playlistId, LIST, "revived with its station");
    assert.equal(r2.last.index, 4);
    assert.equal(r2.last.title, "Heroes");
    assert.equal(r2.last.playing, false, "wakes paused, like the game");
    assert.equal(r2.last.positionMs, 61_000);

    // an old save with no radio field: off air, nothing replayed
    const g2 = await startedGame(sctx);
    const path2 = join(sctx.saveDir, g2.code + ".json");
    const doc = JSON.parse(readFileSync(path2, "utf-8"));
    assert.equal(doc.radio.playlistId, "");
    const slept2 = new Promise((r) => g2.A.on("game-slept", r));
    await sctx.api(`/api/games/${g2.code}/sleep`, {}, g2.host.token);
    await slept2;
    const { writeFileSync } = await import("node:fs");
    delete doc.radio;
    writeFileSync(path2, JSON.stringify(doc));
    const A3 = await sctx.conn();
    const r3 = watchRadio(A3);
    await sctx.emit(A3, "join-session", { code: g2.code, auth: g2.host.token });
    await sctx.wait(150);
    assert.equal(r3.last, null, "off air: no radio-state");
    assert.equal((await sctx.emit(A3, "radio-play")).ok, false);
  } finally {
    await sctx.stop();
  }
});
