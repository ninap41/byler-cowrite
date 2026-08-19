// Gimmicks: rank-unlocked toys writers play INSIDE a live session (non-
// friendly games only) to distract the table. This module is the registry of
// what a gimmick IS plus its pure rules — no I/O, no DOM, no sockets — so
// src/game.js can drive it and a test can exercise every rule directly.
//
// v1 ships one gimmick, the Hellfire d20: a die you throw around your own
// screen. Every landing is called out in the session chat, a natural 1 is a
// fumble, and a natural 20 STEALS THE TURN — the roller becomes the current
// writer on the spot, and whatever the writer they interrupted had typed is
// gone. Which rank earns a gimmick lives in achievements.json
// (gimmickUnlocks / gimmickLabels), exactly like themes.

export const GIMMICKS = {
  d20: {
    id: "d20",
    name: "Hellfire d20",
    theme: "hellfire",
    desc: "Throw a d20 around the screen. Every roll lands in the chat — and a natural 20 steals the turn.",
  },
};
export const GIMMICK_IDS = Object.keys(GIMMICKS);
export const cleanGimmickId = (id) => (GIMMICK_IDS.includes(id) ? id : null);

// ---- the d20 ----------------------------------------------------------------
export const DIE_SIDES = 20;
// A throw's animation runs up to ~1.7s; the server won't take another sooner,
// so a mashed die can't out-roll what anyone can see land — and can't spam
// the chat.
export const ROLL_COOLDOWN_MS = 1800;

// What a landing means. `steal` is what the roll WANTS; whether the turn can
// actually change hands (writing phase, not paused, not already theirs) is the
// session's call in game.js.
export function rollOutcome(value) {
  const v = Math.max(1, Math.min(DIE_SIDES, Math.floor(Number(value) || 1)));
  if (v === DIE_SIDES) return { value: v, kind: "crit", steal: true };
  if (v === 1) return { value: v, kind: "fumble", steal: false };
  return { value: v, kind: "plain", steal: false };
}

// The chat line for a landing. `stole` is what actually happened; `declined`
// means the roller had opted out of stealing (the crit is still called).
export function describeRoll(outcome, { stole = false, from = "", declined = false } = {}) {
  if (outcome.kind === "crit") return stole
    ? `rolled a NATURAL 20 🎲 and stole the turn${from ? ` from ${from}` : ""}!`
    : declined ? "rolled a NATURAL 20 🎲 — and let the writer keep the turn." : "rolled a NATURAL 20 🎲";
  if (outcome.kind === "fumble") return "rolled a natural 1 🎲 — fumble.";
  return `rolled a ${outcome.value} 🎲`;
}
