import { test } from "node:test";
import assert from "node:assert/strict";
import { createSounds, createLineChime, shouldChimeChat, shouldChime, SOUND_NAMES } from "../public/js/sounds.js";

class FakeAudio {
  constructor(src) {
    this.src = src;
    this.plays = 0;
    this.pauses = 0;
  }
  play() {
    this.plays++;
    return Promise.resolve();
  }
  pause() {
    this.pauses++;
  }
}

test("createSounds loads all four sounds and play() is safe for unknown names", () => {
  const { sounds, play } = createSounds(FakeAudio);
  assert.deepEqual(Object.keys(sounds).sort(), [...SOUND_NAMES].sort());
  assert.equal(sounds.incomingline.src, "/sounds/incomingline.mp3");
  assert.equal(sounds.incomingline.volume, 0.6);
  play("incomingline");
  assert.equal(sounds.incomingline.plays, 1);
  play("nope"); // no throw
});

test("vecna clock: looped, idempotent start, stop rewinds", () => {
  const { clock, clockAudio } = createSounds(FakeAudio);
  assert.equal(clockAudio.loop, true, "the alarm loops");
  assert.equal(clock.active, false);
  clock.start();
  clock.start(); // already chiming -> no restart stutter
  assert.equal(clockAudio.plays, 1, "start is idempotent");
  assert.equal(clock.active, true);
  clock.stop();
  assert.equal(clockAudio.pauses, 1);
  assert.equal(clockAudio.currentTime, 0, "rewound for the next turn");
  clock.stop(); // no-op when silent
  assert.equal(clockAudio.pauses, 1);
});

test("shouldChime: everyone hears the last 10s of a live turn", () => {
  const live = (left) => ({ left, paused: false, low: left <= 10 });
  assert.equal(shouldChime(live(10)), true);
  assert.equal(shouldChime(live(1)), true);
  assert.equal(shouldChime(live(11)), false, "not before the demogorgon");
  assert.equal(shouldChime(live(0)), false, "silent once expired");
  assert.equal(shouldChime({ left: 5, paused: true, low: false }), false, "paused is silent");
});

test("chat chime rules: others' real messages only", () => {
  assert.equal(shouldChimeChat({ id: "them", text: "hi" }, "me"), true);
  assert.equal(shouldChimeChat({ id: "me", text: "hi" }, "me"), false, "own echo silent");
  assert.equal(shouldChimeChat({ sys: true, id: "them" }, "me"), false, "system silent");
  assert.equal(shouldChimeChat({ sys: true, chime: true }, "me"), true, "…unless it asks to ring (the dice gimmick's natural 20)");
  assert.equal(shouldChimeChat({ sys: true, chime: "yes" }, "me"), false, "only a true chime flag");
  assert.equal(shouldChimeChat({ text: "no id" }, "me"), false, "history-style msg silent");
});

test("line chime: rejoin replay silent, others' lines ring, mine don't", () => {
  const played = [];
  const chime = createLineChime((n) => played.push(n));
  // first render after rejoin: story already has lines -> silent
  chime.note([{}, {}], "me");
  assert.deepEqual(played, []);
  // someone else was writing, story grew -> ring
  chime.setPrev("them");
  chime.note([{}, {}, {}], "me");
  assert.deepEqual(played, ["incomingline"]);
  // I was the writer -> my own line is silent
  chime.setPrev("me");
  chime.note([{}, {}, {}, {}], "me");
  assert.deepEqual(played, ["incomingline"]);
  // no growth -> silent even with prev writer set
  chime.setPrev("them");
  chime.note([{}, {}, {}, {}], "me");
  assert.deepEqual(played, ["incomingline"]);
});

test("setPrefs gates chat/story/clock independently; legacy boolean fans out", () => {
  const kit = createSounds(FakeAudio);
  kit.setPrefs({ chat: false, story: true, clock: false });
  kit.play("incomingmessage");
  kit.play("outgoingmessage");
  assert.equal(kit.sounds.incomingmessage.plays, 0, "chat muted");
  assert.equal(kit.sounds.outgoingmessage.plays, 0, "chat muted both ways");
  kit.play("incomingline");
  assert.equal(kit.sounds.incomingline.plays, 1, "story still rings");
  kit.clock.start();
  assert.equal(kit.clock.active, false, "clock pref blocks start");

  kit.setPrefs(true); // legacy boolean -> all on
  kit.play("outgoingmessage");
  assert.equal(kit.sounds.outgoingmessage.plays, 1);
  kit.clock.start();
  assert.equal(kit.clock.active, true);

  kit.setPrefs({ chat: true, story: true, clock: false });
  assert.equal(kit.clock.active, false, "disabling the clock pref stops a running clock");
  assert.ok(kit.clockAudio.pauses >= 1);

  kit.setPrefs(false); // legacy off -> everything muted
  kit.play("incomingline");
  assert.equal(kit.sounds.incomingline.plays, 1, "no new plays while muted");
  assert.deepEqual(kit.prefs, { chat: false, story: false, clock: false, gimmick: false });
});

test("the gimmick pref gates a chat ping played under the gimmick category, and only that", () => {
  const kit = createSounds(FakeAudio);
  kit.setPrefs({ chat: true, story: true, clock: true, gimmick: false });
  kit.play("incomingmessage", "gimmick");
  assert.equal(kit.sounds.incomingmessage.plays, 0, "gimmick sounds off: the natural-20 chime is silent");
  kit.play("incomingmessage");
  assert.equal(kit.sounds.incomingmessage.plays, 1, "ordinary chat pings still ring");
  kit.setPrefs({ chat: false, story: true, clock: true, gimmick: true });
  kit.play("incomingmessage", "gimmick");
  assert.equal(kit.sounds.incomingmessage.plays, 2, "chat muted, gimmick on: the natural 20 still rings");
  assert.equal(kit.prefs.gimmick, true);
});

test("playClip: a badge clip loads on first use, replays reuse it, off-pref is silent, bad names never touch the network", () => {
  const made = [];
  class SpyAudio extends FakeAudio {
    constructor(src) {
      super(src);
      made.push(src);
    }
  }
  const kit = createSounds(SpyAudio);
  const before = made.length;
  kit.playClip("at-long-last-we-can-begin");
  kit.playClip("at-long-last-we-can-begin");
  assert.deepEqual(made.slice(before), ["/sounds/at-long-last-we-can-begin.mp3"], "created once");
  kit.playClip("../etc/passwd");
  kit.playClip("Vecna Laugh");
  assert.equal(made.length, before + 1, "a name that isn't a basename is ignored");
  kit.setPrefs({ story: false });
  kit.playClip("vecna-laugh");
  assert.equal(made.length, before + 1, "story sounds off: nothing loads or plays");
});
