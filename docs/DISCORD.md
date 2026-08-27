# Discord bot setup

The site has a Discord bot built in (`src/discord.js`) — no gateway connection,
no library. Slash commands arrive as signed HTTP POSTs at
`/discord/interactions`; announcements and live-game shares are posted with
the bot token. Commands: `/cowrite-link` (the site link), `/cowrite-online`
(who is online). Buttons: **Post to Discord** on each announcement (admin only,
sends the post's markdown verbatim to the admin channel) and **Share to
Discord** in a live game's host drawer (code + Join / Spectate buttons).

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
"Share to Discord" in a live game's host drawer.

`/admin` → `GET /api/admin/discord` reports which of the secrets are set
(true/false, never the values) if something isn't working.
