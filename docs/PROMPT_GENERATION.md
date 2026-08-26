# Prompt Generation System

## Purpose

The vote ballot at the start of every game is dealt by `lib/prompt-gen.js`
from `content/prompts.json`. There is no AI and no build step: the generator is
pure (no I/O, no DOM), the data is hand-edited JSON, and `test/prompt-gen.test.mjs`
validates the data so a broken edit fails the suite instead of the game.

Two modes ship, held on the session as `promptMode` / `promptControls`:

| Mode | UI label | What it deals |
|---|---|---|
| `simple` (default) | Simple | One curated scenario string from `prompts`, untouched. |
| `intermediate` | Advanced | A prompt assembled from **axes** + **1–3 weighted tropes** (+ the explicit layer past the age gate). |

Advanced mode is not built.

# 1. Simple mode

`prompts` is an array of complete scenarios. `generateSimplePrompt(prompts, {recent})`
picks one that isn't in `recent` (the current ballot) and never rewrites it.
Add a scenario by adding a string; fix a typo by editing one. Nothing else to do.

# 2. Advanced (intermediate) mode

Tags are written as short strings so they can be weighted and combined the way
AO3 tags are. Each clause is a terse lowercase fragment, and the prompt is one
bulleted clause per line (`bulletList()`), plain text — the bullet is a
character, not markup. `unbullet()` collapses it for titles.

## Axes

| Axis | Pool | Values (ids) |
|---|---|---|
| season | `seasons` | `pre-canon`, `s1`…`s5`, `post-canon` — each with `ageGroup: minor \| adult` |
| canon | `canon` | `canon-compliant`, `canon-divergent`, `au` |
| scenario / place | `places` | road trip, July 4th festival, church, science fair, NYC, cabin, arcade, backstage, hospital, Hawkins woods, … |
| situation | `situations` | first meeting, reunion, crisis, ordinary day, aftermath, secret kept, secret revealed |
| relationship status | `relationships` | strangers, friends, pining, new couple, established, exes, secret relationship |
| tone | `tones` | fluff, angst, hurt/comfort, crack, slow burn |
| trope | `tropes` (grouped by `tropeGroups`) | exactly one from the bank, weighted |
| explicit | `explicit.levels` | `none` / `suggestive` / `explicit` |

Every entry is `{id, label, text, weight?, tags?, compatibleAgeGroups?, compatibleCanon?, incompatibleTags?, requiresTags?, adultOnly?}`.
`label` is what the menus and the option chips show; `text` is the clause the
prompt renders; `weight` biases the draw (default 1); recently-dealt ids on the
same ballot are damped (÷3), not banned.

## Generation order

1. **Season** — chosen first because it fixes the age. Asking for `explicit`
   with the season on Random narrows the draw to adult seasons; a season the
   host picked is always honoured (the level drops instead — see the gate).
2. **Explicit gate** — `gateExplicit(level, season)`: on a minor season
   `explicit` → `suggestive`; `none`/`suggestive` pass everywhere. This runs
   **before any tag weighting**; the kink layer is never drawn for a minor season.
3. **Canon** — decides whether a setting AU is thinkable.
4. Place, relationship, situation, tone — each filtered by `isCompatible()`.
5. **Trope** — exactly one, weighted, from every group except `setting-au`.
   In an AU a WORLD is drawn from `setting-au` first ("alternate universe"
   alone names no world); it rides the Canon line (`alternate universe · coffee
   shop`) and the Place axis is skipped — the world is the place. Tropes and
   explicit setups carry `requiresTags` / `incompatibleTags` against the
   relationship's `together` / `not-together` / `exes` tags so a
   getting-together trope never lands on a couple.
6. **Explicit layer** (adult season + level `explicit` only): one setup, one
   dynamic, 1–2 acts, 1–2 weighted kinks (registers are deprecated: never dealt) — each its own line
   (one `Kinks:` line (setup · dynamic · acts · kinks), tags within a line
   joined by ` · `) after a `Rating: explicit` line. `suggestive` adds just
   `Rating: suggestive`.

Every clause is `Category: choice` (`CATEGORIES` in the lib — Season, Canon,
Place, Relationship, Situation, Trope, Tone, Rating, Kinks). The prompt is still plain text; `promptHtml()` in
`public/js/util.js` renders it as a `.prompt-grid` of category | choice rows
(two column pairs on a wide card), each category name in `.pc-<category>` with a tooltip (`PROMPT_CAT_TIPS`) so
it wears one colour everywhere — banner, ballot, archive. A curated prompt has
no prefix and renders as plain escaped text.

Output: `{prompt, seed, explicitLevel, selections, labels}`. `selections` holds
every id (`tropeIds` is an array; `explicit` is present only when the layer was
dealt); `labels` holds the display labels in the same shape. Same seed + same
options rebuild the same prompt.

## Compatibility rules (`isCompatible`)

- `compatibleAgeGroups` — the season's `ageGroup` must be listed
  (`["adult"]` on marriage of convenience, roommates, exes, first apartment, …;
  `["minor"]` on high school, science fair, school gym).
- `adultOnly` — never on a minor season (the `explicit` level carries it).
- `compatibleCanon` — the canon id must be listed (`["au"]` on every setting AU,
  `["canon-divergent"]` on fix-it / everybody lives).
- `incompatibleTags` / `requiresTags` — against the tags accumulated so far
  (season → canon → place → relationship → situation → tone → tropes).
- `group` in the context restricts a trope draw to one group.

A filter that empties a pool falls back to the whole pool rather than failing.

## The explicit layer

`explicit` holds `levels`, `setups`, `dynamics`, `acts`, `kinks` (weighted —
the design doc's bolded tags carry the most weight), `registers`. It is only
available when the chosen season's `ageGroup` is `adult` (post-canon /
future-fic). Every on-screen season is minors; suggestive and every
non-explicit trope remain available everywhere. Scraping AO3 for the weighted
list is against their ToS — keep this list curated by hand.

## Controls and the wire

`promptControls` = `{seasonId, canonId, placeId, situationId, relationshipId, toneId, explicitLevel}`.
Ids default to `random`; `explicitLevel` to `none`
(never random — nobody gets an explicit ballot they didn't ask for).
`cleanPromptControls` (src/game.js) narrows anything off the wire.

`GET /api/prompt-options` ships ids + labels for the six axis menus, each
season's `ageGroup`, the levels with `adultOnly`, and the trope group names —
never clause text, never the trope bank or the explicit pools.

The client (`public/js/components/prompt-modes.js`) renders six axis selects
and an Explicit select; `levelsFor()` narrows Explicit to
what the chosen season admits (a level that falls out falls back to None).
`optionChipsHtml` chips each dealt option in `CHIP_ORDER`, one chip per trope.

## Validation (`validateIntermediateData`)

Fails on: an empty pool, a missing/duplicate/non-slug id, an empty label or
clause, a non-positive weight, an unknown age group, a season without
`ageGroup`, a library with no adult season, an unknown `compatibleCanon` id, a
trope with no group or a group `tropeGroups` doesn't name, no `setting-au`
group, a missing explicit level, or an `explicit` level that isn't `adultOnly`.
