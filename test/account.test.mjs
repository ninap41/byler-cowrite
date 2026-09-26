import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startServer, signup, startedGame } from "./helpers.mjs";

let ctx;
before(async () => (ctx = await startServer()));
after(async () => ctx.stop());

test("change email: password-confirmed, validated, unique", async () => {
  const u = await signup(ctx, "emailuser1", "e1@x.com");
  await signup(ctx, "emailuser2", "e2@x.com");
  const bad = await ctx.api("/api/account/email", { password: "wrong", email: "new@x.com" }, u.token);
  assert.equal(bad.status, 401);
  const invalid = await ctx.api("/api/account/email", { password: "1234", email: "nope" }, u.token);
  assert.equal(invalid.status, 400);
  const taken = await ctx.api("/api/account/email", { password: "1234", email: "e2@x.com" }, u.token);
  assert.match(taken.data.error, /already has an account/);
  const ok = await ctx.api("/api/account/email", { password: "1234", email: "fresh@x.com" }, u.token);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.email, "fresh@x.com");
  // login works with the new email
  const login = await ctx.api("/api/login", { user: "fresh@x.com", password: "1234" });
  assert.equal(login.status, 200);
});

test("change password: old confirmed, other sessions revoked, mine kept", async () => {
  const a = await signup(ctx, "pwuser1", "pw1@x.com");
  const other = await ctx.api("/api/login", { user: "pwuser1", password: "1234" }); // second session
  const bad = await ctx.api("/api/account/password", { oldPassword: "nope", newPassword: "abcd" }, a.token);
  assert.equal(bad.status, 401);
  const short = await ctx.api("/api/account/password", { oldPassword: "1234", newPassword: "x" }, a.token);
  assert.equal(short.status, 400);
  const ok = await ctx.api("/api/account/password", { oldPassword: "1234", newPassword: "abcd" }, a.token);
  assert.equal(ok.status, 200);
  assert.equal((await ctx.api("/api/me", null, a.token, "GET")).status, 200, "my session survives");
  assert.equal((await ctx.api("/api/me", null, other.data.token, "GET")).status, 401, "other session revoked");
  assert.equal((await ctx.api("/api/login", { user: "pwuser1", password: "abcd" })).status, 200);
});

test("achievements metadata is public: ladder + usage count only", async () => {
  const r = await ctx.api("/api/achievements", null, undefined, "GET");
  assert.equal(r.status, 200);
  assert.equal(r.data.wordTiers[0].name, "🔫 There. Out Loud.");
  assert.equal(r.data.wordTiers[0].min, 0);
  assert.equal(r.data.wordTiers[1].min, 5000);
  const cfg = JSON.parse(readFileSync(new URL("../content/achievements.json", import.meta.url), "utf-8"));
  assert.equal(r.data.usageCount, cfg.usage.length, "usage count mirrors the hand-editable catalogue");
  assert.ok(r.data.wordTiers[1].desc.includes("5,000"), "ladder descs are public");
  // secret badges ship name-only (their descs arrive per-user once earned);
  // open usage badges are the non-secret kind and always carry their desc
  assert.equal(r.data.usage.length, cfg.usage.length);
  assert.ok(r.data.usage.every((b) => b.name && !b.desc), "secret usage badges never ship descriptions");
  assert.equal(r.data.usageOpen.length, cfg.usageOpen.length);
  assert.ok(r.data.usageOpen.every((b) => b.name && b.desc), "open usage badges carry descriptions");
  assert.equal(JSON.stringify(r.data).includes("triggers"), false, "raw trigger lists still never ship");
  assert.equal(JSON.stringify(r.data).includes("combos"), false, "combo word lists never ship either");
});

test("usage badge awards once from a committed line and announces in chat", async () => {
  const { host, A, B, state } = await startedGame(ctx);
  const chats = [];
  A.on("chat", (m) => chats.push(m));
  const toasts = [];
  A.on("badge-earned", (b) => toasts.push(b));
  B.on("badge-earned", (b) => toasts.push(b));
  const cur = () => (state.current.currentId === A.id ? A : B);
  const hostFirst = state.current.currentName === "willthewise";
  await ctx.emit(cur(), "submit-line", { text: '"Michael?" Will said, and the puppy moaning began.' });
  await ctx.wait(200);
  await ctx.emit(cur(), "submit-line", { text: "a perfectly innocent line" });
  await ctx.wait(200);
  await ctx.emit(cur(), "submit-line", { text: "Michael? again: no double award for moaning" });
  await ctx.wait(200);
  const meTok = hostFirst ? host.token : (await ctx.api("/api/login", { user: "mikewheeler", password: "1234" })).data.token;
  const me = (await ctx.api("/api/me", null, meTok, "GET")).data.user;
  assert.deepEqual(me.usageBadges.sort(), ["🐺 Omega Badge", "😏 Smutty Buddy", "🙄 Ugh, Mike..."].sort());
  assert.equal(me.currentBadge, "🔫 There. Out Loud.", "usage badges never change the word rank");
  const awards = chats.filter((m) => m.sys && /earned the/.test(m.text));
  assert.equal(awards.length, 3, "each badge announced exactly once");
  // unlock notifications broadcast to EVERYONE in the session (A and B both)
  const each = ["🐺 Omega Badge", "😏 Smutty Buddy", "🙄 Ugh, Mike..."];
  assert.deepEqual(
    toasts.map((t) => t.badge).sort(),
    [...each, ...each].sort(),
    "one badge-earned event per unlock, per connected player",
  );
  // the recipe (desc) reaches the EARNER alone — these are secret badges
  assert.equal(toasts.filter((t) => t.desc).length, 3, "three toasts carry the description: the earner's own");
  assert.equal(toasts.filter((t) => !t.desc).length, 3, "the other player's three carry none");
  assert.ok(toasts.every((t) => t.name && t.color), "toasts name the earner");

  // and another writer's profile shows the badge, never the how — unless the
  // viewer has earned it too
  const otherTok = hostFirst ? (await ctx.api("/api/login", { user: "mikewheeler", password: "1234" })).data.token : host.token;
  const earnerName = hostFirst ? "willthewise" : "mikewheeler";
  const seen = (await ctx.api(`/api/users/${earnerName}`, null, otherTok, "GET")).data.user;
  assert.ok(seen.usageBadges.includes("🐺 Omega Badge"), "the badge is worn in public");
  assert.equal(seen.badgeDescs["🐺 Omega Badge"], undefined, "its recipe is not sent to a viewer who hasn't earned it");
  const own = (await ctx.api(`/api/users/${earnerName}`, null, meTok, "GET")).data.user;
  assert.ok(own.badgeDescs["🐺 Omega Badge"], "the owner sees their own");
});

test("phrase badge: “crazy together” must land as the phrase, in one line; everyone is toasted, and a badge's clip rides to both seats", async () => {
  const { A, B, state } = await startedGame(ctx);
  const toastsA = [], toastsB = [];
  A.on("badge-earned", (b) => toastsA.push(b));
  B.on("badge-earned", (b) => toastsB.push(b));
  const cur = () => (state.current.currentId === A.id ? A : B);
  await ctx.emit(cur(), "submit-line", { text: "This is <b>crazy</b>." }); // half of it: nothing
  await ctx.wait(200);
  await ctx.emit(cur(), "submit-line", { text: "Then together we go crazy." }); // the words apart: nothing
  await ctx.wait(200);
  const earner = state.current.currentName;
  await ctx.emit(cur(), "submit-line", { text: "We go <i>crazy together</i>, then." });
  await ctx.wait(200);
  for (const [who, toasts] of [["A", toastsA], ["B", toastsB]]) {
    assert.deepEqual(toasts.map((t) => t.badge), ["🌀 If We're Both Going Crazy"], who + " got exactly one toast");
    assert.equal(toasts[0].name, earner, who + "'s toast names the earner");
    assert.equal(toasts[0].sound, null, "no clip on this one");
  }
  // The Vecna badge carries a clip, and the clip reaches the room too
  await ctx.emit(cur(), "submit-line", { text: "Vecna was waiting." });
  await ctx.wait(200);
  for (const toasts of [toastsA, toastsB]) {
    const t = toasts.find((x) => x.badge === "He's coming for you");
    assert.ok(t, "the Vecna badge fired for this seat");
    assert.equal(t.sound, "at-long-last-we-can-begin");
  }
  assert.ok([...toastsA, ...toastsB].some((t) => t.badge === "He's coming for you" && t.desc === null), "the room copy hides the recipe");
});
