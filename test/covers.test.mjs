// Coverage for the newer account/session features: linked cover images,
// per-category sound prefs, the remembered lastLine, and the hosted vs
// contributed split on public profiles.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startServer, signup, startedGame } from "./helpers.mjs";

let ctx;
before(async () => (ctx = await startServer()));
after(async () => ctx.stop());

const COVER = "https://img.example.com/cover.png";

test("cover image: host-only, http(s)-validated, broadcast + snapshotted + listed", async () => {
  const g = await startedGame(ctx);
  const notHost = g.state.current.hostId === g.A.id ? g.B : g.A;
  const hostSock = notHost === g.A ? g.B : g.A;
  const hostAcct = hostSock === g.A ? g.host : g.mike;

  const denied = await ctx.emit(notHost, "set-cover", { url: COVER });
  assert.equal(denied.ok, false, "non-host cannot set the cover");

  const evil = await ctx.emit(hostSock, "set-cover", { url: "javascript:alert(1)" });
  assert.equal(evil.ok, false, "non-http url rejected");

  const ok = await ctx.emit(hostSock, "set-cover", { url: COVER });
  assert.equal(ok.ok, true);
  assert.equal(ok.cover, COVER);
  await ctx.wait(150);
  assert.equal(g.state.current.cover, COVER, "cover rides game-state");

  const snap = JSON.parse(readFileSync(join(ctx.saveDir, g.code + ".json"), "utf-8"));
  assert.equal(snap.cover, COVER, "cover persists in the snapshot");

  const dash = await ctx.api("/api/dashboard", undefined, hostAcct.token);
  assert.equal(dash.data.myGames.find((x) => x.code === g.code)?.cover, COVER, "dashboard myGames carries it");

  const list = await ctx.api("/api/games", undefined, hostAcct.token);
  assert.equal(list.data.find((x) => x.code === g.code)?.cover, COVER, "/api/games carries it");

  const cleared = await ctx.emit(hostSock, "set-cover", { url: "" });
  assert.equal(cleared.ok, true, "clearing the cover is allowed");
  assert.equal(cleared.cover, "");
});

test("sound prefs: default all-on, per-category save, rides /api/me", async () => {
  const u = await signup(ctx, "soundsuser", "sounds@x.com");
  const me = await ctx.api("/api/me", undefined, u.token);
  assert.deepEqual(me.data.user.sounds, { chat: true, story: true, clock: true }, "fresh accounts hear everything");

  const set = await ctx.api("/api/account/sounds", { chat: false, story: true, clock: false }, u.token);
  assert.equal(set.status, 200);
  assert.deepEqual(set.data.user.sounds, { chat: false, story: true, clock: false });

  const again = await ctx.api("/api/me", undefined, u.token);
  assert.deepEqual(again.data.user.sounds, { chat: false, story: true, clock: false }, "prefs persist");

  const anon = await ctx.api("/api/account/sounds", { chat: true });
  assert.equal(anon.status, 401, "auth required");
});

test("lastLine: every committed line updates the account; profile exposes it", async () => {
  const g = await startedGame(ctx);
  const cur = g.state.current.currentId === g.A.id ? g.A : g.B;
  const curAcct = cur === g.A ? g.host : g.mike;
  const LINE = "The quarry water was colder than October.";
  const res = await ctx.emit(cur, "submit-line", { text: LINE });
  assert.equal(res.ok, true);

  const me = await ctx.api("/api/me", undefined, curAcct.token);
  assert.equal(me.data.user.lastLine?.text, LINE);
  assert.equal(me.data.user.lastLine?.code, g.code);

  const prof = await ctx.api("/api/users/" + curAcct.user.username, undefined, g.host.token);
  assert.equal(prof.data.lastLine?.text, LINE, "profile endpoint exposes the stored lastLine");

  // a newer line replaces it
  const next = g.state.current.currentId === g.A.id ? g.A : g.B;
  const nextAcct = next === g.A ? g.host : g.mike;
  const LINE2 = "Mike answered before he could think better of it.";
  await ctx.emit(next, "submit-line", { text: LINE2 });
  const me2 = await ctx.api("/api/me", undefined, nextAcct.token);
  assert.equal(me2.data.user.lastLine?.text, LINE2);
});

test("public profile splits hosted vs contributed stories", async () => {
  const g = await startedGame(ctx);
  // startedGame: willthewise hosts, mikewheeler holds a seat
  const will = await ctx.api("/api/users/" + g.host.user.username, undefined, g.mike.token);
  assert.ok(will.data.hosted.some((x) => x.code === g.code), "host's game in hosted");
  assert.ok(!will.data.contributed.some((x) => x.code === g.code), "not doubled into contributed");

  const mike = await ctx.api("/api/users/" + g.mike.user.username, undefined, g.host.token);
  assert.ok(mike.data.contributed.some((x) => x.code === g.code), "seat-holder's game in contributed");
  assert.ok(!mike.data.hosted.some((x) => x.code === g.code), "non-host game not in hosted");
  assert.equal(mike.data.contributed.find((x) => x.code === g.code).inProgress, true, "live flag set");
});
