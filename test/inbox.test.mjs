// The inbox as CONVERSATIONS: a reply chains onto what it answers, both sides
// keep their half, and only /inbox (never the dashboard preview) can hold one.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, signup } from "./helpers.mjs";

const ADMIN_EMAIL = "admin@cowrite.test";
let ctx;
before(async () => (ctx = await startServer()));
after(async () => ctx.stop());

const inboxOf = async (u) => (await ctx.api("/api/inbox", undefined, u.token)).data.messages;

test("every message names the conversation it belongs to; a lone one is its own", async () => {
  const u = await signup(ctx, "threadone", "t1@x.com");
  for (const m of await inboxOf(u)) {
    assert.equal(m.threadId, m.id, "a message with no reply is a conversation of one");
    assert.equal(m.mine, false);
  }
});

test("a reply chains onto what it answers, on BOTH sides", async () => {
  const a = await signup(ctx, "willbyers2", "w2@x.com");
  const b = await signup(ctx, "mikewheeler2", "m2@x.com");
  // b's greeting reaches a as a friend request; use a plain note path instead:
  await ctx.api("/api/friends/request", { username: "willbyers2" }, b.token);
  const req = (await inboxOf(a)).find((m) => m.type === "friend-request");
  assert.ok(req);

  const sent = await ctx.api("/api/inbox/reply", { id: req.id, text: "sure, adding you" }, a.token);
  assert.equal(sent.status, 200);
  const thread = sent.data.threadId;
  assert.equal(thread, req.id, "the first message starts the thread");

  // the answer landed on b, in the same conversation, unread
  const bReply = (await inboxOf(b)).find((m) => m.threadId === thread && m.from?.username === "willbyers2");
  assert.ok(bReply, "b got the answer");
  assert.equal(bReply.read, false);
  assert.equal(bReply.mine, false);

  // ...and a kept their own copy, already read, marked as theirs
  const mine = (await inboxOf(a)).find((m) => m.threadId === thread && m.mine);
  assert.ok(mine, "a keeps their half of the exchange");
  assert.equal(mine.text, "sure, adding you");
  assert.equal(mine.read, true, "my own words are not news to me");
  assert.equal((await inboxOf(a)).find((m) => m.id === req.id).read, true, "answering marks the original read");
});

test("a conversation keeps one thread id however long it runs", async () => {
  const a = await signup(ctx, "chainer", "c1@x.com");
  const b = await signup(ctx, "chainee", "c2@x.com");
  await ctx.api("/api/friends/request", { username: "chainer" }, b.token);
  let target = (await inboxOf(a)).find((m) => m.type === "friend-request");
  const thread = target.id;

  // four turns, alternating — every message joins the same conversation
  for (let i = 0; i < 4; i++) {
    const speaker = i % 2 === 0 ? a : b;
    const listener = i % 2 === 0 ? b : a;
    const r = await ctx.api("/api/inbox/reply", { id: target.id, text: "turn " + i }, speaker.token);
    assert.equal(r.status, 200);
    assert.equal(r.data.threadId, thread, "turn " + i + " stays in the thread");
    target = (await inboxOf(listener)).find((m) => m.threadId === thread && !m.mine && m.text === "turn " + i);
    assert.ok(target, "each side can answer the last thing said to them");
  }
  const all = (await inboxOf(a)).filter((m) => m.threadId === thread);
  assert.equal(all.length, 5, "the request plus four turns");
  assert.equal(all.filter((m) => m.mine).length, 2, "two of them are mine");
});

test("a help question and its answer are one conversation for the asker", async () => {
  const c = await startServer();
  try {
    const admin = await signup(c, "ninaadmin", ADMIN_EMAIL);
    const asker = await signup(c, "lostwriter", "lost@x.com");
    await c.api("/api/help", { text: "How do I continue a story?" }, asker.token);

    const q = (await c.api("/api/inbox", undefined, admin.token)).data.messages.find((m) => m.type === "help");
    const own = (await c.api("/api/inbox", undefined, asker.token)).data.messages.find((m) => m.type === "help");
    assert.ok(own, "the asker keeps their own question");
    assert.equal(own.mine, true);
    assert.equal(own.read, true);
    assert.equal(own.threadId, q.threadId, "both copies name the same conversation");

    await c.api("/api/inbox/reply", { id: q.id, text: "From the dashboard." }, admin.token);
    const askerThread = (await c.api("/api/inbox", undefined, asker.token)).data.messages
      .filter((m) => m.threadId === q.threadId)
      .sort((x, y) => x.ts - y.ts);
    assert.equal(askerThread.length, 2, "question and answer, chained");
    assert.equal(askerThread[0].text, "How do I continue a story?");
    assert.equal(askerThread[1].text, "From the dashboard.");
    assert.equal(askerThread[1].from.username, "ninaadmin");
  } finally {
    await c.stop();
  }
});

test("the dashboard preview holds no conversation; /inbox does", async () => {
  const dash = await fetch(ctx.url + "/dashboard").then((r) => r.text());
  const inbox = await fetch(ctx.url + "/inbox").then((r) => r.text());
  assert.match(dash, /replies: false/, "the preview is a notice board");
  assert.ok(!/replies: false/.test(inbox), "the inbox page keeps its composer");
  // and the module honors it: no composer markup, no Reply button, no chain
  const panel = await fetch(ctx.url + "/js/inbox-panel.js").then((r) => r.text());
  assert.match(panel, /reply: replies && !!t\.replyTo/, "the composer is only built where replies live");
  assert.match(panel, /chain: replies \? t\.messages\.slice\(1\) : \[\]/, "and so is the chain");
  assert.ok(!/textContent = "Reply"/.test(panel), "there is no Reply button anywhere — the box is simply there");
  assert.match(panel, /if \(replies && t\.replyTo\) wireReply/, "the open composer is wired instead");
  assert.match(panel, /ib-compact/, "the preview row is marked as the compact one");
});

test("deleting a conversation takes the whole of it", async () => {
  const a = await signup(ctx, "deleter", "d1@x.com");
  const b = await signup(ctx, "deletee", "d2@x.com");
  await ctx.api("/api/friends/request", { username: "deleter" }, b.token);
  const req = (await inboxOf(a)).find((m) => m.type === "friend-request");
  await ctx.api("/api/inbox/reply", { id: req.id, text: "hello back" }, a.token);
  const ids = (await inboxOf(a)).filter((m) => m.threadId === req.id).map((m) => m.id);
  assert.equal(ids.length, 2);
  for (const id of ids) assert.equal((await ctx.api("/api/inbox/" + id, undefined, a.token, "DELETE")).status, 200);
  assert.equal((await inboxOf(a)).filter((m) => m.threadId === req.id).length, 0);
});

test("the ✕ is a borderless corner control on every inbox surface", async () => {
  const css = await fetch(ctx.url + "/css/dashboard.css").then((r) => r.text());
  const del = css.slice(css.indexOf("\n.ib-del {"), css.indexOf("\n.ib-del:hover"));
  assert.match(del, /position: absolute/, "in the card's own corner");
  assert.match(del, /top: 4px/);
  assert.match(del, /right: 6px/);
  assert.match(del, /border: 0/, "no border");
  assert.match(del, /background: none/);
  // not scoped to the dashboard's compact row — it is the ✕ everywhere
  assert.ok(!/\.ib-row\.ib-compact \.ib-del/.test(css));
  assert.match(css.slice(css.indexOf("\n.ib-row {"), css.indexOf("\n.ib-row.unread")), /position: relative/, "the card is what it is positioned in");
});
