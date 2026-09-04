# AO3 work-skin previewer

`/ao3-preview` is a standalone page: a real AO3 work page rendered full-width inside an **iframe** (AO3's site stylesheet as the base, the scraped page as the body, the work skin on top — its own document, so nothing leaks into the drawer and AO3's `body`/`#header`/`#main` rules apply the way they do on the site), a large CSS drawer beside it, and a lint that says what AO3's cleaner will strip. It needs no login and links **none** of the app's chrome (no `base.css`, no `chrome.js`, no theme). Everything it needs is in this directory.

## Files

| file | what |
| --- | --- |
| `../ao3-preview.html` | the page (top-level of `public/` so the `PAGES` route loop in `server.js` finds it) |
| `preview.css` | all of the page's styling, including a copy of the app's `.doc-side*` drawer rules |
| `preview.js` | wiring: mounts `/js/components/side-drawer.js`, applies the CSS live, runs the lint, paints the highlight layer, theme, save, download |
| `editor.js` | the code editor: CodeMirror 6 from the vendored bundle (`/vendor/codemirror.js`, built by `npm run build-codemirror` from `scripts/codemirror-entry.js`) — CSS mode, oneDark / a light palette, the AO3 lint shown as diagnostics with a gutter; returns a small adapter (`value`, `setProblems`, `setDark`, `gotoLine`) so preview.js never touches CodeMirror's API |
| `ao3-rules.js` | pure lint (`lintCss`, `propertyStatus`, `valueStatus`) mirroring otwarchive's `lib/css_cleaner.rb` |
| `ao3-rules.json` | the same whitelist as data; `test/ao3-rules.test.mjs` fails if it drifts from the module |
| `default-skin-webscraped.css` | AO3's own site stylesheet (the base look of the page, scraped from the live site) |
| `html/work.html` | a real AO3 work page, body only (header · work · footer), scraped from the live site — replace to change the default |
| `default-skin.css` | the default work skin — replace to change the default |

The drawer: `−` minimises to an edge tab, `⤢` expands to ~70vw, the grip on its inner edge resizes (drag, double-click resets, arrow keys). The previewer's own chrome (bar, drawer, editor — never the AO3 page) has a **dark theme by default** and a light one (☾/☀ in the bar, remembered as `cowriteAo3Theme`). The editor is **[CodeMirror 6](https://codemirror.net/)** (`editor.js`): CSS syntax highlighting in both themes (oneDark, and a light palette defined in `editor.js`), line numbers, folding, bracket matching, search (⌘/Ctrl+F), undo history, and the AO3 lint's findings as diagnostics — a squiggle on the line, a marker in the gutter, the message on hover. Clicking a row in the lint list selects that line. ⬇ downloads the editor's CSS as `work-skin.css`. Typing paints the skin at once but saves nothing; **Save CSS** (or ⌘/Ctrl+S in the editor) keeps the CSS in this browser's localStorage (`cowriteAo3Css`) and it comes back on the next visit, and **Reset CSS** returns to the shipped default and forgets the save. Open state, width, expanded state and the strict toggle persist the same way (`cowriteAo3*` keys). "Preview as AO3 would" shows the work with the failing declarations removed; untick it to render the CSS raw.

## What AO3 allows and prohibits

Transcribed from otwarchive `config/config.yml` (`SUPPORTED_CSS_PROPERTIES`, `SUPPORTED_CSS_SHORTHAND_PROPERTIES`, `SUPPORTED_CSS_KEYWORDS`, `SUPPORTED_EXTERNAL_URLS`) and `lib/css_cleaner.rb`.

**Properties.** A property passes if it is on the exact list (~180 entries, in `ao3-rules.json`), or **contains** one of the 20 shorthand words (`background border column cue flex font layer-background layout-grid list-style margin marker outline overflow padding page-break pause scrollbar text transform transition` — substring match, so `column-gap` passes and bare `gap` fails), or is a `-moz-`/`-ms-`/`-o-`/`-webkit-` prefix on an exact property. Custom properties (`--name`) are accepted by the cleaner but are reported flaky in work skins. Everything else is dropped (`banned_property`): `gap`, `grid-template-rows`, `grid-area` (but `grid-template-columns` sneaks through on the `column` substring), `animation`, `object-fit`, `pointer-events`, `mix-blend-mode`, `backdrop-filter`, `inset`, `place-items`…

**Values.**
- Numbers: `-?\.?\d{1,3}\.?\d{0,3}` — the dot is optional, so up to six digits pass (`1000px` is fine) but longer numbers and more than three decimals fail.
- Units: `deg cm em ex in mm pc pt px s %` only. No `rem`, `vh`, `vw`, `fr`, `ms`, `ch`.
- Colours: `#rgb`–`#rrggbb`, named colours, `rgb() rgba() hsl() hsla()`.
- Functions: transforms (`scale translate skew rotate matrix` and their x/y forms), filters (`blur brightness contrast grayscale hue-rotate invert opacity saturate sepia drop-shadow`), gradients, `var()`. **Not** `calc() clamp() min() max() color-mix() attr() env() counter()`.
- `url()` only on `background background-image border border-image list-style list-style-image` (and `content`); must be a full `http(s)://` address with a real TLD, ending `.jpg .jpeg .png .gif`, no query string. No `data:`, no `.webp`, no `.svg`.
- `content`: quoted strings, `url()`, `none` — nothing unquoted, no `var()`.
- `font-family`: names made of letters, digits, dashes and spaces, optionally quoted.
- `!important` is always kept.

**At-rules.** `@font-face` is refused outright (the skin fails to save, error `font_face`). `@import`, `@media`, `@keyframes`, `@supports` and the rest are not parsed as rules and vanish silently.

**Selectors.** On save AO3 prefixes every selector with `#workskin `. The lint notes a bare class or id (`.note`, `#foo`) so the preview matches what AO3 will store; element-only selectors (`body`, `p`, `a:hover`, `p > em`) get no note, since they mean the same thing prefixed. A rule whose declarations all fail is dropped (`no_rules_for_selectors`). Comments are fine.

**AO3's error ids** (shown on the skin form): `no_valid_css`, `banned_property`, `invalid_custom_property_name`, `banned_value_for_property`, `no_rules_for_selectors`, `no_valid_css_for_selectors`, `font_face`. The lint reports the same ids.

Sources: <https://github.com/otwcode/otwarchive> (`config/config.yml`, `lib/css_cleaner.rb`); secondary: <https://www.wordfokus.com/ao3-allowed-css-properties/>, AO3's [work skin tutorial](https://archiveofourown.org/faq/tutorial-creating-a-work-skin) and [skins FAQ](https://archiveofourown.org/faq/skins-and-archive-interface).
