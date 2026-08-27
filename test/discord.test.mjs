// The Discord half: signature verification, the two slash commands (pure),
// the message shapes, and the routes — an unsigned interaction is refused,
// admin-only sharing is refused for a normal account, and without a bot token
// sharing fails cleanly (502) rather than pretending.
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { startServer, signup } from "./helpers.mjs";
import { verifyInteraction, handleInteraction, announcementMessage, gameMessage, COMMANDS } from "../src/discord.js";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pubHex = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
const signed = (body, ts = "1700000000") => {
  const raw = JSON.stringify(body);
  return { raw, ts, sig: sign(null, Buffer.concat([Buffer.from(ts), Buffer.from(raw)]), privateKey).toString("hex") };
};

test("verifyInteraction accepts a real signature and refuses a forged or missing one", () => {
  const { raw, ts, sig } = signed({ type: 1 });
  assert.ok(verifyInteraction({ signature: sig, timestamp: ts, rawBody: Buffer.from(raw) }, pubHex));
  assert.ok(!verifyInteraction({ signature: sig, timestamp: "1700000001", rawBody: Buffer.from(raw) }, pubHex), "timestamp is signed too");
  assert.ok(!verifyInteraction({ signature: "00" + sig.slice(2), timestamp: ts, rawBody: raw }, pubHex));
  assert.ok(!verifyInteraction({ signature: sig, timestamp: ts, rawBody: raw }, ""), "no key configured → refused");
});

test("PING pongs; /cowrite-link and /cowrite-online answer", () => {
  assert.deepEqual(handleInteraction({ type: 1 }), { type: 1 });
  const link = handleInteraction({ type: 2, data: { name: "cowrite-link" } }, { siteName: "Byler Cowrite" });
  assert.equal(link.type, 4);
  assert.match(link.data.content, /Byler Cowrite/);
  assert.match(link.data.content, /https?:\/\//);
  const on = handleInteraction({ type: 2, data: { name: "cowrite-online" } }, { onlineNames: () => ["mike", "will"] });
  assert.match(on.data.content, /\(2\).*\*\*mike\*\*, \*\*will\*\*/);
  assert.match(handleInteraction({ type: 2, data: { name: "cowrite-online" } }).data.content, /Nobody/);
  assert.equal(handleInteraction({ type: 2, data: { name: "nope" } }).data.flags, 64, "unknown → ephemeral");
  assert.deepEqual(COMMANDS.map((c) => c.name), ["cowrite-link", "cowrite-online"]);
});

test("message shapes: the announcement's markdown verbatim; a game with Join + Spectate links", () => {
  assert.equal(announcementMessage({ markdown: "# Hi\n\n**there**", title: "Hi" }).content, "# Hi\n\n**there**");
  const g = gameMessage({ code: "ABCD", phase: "writing", name: "The Snowball", hostName: "mike", players: 3 });
  assert.match(g.content, /The Snowball.*mike.*3 writers.*ABCD/);
  const [join, spec] = g.components[0].components;
  assert.match(join.url, /\/game\?code=ABCD&from=discord$/, "Join asks before seating");
  assert.match(spec.url, /\/game\?spectate=ABCD$/);
  const lobby = gameMessage({ code: "ABCD", phase: "waiting", name: "The Snowball", hostName: "mike", players: 1 });
  assert.match(lobby.content, /gathering writers.*1 writer /);
  assert.equal(lobby.components[0].components.length, 1, "a lobby has Join only — nothing to spectate yet");
  assert.equal(lobby.components[0].components[0].label, "Join the lobby");
  assert.match(lobby.components[0].components[0].url, /&from=discord$/);
});

test("routes: unsigned interactions are 401; sharing is admin/host-gated and fails cleanly without a token", async () => {
  const ctx = await startServer({ DISCORD_PUBLIC_KEY: pubHex });
  try {
    const bad = await fetch(ctx.url + "/discord/interactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: 1 }) });
    assert.equal(bad.status, 401);
    const { raw, ts, sig } = signed({ type: 1 });
    const ok = await fetch(ctx.url + "/discord/interactions", { method: "POST", headers: { "Content-Type": "application/json", "X-Signature-Ed25519": sig, "X-Signature-Timestamp": ts }, body: raw });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { type: 1 });

    const admin = await signup(ctx, "ninaadmin", "admin@cowrite.test");
    const normie = await signup(ctx, "normie1", "normie@x.com");
    const posted = await ctx.api("/api/admin/announcements", { markdown: "# Hello" }, admin.token);
    const id = posted.data.post.id;
    const denied = await ctx.api(`/api/admin/announcements/${id}/discord`, {}, normie.token);
    assert.equal(denied.status, 403);
    const noToken = await ctx.api(`/api/admin/announcements/${id}/discord`, {}, admin.token);
    assert.equal(noToken.status, 502, "no bot token configured → an honest 502");
    assert.match(noToken.data.error, /DISCORD_BOT_TOKEN/);
    const status = await ctx.api("/api/admin/discord", undefined, admin.token);
    assert.equal(status.data.publicKey, true);
    assert.equal(status.data.botToken, false);
  } finally { await ctx.stop(); }
});
