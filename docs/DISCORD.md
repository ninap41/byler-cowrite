# Discord bot setup

The site has a Discord bot built in (`src/discord.js`) — no gateway connection,
no library. Slash commands arrive as signed HTTP POSTs at
`/discord/interactions`; announcements and live-game shares are posted with
the bot token.

**Commands**

- `/cowrite-link` — the site link
- `/cowrite-online` — who is online right now

**Buttons on the site**

- **Post to Discord** on each announcement (`/announcements`, admin only) —
  posts the announcement's markdown *verbatim* to the admin channel, with the
  `@role` mention on its own line at the end. Announcements are written in
  markdown for exactly this reason: what you see on the site is what Discord
  renders.
- **Share to Discord** — in a game's lobby under the code, and in the host
  drawer once writing has started (host or admin). Posts to the writing-room
  channel:

  > @Cowrite 🌀☀️ **What the Painting Knew** is gathering writers — hosted by **ninaadmin** · 1 writer · code **XTT8**. Jump in before it starts!
  > `[ Join the lobby ]`

  A lobby gets **Join the lobby** only; a started game gets **Ask to join**
  (a request the host approves) and **Spectate**. Link buttons always open in
  the reader's browser. The Join link carries `from=discord`, so the game page
  shows a "Join “…”?" card and only seats them when they click — nobody joins
  a game by accident from a chat button. Signing in is still required.

**What the bot needs**

Everything is plain text + link buttons — no embeds — so the bot needs only
**Send Messages** and **View Channels** in the two channels. To make the
`@role` mention actually notify people, either give the bot **Mention
@everyone, @here, and All Roles** (recommended: nobody else can ping the role)
or turn on *"Allow anyone to @mention this role"* on the role itself. Every
post's `allowed_mentions` names that one role, so nothing in an announcement's
text or a game title can ping anyone else.

Link previews of the site (the banner card Discord draws under a pasted URL)
are not the bot's doing: they come from the Open Graph tags every page
carries (`ogTags()` in `src/site.js`, banner at `public/img/og-banner.png`,
re-captured with `scripts/og-banner.sh`). They need `PUBLIC_APP_URL` set;
Discord caches previews, so test a new banner with a fresh `?v=2` on the link.

## What you need to do in the Discord Developer Portal

1. **Create an application** (discord.com/developers → New Application), then
   under **Bot** click *Add Bot* and **Reset Token** → copy it.
2. From **General Information** copy the **Application ID** and the **Public Key**.
3. **Invite the bot to your server**: OAuth2 → URL Generator → scopes `bot` +
   `applications.commands`; bot permissions **Send Messages** (and *View
   Channels*). Open the generated URL and add it to the server. Make sure the
   bot has access to both channels (for the admin-only announcement channel,
   add the bot's role to that channel's permissions).
4. **Channel IDs**: enable Developer Mode in Discord (Settings → Advanced),
   right-click each channel → *Copy Channel ID*.
5. **Replit secrets** to add:
   ```
   DISCORD_PUBLIC_KEY          from step 2
   DISCORD_APP_ID              from step 2
   DISCORD_BOT_TOKEN           from step 1
   DISCORD_ANNOUNCE_CHANNEL_ID the admin-only channel
   DISCORD_GAMES_CHANNEL_ID    #mikes-writing-room
   COWRITE_ROLE_ID             the role to @mention on every post (Developer Mode → Server Settings → Roles → right-click → Copy Role ID)
   PUBLIC_APP_URL              https://your-site (already needed for reset emails)
   ```
6. **Deploy**, then in the portal → General Information set **Interactions
   Endpoint URL** to `https://your-site/discord/interactions` and Save. Discord
   immediately sends a signed PING; it only saves if the endpoint answers
   correctly (it will, once `DISCORD_PUBLIC_KEY` is set and the deploy is live
   — do this step *after* deploying).
7. In the Replit shell run `npm run discord-register` once. Global commands can
   take up to an hour to appear in Discord.

Then: `/cowrite-link` in any channel, "Post to Discord" on an announcement,
"Share to Discord" in a game's lobby or host drawer.

`/admin` → `GET /api/admin/discord` reports which of the secrets are set
(true/false, never the values) if something isn't working.
