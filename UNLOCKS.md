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
| 8   | `clouds`        | ☁️ I miss clouds I miss you                 |  35,000 |
| 9   | `artist`        | 🧭 Artist                                   |  50,000 |
| 10  | `notmyfault`    | 😤 It's not my fault you don't like girls!  |  75,000 |
| 11  | `bestfriend`    | 💛 A Best "Friend"                          | 100,000 |
| 12  | `crazytogether` | 🌀 Crazy Together                           | 150,000 |

## What each rank unlocks

| Rank (tier id) | Words | Themes (theme id) | Gimmick that rides along |
| --- | --: | --- | --- |
| `outloud` | 0 | Inkwell (`ink`), The Wall (`wall`) | 🔫 SuperSoaker (`supersoaker`) |
| `puppymike` | 5,000 | Rink-O-Mania (`rink`), Snow Ball Dance (`snowball`) | 🪩 Rink-O-Mania Disco Ball (`disco`) |
| `practice` | 10,000 | Starcourt (`starcourt`) | 🥤 Starcourt Milkshake (`milkshake`) |
| `explorer` | 15,000 | Palace Arcade (`arcade`) | 👾 Palace Arcade Galaga (`galaga`) |
| `sorcerer` | 20,000 | Hellfire Club (`hellfire`) | 🎲 Hellfire d20 (`d20`) |
| `soldiers` | 25,000 | Hawkins Lab (`hawkinslab`), Russian Bunker (`bunker`) | — |
| `innate` | 30,000 | Castle Byers (`castlebyers`) | — |
| `clouds` | 35,000 | Vecna's Clock (`vecna`) | 🕰️ Vecna's Curse (`curse`) |
| `artist` | 50,000 | The Void (`void`) | 🎨 Will's Art Room (`artroom`) |
| `notmyfault` | 75,000 | Cerebro (`cerebro`), Family Video (`video`) | — |
| `bestfriend` | 100,000 | Cleradin (`cleradin`) | — |
| `crazytogether` | 150,000 | I Miss the Clouds (`clouds`) | — |

## Free themes (not in `themeUnlocks`)

- Neon Dusk (`neon`) — the default theme
- Aurora (`aurora`)
- Upside Down (`upside`)

Note: `ink` and `wall` sit at the 0-word tier, so any signed-in account has them; signed-out visitors get only the three free themes. `test/unlocks-doc.test.mjs` re-derives the two tables above from `achievements.json` + `lib/gimmicks.js` and fails if this file drifts.

## How to edit

Change `themeUnlocks` in `achievements.json` — keys are theme ids from `THEMES` in `public/js/theme.js`, values are tier ids from `wordTiers` above. `test/themes.test.mjs` pins every key to a real theme and every value to a real tier, so run `npm test` after editing. Update this file to match.

## Will's Art Room (gimmick)

Take a paintbrush out over the live game and paint — a swatch row (your own
palette colour first), a free color picker, and the whole table watches every
stroke land. Stroke data travels as screen fractions and each viewer redraws
it on their own canvas, so no pixel crosses the wire; the paint layer takes
the pointer only for the painter, so painting never costs another writer
their caret. Paint STAYS until its painter wipes it or leaves (putting the
brush away keeps it); the game going friendly clears the room. No steal, no
chime — pure distraction, the milkshake's category.

## SuperSoaker (gimmick)

A water gun you drag anywhere over the live game — drag to aim (it points
away from the nearest wall), a clean click FIRES: a burst of droplets arcs
out of the muzzle in the shooter's colour, splashes, and streaks run down
before the water dries (~8s). Shared the disco ball's way: the gun's
position streams as fractions (`gimmick-gun`), and one seeded
`gimmick-squirt` relay starts the identical burst on every screen — no
droplet ever crosses the wire. Chat call "soaked the game with the
SuperSoaker 💦" on a cooldown. No steal, no chime, no persistence: water
dries on its own. Registry id `supersoaker`, theme `ink`, so any signed-in
account has it (the 0-word tier).

## Vecna's curse

Vecna's Curse — you lift the curse off the grandfather clock and place it on a tablemate. On their screen (everyone else watches it happen from outside), the theme's clock chimes four times, the page slowly desaturates, a red mist vignette creeps in from the edges, and debris starts drifting upward like the Creel house ceiling. They're being taken.

The escape is the theme's own logic inverted: writing is the song that saves you. The curse lifts the moment the cursed writer types ~15 characters anywhere (editor or chat) — their words are their Running Up That Hill. If they just sit there, it fades on its own after ~20 seconds; nothing is ever actually blocked (the mist is pointer-events none, text stays readable underneath). Cosmetic dread, zero mechanical harm — which is right, because unlike the d20 this one targets a person.

How it fits the architecture (as built):

- Events: `gimmick-curse {targetUserId}` — server checks seat + rank via tableHasGimmick(), target must be another CONNECTED seat, per-user cooldown (the shared gimmick cooldown; one curse in flight per session), relays `gimmick-curse {byName, byColor, targetUserId, targetName, duration}` to the whole room so everyone sees who's cursed (watchers get a red pulse on the victim's chips while it holds). The victim's typed characters are counted client-local; at ~15 they emit `gimmick-uncurse` (only the cursed seat may), and the lift relays as `gimmick-curse {targetUserId, lift: true}` — the same relay the server's expiry timer, the victim leaving, and the friendly switch use, so no screen ever stays grey.
- Chat calls via announce(): "placed Vecna's curse on Will 🕰️" (with `chime: true` — the placement rings like a natural 20, under the gimmick sound pref) and the payoff line "wrote their way out of Vecna's curse ⏱". The victim also hears the vecna clock strike for a few seconds (the existing `/sounds/vecnaclock.mp3` loop, borrowed briefly, never fighting the turn countdown).
- The clock is the anchor: while a curse is live `<html>` wears `vcx-live`, and on the vecna theme the pendulum (#vc-pend) hurries and the dimmed .clockface sky glows red — the background itself becomes the gimmick's tell, which no other gimmick does yet.
- Spectators see the mist indicators the same as writers (relay to the whole room, like dice), but can't cast — cast requires a seat, per the standing rule.

Registry entry: id `curse`, theme: "vecna", so it inherits whatever tier Vecna's Clock sits at (clouds, 35k — a suitably late toy, since it's the first one aimed at a specific person). `CURSE_MS` (20s) and `CURSE_LIFT_CHARS` (15) live in lib/gimmicks.js; `COWRITE_CURSE_MS` shrinks the hold for tests.
