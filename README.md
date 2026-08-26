# Byler Cowrite

A real-time, round-robin writing game for Byler (Will Byers × Mike Wheeler)
fanfiction. Start a game, share a 4-letter code, vote on a scenario, then take
turns adding one line each under a ticking clock.

*If we're both going crazy, we might as well write it down.*

## Features

- **Round-robin writing** — one line per turn under a per-turn countdown. The
  server owns the clock: when time runs out, whatever the writer had typed is
  committed and play advances.
- **Scenario votes** — curated Byler prompts (`content/prompts.json`) plus anyone's
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
  spacing, real undo/redo, and a **Rich text / HTML / Comment** switch — the HTML view is pretty-printed
  one block per line, and those cosmetic newlines are stripped again on the way
  back so they never become stray breaks.
- **Comment mode** — Google-Docs-style comments pinned to the exact words
  they're about: the commented text is underlined, clicking either the
  underline or the comment card jumps to the other, and resolved comments drop
  their underline. The author toggles comment mode on their own draft to leave
  notes to self.
- **Beta readers** — share a draft with friends. They read and comment, never
  edit: comment mode is the only mode they have, and a rewrite they type
  becomes a **suggestion** (`old → new`) that only the author can Accept or
  Reject. Live presence shows who's looking.
- **Dashboard** — signed in, see who's online and join games in progress.
- **Announcements** — `/announcements`, the admins' blog: anyone signed in
  reads it; only admins see the composer (the shared WYSIWYG — the first
  heading is the post's title) and Delete, and the server enforces the same
  rule on the API.
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

Everything the app keeps is a named JSON document, persisted by
`src/storage.js` — **files locally, Postgres in production**:

| Kind | Local file | Contents | Written by |
|---|---|---|---|
| `users/users` | `data/users.json` | accounts, sessions, reset tokens, waitlist | `saveStore()` in `src/store.js` |
| `announcements/announcements` | `data/announcements.json` | the admins' blog posts on `/announcements` | `/announcements` (admins) |
| `save/<CODE>` | `saves/<CODE>.json` | one snapshot per game (story, chat, seats, rules) | `saveSnapshot()` in `src/game.js` |
| `doc/<id>` | `data/docs/<id>.json` | one solo-write document (html, beta readers, comments) | `writeDoc()` in `src/docs.js` |
| `content/<name>` | `content/<name>.json` | the fandom pack (prompts, site, quotes, titles, achievements) | `/admin` prompt editor |
| `reference/<name>` | `writers-reference/<name>.json` | the `/` palette word banks + `index.json` | `/admin` reference editor |

Without `DATABASE_URL` the files are the store (paths relocatable with
`COWRITE_DATA_DIR`, `COWRITE_SAVE_DIR`, `COWRITE_DOC_DIR`,
`COWRITE_CONTENT_DIR`, `COWRITE_REF_DIR` — the test suite uses this to stay
isolated). With it, the database is the store — see “Deploying on Replit”.

To send real password-reset emails, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS`, `SMTP_FROM`. Without them, reset links are logged to the server
console (an admin can copy one to a user by hand).

The deployed site uses **Brevo** (free tier, 300 emails/day) as the SMTP
relay. In the Brevo dashboard verify a sender address and create an SMTP key
(Settings → SMTP & API → SMTP), then set:

```
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=<your Brevo login email>
SMTP_PASS=<the SMTP key — not your Brevo password>
SMTP_FROM=<the verified sender address>
```

On Replit these go in **Secrets**, for the workspace and the deployment both,
then redeploy. Test with “Forgot password” on a real account.

## Deploying on Replit

(Short version for the Repl itself: [`replit.md`](replit.md) — run command,
port, storage check, email.)

The app must run as a **Reserved VM deployment** — Autoscale spins up multiple
stateless copies, which breaks Socket.IO rooms and the in-memory session map.
One small VM easily handles ~50 concurrent writers.

Reserved VM filesystems are **ephemeral across redeploys**: every deploy
resets the disk to the build snapshot. So in production nothing is kept on
disk — with `DATABASE_URL` set, `src/storage.js` makes Replit's PostgreSQL the
store for every document above. You only have to attach the database.

### Steps

1. Push this repository to GitHub, then in Replit choose
   **Create Repl → Import from GitHub** (or push directly into an existing
   Repl). `npm install` pulls everything, including the `pg` driver.
2. In the workspace, open **Tools → Database → PostgreSQL** and add it.
   Replit provisions the database and sets `DATABASE_URL` automatically —
   there is no other configuration.
3. **Deploy → Reserved VM** (`.replit` already says `deploymentTarget = "vm"`),
   run command `npm start`. Make sure the deployment inherits `DATABASE_URL`
   (Replit includes it by default; check the deployment's Secrets pane if in
   doubt). Add the five `SMTP_*` secrets too (Brevo — see “Where data lives” above)
   if you want real password-reset emails.
4. Deploy, then check the deployment logs for:
   ```
   storage: postgres (users 1, saves N, docs N, content 5, reference 6, seeded N)
   ```
   If it says `storage: files` instead, `DATABASE_URL` isn't reaching the
   process and your data will NOT survive the next deploy. If the database is
   unreachable at boot the server exits on purpose instead of running without
   durability. `/api/admin/storage` (admins) reports the same line plus the
   last failed write, if any.
5. Verify end-to-end once: sign up a test account, play a line or two,
   **redeploy**, and confirm the account and game are still there.

### What survives a redeploy — and what the Reserved VM is for

A Reserved VM is **rebuilt on every publish**: its filesystem resets to the
build snapshot, so anything written locally (JSON files, uploads, temp data) is
gone. Reserved VM is about running ONE instance; it is not persistent disk.

What persists — everything in PostgreSQL, because `DATABASE_URL` is set:

- accounts, sessions and reset tokens (`users/users`)
- the admins' announcements (`announcements/announcements`)
- every game snapshot — paused, finished, or mid-write as of its last
  committed line (`save/<CODE>`)
- solo-write documents (`doc/<id>`)
- content-pack and writers'-reference edits made in `/admin`

What does NOT persist — the in-memory state that needs a single process:

- **live games**: `src/game.js` keeps active sessions in a `Map` — players,
  turn order, votes, the paused flag, the current writer's live typing
- **turn timers**: the countdown that commits a line at the deadline runs as a
  `setTimeout` inside the process
- **Socket.IO rooms**: live typing, chat, turn changes, presence and gimmicks
  fan out through rooms on this one server; there is no multi-instance adapter
- **presence**: connected sockets, who's online, who is viewing a document

So a redeploy interrupts games in progress: players are disconnected, and when
they come back the game rehydrates from its last snapshot (paused, at the last
committed line — an unsent line is lost) and the host resumes it. That is the
same recovery path as a server restart, and it is why the app snapshots on
every committed line rather than only at the end.

This is also why Autoscale is wrong for this app: with two instances, two
players in the same game could land on different servers and never see each
other. The Reserved VM keeps every player and every room on one instance.

### How the store works

- On boot every row of the `cowrite_blobs` table (`kind`, `name`, `doc`) is
  loaded into memory; reads are served from that cache and every write updates
  the cache and queues an upsert (ordered per row). Deleting a game or a doc
  removes its row. `data/`, `saves/` and `data/docs/` are never written.
- **First boot seeds, then the database wins.** Any key the table doesn't hold
  yet is taken from disk once: a migrating deploy's `data/`/`saves/`, and the
  repo's `content/*.json` and `writers-reference/*.json`. From then on the
  database's copy is the one served — an edit made in `/admin` sticks across
  deploys, and an edit made in the repo does NOT reach production until you run
  ```
  npm run reseed-content            # or: npm run reseed-content -- reference
  ```
  against the deployment's `DATABASE_URL` (Replit's shell has it), then
  restart. Deploys that touch only code need nothing.
- A deploy that was using the older file-mirror version of this app upgrades
  seamlessly: same table, same keys.
- Without `DATABASE_URL` (local dev, `npm test`) the files are the store and
  the database code never loads.

### Cost

With a Replit Core subscription, the smallest Reserved VM (~$7/mo of usage)
is covered by the plan's included monthly credits, and the built-in PostgreSQL
at this scale (a few MB, a write per committed line) is pennies per month.

## Editing the prompt bank

Edit `content/prompts.json` — one scenario string per array entry. No code changes.
The `/` palette in solo writes reads `writers-reference/` the same way — one JSON
file per group (`/dialogue` tags, `/action` verbs, `/delivery` modifiers,
`/feel` internal sensations, `/spice` romance), registered in
`writers-reference/index.json`. Both banks are also editable from `/admin`.

## Development notes

- The backend is `server.js` + `src/` (Express static + Socket.IO); the
  frontend is the multi-page app in `public/`. Live game state is in-memory;
  snapshots make it durable. See `CLAUDE.md` for the full architecture guide.
- Server-side `sanitizeRich()` is the trust boundary for all rich text —
  never render user HTML that hasn't passed through it.
