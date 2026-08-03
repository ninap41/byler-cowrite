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

test("shouldChime: only the last 15s of MY live turn", () => {
  const live = (left) => ({ left, paused: false });
  assert.equal(shouldChime(live(15), true), true);
  assert.equal(shouldChime(live(1), true), true);
  assert.equal(shouldChime(live(16), true), false, "not before the window");
  assert.equal(shouldChime(live(0), true), false, "silent once expired");
  assert.equal(shouldChime(live(10), false), false, "someone else's turn is silent");
  assert.equal(shouldChime({ left: 10, paused: true }, true), false, "paused is silent");
});

test("chat chime rules: others' real messages only", () => {
  assert.equal(shouldChimeChat({ id: "them", text: "hi" }, "me"), true);
  assert.equal(shouldChimeChat({ id: "me", text: "hi" }, "me"), false, "own echo silent");
  assert.equal(shouldChimeChat({ sys: true, id: "them" }, "me"), false, "system silent");
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
