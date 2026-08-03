# Refactor plan: accounts-only, multi-page, modular

Goal: turn the two-monolith app (`server.js` + `public/index.html`) into a
multi-page, component-based app — **still no build step, no framework, no
database**. Native ES modules (`<script type="module">`), plain HTML pages,
Replit Run button untouched.

Status: **Phase 0 (guest removal, server-side) is done** — all socket entry
points require an account, deny-cooldown keys on account id, `guest` flags are
gone from roster/story/chat payloads, and the test suite covers it.

## Target page map

| Page | File | Needs socket? | Auth |
|---|---|---|---|
| Homepage (hero animation + login/signup) | `public/index.html` | no | public; redirects to dashboard when signed in |
| Dashboard (online users, live games, start/join) | `public/dashboard.html` | identify-only | required |
| Game (lobby-join → waiting → choosing → writing → over) | `public/game.html` | yes — one persistent socket | required |
| Previous games (archive list + detail) | `public/archive.html` | no | required |
| Profile (badges, word count, game history) | `public/profile.html` | no | required |
| Settings (username, color, email, password) | `public/settings.html` | no | required |

The live game deliberately stays ONE page: a Socket.IO session must never
cross a page navigation. Phase cards inside `game.html` become components.

## Testing strategy (every step ships with tests)

- **Server**: existing harness (`test/helpers.mjs`, node:test + socket.io-client).
  Extend it; keep tests hermetic (temp `COWRITE_DATA_DIR`/`COWRITE_SAVE_DIR`).
- **Client pure logic** (no DOM): plain `node --test` imports of the new ES
  modules — this is the big win of modularizing: `esc()`, countdown math,
  vote-tally rendering data, export formatting, rejoin-storage logic all become
  importable and unit-testable.
- **Client DOM components**: add **jsdom as a devDependency** (test-only — the
  app itself stays build-free). A tiny `test/dom.mjs` helper creates a jsdom
  window, imports a component module, mounts it into a container, and asserts
  on rendered DOM + emitted callbacks. Socket.IO is faked with a stub
  `{ on, emit, handlers }` object so component tests never need a server.
- **Rule for every phase below**: extract → its tests land in the same commit →
  `npm test` green → manual smoke of the game (two browser tabs) before the
  next phase.

## Phase 1 — client shared kernel (extract, no behavior change) — **DONE**

Create `public/js/` and move logic out of `index.html` verbatim:

- `js/util.js` — `esc()`, `PALETTE`, time formatting, tiny DOM helpers.
- `js/api.js` — fetch wrapper adding `Authorization: Bearer`, token storage
  (localStorage), `me()` cache, `logout()`.
- `js/auth-guard.js` — `requireAuth()` (redirect to homepage when signed out)
  and `redirectIfSignedIn()` for the homepage.
- `js/socket-client.js` — socket creation, `identify` on connect, rejoin
  payload storage (`cowriteRejoin` {code, token}), reconnect handling.
- `js/sounds.js` — the four sounds + the "was it my line/message" rules.
- `js/nav.js` — hamburger drawer (becomes real links to the new pages).

**Tests (same commit):**
- `test/client-util.test.mjs` — `esc()` escaping table, palette validation,
  countdown formatting edge cases (0, negative, >10min).
- `test/client-api.test.mjs` — token attach/clear, 401 → signed-out state
  (fetch stubbed; jsdom for localStorage).
- `test/client-socket.test.mjs` — rejoin blob save/load/clear rules, identify
  emitted on connect (stub socket).
- `test/client-sounds.test.mjs` — the chime decision rules: own echo silent,
  system messages silent, `seenStoryLen` null on rejoin → no chime, final line
  chime via `prevCurrentId`.

CSS moves to `public/css/base.css` (theme vars, buttons, cards) — no test, but
smoke every page.

## Phase 2 — game-page components (the monolith becomes `game.html`)

> Progress: **done** — `status.js` (presence dots), `components/editor.js`
> (cleanHtml), `components/story-feed.js` (story + live preview markup),
> `components/chat-view.js` (message markup), `components/countdown.js`
> (countdownView), `export.js` (buildExports/exportDocument), each with tests
> (jsdom via `test/dom.mjs`). Also fixed a latent pre-refactor bug: the
> `#playersRow` markup had been lost in an old layout revamp, crashing
> renderWriting on every writing broadcast (timer never rendered). **Remaining
> in this phase:** roster / vote-panel / session-bar / host-controls extraction
> and the game-page orchestrator split (folds into Phase 3's `game.html`).

`index.html`'s game UI splits into component modules, each exporting
`mount(el, deps)` and returning an update function — plain functions + DOM,
no framework:

- `js/components/session-bar.js` — name, ✎ rename (host), click-to-copy code, 👑.
- `js/components/roster.js` — writer list, colors, badges, online dots, host crown.
- `js/components/vote-panel.js` — options, tally bars, custom prompt, shuffle/finalize (host).
- `js/components/editor.js` — contenteditable + toolbar + `cleanHtml()` + typing debounce.
- `js/components/story-feed.js` — story lines, live-typing preview, `turnKey` logic.
- `js/components/countdown.js` — deadline/paused rendering from server state.
- `js/components/chat-dock.js` — collapsible dock, unread badge, history replay.
- `js/components/host-controls.js` — start/pause/resume/rules/continue, join-request popups.
- `js/game-page.js` — orchestrator: owns the socket, `game-state` fan-out to
  components, `onlyShow()` phase switching.

**Tests (per component, jsdom + stub socket; each lands with its component):**
- `editor.test.mjs` — **most important**: `cleanHtml()` normalization table
  (DIV→p, text-align→`al-c`/`al-r`, junk attrs dropped, nested blocks
  flattened) and that typing emits are debounced. Mirrors the server sanitizer
  tests so both sides of the trust boundary are pinned.
- `story-feed.test.mjs` — renders server-sanitized html via innerHTML
  unchanged; `turnKey` change clears live preview; no clear on same-turn
  re-broadcast (the update-rules mid-turn case).
- `vote-panel.test.mjs` — tally rendering, voted/total counts, host-only
  buttons hidden for non-hosts.
- `countdown.test.mjs` — paused shows frozen `remaining`; deadline renders
  from server clock, not local assumptions.
- `chat-dock.test.mjs` — unread badge increments while collapsed, resets on
  open; system messages styled, names `esc()`'d.
- `roster.test.mjs` / `session-bar.test.mjs` — crown placement, offline dots,
  rename visible to host only.
- `host-controls.test.mjs` — join-request popup approve/deny callbacks.

Export (game-over copy/download) moves to `js/export.js`; test the produced
HTML/plain text (names stripped, formatting kept) in `export.test.mjs`.

## Phase 3 — page split — **DONE**, including the dashboard redesign to the
mockup layout (`css/dashboard.css`, `dashboard-view.js` builders) and its
server support: `/api/dashboard` now returns `myGames` (with `myTurn`),
`recentGames`, and `stats`; writing streaks live in `lib/streak.js`
(UTC-calendar-day based, bumped in `creditLine`, exposed via `publicUser`).

- `game.html` (phase 2 output), `index.html` shrinks to hero + auth forms
  (`js/components/auth-forms.js`, `js/hero.js`), `dashboard.html` +
  `js/dashboard-page.js` (poll `/api/dashboard`, Join buttons →
  `game.html?code=XXXX`), `archive.html` + `js/archive-page.js`.

### Dashboard layout (per the reference mockup)

Three-column card grid on a soft gradient background; header bar carries the
logo + tagline, username chip with current badge ("no badge yet" fallback),
theme toggle, Log out, and the hamburger nav.

- **Left/center column:**
  - **Welcome card** — avatar (color-tinted), online dot, "Welcome back!"
    line, stat row: words written · badges earned · current badge with a
    progress bar toward the next rank ("23% toward next rank" comes from
    `nextBadge`, already in `publicUser()`).
  - **Games in progress** — card per live/paused game the user holds a seat
    in: name, code, player color dots + count, status line (**"Your turn"**
    vs "Waiting for <name>") and time remaining, Resume/View button →
    `game.html?code=…`; plus a dashed **"Open slot / Start new game"** card.
    Cover thumbnails: decorative placeholder art by theme/color for now.
  - **Recent achievements strip** — earned badges + greyed "next up" slot
    (feeds straight from Phase 4.5), and a **writing-streak ring** (current
    streak, best streak).
  - **Previous games** — compact list (thumbnail, name, date, players, word
    count) with "See all previous games →" into `archive.html`.
- **Right column:**
  - **Online now** card (count + names, "(you)" marker) with an **Invite a
    friend** button (copies a join link).
  - **Quick start** card — since accounts-only, the mockup's free-text name
    field renders the account username (read-only) and the color picker
    saves to the account (`/api/account/color`); "Start a game" creates and
    navigates; below the divider, the 4-letter **Game code** input + "Join
    game".
  - Quote/flourish card (static).

**New server support this layout needs (added to `/api/dashboard`, tests
first in the archive/dashboard suite):**
- `myGames`: live + paused games where MY account holds a seat, each with
  `{ code, name, phase, paused, myTurn, currentName, players: [{name,color,
  connected}], deadline/remaining, savedAt }` — distinct from the existing
  global `liveGames` list.
- `recentGames`: last N finished snapshots for the compact list (reuses the
  `/api/games` summary shape, capped + sorted).
- `stats`: words, badge counts, `nextBadge` progress percent.
- **Streaks** (new): per-user `lastWroteDay`/`streak`/`bestStreak` updated in
  `creditLine()` (calendar-day based); unit-test day rollover, same-day
  no-increment, gap reset, best-streak retention.

**Tests:** dashboard-page jsdom render from a full fixture payload (my-turn
badge shows, open-slot card when no games, "(you)" marker, progress bar
percent), server tests for `myGames`/`recentGames` privacy (only MY seats),
`myTurn` correctness, and the streak unit tests above.
- Cross-page flow: entering/creating a game from anywhere navigates to
  `game.html?code=…`; `game-page.js` reads the code, rejoins or joins on load.
- Server: add explicit routes (`/dashboard` → dashboard.html etc.) so URLs are
  clean; keep old anchors redirecting.

**Tests:**
- `auth-forms.test.mjs` — validation messages surface, successful login stores
  token + redirects (jsdom, stubbed fetch).
- `archive-page.test.mjs` — story html injected as-is (already sanitized),
  names/prompts escaped, Continue routes to `game.html?code=…`.
- `dashboard-page.test.mjs` — render from a fixture payload; poll only while visible.
- Server route test in `archive.test.mjs`-style file: pages served, unknown
  code query on game page handled.
- **End-to-end guard** (extends `test/game.test.mjs` harness): full round
  still works over the real server — this already exists and is the safety
  net for the whole phase.

## Phase 4 — new pages: profile & settings — **DONE** (email/password endpoints TDD-first; profile at /profile, settings at /settings)

Server first, tests first:
- `GET /api/users/:username` (public profile: username, color, badges,
  wordCount, shared-game visibility rules) — or profile stays private
  (`/api/me` only) to start.
- `POST /api/account/email` (verify password), `POST /api/account/password`
  (verify old password, invalidate other sessions — reuse the reset logic).
- Tests in `test/auth.test.mjs`: wrong-password rejected, session invalidation,
  email uniqueness, username-change ripple into live roster + archive labels
  (the archive label test already exists — extend it).

Then the pages: `profile.html` (badge case, next-badge progress, game list
linking into archive) and `settings.html` (forms over the new endpoints),
each with a jsdom render test from fixture payloads.

## Phase 4.5 — achievements system — **DONE** (lib/achievements.js; the new ladder REPLACES the legacy one per the decision below; startup migration drops old ids)

Rework the badge system from a single word-count ladder into a config-driven
**achievements module** (`src/achievements.js` once Phase 5 lands; until then a
section of server.js) with two achievement types. Placeholder emojis for now —
art can replace them later without touching logic.

**Type 1 — word-count achievements** (total words written, new ladder):

| Words | Badge |
|---|---|
| 5,000 | 🐶 Puppy Mike |
| 10,000 | 🪄 Practice |
| 20,000 | 🧙 Sorcerer |
| 30,000 | ⚡ Innate Powers |
| 50,000 | 🧭 Explorer |
| 100,000 | 💛 A Best "Friend" |

Open decision: the current ladder (✏️ Inkling 1 → 🏆 Living Legend 10,000)
either gets replaced outright or kept as the sub-5,000 starter tiers beneath
the new ladder. Existing users' `badges`/`currentBadge` arrays need a one-time
migration either way (map old ids or drop them).

**Type 2 — word-usage achievements** (earned the first time a committed story
line contains a trigger word/phrase):

| Trigger (case-insensitive) | Badge |
|---|---|
| "puppy" / "puppy Mike" | 🐺 Omega Badge |
| "cock" | 🐓 Just the tip. |
| "moan" / "moaning" | 😏 Smutty Buddy |
| "Michael?" | 🙄 Ugh, Mike... |

**Design:**
- One `ACHIEVEMENTS` config (or `achievements.json`, like `prompts.json`) —
  entries are `{ id, emoji, name, type: "words"|"usage", min?|triggers? }`.
  Adding a new achievement = adding one entry, no code.
- Matching runs in `creditLine()` on the **stripped text of the sanitized
  committed line** (never raw HTML, never chat): case-insensitive,
  word-boundary matching so "cocktail" and "moans"-vs-"moan" behave as
  intended ("moaning" is its own listed trigger; stem matching is explicit
  per-entry via the triggers list, not automatic).
- Usage achievements award **once per user**, persist in the same
  `u.badges` list, announce in chat exactly like word-count tiers, and ride
  along on roster/chat as `badge` does today. `currentBadge` stays the
  highest *word-count* tier; usage badges are collectibles shown in the
  profile badge case.
- Profile page (Phase 4) renders both types in separate sections: the ladder
  with next-tier progress, and the usage collection (earned vs. silhouette).

**Tests (same commits):**
- Matcher unit tests: word boundaries (no "cocktail"/"peacock" award), case
  insensitivity, trigger inside rich formatting (`<b>moan</b>ing` → stripped
  text still matches), multi-word phrase "puppy Mike", punctuation-sensitive
  "Michael?" (the `?` is part of the trigger).
- Awarding tests via the existing socket harness: crossing 5,000 words awards
  🐶 and announces once; a line containing two triggers awards both; the same
  trigger twice awards once; usage badges never change `currentBadge`;
  badges survive save/restart rehydration and show on `/api/me` + profile.
- Migration test: a legacy user file with old badge ids loads without
  crashing and maps per the chosen migration rule.

## Phase 5 — server modularization (mechanical, tests already green)

`server.js` → `src/` ES modules, no behavior change, import-order preserved:
- `src/sanitize.js` (sanitizeRich, stripTags) — **add direct unit tests** (fast,
  no server boot; the socket-level tests stay as integration cover).
- `src/store.js` (users/sessions/resets JSON store, scrypt, badges) — direct
  unit tests for `awardBadges` tiers and `checkPassword`.
- `src/auth-routes.js`, `src/archive-routes.js`, `src/game.js` (session state
  machine), `src/persistence.js` (snapshot/load), `src/sockets.js`.
- `server.js` remains the ~30-line entry point wiring them (Replit unchanged).
Existing black-box suite is the regression net; it should not change at all in
this phase — that's the proof the refactor was behavior-preserving.

## Order & rules of engagement

1 → 2 → 3 → 4 → 5. Each phase is a series of small commits; every commit runs
`npm test` green. Never move and modify in the same commit. The sanitizer
trust boundary (`sanitizeRich` server-side, innerHTML only for server-clean
html) must survive every step — the paired sanitizer tests (server table +
client `cleanHtml` table) are the tripwire.
