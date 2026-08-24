# The content pack

This directory IS the fandom. Everything hand-editable that says *which* fandom
the game is about lives here, and the server reads it via `src/content.js`:

| file | holds |
|---|---|
| `prompts.json` | `prompts` — the curated scenario pool (one string each); `intermediate` — the guided-mode component pools (universes, periods, locations, relationship contexts, tensions, catalysts, tones, templates). See `docs/PROMPT_GENERATION.md`. |
| `achievements.json` | `wordTiers` — the rank ladder; `usageOpen` — word badges with visible descriptions; `usage` — the SECRET word badges (triggers and descriptions hidden until earned); `themeUnlocks` — which rank earns which theme (and, through it, which gimmick). See `UNLOCKS.md`. |
| `quotes.json` | Taglines for the homepage hero and dashboard (one string each, re-read on every request). |

## Swapping packs

Point `COWRITE_CONTENT_DIR` at another directory holding the same three files:

```bash
COWRITE_CONTENT_DIR=/path/to/other-fandom npm start
```

`npm test` validates a pack's shape (`test/prompt-gen.test.mjs`, `test/themes.test.mjs`,
`test/unlocks-doc.test.mjs`), so run it against a new pack before shipping it.

## What is still fandom-bound in code

A pack changes the data, not the skin. A full "other fandom" build also needs:

- theme ids/labels in `public/js/theme.js` and their CSS blocks + decorations in `public/css/base.css` (and `public/img/themes/*.jpg` screenshots)
- gimmick names/descriptions in `lib/gimmicks.js` and the fandom-art components under `public/js/components/`
- the spectator name pool in `public/js/spectator-names.js`
- page `<title>`s and hero copy in `public/*.html`, `public/js/chrome.js`, `public/js/logo.js`
- the fallback quote in `src/routes.js` (`readQuotes`)
