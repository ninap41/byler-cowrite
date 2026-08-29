// Discord — the bot half of the site, without a gateway connection or a
// library. Discord calls US: slash commands arrive as signed HTTP POSTs at
// /discord/interactions (verified with the app's Ed25519 public key, which is
// what makes the endpoint safe to expose), and we call Discord's REST API with
// the bot token to post messages into channels. Two things go out:
//   - an announcement (POST /api/admin/announcements/:id/discord, the "Post to
//     Discord" button on each post): its MARKDOWN verbatim — Discord renders
//     markdown, which is why announcements are written in it — then the role
//     mention on its own line at the end, so a leading heading stays one;
//   - a live game share (POST /api/games/:code/discord, "Share to Discord" in
//     the lobby under the code and in the host drawer): the role mention, then
//     🌀☀️ title · bold host · writer count · bold code, with LINK buttons —
//     "Join the lobby" for a lobby (from=discord, so the game page confirms
//     before seating), "Ask to join" + "Spectate" once the game has started.
// Everything is plain content + link buttons — no embeds — so the bot needs
// only Send Messages / View Channels (and, to actually notify the role,
// "Mention @everyone, @here and All Roles" or the role's own mention toggle);
// link buttons always open in the viewer's browser. Configuration is env:
//   DISCORD_PUBLIC_KEY          the app's public key (verifies interactions)
//   DISCORD_APP_ID              the application id (command registration)
//   DISCORD_BOT_TOKEN           the bot token (posting messages, registration)
//   DISCORD_ANNOUNCE_CHANNEL_ID the admin-only channel announcements post to
//   DISCORD_GAMES_CHANNEL_ID    where live-game shares post (#mikes-writing-room)
//   COWRITE_ROLE_ID             a role to @mention on every post, so its members get alerted
//   PUBLIC_APP_URL              the site's origin, used in every link
// Nothing here runs unless the relevant var is set; `discordStatus()` reports
// which are (booleans, never values) for /admin. Link previews of the site
// itself are Open Graph tags, not the bot's doing — see ogTags() in site.js.
// Setup walkthrough: docs/DISCORD.md.
import { verify as cryptoVerify, createPublicKey } from "node:crypto";

const env = (k) => String(process.env[k] || "").trim();
const API = "https://discord.com/api/v10";

export const COMMANDS = [
  { name: "cowrite-link", description: "Get the link to the site", type: 1 },
  { name: "cowrite-online", description: "See who is online right now", type: 1 },
];

export const discordStatus = () => ({
  publicKey: !!env("DISCORD_PUBLIC_KEY"), appId: !!env("DISCORD_APP_ID"), botToken: !!env("DISCORD_BOT_TOKEN"),
  announceChannel: !!env("DISCORD_ANNOUNCE_CHANNEL_ID"), roleId: !!env("COWRITE_ROLE_ID"), gamesChannel: !!env("DISCORD_GAMES_CHANNEL_ID"), appUrl: !!env("PUBLIC_APP_URL"),
});
export const siteUrl = (path = "/") => (env("PUBLIC_APP_URL") || "http://localhost:" + (process.env.PORT || 3000)).replace(/\/$/, "") + path;

// Ed25519 check of X-Signature-Ed25519 over timestamp + raw body — the
// contract every interactions endpoint must honour. `publicKey` may be passed
// for tests; the raw body must be the exact bytes Discord sent.
export function verifyInteraction({ signature, timestamp, rawBody }, publicKey = env("DISCORD_PUBLIC_KEY")) {
  if (!publicKey || !signature || !timestamp || rawBody == null) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKey, "hex")]), format: "der", type: "spki" });
    return cryptoVerify(null, Buffer.concat([Buffer.from(String(timestamp)), Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody))]), key, Buffer.from(signature, "hex"));
  } catch { return false; }
}

// Pure: the interaction body in, the response body out. `onlineNames()` is
// supplied by the caller (it's the dashboard's presence list).
export function handleInteraction(body, { onlineNames = () => [], siteName = "Cowrite" } = {}) {
  if (body?.type === 1) return { type: 1 }; // PING → PONG (Discord's endpoint check)
  if (body?.type !== 2) return { type: 4, data: { content: "I don't know that one.", flags: 64 } };
  const name = body.data?.name;
  if (name === "cowrite-link") return { type: 4, data: { content: `✍️ **${siteName}** — ${siteUrl("/")}` } };
  if (name === "cowrite-online") {
    const names = onlineNames();
    const content = names.length ? `🟢 Online now (${names.length}): ${names.map((n) => `**${n}**`).join(", ")}` : "Nobody's online right now — be the first: " + siteUrl("/");
    return { type: 4, data: { content } };
  }
  return { type: 4, data: { content: "Unknown command.", flags: 64 } };
}

// POST a message to a channel as the bot. Returns {ok} or {error}.
export async function postToChannel(channelId, payload) {
  const token = env("DISCORD_BOT_TOKEN");
  if (!token) return { error: "DISCORD_BOT_TOKEN isn't set." };
  if (!channelId) return { error: "No channel id configured." };
  try {
    const r = await fetch(`${API}/channels/${channelId}/messages`, {
      method: "POST", headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    if (!r.ok) return { error: `Discord said ${r.status}: ${(await r.text()).slice(0, 200)}` };
    const m = await r.json();
    return { ok: true, id: m.id };
  } catch (e) { return { error: e.message || "Couldn't reach Discord." }; }
}

// Every post @mentions COWRITE_ROLE_ID (when set) so the role's members are
// alerted, and allowed_mentions names that role alone so nothing else in the
// text — the markdown, a game title saying "@everyone" — can ping anyone.
// A game share leads with it (`at` = "start"); an announcement ends with it,
// on its own line after the markdown (`at` = "end"), so a leading
// `## heading` stays a heading. Without a role, no mention is allowed at all.
const withRole = (msg, at = "start") => {
  const role = env("COWRITE_ROLE_ID");
  if (!role) return { ...msg, allowed_mentions: { parse: [] } };
  const content = at === "end" ? `${msg.content}\n\n<@&${role}>` : `<@&${role}> ${msg.content}`;
  return { ...msg, content: content.slice(0, 2000), allowed_mentions: { roles: [role] } };
};

// The announcement's own markdown, verbatim. Discord's cap is 2000 chars for
// the whole message; 1970 leaves room for the role mention withRole() appends.
// Each of the post's images rides as an embed with image.url (Discord shows
// them inline under the text; the API takes 10 embeds per message).
export const announcementMessage = (post) => {
  const msg = { content: String(post.markdown || post.title || "").slice(0, 1970) };
  const images = (Array.isArray(post.images) ? post.images : []).filter((u) => /^https?:\/\//i.test(String(u))).slice(0, 10);
  if (images.length) msg.embeds = images.map((url) => ({ image: { url } }));
  return msg;
};
export { withRole };
export const postAnnouncement = (post) => postToChannel(env("DISCORD_ANNOUNCE_CHANNEL_ID"), withRole(announcementMessage(post), "end"));

// A live game share: 🌀☀️, the title, the host's name in bold (Discord has no
// text colour outside code blocks, so bold is how the name stands out), the
// writer count, the code, and the link buttons that make sense for its phase.
// A lobby ("gathering writers") gets "Join the lobby" alone — the host gate
// only starts with the game, and there is nothing to spectate yet; a started
// game gets "Ask to join" (a request the host approves) and "Spectate". The
// Join link carries from=discord so the game page shows what the game is and
// waits for a click before seating (public/js/join-confirm.js) — one tap on a
// chat button shouldn't seat anyone by surprise.
const link = (label, url) => ({ type: 2, style: 5, label, url });
export const gameMessage = (s) => {
  const lobby = s.phase === "waiting";
  const who = `hosted by **${s.hostName || "someone"}** · ${s.players} writer${s.players === 1 ? "" : "s"} · code **${s.code}**`;
  const content = lobby
    ? `🌀☀️ **${s.name || s.code}** is gathering writers — ${who}. Jump in before it starts!`
    : `🌀☀️ **${s.name || s.code}** is live — ${who}`;
  const buttons = [link(lobby ? "Join the lobby" : "Ask to join", siteUrl(`/game?code=${s.code}&from=discord`))];
  if (!lobby) buttons.push(link("Spectate", siteUrl(`/game?spectate=${s.code}`)));
  return { content, components: [{ type: 1, components: buttons }] };
};
export const postGame = (s) => postToChannel(env("DISCORD_GAMES_CHANNEL_ID"), withRole(gameMessage(s)));

// Registers the slash commands globally (run once, or after changing COMMANDS).
export async function registerCommands() {
  const appId = env("DISCORD_APP_ID"), token = env("DISCORD_BOT_TOKEN");
  if (!appId || !token) throw new Error("DISCORD_APP_ID and DISCORD_BOT_TOKEN are required");
  const r = await fetch(`${API}/applications/${appId}/commands`, { method: "PUT", headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(COMMANDS) });
  if (!r.ok) throw new Error(`Discord said ${r.status}: ${await r.text()}`);
  return r.json();
}
