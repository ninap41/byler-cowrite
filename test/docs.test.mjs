// Solo-write documents: CRUD, the friends-only beta-reader gate, the
// permission boundary (readers may read+comment, never edit), live presence,
// and comment persistence.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, signup } from "./helpers.mjs";
import { anchorCids, anchorText, stripAnchor, applySuggestion } from "../src/docs.js";

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

// Anchored comments. The client wraps the commented words in a marker span and
// sends the whole html; the server takes it only if stripping that one anchor
// gives back exactly what it had. These tests are that guard, from both sides.
const BODY = "<p>first</p><p>his striped shirt hangs</p>";
const anchored = (cid, inner = "striped shirt") =>
  BODY.replace(inner, `<span class="cmt" data-cid="${cid}">${inner}</span>`);

async function commentableDoc() {
  const doc = await newDoc(alice.token, "Commentable");
  await ctx.api("/api/docs/" + doc.id, { html: BODY }, alice.token, "PUT");
  await ctx.api("/api/docs/" + doc.id + "/readers", { username: "bobbeta" }, alice.token);
  await ctx.api("/api/docs/" + doc.id + "/visibility", { visibility: "readers" }, alice.token);
  return doc;
}
const docOf = async (id, token = alice.token) => (await ctx.api("/api/docs/" + id, null, token, "GET")).data.doc;

test("a beta reader's comment anchors itself in the html and carries their identity", async () => {
  const doc = await commentableDoc();
  const B = await ctx.conn();
  B.emit("doc-open", { auth: bob.token, id: doc.id });
  await ctx.wait(150);
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "aaaaaaaaaaaa", html: anchored("aaaaaaaaaaaa"), text: "this line sings" });
  await ctx.wait(200);

  const after = await docOf(doc.id);
  assert.equal(after.comments.length, 1);
  const c = after.comments[0];
  assert.equal(c.text, "this line sings");
  assert.equal(c.author, "bobbeta");
  assert.equal(c.cid, "aaaaaaaaaaaa");
  assert.equal(c.quote, "striped shirt", "the comment remembers the words it is about");
  assert.equal(c.orphaned, false);
  assert.ok(!("userId" in c), "account ids never reach the client");
  assert.ok(after.html.includes('data-cid="aaaaaaaaaaaa"'), "the underline is in the saved html");
});

test("a reader cannot smuggle an edit alongside their comment", async () => {
  const doc = await commentableDoc();
  const B = await ctx.conn();
  B.emit("doc-open", { auth: bob.token, id: doc.id });
  await ctx.wait(150);
  // the anchor is legitimate, but the surrounding prose has been rewritten too
  const sneaky = anchored("bbbbbbbbbbbb").replace("first", "MY WORDS NOW");
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "bbbbbbbbbbbb", html: sneaky, text: "innocent note" });
  await ctx.wait(200);

  const after = await docOf(doc.id);
  assert.equal(after.comments.length, 0, "the whole comment is dropped, not partly applied");
  assert.equal(after.html, BODY, "the author's words are untouched");
});

test("a comment with no anchor, a bad cid, or a reused cid is refused", async () => {
  const doc = await commentableDoc();
  const B = await ctx.conn();
  B.emit("doc-open", { auth: bob.token, id: doc.id });
  await ctx.wait(150);
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "cccccccccccc", html: BODY, text: "no anchor" });
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "nothex", html: BODY, text: "bad cid" });
  await ctx.wait(200);
  assert.equal((await docOf(doc.id)).comments.length, 0);

  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "dddddddddddd", html: anchored("dddddddddddd"), text: "fine" });
  await ctx.wait(200);
  assert.equal((await docOf(doc.id)).comments.length, 1);
  // same cid again, this time wrapping different words
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "dddddddddddd", html: anchored("dddddddddddd").replace("first", '<span class="cmt" data-cid="dddddddddddd">first</span>'), text: "dupe" });
  await ctx.wait(200);
  assert.equal((await docOf(doc.id)).comments.length, 1, "an anchor id is never reused");
});

test("a stranger cannot comment at all", async () => {
  const doc = await commentableDoc();
  const C = await ctx.conn();
  C.emit("doc-comment", { auth: carol.token, id: doc.id, cid: "eeeeeeeeeeee", html: anchored("eeeeeeeeeeee"), text: "let me in" });
  await ctx.wait(200);
  assert.equal((await docOf(doc.id)).comments.length, 0, "no access, no comment");
});

test("accepting a suggestion rewrites the words and resolves the comment", async () => {
  const doc = await commentableDoc();
  const A = await ctx.conn(), B = await ctx.conn();
  A.emit("doc-open", { auth: alice.token, id: doc.id });
  B.emit("doc-open", { auth: bob.token, id: doc.id });
  await ctx.wait(150);
  // the decider applies it locally, so the push goes to everyone ELSE
  let pushed = null, pushedToDecider = null;
  B.on("doc-html", (d) => (pushed = d));
  A.on("doc-html", (d) => (pushedToDecider = d));
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "111111111111", html: anchored("111111111111"), text: "repeats", suggestion: "striped tee" });
  await ctx.wait(200);

  const cid = (await docOf(doc.id)).comments[0];
  assert.equal(cid.suggestion, "striped tee");
  assert.ok(pushedToDecider, "the author was told when the reader anchored their comment");
  pushedToDecider = null; // from here on, only the decide should push
  A.emit("doc-comment-decide", { auth: alice.token, id: doc.id, commentId: cid.id, accept: true });
  await ctx.wait(250);

  const after = await docOf(doc.id);
  assert.equal(after.html, "<p>first</p><p>his striped tee hangs</p>", "the suggestion is applied");
  assert.equal(after.comments[0].resolved, true);
  assert.equal(after.comments[0].accepted, true);
  assert.ok(pushed?.html.includes("striped tee"), "the new html is pushed to everyone else watching");
  assert.equal(pushedToDecider, null, "…but the decide is not echoed back at the author, whose editor already applied it");
});

test("rejecting a suggestion keeps the words and drops the underline", async () => {
  const doc = await commentableDoc();
  const A = await ctx.conn(), B = await ctx.conn();
  A.emit("doc-open", { auth: alice.token, id: doc.id });
  B.emit("doc-open", { auth: bob.token, id: doc.id });
  await ctx.wait(150);
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "222222222222", html: anchored("222222222222"), text: "?", suggestion: "striped tee" });
  await ctx.wait(200);
  const c = (await docOf(doc.id)).comments[0];
  A.emit("doc-comment-decide", { auth: alice.token, id: doc.id, commentId: c.id, accept: false });
  await ctx.wait(250);

  const after = await docOf(doc.id);
  assert.equal(after.html, BODY, "the author's words stand");
  assert.equal(after.comments[0].resolved, true);
  assert.equal(after.comments[0].accepted, false);
});

test("only the author decides — a beta reader cannot accept their own suggestion", async () => {
  const doc = await commentableDoc();
  const B = await ctx.conn();
  B.emit("doc-open", { auth: bob.token, id: doc.id });
  await ctx.wait(150);
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "333333333333", html: anchored("333333333333"), text: "?", suggestion: "MY VERSION" });
  await ctx.wait(200);
  const c = (await docOf(doc.id)).comments[0];
  B.emit("doc-comment-decide", { auth: bob.token, id: doc.id, commentId: c.id, accept: true });
  await ctx.wait(250);

  const after = await docOf(doc.id);
  assert.ok(!after.html.includes("MY VERSION"), "readers never rewrite the doc");
  assert.equal(after.comments[0].resolved, false);
});

test("the author can comment on their own fic", async () => {
  const doc = await commentableDoc();
  const A = await ctx.conn();
  A.emit("doc-open", { auth: alice.token, id: doc.id });
  await ctx.wait(150);
  A.emit("doc-comment", { auth: alice.token, id: doc.id, cid: "444444444444", html: anchored("444444444444"), text: "note to self: cut this" });
  await ctx.wait(200);
  const c = (await docOf(doc.id)).comments[0];
  assert.equal(c.author, "aliceauthor");
  assert.equal(c.isAuthor, true, "the author's own notes are marked as theirs");
  assert.equal(c.suggestion, null);
});

test("deleting or resolving a comment takes its underline with it", async () => {
  const doc = await commentableDoc();
  const A = await ctx.conn();
  A.emit("doc-open", { auth: alice.token, id: doc.id });
  await ctx.wait(150);
  A.emit("doc-comment", { auth: alice.token, id: doc.id, cid: "555555555555", html: anchored("555555555555"), text: "hm" });
  await ctx.wait(200);
  const c = (await docOf(doc.id)).comments[0];
  A.emit("doc-comment-resolve", { auth: alice.token, id: doc.id, commentId: c.id, resolved: true });
  await ctx.wait(200);
  let after = await docOf(doc.id);
  assert.equal(after.html, BODY, "resolved: words kept, underline gone");
  assert.equal(after.comments[0].orphaned, true, "with no anchor left it reads as orphaned");

  A.emit("doc-comment-delete", { auth: alice.token, id: doc.id, commentId: c.id });
  await ctx.wait(200);
  after = await docOf(doc.id);
  assert.equal(after.comments.length, 0);
  assert.equal(after.html, BODY);
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

// ---- comment anchors ----
// String surgery on already-sanitized html: these back the underline, the
// Accept button, and orphan detection, so the edge cases matter.
const CID = "0123456789ab";
const A = (inner, cid = CID) => `<span class="cmt" data-cid="${cid}">${inner}</span>`;

test("anchorCids lists every anchor in document order", () => {
  const html = `<p>${A("one")}</p><p>${A("two", "ffffffffffff")}</p>`;
  assert.deepEqual(anchorCids(html), [CID, "ffffffffffff"]);
  assert.deepEqual(anchorCids("<p>plain</p>"), []);
  assert.deepEqual(anchorCids(""), []);
});

test("anchorText reads the words a comment points at, tags stripped", () => {
  assert.equal(anchorText(`<p>his ${A("striped <b>shirt</b>")} hangs</p>`, CID), "striped shirt");
  assert.equal(anchorText("<p>no anchor</p>", CID), "", "a missing anchor reads empty, not a throw");
});

test("stripAnchor unwraps the marker and keeps the text", () => {
  assert.equal(stripAnchor(`<p>his ${A("striped shirt")} hangs</p>`, CID), "<p>his striped shirt hangs</p>");
  assert.equal(stripAnchor(`<p>${A("a <b>bold</b> bit")}</p>`, CID), "<p>a <b>bold</b> bit</p>", "inner formatting survives");
});

test("stripAnchor leaves other anchors alone", () => {
  const html = `<p>${A("one")} and ${A("two", "ffffffffffff")}</p>`;
  assert.equal(stripAnchor(html, CID), `<p>one and ${A("two", "ffffffffffff")}</p>`);
});

test("applySuggestion swaps the anchored words and removes the anchor", () => {
  assert.equal(
    applySuggestion(`<p>his ${A("striped shirt")} hangs</p>`, CID, "striped tee"),
    "<p>his striped tee hangs</p>",
  );
});

test("applySuggestion escapes the proposed text — a suggestion is words, not markup", () => {
  const out = applySuggestion(`<p>${A("x")}</p>`, CID, '<img src=x onerror="alert(1)">');
  assert.ok(!out.includes("<img"), out);
  assert.ok(out.includes("&lt;img"), out);
});

test("a nested size span does not close the anchor early", () => {
  const html = `<p>${A('a <span class="fs-36">big</span> word')} after</p>`;
  assert.equal(anchorText(html, CID), "a big word");
  assert.equal(applySuggestion(html, CID, "small"), "<p>small after</p>");
});

test("unbalanced html is left untouched rather than corrupted", () => {
  const broken = `<p><span class="cmt" data-cid="${CID}">unclosed`;
  assert.equal(stripAnchor(broken, CID), broken);
  assert.equal(applySuggestion(broken, CID, "x"), broken);
});

test("a missing cid is a no-op on every anchor helper", () => {
  const html = "<p>plain text</p>";
  assert.equal(stripAnchor(html, CID), html);
  assert.equal(applySuggestion(html, CID, "x"), html);
});
