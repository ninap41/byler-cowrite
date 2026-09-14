# Theme & gimmick unlocks

A hand-editable reference of which themes unlock at which word-count ranks, and which gimmick rides each theme.

**This file is documentation only.** The real data lives in `content/achievements.json`:

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

Note: `ink` and `wall` sit at the 0-word tier, so any signed-in account has them; signed-out visitors get only the three free themes. `test/unlocks-doc.test.mjs` re-derives the two tables above from `content/achievements.json` + `lib/gimmicks.js` and fails if this file drifts.

## How to edit

Change `themeUnlocks` in `content/achievements.json` — keys are theme ids from `THEMES` in `public/js/theme.js`, values are tier ids from `wordTiers` above. `test/themes.test.mjs` pins every key to a real theme and every value to a real tier, so run `npm test` after editing. Update this file to match.

## Table rules for every gimmick

All gimmicks share the table rules: only in **non-friendly** games, only from a
seat (spectators watch but can't play), and "if one person at the table has
it, everyone can play it" (`tableHasGimmick()` — admins count as having every
gimmick). The 🎲 menu says which is which: your own unlocks read "🎲 … · Play",
a tablemate's read "🔓 … · Play" (live, with a tooltip naming the rank that
would keep it), and a gimmick nobody seated has is 🔒 and disabled. Because the
table list rides on every `game-state`, one high-ranked seat — an admin, say —
lights every gimmick for the whole lobby before the game even starts. Flipping the game friendly fades every toy off every screen with a
"💛 This is a friendly game now" toast. Positions travel as fractions of each
player's own screen; heavy effects (water, light shows, paint pixels) are
simulated locally on every viewer so almost nothing crosses the wire.

## Hellfire d20 (gimmick)

`d20`, rides the Hellfire Club theme (`sorcerer`, 20k). A real 3D icosahedron
in your own palette colour that you drag anywhere over the live game — the
editor included, that's the point — flick to throw it, click to roll. The
SERVER rolls and calls every landing in writers chat ("rolled a 13 🎲",
"a natural 1 — fumble."). A **natural 20 mid-writing steals the turn**: the
roller becomes the current writer and the interrupted writer's unsent line is
gone. The HUD's "Steal the turn on a natural 20" box is the roller's opt-out
(remembered in `cowriteDiceSteal`, shared by Galaga). Every throw plays the
tumble sound and the natural-20 chat line chimes, both under the account's
gimmick sound preference. 1.8s per-user roll cooldown.

## Palace Arcade Galaga (gimmick)

`galaga`, rides the Palace Arcade theme (`explorer`, 15k). A playable
mini-Galaga fought full-screen over the live game: your pixel ship in your
own colour at the foot of the screen, a bobbing bee fleet up top, divers
worth chasing (100 points a bob, 300 a dive), a 45-second run. Steering is
mouse/←→ from the document, Space or the HUD's Fire button shoots — keys are
ignored while focus is in an editor or input, so typing never fires a shot.
**Every battle is shared**: your ship, shots and fleet stream to the table
(bees carry stable ids, so when you kill one, everyone sees exactly that bee
explode), several players can blast their own fleets side by side, and while
any battle is live the arcade theme's own ambient fleet fades away. Only the
FINAL score counts: beat **8,000** and it steals the turn under exactly the
d20's conditions and opt-out. High scores chime like a natural 20.

## Starcourt Milkshake (gimmick)

`milkshake`, rides the Starcourt theme (`practice`, 10k). A paper cup tinted
in your colour that you drag over the game and tip — click for a full pour,
whip it sideways to slosh — and the spill rains down, pooling along the
bottom of the screen over the chat dock, pools merging per colour. Every
viewer simulates the drops locally from the cup's streamed position; the pour
is called in chat ("tipped a milkshake over the game 🥤") on a cooldown. No
steal, no chime — pure distraction. HUD: Refill (local), Wipe up (clears this
viewer's puddles), Put the cup away. The mess clears when the last cup leaves.

## Rink-O-Mania Disco Ball (gimmick)

`disco`, rides the Rink-O-Mania theme (`puppymike`, 5k). A silver CSS-3D
mirror ball hung by a chain from the top edge — not tinted, a disco ball is
silver for everyone; whose it is lives in the name tag. Drag it anywhere over
the game; **click to spin**: for one 8-second show, colored light spots orbit
the ball on tilted elliptical sweeps under a turning beam fan, tinted your
colour first and then the table's. One spin lights every screen from a single
relayed event (the spin is also the cooldown), and the lights follow the ball
if it's dragged mid-show. Chat call "turned on the disco ball 🪩". No steal,
no chime, no sound — pure distraction.

## Will's Art Room (gimmick)

`artroom`, rides The Void theme (`artist`, 50k). Take a paintbrush out over
the live game and paint — a swatch row (your own palette colour first), a
free color picker, an eraser 🧽, and a four-stop brush-size row whose dots
preview their own width. The whole table watches every stroke land: stroke
data travels as screen fractions and each viewer redraws it on their own
canvas (sized on demand, so a viewer who never opened the room still sees the
painting), so no pixel crosses the wire. While YOUR brush is out an invisible
catcher owns the pointer — painting never costs another writer their caret,
but it also means you must **put the brush away before grabbing any other
gimmick**, and the HUD hint says so. Paint STAYS until its painter wipes it
or leaves (putting the brush away keeps it); the game going friendly clears
the room. No steal, no chime — pure distraction, the milkshake's category.

## SuperSoaker (gimmick)

The gun is the 🔫 water-pistol emoji (green on every modern platform),
mirrored and rotated to face wherever it's aiming so it's never upside down,
with the owner's name tag beside it. Drag it anywhere over the live game —
it aims away from the nearest wall — and a clean click FIRES: a burst of
droplets arcs out of the muzzle in the shooter's colour, splashes, and
streaks run down before the water dries (~8s). Shared the disco ball's way:
the gun's position streams as fractions (`gimmick-gun`), and one seeded
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
