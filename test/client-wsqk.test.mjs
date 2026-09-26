// WSQK on jsdom: the shared rules (playlist parsing, the anchor maths), the
// listener's prefs, and the HUD driving a fake YouTube player — sync on
// entry, the conductor's reports, the local power switch, and the phone
// variant that never builds a player.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.mjs";

let radio, wsqk;
before(async () => {
  installDom();
  radio = await import("../public/js/shared/radio.js");
  wsqk = await import("../public/js/components/wsqk.js");
});

const LIST = "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf";

test("parsePlaylistId: playlist/watch/music/short links and a bare id; junk is null", () => {
  const { parsePlaylistId } = radio;
  assert.equal(parsePlaylistId(`https://www.youtube.com/playlist?list=${LIST}`), LIST);
  assert.equal(parsePlaylistId(`https://youtube.com/watch?v=dQw4w9WgXcQ&list=${LIST}&index=3`), LIST);
  assert.equal(parsePlaylistId(`https://music.youtube.com/playlist?list=${LIST}`), LIST);
  assert.equal(parsePlaylistId(`https://m.youtube.com/playlist?list=${LIST}`), LIST);
  assert.equal(parsePlaylistId(`https://youtu.be/dQw4w9WgXcQ?list=${LIST}`), LIST);
  assert.equal(parsePlaylistId(`  ${LIST}  `), LIST);
  assert.equal(parsePlaylistId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), null, "a lone video is not a station");
  assert.equal(parsePlaylistId(`https://vimeo.com/?list=${LIST}`), null);
  assert.equal(parsePlaylistId(`javascript:alert(1)`), null);
  assert.equal(parsePlaylistId("short"), null);
  assert.equal(parsePlaylistId(""), null);
});

test("the anchor maths: position advances only while playing; a listener seeks only past the tolerance", () => {
  const { expectedPositionMs, needsSeek, acceptsReanchor, playlistUrl } = radio;
  const r = { playing: true, positionMs: 10_000, updatedAt: 1_000_000 };
  assert.equal(expectedPositionMs(r, 0, 1_005_000), 15_000);
  assert.equal(expectedPositionMs(r, 2_000, 1_005_000), 17_000, "skew: my clock is 2s behind the server's");
  assert.equal(expectedPositionMs({ ...r, playing: false }, 0, 1_999_000), 10_000, "paused: frozen");
  assert.equal(expectedPositionMs({ ...r, positionMs: 0, updatedAt: 2_000_000 }, 0, 1_000_000), 0, "never negative");
  assert.equal(needsSeek(15_000, 17_000), false);
  assert.equal(needsSeek(15_000, 19_000), true);
  assert.equal(acceptsReanchor(r, 15_500, 0, 1_005_000), false, "within drift");
  assert.equal(acceptsReanchor(r, 25_000, 0, 1_005_000), true);
  assert.equal(acceptsReanchor(r, 25_000, 1_000_000, 1_005_000), false, "inside the cooldown");
  assert.equal(playlistUrl(LIST), `https://www.youtube.com/playlist?list=${LIST}`);
  assert.equal(playlistUrl(LIST, 4), `https://www.youtube.com/playlist?list=${LIST}&index=5`);
});

test("prefs: defaults, clamping, a throwing storage", () => {
  const { loadRadioPrefs, saveRadioPrefs, DEFAULT_PREFS } = wsqk;
  const mem = new Map();
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  assert.deepEqual(loadRadioPrefs(store), DEFAULT_PREFS);
  saveRadioPrefs({ volume: 250, muted: true, off: "yes" }, store);
  assert.deepEqual(loadRadioPrefs(store), { volume: 100, muted: true, collapsed: false, off: false });
  mem.set("cowriteRadio", "{not json");
  assert.deepEqual(loadRadioPrefs(store), DEFAULT_PREFS);
  const broken = { getItem: () => { throw new Error("private"); }, setItem: () => { throw new Error("private"); }, removeItem() {} };
  assert.deepEqual(loadRadioPrefs(broken), DEFAULT_PREFS);
  assert.doesNotThrow(() => saveRadioPrefs({ volume: 10 }, broken));
});

// ---- a fake YouTube player that records what the HUD asks of it ----
function fakeYT() {
  const players = [];
  class Player {
    constructor(el, o) {
      this.el = el;
      this.opts = o;
      this.calls = [];
      this.state = 5;
      this.index = o.playerVars?.index ?? 0;
      this.time = 0;
      this.muted = false;
      this.volume = 100;
      players.push(this);
      queueMicrotask(() => o.events?.onReady?.());
    }
    playVideo() { this.calls.push(["play"]); this.state = 1; }
    pauseVideo() { this.calls.push(["pause"]); this.state = 2; }
    nextVideo() { this.calls.push(["next"]); this.index++; }
    previousVideo() { this.calls.push(["prev"]); this.index--; }
    playVideoAt(i) { this.calls.push(["at", i]); this.index = i; this.state = 1; }
    seekTo(s) { this.calls.push(["seek", Math.round(s)]); this.time = s; }
    loadPlaylist(o) { this.calls.push(["load", o.list, o.index]); this.index = o.index ?? 0; }
    mute() { this.muted = true; }
    unMute() { this.muted = false; }
    isMuted() { return this.muted; }
    setVolume(v) { this.volume = v; }
    getCurrentTime() { return this.time; }
    getPlayerState() { return this.state; }
    getPlaylistIndex() { return this.index; }
    getVideoData() { return { video_id: "dQw4w9WgXcQ", title: "Track " + this.index }; }
    destroy() { this.calls.push(["destroy"]); this.destroyed = true; }
    fire(data) { this.opts.events?.onStateChange?.({ data }); }
  }
  return { YT: { Player }, players };
}
function socketSpy() {
  const sent = [];
  return { sent, emit: (ev, p, ack) => { sent.push([ev, p]); ack?.({ ok: true }); } };
}
function mountFake({ isPhone = false, prefs = null, now = () => 1_000_000 } = {}) {
  const card = document.createElement("div");
  card.className = "side-sec radio-card hidden";
  const host = document.createElement("div");
  document.body.append(card, host);
  const mem = new Map();
  if (prefs) mem.set("cowriteRadio", JSON.stringify(prefs));
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  const yt = fakeYT();
  const socket = socketSpy();
  const w = wsqk.mountWsqk({ socket, card, host, storage, isPhone, now, loadApi: () => Promise.resolve(yt.YT) });
  return { w, card, host, yt, socket, storage, mem };
}
const tick = () => new Promise((r) => setTimeout(r, 5));
const onAir = (over = {}) => ({ playlistId: LIST, playlistName: "Hawkins Mix", index: 2, videoId: "dQw4w9WgXcQ", title: "Should I Stay", playing: true, positionMs: 30_000, updatedAt: 990_000, now: 1_000_000, ...over });

test("off air: hidden for a writer, a nudge for the host; on air: builds one player at the anchor, applies prefs, no socket traffic", async () => {
  const { w, card, yt, socket } = mountFake({ prefs: { volume: 20, muted: true } });
  assert.ok(card.classList.contains("hidden"), "nothing to show while off air");
  w.setHost(true);
  assert.ok(!card.classList.contains("hidden"));
  assert.match(card.querySelector('[data-el="note"]').textContent, /Tune the table/);
  w.setHost(false);

  w.set(onAir());
  await tick();
  assert.equal(yt.players.length, 1);
  const p = yt.players[0];
  assert.equal(p.opts.playerVars.list, LIST);
  assert.equal(p.opts.playerVars.index, 2);
  assert.equal(p.opts.playerVars.loop, 1);
  assert.equal(p.volume, 20);
  assert.equal(p.muted, true, "my mute is mine");
  // 30s + (1_000_000 − 990_000) = 40s into the track
  assert.ok(p.calls.some(([c, v]) => c === "seek" && v === 40), JSON.stringify(p.calls));
  assert.ok(p.calls.some(([c]) => c === "play"));
  assert.equal(card.querySelector('[data-el="list"]').textContent, "Hawkins Mix");
  assert.equal(card.querySelector('[data-el="track"]').textContent, "▸ Should I Stay");
  assert.ok(card.classList.contains("radio-on"), "signal bars animate while playing");
  assert.equal(socket.sent.length, 0, "a listener never talks");
  assert.equal(card.querySelector('[data-el="note"]').textContent.includes("HTML"), false);
  w.destroy();
});

test("a state update: wrong track → jump (seek once it plays); small drift left alone; pause pauses; off air destroys", async () => {
  const { w, yt } = mountFake();
  w.set(onAir());
  await tick();
  const p = yt.players[0];
  p.calls.length = 0;
  p.time = 41;
  w.set(onAir({ positionMs: 42_000, updatedAt: 1_000_000 }));
  assert.ok(!p.calls.some(([c]) => c === "seek"), "1s of drift is ambient: no seek");
  w.set(onAir({ index: 3, positionMs: 5_000, updatedAt: 1_000_000 }));
  assert.deepEqual(p.calls.find(([c]) => c === "at"), ["at", 3]);
  p.fire(1); // the new track began: the pending seek lands
  assert.ok(p.calls.some(([c, v]) => c === "seek" && v === 5));
  w.set(onAir({ index: 3, playing: false, positionMs: 5_000 }));
  assert.ok(p.calls.some(([c]) => c === "pause"));
  w.set({ ...onAir(), playlistId: "", playing: false });
  assert.ok(p.destroyed, "off air: the player goes away");
  w.destroy();
});

test("the conductor: only the host reports, a new track always, the same track only when drifted; ⏯ and ⏭", async () => {
  const { w, yt, socket, card } = mountFake();
  w.set(onAir({ index: 2, positionMs: 0, updatedAt: 1_000_000 }));
  await tick();
  const p = yt.players[0];
  p.fire(1);
  assert.equal(socket.sent.length, 0, "not the host: silent");
  w.setHost(true);
  // the new conductor announces where it is (same index: the server treats it as a re-anchor check)
  assert.equal(socket.sent.length, 1);
  assert.equal(socket.sent[0][0], "radio-track");
  assert.equal(socket.sent[0][1].index, 2);
  p.index = 3;
  p.time = 0.4;
  p.fire(1);
  assert.equal(socket.sent.length, 2, "a new track is reported");
  assert.deepEqual(socket.sent[1][1], { index: 3, videoId: "dQw4w9WgXcQ", title: "Track 3", positionMs: 400 });
  p.fire(1);
  assert.equal(socket.sent.length, 2, "the same track, no drift: nothing");
  w.set(onAir({ index: 3, positionMs: 400, updatedAt: 1_000_000 }));
  p.time = 30;
  p.fire(1);
  assert.equal(socket.sent.length, 3, "the same track, drifted: re-anchor");
  assert.equal(socket.sent[2][1].positionMs, 30_000);

  card.querySelector('[data-act="toggle"]').click();
  assert.equal(socket.sent.at(-1)[0], "radio-pause");
  assert.equal(socket.sent.at(-1)[1].positionMs, 30_000);
  w.set(onAir({ index: 3, playing: false, positionMs: 30_000 }));
  card.querySelector('[data-act="toggle"]').click();
  assert.equal(socket.sent.at(-1)[0], "radio-play");
  p.calls.length = 0;
  card.querySelector('[data-act="skip"]').click();
  assert.deepEqual(p.calls, [["next"]], "skip is a local nextVideo; the report follows from the state change");
  card.querySelector('[data-act="back"]').click();
  assert.deepEqual(p.calls, [["next"], ["prev"]], "back is a local previousVideo");
  w.destroy();
});

test("mute and volume are mine: they touch the player and the prefs, never the socket; power off destroys, on rebuilds", async () => {
  const { w, yt, socket, card, mem } = mountFake();
  w.set(onAir());
  await tick();
  const p = yt.players[0];
  card.querySelector('[data-act="mute"]').click();
  assert.equal(p.muted, true);
  assert.equal(JSON.parse(mem.get("cowriteRadio")).muted, true);
  const vol = card.querySelector('[data-act="vol"]');
  card.querySelector('[data-act="mute"]').click();
  vol.value = "70";
  vol.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(p.volume, 70);
  assert.equal(JSON.parse(mem.get("cowriteRadio")).volume, 70);
  assert.equal(socket.sent.length, 0);

  card.querySelector('[data-act="power"]').click();
  assert.ok(p.destroyed, "off = no player at all");
  assert.equal(w.player, null);
  assert.match(card.querySelector('[data-el="note"]').textContent, /Tune in/);
  assert.equal(JSON.parse(mem.get("cowriteRadio")).off, true);
  card.querySelector('[data-act="power"]').click();
  await tick();
  assert.equal(yt.players.length, 2, "on again: a fresh player at the anchor");
  assert.equal(yt.players[1].volume, 70);
  w.destroy();
});

test("a phone never builds a player: the station's info and a link to the playlist on YouTube instead", async () => {
  const { w, yt, card, socket } = mountFake({ isPhone: true });
  w.set(onAir({ index: 4, title: `<b>Heroes</b>` }));
  await tick();
  assert.equal(yt.players.length, 0);
  assert.ok(card.classList.contains("radio-phone"));
  assert.ok(card.querySelector('[data-el="ctl"]').classList.contains("hidden"), "no controls to speak of");
  const a = card.querySelector('[data-el="note"] a');
  assert.equal(a.getAttribute("href"), `https://www.youtube.com/playlist?list=${LIST}&index=5`);
  assert.equal(a.getAttribute("target"), "_blank");
  assert.match(card.querySelector('[data-el="note"]').textContent, /isn't supported on phones/);
  assert.equal(card.querySelector('[data-el="track"]').textContent, "▸ <b>Heroes</b>", "a title is text, never markup");
  assert.equal(card.querySelector('[data-el="track"] b'), null);
  w.setHost(true);
  assert.equal(socket.sent.length, 0, "a phone host doesn't conduct");
  w.destroy();
});

test("the API never loading: the HUD says so and the game goes on", async () => {
  const card = document.createElement("div");
  const host = document.createElement("div");
  document.body.append(card, host);
  const w = wsqk.mountWsqk({ socket: socketSpy(), card, host, storage: null, isPhone: false, loadApi: () => Promise.reject(new Error("blocked")) });
  w.set(onAir());
  await tick();
  assert.match(card.querySelector('[data-el="note"]').textContent, /off the air in this browser/);
  assert.equal(w.player, null);
  w.destroy();
});
