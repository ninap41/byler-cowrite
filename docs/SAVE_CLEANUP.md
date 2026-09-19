# Solo editor: save cleanup plan

Status: **plan only — nothing here is implemented yet.**

## Why

The solo editor autosaves to the server, with two-tab protection. But autosave fires only on a 30s `setInterval`, and only after 3s idle (`AUTOSAVE_MS`/`AUTOSAVE_IDLE_MS` in `client/pages/write.ts`). Up to ~30s of work is unsaved at any moment, and that window is the only reason the Save button, the three-way leave modal and the tick-written local draft exist. Close the window and most of it goes.

## What stays (and why)

- `save({quiet})` + `dirty`/`setDirty`/`lastEditAt` — autosave, the Saved/Unsaved chip and comment sync (`doc-html` pushes ignored while dirty, `mergeArrivedAnchors`) all stand on them.
- Two-tab protection, untouched: `baseRev` on quiet saves only (`doc.rev` moves only on a save — comments never conflict), the 409 in `src/routes.js`, the `conflicted` gate, `conflictBar` (Reload / Save & overwrite — which needs the base-less `save()`), the `doc-updated` early return for a dirty tab.
- Ctrl/⌘+S — the "save NOW" the app itself asks for ("Save first, then comment in the new chapter").
- The local draft + `restoreBar` (`client/doc-store.ts`) — as the OFFLINE/FAILURE fallback only.
- The 413 refusal, and `#docErr` for failures.

## What changes

1. **Debounced autosave.** Replace the 30s interval: `onEdit`/`setDirty(true)` arms a ~2s idle timer → `save({quiet: true})`; a 30s ceiling saves through continuous typing. Same guards (`dirty`, `doc.mine`, `!conflicted`, `saving`). A save that finishes while newer edits exist (`lastEditAt !== editedSince`) re-arms the timer.
2. **Save button removed.** `#saveBtn` (`public/write.html`, `.doc-save` in base.css) goes; `#saveState` becomes a button — clicking "Unsaved" calls `save()`; add a transient "Saving…" state. Keep its `min-width` so the row never shifts. `#saveState` is time-shared with `setStatus` and the sprint line — keep those restoring via `setDirty(dirty)`.
3. **Leave = flush, no modal.** Remove `#leaveModal` and the link interceptor's three choices: on an in-app link while dirty, `await save({quiet: true})` then navigate (on failure: write the draft, show `#docErr`, stay). On `pagehide`/`beforeunload` while dirty: `saveDraft(...)` plus a `fetch(..., {keepalive: true})` PUT (the sprint logger's pattern) — and only `preventDefault()` when the body exceeds keepalive's 64 KB limit or a save has just failed.
4. **Draft written where it helps.** Drop the tick's `else saveDraft(...)` branch; write the draft (a) when a save FAILS — today it isn't, so an idle author with a 401/413/offline has no fallback until unload — and (b) on unload. Still cleared on every successful save.
5. **Failure retry.** After a non-409 failure, retry with backoff (5s → 60s cap) while dirty instead of waiting for the next tick; 413/401/403 don't retry (they need the author) and keep their message.
6. **Send only what changed.** Today every save PUTs EVERY chapter, so three limits disagree: `DOC_MAX` (200,000 chars a chapter) × `MAX_CHAPTERS` (200) allows ~40 MB, but the request body limit in `server.js` is 2 MB — the real ceiling on a whole story is ~2 million characters (~300,000 words, or ten full-size chapters). Over it, the server now answers a worded 413 ("too large to save in one piece") instead of express's html error page — that stopgap is DONE; this step removes the ceiling. The client keeps the last saved shape per chapter (`id`, `title`, `html`) and sends `{order: [ids], changed: [{id, title, html}], baseRev}`; the server reads the stored chapter list (invariant 9: a save reads the whole list), swaps in the changed ones, reorders/drops by `order`, and sanitizes and `DOC_MAX`-checks only `changed`. A new chapter is a `changed` entry with `id: null`, answered with its minted id as now. The full-list shape stays accepted (the legacy single-`html` one too), and the conflict rule is unchanged — `rev` still moves once per PUT. A save with nothing changed and the same order is skipped client-side, which also answers the "more PUTs per session" risk below. Pin: a 15-chapter story of full-size chapters saves one edited chapter; an unknown id in `order` is a 400; a changed chapter over `DOC_MAX` is still a 413 and nothing is stored.
7. **Housekeeping.** Fix `doc-store.ts`'s header comment (no "debounce while typing" writer exists); note that the draft key is one global slot, not per document — acceptable, but say so.

## Order of work

1 → 4 → 5 (pure behaviour, the button still present as a safety net) → 2 → 3 → 6 (before or with 1 if a story nears 2 MB — the debounce multiplies full-story PUTs) → 7. Each step is shippable alone.

## Tests

- `test/pages.test.mjs`: drop the `leaveModal` pin, update the head-row order if `#saveState` changes tag, pin "no `#saveBtn`".
- `test/docs.test.mjs`'s 409 and idempotent-autosave tests stay as they are (the server is untouched).
- `test/client-doc-store.test.mjs` unchanged.
- New: extract the timer rule as a pure helper (e.g. `components/autosave.ts`: `nextSaveDelay({lastEditAt, lastSaveAt, now, failures})`) and unit-test idle / ceiling / backoff; a jsdom test that a failed save writes the draft.
- Update CLAUDE.md's solo-editor paragraphs (head row, the "30s draft") in the same commit as each step.

## Risks

- More PUTs per session (one per pause), each sending EVERY chapter until step 6 lands — fine at ~100 users; step 6 skips the save when nothing changed.
- keepalive's 64 KB cap: long works fall back to the draft + the native prompt.
- Every quiet save bumps `rev`, so a second dirty tab hits the conflict bar sooner — intended.
