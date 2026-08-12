# Byler Cowrite

A real-time, round-robin writing game for Byler (Will Byers × Mike Wheeler)
fanfiction. Start a game, share a 4-letter code, vote on a scenario, then take
turns adding one line each under a ticking clock.

*If we're both going crazy, we might as well write it down.*

## Features

- **Round-robin writing** — one line per turn under a per-turn countdown. The
  server owns the clock: when time runs out, whatever the writer had typed is
  committed and play advances.
- **Scenario votes** — curated Byler prompts (`prompts.json`) plus anyone's
  custom scenarios, decided by group vote.
- **Rich text** — bold/italic/underline, headings, alignment, and horizontal
  rules, with live typing visible to the whole room.
- **Accounts (optional)** — email + username + password, password reset by
  email, colors, word-count badges (✏️ Inkling → 🏆 Living Legend), and a
  private archive of your games. Playing and hosting both require an account.
- **Permanent game codes** — every game snapshots to disk continuously; any
  code can be rejoined or continued later, from any device (signed-in seat
  reclaim). Started/continued games gate new entries behind host approval,
  with a 5-minute cooldown after a denial.
- **Solo writes** — `/writes` and `/write`: a full document editor outside the
  game. Autosaving drafts, headings/lists/quotes/links/images, a font-size
  ladder, a `/` palette of action verbs and dialogue tags, per-browser line
  spacing, and a **Rich text / HTML** switch — the HTML view is pretty-printed
  one block per line, and those cosmetic newlines are stripped again on the way
  back so they never become stray breaks.
- **Beta readers** — share a draft with friends; they read and comment
  (paragraph-anchored, resolvable) but never edit. Live presence shows who's
  looking.
- **Dashboard** — signed in, see who's online and join games in progress.
- **Docked chat, sounds, three themes, GSAP-animated everything.**
- **Export** — copy the finished story as formatted rich text or download a
  clean styled HTML file.

## Run locally

```bash
npm install
npm start        # http://localhost:3000 (PORT env var overrides)
npm test         # full unit test suite (node --test)
```

## Where data lives

The working store is plain JSON files. Two directories hold everything:

| Path | Contents | Written by |
|---|---|---|
| `data/users.json` | accounts, sessions, reset tokens | `saveStore()` in `server.js` |
| `saves/<CODE>.json` | one snapshot per game (story, chat, seats, rules) | `saveSnapshot()` in `server.js` |
| `data/docs/<id>.json` | one solo-write document (html, beta readers, comments) | `writeDoc()` in `src/docs.js` |

These paths can be relocated with the `COWRITE_DATA_DIR`, `COWRITE_SAVE_DIR`
and `COWRITE_DOC_DIR` environment variables (the test suite uses this to stay
isolated).

**Deploy durability**: when `DATABASE_URL` is set, `src/persist.js` mirrors
every file write into a Postgres blob table and restores the files at boot —
see “Deploying on Replit” below. Without it (local dev, tests) the mirror is
a no-op.

To send real password-reset emails, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS`, `SMTP_FROM`. Without them, reset links are logged to the server
console.

## Deploying on Replit

The app must run as a **Reserved VM deployment** — Autoscale spins up multiple
stateless copies, which breaks Socket.IO rooms and the in-memory session map.
One small VM easily handles ~50 concurrent writers.

Reserved VM filesystems are **ephemeral across redeploys**: every deploy
resets the disk to the build snapshot, which would wipe `data/` and `saves/`.
The fix is already built in — `src/persist.js` mirrors both into Replit's
PostgreSQL and restores them at boot. You only have to attach the database.

### Steps

1. Push this repository to GitHub, then in Replit choose
   **Create Repl → Import from GitHub** (or push directly into an existing
   Repl). `npm install` pulls everything, including the `pg` driver.
2. In the workspace, open **Tools → Database → PostgreSQL** and add it.
   Replit provisions the database and sets `DATABASE_URL` automatically —
   there is no other configuration.
3. **Deploy → Reserved VM**, run command `npm start`. Make sure the
   deployment inherits `DATABASE_URL` (Replit includes it by default; check
   the deployment's Secrets pane if in doubt). Add the `SMTP_*` secrets too
   if you want real password-reset emails.
4. Deploy, then check the deployment logs for:
   ```
   persistence: Postgres mirror active (N blobs restored)
   ```
   If that line is missing, `DATABASE_URL` isn't reaching the process and
   your data will NOT survive the next deploy. If the database is unreachable
   at boot the server exits on purpose instead of running without durability.
5. Verify end-to-end once: sign up a test account, play a line or two,
   **redeploy**, and confirm the account and game are still there.

### How the mirror works

- The JSON files stay the working store — all reads are local and synchronous.
- On boot (before anything reads them), every blob in the `cowrite_blobs`
  table is written back to `data/users.json` and `saves/*.json`. Any local
  file the table doesn't know yet is uploaded, so a first deploy with
  existing data seeds the database instead of losing it.
- On every save, `saveStore()` / `saveSnapshot()` upsert the same bytes into
  the table (write-through, ordered per key); deleting a game removes its row.
- Without `DATABASE_URL` (local dev, `npm test`) the mirror is a perfect
  no-op.

### Cost

With a Replit Core subscription, the smallest Reserved VM (~$7/mo of usage)
is covered by the plan's included monthly credits, and the built-in PostgreSQL
at this scale (a few MB, a write per committed line) is pennies per month.

## Editing the prompt bank

Edit `prompts.json` — one scenario string per array entry. No code changes.
The `/` palette in solo writes reads `writers-reference/` the same way.

## Development notes

- The backend is `server.js` + `src/` (Express static + Socket.IO); the
  frontend is the multi-page app in `public/`. Live game state is in-memory;
  snapshots make it durable. See `CLAUDE.md` for the full architecture guide.
- Server-side `sanitizeRich()` is the trust boundary for all rich text —
  never render user HTML that hasn't passed through it.
