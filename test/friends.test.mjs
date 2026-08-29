// Inbox + friends system: welcome seed, requests, accept/decline, unfriend,
// read/unread state, deletion, and the profile friendState.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, signup, startedGame } from "./helpers.mjs";

let ctx;
before(async () => (ctx = await startServer()));
after(async () => ctx.stop());

const inboxOf = async (u) => (await ctx.api("/api/inbox", undefined, u.token)).data;

test("signup seeds a welcome message, unread", async () => {
  const will = await signup(ctx);
  const box = await inboxOf(will);
  assert.equal(box.messages.length, 1);
  assert.equal(box.messages[0].type, "system");
  assert.equal(box.messages[0].read, false);
  assert.equal(box.unread, 1);
});

test("friend request lands in the target inbox and profile shows the state", async () => {
  const will = await signup(ctx);
  const mike = await signup(ctx, "mikewheeler", "mike@wheeler.com");

  // self / missing / duplicate guards
  const self = await ctx.api("/api/friends/request", { username: "willthewise" }, will.token);
  assert.equal(self.status, 400);
  const ghost = await ctx.api("/api/friends/request", { username: "nobodyhere" }, will.token);
  assert.equal(ghost.status, 404);

  const r = await ctx.api("/api/friends/request", { username: "mikewheeler" }, will.token);
  assert.equal(r.status, 200);
  const dup = await ctx.api("/api/friends/request", { username: "mikewheeler" }, will.token);
  assert.equal(dup.status, 400);
  // reverse direction blocked while pending
  const rev = await ctx.api("/api/friends/request", { username: "willthewise" }, mike.token);
  assert.equal(rev.status, 400);

  const box = await inboxOf(mike);
  const req = box.messages.find((m) => m.type === "friend-request");
  assert.ok(req);
  assert.equal(req.from.username, "willthewise");
  assert.equal(req.read, false);

  // profile friendState from both sides
  const fromWill = await ctx.api("/api/users/mikewheeler", undefined, will.token);
  assert.equal(fromWill.data.friendState.state, "outgoing");
  const fromMike = await ctx.api("/api/users/willthewise", undefined, mike.token);
  assert.equal(fromMike.data.friendState.state, "incoming");
  assert.equal(fromMike.data.friendState.requestId, req.id);

  // accept: both become friends, requester gets a note
  const acc = await ctx.api("/api/friends/respond", { id: req.id, accept: true }, mike.token);
  assert.equal(acc.status, 200);
  assert.equal(acc.data.accepted, true);
  const willFriends = (await ctx.api("/api/friends", undefined, will.token)).data.friends;
  const mikeFriends = (await ctx.api("/api/friends", undefined, mike.token)).data.friends;
  assert.deepEqual(willFriends.map((f) => f.username), ["mikewheeler"]);
  assert.deepEqual(mikeFriends.map((f) => f.username), ["willthewise"]);
  // a row carries the public counts its tooltip shows, never an email or id
  const row = willFriends[0];
  assert.equal(typeof row.wordCount, "number");
  assert.equal(typeof row.badges, "number");
  assert.equal(typeof row.games, "number");
  assert.equal(row.email, undefined);
  assert.equal(row.id, undefined);
  const note = (await inboxOf(will)).messages.find((m) => m.type === "friend-accept");
  assert.ok(note);
  assert.equal(note.from.username, "mikewheeler");
  // request consumed
  assert.ok(!(await inboxOf(mike)).messages.some((m) => m.type === "friend-request"));
  const nowFriends = await ctx.api("/api/users/mikewheeler", undefined, will.token);
  assert.equal(nowFriends.data.friendState.state, "friends");
  // request while already friends refused
  const again = await ctx.api("/api/friends/request", { username: "mikewheeler" }, will.token);
  assert.equal(again.status, 400);

  // unfriend removes both sides
  const un = await ctx.api("/api/friends/mikewheeler", undefined, will.token, "DELETE");
  assert.equal(un.status, 200);
  assert.equal((await ctx.api("/api/friends", undefined, will.token)).data.friends.length, 0);
  assert.equal((await ctx.api("/api/friends", undefined, mike.token)).data.friends.length, 0);
});

test("declining a request consumes it without friending", async () => {
  const will = await signup(ctx);
  const el = await signup(ctx, "elhopper", "el@hopper.com");
  await ctx.api("/api/friends/request", { username: "elhopper" }, will.token);
  const req = (await inboxOf(el)).messages.find((m) => m.type === "friend-request");
  const r = await ctx.api("/api/friends/respond", { id: req.id, accept: false }, el.token);
  assert.equal(r.status, 200);
  assert.equal(r.data.accepted, false);
  assert.equal((await ctx.api("/api/friends", undefined, el.token)).data.friends.length, 0);
  assert.ok(!(await inboxOf(el)).messages.some((m) => m.type === "friend-request"));
  // answering it twice fails
  const twice = await ctx.api("/api/friends/respond", { id: req.id, accept: true }, el.token);
  assert.equal(twice.status, 404);
});

test("read state: mark one, mark all; delete removes a message", async () => {
  const dustin = await signup(ctx, "dustinhenderson", "dustin@henderson.com");
  const lucas = await signup(ctx, "lucassinclair", "lucas@sinclair.com");
  await ctx.api("/api/friends/request", { username: "dustinhenderson" }, lucas.token);
  let box = await inboxOf(dustin);
  assert.equal(box.unread, 2); // welcome + request

  const welcome = box.messages.find((m) => m.type === "system");
  const one = await ctx.api("/api/inbox/read", { ids: [welcome.id] }, dustin.token);
  assert.equal(one.data.unread, 1);
  box = await inboxOf(dustin);
  assert.equal(box.messages.find((m) => m.id === welcome.id).read, true);

  const all = await ctx.api("/api/inbox/read", {}, dustin.token);
  assert.equal(all.data.unread, 0);

  // delete the welcome message
  const del = await ctx.api("/api/inbox/" + welcome.id, undefined, dustin.token, "DELETE");
  assert.equal(del.status, 200);
  box = await inboxOf(dustin);
  assert.ok(!box.messages.some((m) => m.id === welcome.id));
  const delAgain = await ctx.api("/api/inbox/" + welcome.id, undefined, dustin.token, "DELETE");
  assert.equal(delAgain.status, 404);
});

test("friends list carries live online status", async () => {
  const max = await signup(ctx, "maxmayfield", "max@mayfield.com");
  const nancy = await signup(ctx, "nancywheeler", "nancy@wheeler.com");
  await ctx.api("/api/friends/request", { username: "nancywheeler" }, max.token);
  const req = (await inboxOf(nancy)).messages.find((m) => m.type === "friend-request");
  await ctx.api("/api/friends/respond", { id: req.id, accept: true }, nancy.token);

  const s = await ctx.conn();
  s.emit("identify", { auth: nancy.token });
  await ctx.wait(150);
  const friends = (await ctx.api("/api/friends", undefined, max.token)).data.friends;
  assert.equal(friends[0].username, "nancywheeler");
  assert.equal(friends[0].online, true);
});

test("continuing a story auto-invites online, unseated contributors", async () => {
  const { host, mike, A, B, code } = await startedGame(ctx);
  await ctx.emit(A, "end-game", {});
  // mike leaves the game but stays online elsewhere (dashboard presence)
  B.disconnect();
  const lobby = await ctx.conn();
  lobby.emit("identify", { auth: mike.token });
  await ctx.wait(200);
  const invite = new Promise((r) => lobby.on("game-invite", r));
  await ctx.emit(A, "continue-writing", { turnSeconds: 60, rounds: 1 });
  const inv = await invite;
  assert.equal(inv.code, code);
  assert.equal(inv.host, "willthewise");
  const box = await inboxOf(mike);
  const msg = box.messages.find((m) => m.type === "game-invite");
  assert.ok(msg);
  assert.equal(msg.code, code);
  assert.equal(msg.read, false);
  assert.equal(msg.from.username, "willthewise");
  // the seated host got no invite
  assert.ok(!(await inboxOf(host)).messages.some((m) => m.type === "game-invite"));
});

test("inbox endpoints require auth", async () => {
  assert.equal((await ctx.api("/api/inbox")).status, 401);
  assert.equal((await ctx.api("/api/friends")).status, 401);
  assert.equal((await ctx.api("/api/friends/request", { username: "x" })).status, 401);
});
