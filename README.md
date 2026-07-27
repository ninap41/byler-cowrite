# Byler Cowrite

A real-time collaborative writing app for Byler (Will × Mike) fanfiction sessions.
Start a session, share a 4-letter code, and everyone gets a scenario prompt (or a
blank page) to write from.

## Features

- **Real multiplayer** — writers join from their own devices with a session code
  (Socket.IO). Host sees everyone gather in a waiting room, then begins.
- **Prompt modes** — hand everyone a curated prompt, blank pages, or a mix.
- **Curated prompt bank** — 25+ hand-written Byler scenarios in `prompts.json`.
  Works offline, free, instant.
- **Optional AI generation** — a "✨ Generate fresh" button that calls Claude to
  invent a new scenario. Disabled automatically if no API key is set.

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000

## Deploy on Replit

1. Upload this whole folder to a new Replit (or import it).
2. Press **Run**. Replit installs deps and starts the server.
3. Open the webview URL and share it with your writers.

### Enable AI scenario generation (optional)

In Replit, open **Tools → Secrets** and add:

- Key: `ANTHROPIC_API_KEY`
- Value: your Anthropic API key

Restart. The "✨ Generate fresh" button activates. Without it, the app runs fine
on the curated prompt bank alone.

## Editing the prompt bank

Just edit `prompts.json` — one scenario per string in the `prompts` array.
No code changes needed.

## Notes

- Session state lives in server memory (no database). If the server restarts,
  active sessions reset — fine for a party-style app.
- Written text stays local to each writer's browser (nothing is stored server-side).
  If you want to collect finished pieces, that's a natural next feature to add.
