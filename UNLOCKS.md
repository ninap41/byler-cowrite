# Theme & gimmick unlocks

A hand-editable reference of which themes unlock at which word-count ranks, and which gimmick rides each theme.

**This file is documentation only.** The real data lives in `achievements.json`:

- Ranks are the `wordTiers` ladder (id, name, `min` words).
- Theme gating is the `themeUnlocks` map: `theme id → tier id`. A theme not listed is free for everyone; a theme pointing at a tier id that doesn't exist falls back to free.
- **There is no gimmick map.** A gimmick belongs to a theme (`lib/gimmicks.js`, the `theme` field) and unlocks with that theme — retier the theme and the gimmick moves with it. A gimmick on a free theme is free.
- Admins have every theme and gimmick regardless of rank.

## Rank ladder (`wordTiers`)

| #   | Tier id         | Badge                                       |   Words |
| --- | --------------- | ------------------------------------------- | ------: |
| 1   | `outloud`       | 🔫 There. Out Loud.                         |       0 |
| 2   | `puppymike`     | 🐶 Puppy Mike                               |   5,000 |
| 3   | `practice`      | 🪄 Practice                                 |  10,000 |
| 4   | `explorer`      | 🫶 You have explored (like Mike, offscreen) |  15,000 |
| 5   | `sorcerer`      | 🧙 Sorcerer                                 |  20,000 |
| 6   | `soldiers`      | 🪖 Like the soldiers                        |  25,000 |
| 7   | `innate`        | ⚡ Innate Powers                            |  30,000 |
| 8   | `clouds`        | ☁️ I miss clouds I miss you                 |  40,000 |
| 9   | `artist`        | 🧭 Artist                                   |  50,000 |
| 10  | `notmyfault`    | 😤 It's not my fault you don't like girls!  |  75,000 |
| 11  | `bestfriend`    | 💛 A Best "Friend"                          | 100,000 |
| 12  | `crazytogether` | 🌀 Crazy Together                           | 150,000 |

## What each rank unlocks

| Rank (tier id) | Words | Themes (theme id) | Gimmick that rides along |
| --- | --: | --- | --- |
| `outloud` | 0 | Upside Down (`upside`) | 🔫 SuperSoaker (`supersoaker`) |
| `puppymike` | 5,000 | Snow Ball (`snowball`) |
| `practice` | 10,000 | Starcourt (`starcourt`) | 🥤 Starcourt Milkshake (`milkshake`) |
| `explorer` | 15,000 | Palace Arcade (`arcade`) | 👾 Palace Arcade Galaga (`galaga`) |
| `sorcerer` | 20,000 | Hellfire Club (`hellfire`) | 🎲 Hellfire d20 (`d20`) |
| `soldiers` | 25,000 | Hawkins Lab (`hawkinslab`) | — |
| `innate` | 30,000 | Castle Byers (`castlebyers`) | — |
| `clouds` | 40,000 | Vecna's Clock (`vecna`) | — Vecna's Curse (`vecnascurse`) |
| `artist` | 50,000 | The Void (`void`) | — Will's art room (`artroom`) |
| `notmyfault` | 75,000 | Cerebro (`cerebro`), Family Video (`video`) | — |
| `bestfriend` | 100,000 | Rink-O-Mania (`rink`), Cleradin (`cleradin`) | — |
| `crazytogether` | 150,000 | Russian Bunker (`bunker`), I Miss the Clouds (`clouds`) | — |

## Free themes (not in `themeUnlocks`)

- Neon Dusk (`neon`) — the default theme
- Aurora (`aurora`)
- Inkwell (`ink`)

Note: `wall` and `snowball` sit at the 0-word tier, so any signed-in account has them; signed-out visitors get only the three free themes.

## How to edit

Change `themeUnlocks` in `achievements.json` — keys are theme ids from `THEMES` in `public/js/theme.js`, values are tier ids from `wordTiers` above. `test/themes.test.mjs` pins every key to a real theme and every value to a real tier, so run `npm test` after editing. Update this file to match.

## Art Room (gimmick)

paint splash gimmick

## Supersoaker (gimmick)

A gun that fires water.

## Vecna's curse

Vecna's Curse — you lift the curse off the grandfather clock and place it on a tablemate. On their screen (everyone else watches it happen from outside), the theme's clock chimes four times, the page slowly desaturates, a red mist vignette creeps in from the edges, and debris starts drifting upward like the Creel house ceiling. They're being taken.

The escape is the theme's own logic inverted: writing is the song that saves you. The curse lifts the moment the cursed writer types ~15 characters anywhere (editor or chat) — their words are their Running Up That Hill. If they just sit there, it fades on its own after ~20 seconds; nothing is ever actually blocked (the mist is pointer-events none, text stays readable underneath). Cosmetic dread, zero mechanical harm — which is right, because unlike the d20 this one targets a person.

How it fits the architecture:

- Events: gimmick-curse {targetUserId} — server checks seat + rank via tableHasGimmick(), per-user cooldown (~30s, one curse in flight per session), relays gimmick-curse {byName, byColor, targetUserId} to the room so everyone sees who's cursed (watchers get a subtle red pulse around the victim's roster entry and story bylines while it holds). The lift is client-local on the victim (they know when they've typed) with a gimmick-uncurse ack relayed so the room sees them escape.
- Chat calls via announce(): "placed Vecna's curse on Will 🕰️" and — the payoff line — "Will wrote their way out. ⏱" The four chimes ride the gimmick sound pref (announce(…, {chime: true}) on the placement only, like the natural 20).
- The clock is the anchor: while a curse is live, the theme's pendulum (#vc-pend) swings faster and the dimmed .clockface sky behind it glows red — the background itself becomes the gimmick's tell, which no other gimmick does yet.
- Spectators see the mist on the victim the same as writers (relay to the whole room, like dice), but can't cast — cast requires a seat, per the standing rule.

Registry entry: id curse, theme: "vecna", so it inherits whatever tier Vecna's Clock sits at (clouds, 40k — a suitably late toy, since it's the first one aimed at a specific person).
