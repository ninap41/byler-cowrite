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
    icon: "🎲",
    name: "Hellfire d20",
    theme: "hellfire",
    desc: "Throw a d20 around the screen. Every roll lands in the chat, and a natural 20 steals the turn.",
  },
  galaga: {
    id: "galaga",
    icon: "👾",
    name: "Palace Arcade Galaga",
    theme: "arcade",
    desc: "Blast the Galaga fleet over the live game. Your run lands in the chat, and beating 8,000 steals the turn (the table's best run holds it).",
  },
  milkshake: {
    id: "milkshake",
    icon: "🥤",
    name: "Starcourt Milkshake",
    theme: "starcourt",
    desc: "Drag a milkshake anywhere over the live game, tip it and the spill runs down everyone's screen. Pure mess, no steal.",
  },
  disco: {
    id: "disco",
    icon: "🪩",
    name: "Rink-O-Mania Disco Ball",
    theme: "rink",
    desc: "Hang a disco ball over the live game, spin it and colored light sweeps everyone's screen. Pure distraction, no steal.",
  },
  artroom: {
    id: "artroom",
    icon: "🎨",
    name: "Will's Art Room",
    theme: "void",
    desc: "Take out a paintbrush and paint over the live game, swatches, a color picker, and the whole table watches the picture happen. Pure distraction, no steal.",
  },
  supersoaker: {
    id: "supersoaker",
    icon: "🔫",
    name: "SuperSoaker",
    theme: "ink",
    desc: "Drag a water gun over the live game and FIRE, the burst splashes and runs down everyone's screen before it dries. Pure soak, no steal.",
  },
  curse: {
    id: "curse",
    icon: "🕰️",
    name: "Vecna's Curse",
    theme: "vecna",
    desc: "Place the curse on a tablemate: their page greys out under red mist while the clock chimes. Writing is the song that saves them, ~15 typed characters lift it.",
  },
};

// Vecna's curse: how long a victim is taken for, and how many typed
// characters sing them out early. Cosmetic dread only — nothing is blocked.
export const CURSE_MS = 60000;
export const CURSE_LIFT_CHARS = 15;

// The art room's bounds: how much paint one painter may keep on the table's
// screens. The server trims the oldest stroke past the cap rather than
// refusing, so painting never errors — old paint just gives way to new.
export const PAINT_MAX_STROKES = 40;
export const PAINT_MAX_PTS = 200;

// How long one disco-ball spin's light show runs. Also the spin cooldown —
// you can't restart the show before your own has finished.
export const SPIN_MS = 8000;
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
    : declined ? "rolled a NATURAL 20 🎲, and let the writer keep the turn." : "rolled a NATURAL 20 🎲";
  if (outcome.kind === "fumble") return "rolled a natural 1 🎲, fumble.";
  return `rolled a ${outcome.value} 🎲`;
}

// ---- the Palace Arcade Galaga run --------------------------------------------
// The whole run plays on the roller's own screen (components/galaga-game.js);
// only the FINAL score comes to the server, which clamps it and decides what
// it means: beat GALAGA_TARGET and the run wants the turn, exactly like a
// natural 20. Whether the turn actually changes hands stays the session's
// call in game.js.
export const GALAGA_TARGET = 8000;
export const GALAGA_MAX_SCORE = 99950; // a run can't claim more than the board could ever pay out

export function galagaOutcome(score) {
  const v = Math.max(0, Math.min(GALAGA_MAX_SCORE, Math.floor(Number(score) || 0)));
  if (v > GALAGA_TARGET) return { score: v, kind: "highscore", steal: true };
  return { score: v, kind: "plain", steal: false };
}

// The chat line for a finished run. Same contract as describeRoll: `stole` is
// what actually happened, `declined` means the player had opted out — and
// `beaten` means the run cleared the target but a HIGHER run already holds
// the stolen turn (`by` names its holder): steals stack, best score wins.
export function describeGalaga(outcome, { stole = false, from = "", declined = false, beaten = false, by = "" } = {}) {
  const pts = outcome.score.toLocaleString();
  const target = GALAGA_TARGET.toLocaleString();
  if (outcome.kind === "highscore") return stole
    ? `blasted the fleet for ${pts} 👾, beat ${target} and stole the turn${from ? ` from ${from}` : ""}!`
    : declined
      ? `blasted the fleet for ${pts} 👾, beat ${target}, and let the writer keep the turn.`
      : beaten
        ? `blasted the fleet for ${pts} 👾, beat ${target}, but ${by ? `${by}'s` : "a"} higher run holds the turn.`
        : `blasted the fleet for ${pts} 👾, beat ${target}!`;
  return `scored ${pts} on the Galaga fleet 👾`;
}
