# AO3 work-skin previewer

`/ao3-preview` is a standalone page: a real AO3 work page rendered full-width inside an **iframe** (AO3's site stylesheet as the base, the scraped page as the body, the work skin on top — its own document, so nothing leaks into the drawer and AO3's `body`/`#header`/`#main` rules apply the way they do on the site), a large CSS drawer beside it, and a lint that says what AO3's cleaner will strip. It needs no login and links **none** of the app's chrome (no `base.css`, no `chrome.js`, no theme). Everything it needs is in this directory.

## Files

| file | what |
| --- | --- |
| `../ao3-preview.html` | the page (top-level of `public/` so the `PAGES` route loop in `server.js` finds it) |
| `preview.css` | all of the page's styling, including a copy of the app's `.doc-side*` drawer rules |
| `preview.js` | wiring: mounts `/js/components/side-drawer.js`, applies the CSS live, runs the lint |
| `ao3-rules.js` | pure lint (`lintCss`, `propertyStatus`, `valueStatus`) mirroring otwarchive's `lib/css_cleaner.rb` |
| `ao3-rules.json` | the same whitelist as data; `test/ao3-rules.test.mjs` fails if it drifts from the module |
| `default-skin-webscraped.css` | AO3's own site stylesheet (the base look of the page, scraped from the live site) |
| `default-work.html` | a real AO3 work page, body only (header · work · footer), scraped from the live site — replace to change the default |
| `default-skin.css` | the default work skin — replace to change the default |

The drawer: `−` minimises to an edge tab, `⤢` expands to ~70vw, the grip on its inner edge resizes (drag, double-click resets, arrow keys). Open state, width, expanded state, the CSS draft and the strict toggle all persist per browser (`cowriteAo3*` keys in localStorage). "Preview as AO3 would" shows the work with the failing declarations removed; untick it to render the CSS raw.

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

**Selectors.** On save AO3 prefixes every selector with `#workskin `. A rule whose declarations all fail is dropped (`no_rules_for_selectors`). Comments are fine.

**AO3's error ids** (shown on the skin form): `no_valid_css`, `banned_property`, `invalid_custom_property_name`, `banned_value_for_property`, `no_rules_for_selectors`, `no_valid_css_for_selectors`, `font_face`. The lint reports the same ids.

Sources: <https://github.com/otwcode/otwarchive> (`config/config.yml`, `lib/css_cleaner.rb`); secondary: <https://www.wordfokus.com/ao3-allowed-css-properties/>, AO3's [work skin tutorial](https://archiveofourown.org/faq/tutorial-creating-a-work-skin) and [skins FAQ](https://archiveofourown.org/faq/skins-and-archive-interface).
