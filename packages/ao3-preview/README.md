# @byler-cowrite/ao3-preview

The AO3 skin previewer, a workspace package of Byler Cowrite. A real AO3 work page (`public/ao3/html/work.html`, the live site's body scraped whole, comments included) renders full-width in an iframe under AO3's own site stylesheet, beside a CodeMirror 6 CSS editor. Everything is under `public/`:

- `ao3-preview.html` — the page (served at `/ao3-preview` by the app; it links nothing of the app's).
- `ao3/preview.js` — `mountPreview(doc, {storage, loadCss, loadHtml, loadSite})`; the frame, the drawer, the lint list, Work skin / Site skin, save/reset/download, the inspector wiring.
- `ao3/ao3-rules.js` — the lint mirroring otwarchive's `lib/css_cleaner.rb` (`lintCss(source, {kind})` → `{rules, problems, cleaned}`; `ao3-rules.json` is the same whitelist as data; `README.md` there is the prohibition list).
- `ao3/editor.js` — the CodeMirror adapter (`createEditor`), AO3-whitelist completions (`css-values.js` for values), the colour picker (`color-picker.js`).
- `ao3/inspect.js` — the element inspector (`selectorFor`, `mountInspector`, `pathOf`).
- `ao3/work-content.js` — the Work Content tab: the edit-form fields, the boilerplate values (the shipped work), the `{{TOKEN}}` renderer for `html/work.html` (a template), the form builders.
- `ao3/html/*.html` — the pages the Page dropdown offers: `work.html` (a hand-curated chapter with its comments) and the site pages `scripts/scrape-pages.mjs` scrapes (`node scripts/scrape-pages.mjs [id…]` re-scrapes; the list is `SCRAPED_PAGES` there and `PAGES` in preview.js).
- `ao3/side-drawer.js` — a copy of the app's drawer component.
- `vendor/codemirror.js` — the committed esbuild bundle of `scripts/codemirror-entry.js`; rebuild with `npm run build-codemirror` (here or from the repo root).

```bash
npm test                 # this package's suites (jsdom); the root `npm test` runs them too
npm run build-codemirror # after changing scripts/codemirror-entry.js or bumping @codemirror/*
```

The app's integration test for the route stays in the root `test/pages.test.mjs`.
