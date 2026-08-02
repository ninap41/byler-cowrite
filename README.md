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
  private archive of your games. Guests can play; hosting needs an account.
- **Permanent game codes** — every game snapshots to disk continuously; any
  code can be rejoined or continued later, from any device (signed-in seat
  reclaim). Started/continued games gate new entries behind host approval,
  with a 5-minute cooldown after a denial.
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

There is deliberately **no database**. Two directories hold everything:

| Path | Contents | Written by |
|---|---|---|
| `data/users.json` | accounts, sessions, reset tokens | `saveStore()` in `server.js` |
| `saves/<CODE>.json` | one snapshot per game (story, chat, seats, rules) | `saveSnapshot()` in `server.js` |

Both paths can be relocated with the `COWRITE_DATA_DIR` and `COWRITE_SAVE_DIR`
environment variables (the test suite uses this to stay isolated).

To send real password-reset emails, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS`, `SMTP_FROM`. Without them, reset links are logged to the server
console.

## Deploying on Replit (Reserved VM) — migrating persistence to Object Storage

The app must run as a **Reserved VM deployment** (Autoscale is stateless and
breaks Socket.IO rooms and the in-memory session map). The catch: Reserved VM
filesystems are **ephemeral across redeploys** — every deploy resets the disk
to the build snapshot, which would wipe `data/` and `saves/`.

The fix is a thin **Object Storage mirror** that keeps the file-based design
intact: the local filesystem stays the fast path, and a Replit Object Storage
bucket is the durable copy.

### How the sync works

1. **On boot** (before the server starts listening): if the
   `REPLIT_OBJECT_STORAGE` env flag is set, download `users.json` and every
   `saves/*.json` object from the bucket into the local `data/` and `saves/`
   directories. A fresh deploy therefore rehydrates itself before accepting
   its first connection.
2. **On every write**: `saveStore()` and `saveSnapshot()` are the only two
   functions that touch disk. After each local `writeFileSync`, the same bytes
   are uploaded (fire-and-forget, latest-write-wins) to the bucket via
   `@replit/object-storage`. Local dev and `npm test` skip the mirror entirely
   because the flag is unset.

Object names mirror the paths: `data/users.json`, `saves/<CODE>.json`. At
~100 users this is well inside Object Storage's pennies-per-month range.

### Migration steps

1. Push this repository to GitHub, then in Replit choose
   **Create Repl → Import from GitHub**.
2. In the Replit workspace, add the dependency:
   ```bash
   npm install @replit/object-storage
   ```
3. Create a bucket via **Tools → Object Storage** in the workspace.
4. Add the sync adapter in `server.js` (wrap `saveStore()` / `saveSnapshot()`
   with the upload, and add the boot-time hydration described above), gated on
   the `REPLIT_OBJECT_STORAGE` env flag.
5. **One-time data migration**: if you have existing local `data/users.json`
   or `saves/*.json`, upload them to the bucket once (a small script calling
   `client.uploadFromFilename()` for each file, or drag-and-drop in the
   Object Storage pane).
6. Configure the deployment: **Deploy → Reserved VM**, run command
   `npm start`, and set `REPLIT_OBJECT_STORAGE=1` in the deployment secrets
   (plus the `SMTP_*` secrets if you want real reset emails).
7. Deploy. Verify persistence by signing up, redeploying, and logging back in.

### Cost

With a Replit Core subscription, the smallest Reserved VM (~$7/mo of usage) is
covered by the plan's included monthly credits, and Object Storage at this
scale is negligible — so hosting is effectively free on an existing Core plan.

## Editing the prompt bank

Edit `prompts.json` — one scenario string per array entry. No code changes.

## Development notes

- `server.js` is the whole backend (Express static + Socket.IO). Live game
  state is in-memory; snapshots make it durable. `public/index.html` is the
  whole frontend. See `CLAUDE.md` for the full architecture guide.
- Server-side `sanitizeRich()` is the trust boundary for all rich text —
  never render user HTML that hasn't passed through it.
