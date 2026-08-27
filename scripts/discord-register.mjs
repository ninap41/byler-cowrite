// npm run discord-register — registers the bot's slash commands with Discord.
// Needs DISCORD_APP_ID and DISCORD_BOT_TOKEN in the environment (Replit secrets).
import { registerCommands, COMMANDS } from "../src/discord.js";
const out = await registerCommands();
console.log(`Registered ${out.length} command(s): ${COMMANDS.map((c) => "/" + c.name).join(", ")}`);
