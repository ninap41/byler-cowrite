# Theme & gimmick unlocks

A hand-editable reference of which themes unlock at which word-count ranks, and which gimmick rides each theme.

**This file is documentation only.** The real data lives in `achievements.json`:

- Ranks are the `wordTiers` ladder (id, name, `min` words).
- Theme gating is the `themeUnlocks` map: `theme id → tier id`. A theme not listed is free for everyone; a theme pointing at a tier id that doesn't exist falls back to free.
- **There is no gimmick map.** A gimmick belongs to a theme (`lib/gimmicks.js`, the `theme` field) and unlocks with that theme — retier the theme and the gimmick moves with it. A gimmick on a free theme is free.
- Admins have every theme and gimmick regardless of rank.

## Rank ladder (`wordTiers`)

| # | Tier id | Badge | Words |
|---|---------|-------|------:|
| 1 | `outloud` | 🔫 There. Out Loud. | 0 |
| 2 | `puppymike` | 🐶 Puppy Mike | 5,000 |
| 3 | `practice` | 🪄 Practice | 10,000 |
| 4 | `practicewithme` | 🫶 You can practice with me. | 15,000 |
| 5 | `sorcerer` | 🧙 Sorcerer | 20,000 |
| 6 | `soldiers` | 🪖 Like the soldiers | 25,000 |
| 7 | `innate` | ⚡ Innate Powers | 30,000 |
| 8 | `clouds` | ☁️ I miss clouds I miss you | 40,000 |
| 9 | `explorer` | 🧭 Explorer | 50,000 |
| 10 | `notmyfault` | 😤 It's not my fault you don't like girls! | 75,000 |
| 11 | `bestfriend` | 💛 A Best "Friend" | 100,000 |
| 12 | `crazytogether` | 🌀 Crazy Together | 150,000 |

## What each rank unlocks

| Rank (tier id) | Words | Themes (theme id) | Gimmick that rides along |
|----------------|------:|-------------------|--------------------------|
| `outloud` | 0 | The Wall (`wall`), Snow Ball (`snowball`) | — |
| `puppymike` | 5,000 | Upside Down (`upside`) | — |
| `practice` | 10,000 | Starcourt (`starcourt`) | 🥤 Starcourt Milkshake (`milkshake`) |
| `practicewithme` | 15,000 | Palace Arcade (`arcade`) | 👾 Palace Arcade Galaga (`galaga`) |
| `sorcerer` | 20,000 | Hellfire Club (`hellfire`) | 🎲 Hellfire d20 (`d20`) |
| `soldiers` | 25,000 | Hawkins Lab (`hawkinslab`) | — |
| `innate` | 30,000 | Castle Byers (`castlebyers`) | — |
| `clouds` | 40,000 | Vecna's Clock (`vecna`) | — |
| `explorer` | 50,000 | The Void (`void`) | — |
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
