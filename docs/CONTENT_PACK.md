# The content pack — how to re-fandom the app

The `content/` directory (repo root) IS the fandom. Everything hand-editable
that says *which* fandom the game is about lives there, and the server reads it
via `src/content.js` (`contentPath()`) and `src/site.js`. Nothing in `public/`
or `src/` needs to be touched to run the app for another fandom — only that
directory.

## The four files

| file | holds |
|---|---|
| `site.json` | The app's identity: `fandom` (the hero's first word — "Byler"), `name` (the full app name in every page title, the header, exports, emails, the welcome inbox note — "Byler Cowrite"), `tagline` (under the homepage heading), `blurb` (the first line of the features modal). Each is a plain string, ≤200 chars. Missing keys fall back to a generic "Cowrite". |
| `titles.json` | `patterns` of `{slot}` templates plus a word list per slot — the random ≤40-char title a story gets when the host doesn't name it. Optional: without it every unnamed story is "Untitled". |
| `prompts.json` | `prompts` — the curated scenario pool (one string each, dealt untouched in Simple mode); `intermediate` — the guided-mode axes (seasons, canon, places, situations, relationships, tones), the grouped `tropes` bank (`tropeGroups` names the groups) and the `explicit` layer (levels, setups, dynamics, acts, weighted kinks, registers — adult seasons only). See `docs/PROMPT_GENERATION.md` for the schema and compatibility rules. |
| `achievements.json` | `wordTiers` — the rank ladder (id, name, min words, emoji); `usageOpen` — word badges whose descriptions are always visible; `usage` — the SECRET word badges (trigger words and descriptions hidden until earned); `themeUnlocks` — which rank earns which theme (and, through the theme, which gimmick). See `docs/UNLOCKS.md`. |
| `quotes.json` | Taglines for the homepage hero and the dashboard (an array of strings, re-read on every request, so edits show without a restart). |

## Step by step: making a pack for another fandom

1. **Copy this directory** somewhere outside the repo (or to a sibling folder):
   ```bash
   cp -r content /path/to/drarry-pack
   ```
2. **Edit `site.json`** — set `fandom`, `name`, `tagline`, `blurb`. This alone
   renames the app everywhere the name appears.
3. **Rewrite `quotes.json`** — any number of strings.
4. **Rewrite `prompts.json`** (or do it in the app: the "Prompt library" section of `/admin`
   edits every pool and validates before saving — it writes this same file):
   - `prompts`: replace the curated scenarios (any count, one string each).
   - `intermediate`: keep the SHAPE (same top-level keys, same fields per
     entry) and replace the content. The rules that matter: ids are unique
     lowercase slugs; every `seasons` entry needs an `ageGroup` (`minor` |
     `adult`) and at least one must be adult, or the explicit layer can never
     be dealt; every `compatibleCanon` id must exist in `canon`; every trope's
     `group` must be named in `tropeGroups`, and at least one group must be
     `setting-au` (an AU draws its world from it); `explicit.levels` must carry
     `none`/`explicit` with `explicit` marked `adultOnly` (`suggestive` is
     deprecated and ignored). A season that may carry the explicit layer is the
     adult one or one tagged `explicit-ok`; seasons that must never carry it
     get `incompatibleTags: ["explicit"]`. Anything that must not reach minors
     gets `compatibleAgeGroups: ["adult"]`; `adultOnly` marks explicit-only
     content and reaches any season that admits explicit. Or
     delete the `intermediate` key entirely and the game runs Simple mode only.
5. **Rewrite `achievements.json`**:
   - `wordTiers`: rename the ranks (keep `id`s stable if accounts already exist —
     a user's `currentBadge` stores the id).
   - `usage` / `usageOpen`: new trigger words and names.
   - `themeUnlocks`: keys must be theme ids from `THEMES` in
     `public/js/theme.js`, values must be `wordTiers` ids. Delete a key to make
     that theme free.
6. **Validate it** — the suite checks a pack's shape:
   ```bash
   COWRITE_CONTENT_DIR=/path/to/drarry-pack npm test
   ```
   `test/prompt-gen.test.mjs` validates the prompt library, `test/themes.test.mjs`
   the theme unlocks, `test/pages.test.mjs` the rendered site name. (A few tests
   assert the DEFAULT pack's literal strings — "Byler Cowrite", the Byler
   quotes — and will fail on another pack; that is expected and is the only
   noise.)
7. **Run it**:
   ```bash
   COWRITE_CONTENT_DIR=/path/to/drarry-pack npm start
   ```
   On Replit, set `COWRITE_CONTENT_DIR` in Secrets, or simply replace the files
   in `content/` in that deployment's copy of the repo.

## How the wiring works (for the curious)

- `src/content.js` resolves the directory: `COWRITE_CONTENT_DIR` or `<repo>/content`.
- `src/site.js` loads `site.json` once at boot. `server.js` serves every page
  through `renderPage()`, which fills `{{SITE_NAME}}`, `{{FANDOM}}`, `{{TAGLINE}}`
  and `{{BLURB}}` in the HTML and injects `<meta name="site-name">`; client
  modules read that meta via `siteName()` in `public/js/util.js`. Server-side
  strings (emails, the welcome note, the boot log) use `SITE.name`.
- `prompts.json` and `achievements.json` are read once at startup (restart
  after editing); `quotes.json` is re-read per request.

## What is still fandom-bound in code

A pack changes the data and the name, not the skin. A full re-theme also needs:

- theme ids/labels in `public/js/theme.js`, their CSS blocks and decorations in
  `public/css/base.css`, and the screenshots in `public/img/themes/*.jpg`
- gimmick names/descriptions in `lib/gimmicks.js` and their fandom-art
  components under `public/js/components/`
- the spectator name pool in `public/js/spectator-names.js`
- the features-modal bullet list in `public/index.html` (it names themes,
  badges and gimmicks)
- the fallback quote in `src/routes.js` (`readQuotes`) — only shown if
  `quotes.json` is missing or empty
