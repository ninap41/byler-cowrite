// Solo-write documents: CRUD, the friends-only beta-reader gate, the
// permission boundary (readers may read+comment, never edit), live presence,
// and comment persistence.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, signup } from "./helpers.mjs";

let ctx, alice, bob, carol;
before(async () => {
  ctx = await startServer();
  alice = await signup(ctx, "aliceauthor", "alice@byers.com");
  bob = await signup(ctx, "bobbeta", "bob@byers.com");
  carol = await signup(ctx, "carolnope", "carol@byers.com");
  // alice and bob are friends; carol is a stranger
  await ctx.api("/api/friends/request", { username: "bobbeta" }, alice.token);
  const inbox = await ctx.api("/api/inbox", null, bob.token, "GET");
  const req = inbox.data.messages.find((m) => m.type === "friend-request");
  await ctx.api("/api/friends/respond", { id: req.id, accept: true }, bob.token);
});
after(async () => ctx.stop());

const newDoc = async (token, title = "Draft") =>
  (await ctx.api("/api/docs", { title }, token)).data.doc;

test("docs require auth", async () => {
  assert.equal((await ctx.api("/api/docs")).status, 401);
  assert.equal((await ctx.api("/api/docs", { title: "x" })).status, 401);
  assert.equal((await ctx.api("/api/reference")).status, 401);
});

test("create, save, list and delete a document", async () => {
  const doc = await newDoc(alice.token, "The Upside Down");
  assert.equal(doc.title, "The Upside Down");
  assert.equal(doc.visibility, "private");
  assert.equal(doc.mine, true);

  const saved = await ctx.api(
    "/api/docs/" + doc.id,
    { title: "The Upside Down", html: "<h2>One</h2><p>Mike knocked twice.</p>" },
    alice.token,
    "PUT"
  );
  assert.equal(saved.status, 200);
  assert.equal(saved.data.doc.html, "<h2>One</h2><p>Mike knocked twice.</p>");
  assert.equal(saved.data.doc.wordCount, 4, "word count comes from the stripped text");

  const list = await ctx.api("/api/docs", null, alice.token, "GET");
  assert.ok(list.data.docs.some((d) => d.id === doc.id));
  assert.ok(!("html" in list.data.docs[0]), "the listing never ships document bodies");

  assert.equal((await ctx.api("/api/docs/" + doc.id, null, alice.token, "DELETE")).status, 200);
  assert.equal((await ctx.api("/api/docs/" + doc.id, null, alice.token, "GET")).status, 404);
});

test("saving runs the document sanitizer", async () => {
  const doc = await newDoc(alice.token);
  const r = await ctx.api(
    "/api/docs/" + doc.id,
    { html: '<p>hi</p><script>alert(1)</script><a href="javascript:x">no</a><img src=y onerror=z>' },
    alice.token,
    "PUT"
  );
  assert.ok(r.data.doc.html.includes("<p>hi</p>"));
  assert.ok(!r.data.doc.html.includes("<script"), "script never stored live");
  assert.ok(!/<a\s+href="javascript/.test(r.data.doc.html), "bad scheme never stored live");
  assert.ok(!r.data.doc.html.includes("<img"), "handler-bearing img never stored live");
});

test("a stranger can neither read nor write someone else's document", async () => {
  const doc = await newDoc(alice.token, "Private thoughts");
  assert.equal((await ctx.api("/api/docs/" + doc.id, null, carol.token, "GET")).status, 403);
  assert.equal((await ctx.api("/api/docs/" + doc.id, { html: "<p>mine now</p>" }, carol.token, "PUT")).status, 403);
  assert.equal((await ctx.api("/api/docs/" + doc.id, null, carol.token, "DELETE")).status, 403);
  const list = await ctx.api("/api/docs", null, carol.token, "GET");
  assert.ok(!list.data.docs.some((d) => d.id === doc.id), "not in their listing either");
});

test("beta readers must be friends, and readers can read but never edit", async () => {
  const doc = await newDoc(alice.token, "Shared draft");
  await ctx.api("/api/docs/" + doc.id, { html: "<p>line one</p>" }, alice.token, "PUT");

  // carol isn't a friend
  const nope = await ctx.api("/api/docs/" + doc.id + "/readers", { username: "carolnope" }, alice.token);
  assert.equal(nope.status, 400);
  assert.match(nope.data.error, /friends/i);

  // bob is
  const added = await ctx.api("/api/docs/" + doc.id + "/readers", { username: "bobbeta" }, alice.token);
  assert.equal(added.status, 200);
  assert.deepEqual(added.data.doc.readers, ["bobbeta"]);

  // still private, so even an invited reader can't open it yet
  assert.equal((await ctx.api("/api/docs/" + doc.id, null, bob.token, "GET")).status, 403);

  await ctx.api("/api/docs/" + doc.id + "/visibility", { visibility: "readers" }, alice.token);
  const seen = await ctx.api("/api/docs/" + doc.id, null, bob.token, "GET");
  assert.equal(seen.status, 200);
  assert.equal(seen.data.doc.html, "<p>line one</p>");
  assert.equal(seen.data.doc.mine, false);

  // reading is not editing
  assert.equal((await ctx.api("/api/docs/" + doc.id, { html: "<p>hacked</p>" }, bob.token, "PUT")).status, 403);
  assert.equal((await ctx.api("/api/docs/" + doc.id, null, bob.token, "DELETE")).status, 403);
  // and only the author manages the reader list
  assert.equal((await ctx.api("/api/docs/" + doc.id + "/readers", { username: "carolnope" }, bob.token)).status, 403);

  // revoking access closes the door again
  await ctx.api("/api/docs/" + doc.id + "/readers/bobbeta", null, alice.token, "DELETE");
  assert.equal((await ctx.api("/api/docs/" + doc.id, null, bob.token, "GET")).status, 403);
});

test("an invite lands in the reader's inbox", async () => {
  const doc = await newDoc(alice.token, "Notes please");
  await ctx.api("/api/docs/" + doc.id + "/readers", { username: "bobbeta" }, alice.token);
  const inbox = await ctx.api("/api/inbox", null, bob.token, "GET");
  assert.ok(
    inbox.data.messages.some((m) => m.type === "doc-invite" && /Notes please/.test(m.text)),
    "beta-reader invites use the existing inbox"
  );
});

test("comments persist, carry author identity, and respect access", async () => {
  const doc = await newDoc(alice.token, "Commentable");
  await ctx.api("/api/docs/" + doc.id, { html: "<p>first</p><p>second</p>" }, alice.token, "PUT");
  await ctx.api("/api/docs/" + doc.id + "/readers", { username: "bobbeta" }, alice.token);
  await ctx.api("/api/docs/" + doc.id + "/visibility", { visibility: "readers" }, alice.token);

  const B = await ctx.conn();
  B.emit("doc-open", { auth: bob.token, id: doc.id });
  await ctx.wait(150);
  B.emit("doc-comment", { auth: bob.token, id: doc.id, blockIdx: 1, blockHash: "h2", text: "this line sings" });
  await ctx.wait(200);

  const after = await ctx.api("/api/docs/" + doc.id, null, alice.token, "GET");
  assert.equal(after.data.doc.comments.length, 1);
  const c = after.data.doc.comments[0];
  assert.equal(c.text, "this line sings");
  assert.equal(c.author, "bobbeta");
  assert.equal(c.blockIdx, 1);
  assert.ok(!("userId" in c), "account ids never reach the client");

  // a stranger's comment is ignored outright
  const C = await ctx.conn();
  C.emit("doc-comment", { auth: carol.token, id: doc.id, blockIdx: 0, blockHash: "h1", text: "let me in" });
  await ctx.wait(200);
  const still = await ctx.api("/api/docs/" + doc.id, null, alice.token, "GET");
  assert.equal(still.data.doc.comments.length, 1, "no access, no comment");
});

test("presence lists everyone viewing the doc", async () => {
  const doc = await newDoc(alice.token, "Watch me");
  await ctx.api("/api/docs/" + doc.id + "/readers", { username: "bobbeta" }, alice.token);
  await ctx.api("/api/docs/" + doc.id + "/visibility", { visibility: "readers" }, alice.token);

  const A = await ctx.conn();
  const seen = [];
  A.on("doc-presence", (p) => seen.push(p));
  A.emit("doc-open", { auth: alice.token, id: doc.id });
  await ctx.wait(150);

  const B = await ctx.conn();
  B.emit("doc-open", { auth: bob.token, id: doc.id });
  await ctx.wait(200);

  const last = seen[seen.length - 1];
  assert.equal(last.id, doc.id);
  const names = last.viewers.map((v) => v.username).sort();
  assert.deepEqual(names, ["aliceauthor", "bobbeta"]);
  assert.ok(last.viewers.every((v) => "avatar" in v && "color" in v), "presence carries what the avatar needs");

  // leaving drops them from the list
  B.disconnect();
  await ctx.wait(250);
  const final = seen[seen.length - 1];
  assert.deepEqual(final.viewers.map((v) => v.username), ["aliceauthor"]);
});

test("the reference bank is served for the slash palette", async () => {
  const r = await ctx.api("/api/reference", null, alice.token, "GET");
  assert.equal(r.status, 200);
  assert.equal(r.data.groups.length, 6, "all six reference files load");
  const action = r.data.groups.find((g) => g.prefix === "/action");
  assert.ok(action.categories.length > 10);
  assert.ok(action.categories[0].words.length > 5);
  assert.ok(typeof action.categories[0].words[0] === "string", "leaves are plain words");
  // delivery-modifiers wraps its categories in a root key that must be unwrapped
  const delivery = r.data.groups.find((g) => g.prefix === "/delivery");
  assert.ok(delivery.categories.some((c) => c.key === "warm_and_gentle"), "root unwrapped");
});
