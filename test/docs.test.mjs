// Solo-write documents: CRUD, the friends-only beta-reader gate, the
// permission boundary (readers may read+comment, never edit), live presence,
// and comment persistence.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, signup } from "./helpers.mjs";
import { anchorCids, anchorText, stripAnchor, applySuggestion, repairEntities, countWords } from "../src/docs.js";
import { DOC_MAX } from "../src/sanitize.js";

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

  // assigning a reader auto-promotes a private doc to the "readers" state, so
  // the invited reader can open it right away — no separate visibility flip
  assert.equal(added.data.doc.visibility, "readers");
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

test("only the author decides, a beta reader cannot accept their own suggestion", async () => {
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
  assert.equal(r.data.groups.length, 5, "all five reference files load");
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

test("applySuggestion escapes the proposed text, a suggestion is words, not markup", () => {
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

// ---- public writes ----
// Three levels, narrowest first: private -> readers -> public. "Public" means
// any signed-in account may READ; commenting stays a beta-reader right.

const setVis = (id, visibility, token = alice.token) =>
  ctx.api(`/api/docs/${id}/visibility`, { visibility }, token);

test("a public write is readable by anyone signed in; private and shared are not", async () => {
  const doc = await newDoc(alice.token, "Open Draft");
  await ctx.api("/api/docs/" + doc.id, { html: "<p>hello</p>" }, alice.token, "PUT");

  assert.equal((await ctx.api("/api/docs/" + doc.id, null, carol.token, "GET")).status, 403, "private by default");
  await setVis(doc.id, "readers");
  assert.equal((await ctx.api("/api/docs/" + doc.id, null, carol.token, "GET")).status, 403, "a stranger is not a reader");

  const pub = await setVis(doc.id, "public");
  assert.equal(pub.data.doc.visibility, "public");
  const seen = await ctx.api("/api/docs/" + doc.id, null, carol.token, "GET");
  assert.equal(seen.status, 200, "now anyone signed in can read it");
  assert.ok(seen.data.doc.html.includes("hello"));
  assert.equal(seen.data.doc.mine, false);

  await setVis(doc.id, "private");
  assert.equal((await ctx.api("/api/docs/" + doc.id, null, carol.token, "GET")).status, 403, "narrowing takes it back");
});

test("a public write is a public page: no account needed to read it, and a plain reader gets no comments", async () => {
  const doc = await newDoc(alice.token, "Open Book");
  await ctx.api("/api/docs/" + doc.id, { html: BODY }, alice.token, "PUT");
  assert.equal((await ctx.api("/api/docs/" + doc.id, null, null, "GET")).status, 401, "private: sign in first");
  await setVis(doc.id, "readers");
  assert.equal((await ctx.api("/api/docs/" + doc.id, null, null, "GET")).status, 401, "readers-only: sign in first");
  assert.equal((await ctx.api("/api/docs/" + doc.id, null, "nonsense-token", "GET")).status, 401, "a junk token is nobody");
  await setVis(doc.id, "public");
  // bob is invited; he leaves a note
  await ctx.api(`/api/docs/${doc.id}/readers`, { username: "bobbeta" }, alice.token);
  const B = await ctx.conn();
  B.emit("doc-open", { auth: bob.token, id: doc.id });
  await ctx.wait(100);
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "bbbbbbbbbbbb", html: anchored("bbbbbbbbbbbb"), text: "nice" });
  await ctx.wait(200);
  assert.equal((await docOf(doc.id)).comments.length, 1, "the beta reader's note landed");

  const anon = await ctx.api("/api/docs/" + doc.id, null, null, "GET");
  assert.equal(anon.status, 200, "signed out, the write opens");
  assert.ok(anon.data.doc.html.includes("striped shirt"));
  assert.equal(anon.data.doc.mine, false);
  assert.equal(anon.data.doc.canComment, false);
  assert.deepEqual(anon.data.doc.comments, [], "comments never leave the server for a plain reader");
  assert.deepEqual(anon.data.doc.readerRows, [], "nor the reader roster");

  const carolSees = await ctx.api("/api/docs/" + doc.id, null, carol.token, "GET");
  assert.equal(carolSees.data.doc.canComment, false, "a signed-in stranger is a plain reader too");
  assert.deepEqual(carolSees.data.doc.comments, []);
  const bobSees = await ctx.api("/api/docs/" + doc.id, null, bob.token, "GET");
  assert.equal(bobSees.data.doc.canComment, true);
  assert.equal(bobSees.data.doc.comments.length, 1, "the beta reader still gets the thread");
  assert.equal((await docOf(doc.id)).canComment, true, "and so does the author");

  // every other doc route still wants an account
  assert.equal((await ctx.api("/api/docs/" + doc.id, { html: "<p>x</p>" }, null, "PUT")).status, 401);
  assert.equal((await ctx.api(`/api/docs/${doc.id}/visibility`, { visibility: "private" }, null)).status, 401);

  await setVis(doc.id, "private");
  assert.equal((await ctx.api("/api/docs/" + doc.id, null, null, "GET")).status, 401, "narrowing shuts the door");
});

test("a signed-out reader's socket gets the story's updates, and nobody but commenters gets the comments", async () => {
  const doc = await newDoc(alice.token, "Live Book");
  await ctx.api("/api/docs/" + doc.id, { html: BODY }, alice.token, "PUT");
  await setVis(doc.id, "public");
  await ctx.api(`/api/docs/${doc.id}/readers`, { username: "bobbeta" }, alice.token);
  const anon = await ctx.conn(), C = await ctx.conn(), B = await ctx.conn();
  const got = { anon: [], carol: [], bob: [] }, notes = { anon: 0, carol: 0, bob: 0 };
  anon.on("doc-updated", (p) => got.anon.push(p)); anon.on("doc-comments", () => notes.anon++);
  C.on("doc-updated", (p) => got.carol.push(p)); C.on("doc-comments", () => notes.carol++);
  B.on("doc-updated", (p) => got.bob.push(p)); B.on("doc-comments", () => notes.bob++);
  anon.emit("doc-open", { auth: null, id: doc.id });
  C.emit("doc-open", { auth: carol.token, id: doc.id });
  B.emit("doc-open", { auth: bob.token, id: doc.id });
  await ctx.wait(150);

  await ctx.api("/api/docs/" + doc.id, { html: "<p>a new line</p>" }, alice.token, "PUT");
  const A = await ctx.conn();
  A.emit("doc-saved", { auth: alice.token, id: doc.id }); // what the author's editor sends after a save
  await ctx.wait(200);
  assert.equal(got.anon.length, 1, "the signed-out reader sees the save land");
  assert.ok(got.anon[0].html.includes("a new line"));
  assert.equal(got.carol.length, 1);
  assert.equal(got.bob.length, 1);

  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "dddddddddddd", html: "<p>a new line</p>".replace("new line", 'new <span class="cmt" data-cid="dddddddddddd">line</span>'), text: "hm" });
  await ctx.wait(200);
  assert.equal((await docOf(doc.id)).comments.length, 1, "bob's note landed");
  assert.equal(notes.bob, 1, "the commenter gets the comment push");
  assert.equal(notes.carol, 0, "a signed-in plain reader does not");
  assert.equal(notes.anon, 0, "nor a signed-out one");

  // going private shuts the signed-out reader out too
  const lost = [];
  anon.on("doc-access-lost", (p) => lost.push(p));
  await setVis(doc.id, "private");
  await ctx.wait(150);
  assert.equal(lost.length, 1, "the anonymous seat is closed with the rest");
});

test("the reader theme: the author's pick, a whitelisted id, and a theme-only post leaves visibility alone", async () => {
  const doc = await newDoc(alice.token, "Themed");
  assert.equal((await docOf(doc.id)).theme, null, "nothing chosen yet");
  await setVis(doc.id, "public");
  const r = await ctx.api(`/api/docs/${doc.id}/visibility`, { theme: "vecna" }, alice.token);
  assert.equal(r.status, 200);
  assert.equal(r.data.doc.theme, "vecna");
  assert.equal(r.data.doc.visibility, "public", "a theme-only post does not narrow the write");
  const anon = await ctx.api("/api/docs/" + doc.id, null, null, "GET");
  assert.equal(anon.data.doc.theme, "vecna", "readers are told which theme to wear");
  assert.equal((await ctx.api(`/api/docs/${doc.id}/visibility`, { theme: "<script>" }, alice.token)).data.doc.theme, null, "junk is no theme");
  assert.equal((await ctx.api(`/api/docs/${doc.id}/visibility`, { visibility: "readers", theme: "neon" }, alice.token)).data.doc.visibility, "readers", "both together still work");
  assert.equal((await ctx.api(`/api/docs/${doc.id}/visibility`, { theme: "snowball" }, carol.token)).status, 403, "a reader can't restyle it");
  assert.equal((await docOf(doc.id)).theme, "neon");
});

test("going public hands out a reader, not a pen", async () => {
  const doc = await newDoc(alice.token, "No Pens");
  await ctx.api("/api/docs/" + doc.id, { html: BODY }, alice.token, "PUT");
  await setVis(doc.id, "public");

  // carol can read it, but she is not a beta reader
  const C = await ctx.conn();
  C.emit("doc-open", { auth: carol.token, id: doc.id });
  await ctx.wait(150);
  C.emit("doc-comment", { auth: carol.token, id: doc.id, cid: "cccccccccccc", html: anchored("cccccccccccc"), text: "hi" });
  await ctx.wait(200);
  const after = await docOf(doc.id);
  assert.equal(after.comments.length, 0, "a public reader cannot comment");
  assert.ok(!after.html.includes("data-cid"), "and cannot touch the html");

  // editing is refused too, as it always was
  const edit = await ctx.api("/api/docs/" + doc.id, { html: "<p>mine now</p>" }, carol.token, "PUT");
  assert.equal(edit.status, 403);
});

test("an unknown visibility narrows to private rather than guessing", async () => {
  const doc = await newDoc(alice.token, "Junk Vis");
  await setVis(doc.id, "public");
  const r = await setVis(doc.id, "everyone-on-earth");
  assert.equal(r.data.doc.visibility, "private", "the safe direction wins");
});

test("only the author sets visibility", async () => {
  const doc = await newDoc(alice.token, "Not Yours");
  await setVis(doc.id, "public");
  const r = await setVis(doc.id, "private", carol.token);
  assert.equal(r.status, 403);
  assert.equal((await docOf(doc.id)).visibility, "public", "a reader can't lock the author out either");
});

test("public writes are listed on the all-stories shelf, never on someone else's writes page", async () => {
  const doc = await newDoc(alice.token, "Shelf Test");
  await ctx.api("/api/docs/" + doc.id, { html: "<p>words words</p>" }, alice.token, "PUT");
  await setVis(doc.id, "public");

  const shelf = await ctx.api("/api/docs", null, carol.token, "GET");
  assert.ok(!shelf.data.docs.some((d) => d.id === doc.id), "a public write is not on everyone's personal shelf");

  const stories = await ctx.api("/api/stories?limit=50", null, carol.token, "GET");
  const row = stories.data.stories.find((x) => x.id === doc.id);
  assert.ok(row, "it IS in the library");
  assert.equal(row.kind, "write", "and says which kind it is");
  assert.equal(row.name, "Shelf Test");
  assert.equal(row.hostName, "aliceauthor");
  assert.equal(row.wordCount, 2);

  await setVis(doc.id, "readers");
  const gone = await ctx.api("/api/stories?limit=50", null, carol.token, "GET");
  assert.ok(!gone.data.stories.some((x) => x.id === doc.id), "reader-shared writes are not public");
});

test("the author's own shelf and the invited reader's still work as before", async () => {
  const doc = await newDoc(alice.token, "Shelf Rules");
  await ctx.api("/api/docs/" + doc.id + "/readers", { username: "bobbeta" }, alice.token);
  await setVis(doc.id, "readers");
  const mine = await ctx.api("/api/docs", null, alice.token, "GET");
  assert.ok(mine.data.docs.some((d) => d.id === doc.id && d.mine));
  const theirs = await ctx.api("/api/docs", null, bob.token, "GET");
  assert.ok(theirs.data.docs.some((d) => d.id === doc.id && !d.mine), "invited readers keep their shelf copy");
});

// ---- the reported bug: comments that never land ----
// Reported from the author's own seat: "comments and suggestions aren't
// saving or showing". The client sends the html AS IT SITS IN THE EDITOR, so
// the moment the author has typed anything since their last save, stripping
// the new anchor no longer equals the stored html — and the whole comment was
// dropped in silence. The author is allowed to edit their own document, so
// for them the html that arrives IS the document.

test("the author can comment while they have unsaved edits", async () => {
  const doc = await newDoc(alice.token, "Unsaved");
  await ctx.api("/api/docs/" + doc.id, { html: BODY }, alice.token, "PUT");
  const A = await ctx.conn();
  A.emit("doc-open", { auth: alice.token, id: doc.id });
  await ctx.wait(150);

  // what the editor holds: a fresh sentence AND the new anchor
  const edited = "<p>first</p><p>a new line typed just now</p><p>his " +
    '<span class="cmt" data-cid="dddddddddddd">striped shirt</span> hangs</p>';
  A.emit("doc-comment", { auth: alice.token, id: doc.id, cid: "dddddddddddd", html: edited, text: "does this land?" });
  await ctx.wait(250);

  const after = await docOf(doc.id);
  assert.equal(after.comments.length, 1, "the comment saved");
  assert.equal(after.comments[0].text, "does this land?");
  assert.equal(after.comments[0].quote, "striped shirt", "and knows the words it is about");
  assert.ok(after.html.includes('data-cid="dddddddddddd"'), "the underline is in the html");
  assert.ok(after.html.includes("typed just now"), "the author's own edit came with it");
});

test("the author's comment comes straight back to them, so the pane can render it", async () => {
  const doc = await newDoc(alice.token, "Echo");
  await ctx.api("/api/docs/" + doc.id, { html: BODY }, alice.token, "PUT");
  const A = await ctx.conn();
  const seen = [];
  A.on("doc-comments", (p) => seen.push(p));
  A.emit("doc-open", { auth: alice.token, id: doc.id });
  await ctx.wait(150);
  A.emit("doc-comment", { auth: alice.token, id: doc.id, cid: "eeeeeeeeeeee", html: anchored("eeeeeeeeeeee"), text: "mine" });
  await ctx.wait(250);

  const last = seen[seen.length - 1];
  assert.ok(last, "the commenter is told about their own comment");
  assert.equal(last.id, doc.id);
  assert.equal(last.comments.length, 1);
  assert.equal(last.comments[0].text, "mine");
  assert.equal(last.comments[0].author, "aliceauthor");
});

test("an author's suggestion on their own words saves like any other comment", async () => {
  const doc = await newDoc(alice.token, "Self Suggest");
  await ctx.api("/api/docs/" + doc.id, { html: BODY }, alice.token, "PUT");
  const A = await ctx.conn();
  A.emit("doc-open", { auth: alice.token, id: doc.id });
  await ctx.wait(150);
  A.emit("doc-comment", {
    auth: alice.token, id: doc.id, cid: "ffffffffffff", html: anchored("ffffffffffff"),
    text: "", suggestion: "faded denim jacket",
  });
  await ctx.wait(250);
  const after = await docOf(doc.id);
  assert.equal(after.comments.length, 1);
  assert.equal(after.comments[0].suggestion, "faded denim jacket");
});

test("a beta reader's comment lands while the author has unsaved work, without taking the author's edit", async () => {
  const doc = await commentableDoc();
  const B = await ctx.conn();
  B.emit("doc-open", { auth: bob.token, id: doc.id });
  await ctx.wait(150);
  // bob's copy is the SAVED html plus his anchor — that must still be the only
  // thing a non-author is ever allowed to change
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "abababababab", html: anchored("abababababab"), text: "lovely" });
  await ctx.wait(250);
  let after = await docOf(doc.id);
  assert.equal(after.comments.length, 1, "a legitimate reader comment still lands");

  const sneaky = anchored("bcbcbcbcbcbc").replace("first", "BOB WAS HERE");
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "bcbcbcbcbcbc", html: sneaky, text: "and an edit" });
  await ctx.wait(250);
  after = await docOf(doc.id);
  assert.equal(after.comments.length, 1, "the smuggled edit is still refused whole");
  assert.ok(!after.html.includes("BOB WAS HERE"));
});

// ---- an anchor with no live comment is not a legal state ----
// Reported from the HTML view: resolve or delete a comment, hit undo, save —
// and the <span class="cmt" data-cid="…"> was still sitting in the document.
// The author's editor is the one place that can reintroduce one (their undo
// stack remembers it, and a dirty editor ignores the server's html push), so
// the write path itself has to be the guarantee.

const anchorsIn = (html) => (html.match(/data-cid="[0-9a-f]{12}"/g) || []).length;

test("saving strips an anchor whose comment no longer exists", async () => {
  const doc = await newDoc(alice.token, "Orphan Anchor");
  const html = '<p>his <span class="cmt" data-cid="0f0f0f0f0f0f">striped shirt</span> hangs</p>';
  const saved = await ctx.api("/api/docs/" + doc.id, { html }, alice.token, "PUT");
  assert.equal(saved.status, 200);
  assert.equal(anchorsIn(saved.data.doc.html), 0, "no comment, no anchor");
  assert.ok(saved.data.doc.html.includes("striped shirt"), "the words stay, only the marker goes");
  assert.equal((await docOf(doc.id)).html.includes("data-cid"), false, "and it's gone from the stored data too");
});

test("a live comment's anchor survives the same save", async () => {
  const doc = await commentableDoc();
  const B = await ctx.conn();
  B.emit("doc-open", { auth: bob.token, id: doc.id });
  await ctx.wait(150);
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "1a1a1a1a1a1a", html: anchored("1a1a1a1a1a1a"), text: "keep me" });
  await ctx.wait(250);

  const withAnchor = (await docOf(doc.id)).html;
  assert.equal(anchorsIn(withAnchor), 1);
  const saved = await ctx.api("/api/docs/" + doc.id, { html: withAnchor }, alice.token, "PUT");
  assert.equal(anchorsIn(saved.data.doc.html), 1, "an anchor with a live comment is left alone");
});

test("resolving, then undoing and saving, does not put the underline back", async () => {
  const doc = await commentableDoc();
  const B = await ctx.conn();
  B.emit("doc-open", { auth: bob.token, id: doc.id });
  await ctx.wait(150);
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "2b2b2b2b2b2b", html: anchored("2b2b2b2b2b2b"), text: "resolve me" });
  await ctx.wait(250);
  const c = (await docOf(doc.id)).comments[0];

  const A = await ctx.conn();
  A.emit("doc-open", { auth: alice.token, id: doc.id });
  await ctx.wait(150);
  A.emit("doc-comment-resolve", { auth: alice.token, id: doc.id, commentId: c.id, resolved: true });
  await ctx.wait(250);
  assert.equal(anchorsIn((await docOf(doc.id)).html), 0, "resolving takes the underline");

  // the author's undo brings the anchor back into THEIR editor, and they save
  const undone = await ctx.api("/api/docs/" + doc.id, { html: anchored("2b2b2b2b2b2b") }, alice.token, "PUT");
  assert.equal(anchorsIn(undone.data.doc.html), 0, "a resolved comment's anchor cannot come back");
  assert.ok(undone.data.doc.html.includes("striped shirt"), "the words are untouched");
});

test("deleting, then undoing and saving, does not put the underline back", async () => {
  const doc = await commentableDoc();
  const B = await ctx.conn();
  B.emit("doc-open", { auth: bob.token, id: doc.id });
  await ctx.wait(150);
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "3c3c3c3c3c3c", html: anchored("3c3c3c3c3c3c"), text: "delete me" });
  await ctx.wait(250);
  const c = (await docOf(doc.id)).comments[0];

  B.emit("doc-comment-delete", { auth: bob.token, id: doc.id, commentId: c.id });
  await ctx.wait(250);
  const after = await docOf(doc.id);
  assert.equal(after.comments.length, 0);
  assert.equal(anchorsIn(after.html), 0);

  const undone = await ctx.api("/api/docs/" + doc.id, { html: anchored("3c3c3c3c3c3c") }, alice.token, "PUT");
  assert.equal(anchorsIn(undone.data.doc.html), 0, "a deleted comment's anchor cannot come back");
});

test("pruning an orphan anchor leaves the formatting around it alone", async () => {
  // the shape from the report: a size span wrapping the comment anchor
  const doc = await newDoc(alice.token, "Nested Orphan");
  const html = '<p><span class="fs-12"><span class="cmt" data-cid="4d4d4d4d4d4d">The bedroom threshold</span> feels like a boundary</span></p>';
  const saved = await ctx.api("/api/docs/" + doc.id, { html }, alice.token, "PUT");
  assert.equal(anchorsIn(saved.data.doc.html), 0, "the marker goes");
  assert.ok(saved.data.doc.html.includes('<span class="fs-12">'), "the size span stays");
  assert.ok(saved.data.doc.html.includes("The bedroom threshold feels like a boundary"), "and so does every word");
});

test("a resolved comment keeps its record, it just stops underlining", async () => {
  const doc = await commentableDoc();
  const B = await ctx.conn();
  B.emit("doc-open", { auth: bob.token, id: doc.id });
  await ctx.wait(150);
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "5e5e5e5e5e5e", html: anchored("5e5e5e5e5e5e"), text: "still here" });
  await ctx.wait(250);
  const c = (await docOf(doc.id)).comments[0];
  B.emit("doc-comment-resolve", { auth: bob.token, id: doc.id, commentId: c.id, resolved: true });
  await ctx.wait(250);

  const after = await docOf(doc.id);
  assert.equal(after.comments.length, 1, "the note itself is not deleted");
  assert.equal(after.comments[0].resolved, true);
  assert.equal(anchorsIn(after.html), 0, "but nothing is underlined for it");
});

test("a writer's solo writes are LISTED on their profile and /stories?user=, private ones included, and `viewable` says who may open them", async () => {
  const priv = await newDoc(alice.token, "Alice private");
  const pub = await newDoc(alice.token, "Alice public");
  await ctx.api("/api/docs/" + pub.id + "/visibility", { visibility: "public" }, alice.token);
  const shared = await newDoc(alice.token, "Alice for Bob");
  await ctx.api("/api/docs/" + shared.id + "/visibility", { visibility: "readers" }, alice.token);
  await ctx.api("/api/docs/" + shared.id + "/readers", { username: "bobbeta" }, alice.token);

  // Carol (a stranger) sees all three listed; only the public one opens
  const carolView = await ctx.api("/api/users/aliceauthor", null, carol.token, "GET");
  const byTitle = (list) => Object.fromEntries(list.map((d) => [d.title, d]));
  const cw = byTitle(carolView.data.writes);
  assert.equal(Object.keys(cw).length >= 3, true);
  assert.equal(cw["Alice private"].viewable, false);
  assert.equal(cw["Alice private"].mine, false);
  assert.equal(cw["Alice public"].viewable, true);
  assert.equal(cw["Alice for Bob"].viewable, false, "readers-only isn't Carol's to open");
  assert.equal(cw["Alice private"].visibility, "private");
  assert.ok(!("html" in cw["Alice private"]), "a listing never carries the body");
  // Bob (a beta reader) may open the shared one
  const bobView = await ctx.api("/api/users/aliceauthor", null, bob.token, "GET");
  assert.equal(byTitle(bobView.data.writes)["Alice for Bob"].viewable, true);
  // Alice herself: everything is hers
  const me = await ctx.api("/api/users/aliceauthor", null, alice.token, "GET");
  assert.ok(me.data.writes.every((d) => d.mine && d.viewable));

  // the library at large lists only the public one; ?user= lists all of Alice's with the same flags
  const lib = await ctx.api("/api/stories?limit=50", null, carol.token, "GET");
  const libTitles = lib.data.stories.filter((s) => s.kind === "write").map((s) => s.name);
  assert.ok(libTitles.includes("Alice public"));
  assert.ok(!libTitles.includes("Alice private"));
  const hers = await ctx.api("/api/stories?user=aliceauthor&limit=50", null, carol.token, "GET");
  const hw = byTitle(hers.data.stories.filter((s) => s.kind === "write").map((s) => ({ ...s, title: s.name })));
  assert.equal(hw["Alice private"].viewable, false);
  assert.equal(hw["Alice public"].viewable, true);
  assert.equal(hw["Alice for Bob"].visibility, "readers");
});

// ---- sprints ----
test("a sprint logs its words on the account and the document; only the author can sprint", async () => {
  const doc = await newDoc(alice.token, "Sprint draft");
  const r = await ctx.api(`/api/docs/${doc.id}/sprint`, { words: 137, seconds: 600 }, alice.token);
  assert.equal(r.status, 200);
  assert.equal(r.data.sprint.words, 137);
  assert.equal(r.data.sprint.title, "Sprint draft");
  assert.equal(r.data.doc.sprintWords, 137);
  // negative deltas (words deleted) log as zero, never a debt
  await ctx.api(`/api/docs/${doc.id}/sprint`, { words: -40, seconds: 30 }, alice.token);
  const prof = await ctx.api("/api/users/aliceauthor", null, alice.token, "GET");
  assert.equal(prof.data.user.sprintWords, 137);
  assert.equal(prof.data.user.sprintCount, 2);
  assert.equal(prof.data.sprints[0].words, 0, "newest first");
  assert.equal(prof.data.sprints[1].docId, doc.id, "and each names its project");
  const w = prof.data.writes.find((d) => d.id === doc.id);
  assert.equal(w.sprintWords, 137);
  assert.equal(w.sprints, 2);
  // a beta reader can't sprint in someone else's document
  await ctx.api(`/api/docs/${doc.id}/readers`, { username: "bobbeta" }, alice.token);
  assert.equal((await ctx.api(`/api/docs/${doc.id}/sprint`, { words: 5, seconds: 5 }, bob.token)).status, 403);
  assert.equal((await ctx.api(`/api/docs/${doc.id}/sprint`, { words: 5, seconds: 5 })).status, 401);
});

test("solo writes count: words an author adds credit the account once (a high-water mark, so cutting and rewriting never double-counts)", async () => {
  const w = await signup(ctx, "solowords", "solowords@x.com");
  const doc = await newDoc(w.token, "Counted");
  const me0 = (await ctx.api("/api/me", undefined, w.token)).data.user.wordCount;
  const put = (html) => ctx.api("/api/docs/" + doc.id, { html }, w.token, "PUT");
  let r = await put("<p>one two three four five</p>");
  assert.equal(r.status, 200);
  assert.equal(r.data.wordCount, me0 + 5);
  r = await put("<p>one two</p>"); // cut three words: nothing to credit, nothing taken away
  assert.equal(r.data.wordCount, me0 + 5);
  r = await put("<p>one two three four five six</p>"); // back up past the mark by one
  assert.equal(r.data.wordCount, me0 + 6);
  assert.equal((await ctx.api("/api/me", undefined, w.token)).data.user.wordCount, me0 + 6);
});

test("a beta reader can comment multiple times and every comment sticks (cumulative anchors)", async () => {
  const doc = await commentableDoc();
  const B = await ctx.conn();
  B.emit("doc-open", { auth: bob.token, id: doc.id });
  await ctx.wait(150);
  // The real client keeps each anchor it adds in its editor, so the next
  // comment's html carries the anchors from the earlier ones too.
  const wrap = (html, cid, word) => html.replace(word, `<span class="cmt" data-cid="${cid}">${word}</span>`);
  let html = BODY;
  html = wrap(html, "a1a1a1a1a1a1", "striped");
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "a1a1a1a1a1a1", html, text: "note 1" });
  await ctx.wait(150);
  html = wrap(html, "b2b2b2b2b2b2", "shirt");
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "b2b2b2b2b2b2", html, text: "note 2" });
  await ctx.wait(150);
  html = wrap(html, "c3c3c3c3c3c3", "hangs");
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "c3c3c3c3c3c3", html, text: "note 3" });
  await ctx.wait(200);

  const after = await docOf(doc.id);
  const texts = after.comments.map((c) => c.text).sort();
  assert.deepEqual(texts, ["note 1", "note 2", "note 3"], "all three comments are kept");
  for (const cid of ["a1a1a1a1a1a1", "b2b2b2b2b2b2", "c3c3c3c3c3c3"])
    assert.ok(after.html.includes(`data-cid="${cid}"`), `anchor ${cid} survives in the html`);
  assert.ok(after.comments.every((c) => !c.orphaned), "no comment is orphaned");
});

test("a beta reader commenting several times: each comment re-syncs from the server, all stick", async () => {
  const doc = await commentableDoc();
  const B = await ctx.conn();
  B.emit("doc-open", { auth: bob.token, id: doc.id });
  // the client tracks the canonical html the server pushes back
  let base = BODY;
  B.on("doc-html", ({ html }) => { base = html; });
  await ctx.wait(150);
  const wrap = (html, cid, word) => html.replace(word, `<span class="cmt" data-cid="${cid}">${word}</span>`);
  const plan = [["a1a1a1a1a1a1", "striped", "note 1"], ["b2b2b2b2b2b2", "shirt", "note 2"], ["c3c3c3c3c3c3", "hangs", "note 3"]];
  for (const [cid, word, text] of plan) {
    B.emit("doc-comment", { auth: bob.token, id: doc.id, cid, html: wrap(base, cid, word), text });
    await ctx.wait(150);
  }
  await ctx.wait(150);
  const after = await docOf(doc.id);
  assert.deepEqual(after.comments.map((c) => c.text).sort(), ["note 1", "note 2", "note 3"]);
  assert.ok(after.comments.every((c) => !c.orphaned), "no comment is orphaned");
  for (const cid of ["a1a1a1a1a1a1", "b2b2b2b2b2b2", "c3c3c3c3c3c3"])
    assert.ok(after.html.includes(`data-cid="${cid}"`));
});

test("assigning a beta reader auto-promotes a private doc to 'readers'; a public doc is left public", async () => {
  const priv = await newDoc(alice.token, "Private one");
  assert.equal((await docOf(priv.id)).visibility, "private");
  const r = await ctx.api("/api/docs/" + priv.id + "/readers", { username: "bobbeta" }, alice.token);
  assert.equal(r.data.doc.visibility, "readers");
  assert.equal((await ctx.api("/api/docs/" + priv.id, null, bob.token, "GET")).status, 200, "the reader can open it immediately");

  const pub = await newDoc(alice.token, "Public one");
  await ctx.api("/api/docs/" + pub.id + "/visibility", { visibility: "public" }, alice.token);
  const r2 = await ctx.api("/api/docs/" + pub.id + "/readers", { username: "bobbeta" }, alice.token);
  assert.equal(r2.data.doc.visibility, "public", "a public doc stays public");
});

test("/api/docs marks a beta-read doc viewable so it opens from the dashboard, not just the profile", async () => {
  const doc = await newDoc(alice.token, "Chapter 11");
  await ctx.api("/api/docs/" + doc.id, { html: "<p>words</p>" }, alice.token, "PUT");
  await ctx.api("/api/docs/" + doc.id + "/readers", { username: "bobbeta" }, alice.token); // auto-promotes to readers
  const list = await ctx.api("/api/docs", null, bob.token, "GET");
  const row = list.data.docs.find((d) => d.id === doc.id);
  assert.ok(row, "the beta read is on bob's shelf");
  assert.equal(row.mine, false);
  assert.equal(row.viewable, true, "and it's marked viewable so the Read link appears");
});

test("a writer can delete their own sprint: words roll back off the account and the document; needs auth and a real one", async () => {
  const base = (await ctx.api("/api/users/aliceauthor", null, alice.token, "GET")).data.user.sprintWords || 0;
  const doc = await newDoc(alice.token, "Deletable sprint");
  const a = await ctx.api(`/api/docs/${doc.id}/sprint`, { words: 100, seconds: 300 }, alice.token);
  const b = await ctx.api(`/api/docs/${doc.id}/sprint`, { words: 40, seconds: 120 }, alice.token);
  const atA = a.data.sprint.at, atB = b.data.sprint.at;

  // anonymous can't delete; a missing timestamp is a 404
  assert.equal((await ctx.api(`/api/account/sprints/${atA}`, null, undefined, "DELETE")).status, 401);
  assert.equal((await ctx.api(`/api/account/sprints/999`, null, alice.token, "DELETE")).status, 404);

  // delete the 100-word sprint; the account rolls back exactly 100
  const del = await ctx.api(`/api/account/sprints/${atA}`, null, alice.token, "DELETE");
  assert.equal(del.status, 200);
  assert.equal(del.data.sprintWords, base + 40, "100 of the 140 just added rolled off");

  const prof = await ctx.api("/api/users/aliceauthor", null, alice.token, "GET");
  assert.equal(prof.data.user.sprintWords, base + 40, "account total rolled back");
  assert.ok(!prof.data.sprints.some((s) => s.at === atA), "the deleted sprint is gone");
  assert.ok(prof.data.sprints.some((s) => s.at === atB), "the other one remains");
  const w = prof.data.writes.find((d) => d.id === doc.id);
  assert.equal(w.sprintWords, 40, "the document total rolled back too");
  assert.equal(w.sprints, 1);
});

test("one writer cannot delete another writer's sprint", async () => {
  const doc = await newDoc(alice.token, "Mine to sprint");
  const a = await ctx.api(`/api/docs/${doc.id}/sprint`, { words: 55, seconds: 60 }, alice.token);
  // bob has no sprint with that timestamp, so it's a 404 for him — alice's stays
  assert.equal((await ctx.api(`/api/account/sprints/${a.data.sprint.at}`, null, bob.token, "DELETE")).status, 404);
  const prof = await ctx.api("/api/users/aliceauthor", null, alice.token, "GET");
  assert.ok(prof.data.sprints.some((s) => s.at === a.data.sprint.at), "alice's sprint is untouched");
});

test("a beta reader can comment on part of an italic run (the split <i> tag doesn't refuse the comment)", async () => {
  const doc = await newDoc(alice.token, "Italic fic");
  const ITAL = "<p>he said <i>we speak the way we breathe</i> softly</p>";
  await ctx.api("/api/docs/" + doc.id, { html: ITAL }, alice.token, "PUT");
  await ctx.api("/api/docs/" + doc.id + "/readers", { username: "bobbeta" }, alice.token);
  const stored = (await docOf(doc.id)).html;

  const B = await ctx.conn();
  B.emit("doc-open", { auth: bob.token, id: doc.id });
  await ctx.wait(150);
  // wrapping "the way" inside the italics splits the <i> the way a browser does
  const cid = "f0f0f0f0f0f0";
  const split = stored.replace(
    "<i>we speak the way we breathe</i>",
    `<i>we speak </i><span class="cmt" data-cid="${cid}"><i>the way</i></span><i> we breathe</i>`,
  );
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid, html: split, text: "love this line" });
  await ctx.wait(200);

  const after = await docOf(doc.id);
  assert.equal(after.comments.length, 1, "the comment on italic text is accepted");
  assert.equal(after.comments[0].text, "love this line");
  assert.ok(after.html.includes(`data-cid="${cid}"`), "the underline is saved");
  assert.equal(after.comments[0].orphaned, false);
});

// ---- chapters ----
// A document is a list of chapters; doc.html is their html joined with no
// marker, so a one-chapter document reads exactly as the old single blob did.
import { writeFileSync } from "node:fs";
import { join as joinPath } from "node:path";
import { ensureChapters, joinChapters, chapterOfCid, mapChapterHtml } from "../src/docs.js";

test("chapters: pure helpers — the join, the chapter of a cid, a map over every chapter", () => {
  const d = ensureChapters({ html: "<p>old</p>" });
  assert.equal(d.chapters.length, 1);
  assert.equal(d.chapters[0].title, "Chapter 1");
  assert.match(d.chapters[0].id, /^[0-9a-f]{12}$/);
  assert.equal(d.html, "<p>old</p>", "a legacy blob becomes one chapter holding its html");
  assert.equal(d.wordCount, 1);
  const two = ensureChapters({ chapters: [{ id: "bad id", title: "", html: "<p>a b</p>" }, { title: "Two", html: anchored("ee0000000000") }] });
  assert.equal(joinChapters(two), "<p>a b</p>" + anchored("ee0000000000"));
  assert.equal(two.chapters[0].title, "Chapter 1", "an empty title is numbered");
  assert.match(two.chapters[0].id, /^[0-9a-f]{12}$/, "a junk id is replaced");
  assert.equal(two.chapters[0].wordCount, 2);
  assert.equal(two.wordCount, 2 + 5, "the total is the sum");
  assert.equal(chapterOfCid(two, "ee0000000000"), two.chapters[1]);
  assert.equal(chapterOfCid(two, "ffffffffffff"), null);
  mapChapterHtml(two, (h) => stripAnchor(h, "ee0000000000"));
  assert.equal(two.chapters[1].html, BODY, "the map reaches the chapter that holds the anchor and leaves the other alone");
});

test("chapters: a new document has one; a pre-chapter blob on disk migrates on read and its html is never stored", async () => {
  const doc = await newDoc(alice.token, "Fresh");
  assert.equal(doc.chapters.length, 1);
  assert.equal(doc.chapters[0].title, "Chapter 1");
  assert.equal(doc.chapters[0].html, "");
  // a document written before chapters existed
  const id = "11111111-2222-4333-8444-555555555555";
  writeFileSync(joinPath(ctx.dataDir, "docs", id + ".json"), JSON.stringify({
    id, ownerId: doc.owner === "aliceauthor" ? (await ctx.api("/api/me", null, alice.token, "GET")).data.user.id : null,
    title: "Old", html: "<p>one two</p>", betaReaders: [], visibility: "private", comments: [], wordCount: 2, createdAt: 1, updatedAt: 1,
  }));
  const old = await docOf(id);
  assert.equal(old.chapters.length, 1);
  assert.equal(old.chapters[0].html, "<p>one two</p>");
  assert.equal(old.html, "<p>one two</p>", "the join is the old html, byte for byte");
  // the first read persists the chaptered shape, so the minted id is stable —
  // a reader's comment names the id they were shown, and a second read must
  // agree with it — without stamping the document as edited
  const migrated = JSON.parse((await import("node:fs")).readFileSync(joinPath(ctx.dataDir, "docs", id + ".json"), "utf-8"));
  assert.equal(migrated.chapters?.[0]?.id, old.chapters[0].id, "the upgrade is written back on first read");
  assert.equal(migrated.chapters[0].html, "<p>one two</p>");
  assert.ok(!("html" in migrated), "the derived join is not written even by the migration");
  assert.equal(migrated.updatedAt, 1, "a read-side migration is not an edit");
  const again = await docOf(id);
  assert.equal(again.chapters[0].id, old.chapters[0].id, "every later read carries the same chapter id");
  assert.equal(old.chapters, old.chapters, "listing counts one chapter");
  const list = await ctx.api("/api/docs", null, alice.token, "GET");
  assert.equal(list.data.docs.find((d) => d.id === id).chapters, 1);
  // saving persists the chapters, not the derived join
  await ctx.api("/api/docs/" + id, { chapters: [{ id: old.chapters[0].id, title: "One", html: "<p>one two</p>" }, { title: "Two", html: "<p>three</p>" }] }, alice.token, "PUT");
  const raw = JSON.parse((await import("node:fs")).readFileSync(joinPath(ctx.dataDir, "docs", id + ".json"), "utf-8"));
  assert.ok(!("html" in raw), "doc.html is derived, never written");
  assert.equal(raw.chapters.length, 2);
});

test("chapters: PUT keeps ids, mints new ones, sanitizes each, honours order, drops what's left out, refuses bad lists", async () => {
  const doc = await newDoc(alice.token, "Serial");
  const first = doc.chapters[0].id;
  let r = await ctx.api("/api/docs/" + doc.id, { chapters: [
    { id: first, title: "<b>Opening</b>", html: "<p>a b c</p><script>x</script>" },
    { title: "", html: "<p>d e</p>" },
    { id: "not-a-real-one", title: "Third", html: "<p>f</p>" },
  ] }, alice.token, "PUT");
  assert.equal(r.status, 200);
  const ch = r.data.doc.chapters;
  assert.equal(ch.length, 3);
  assert.equal(ch[0].id, first, "a known id keeps its chapter");
  assert.equal(ch[0].title, "Opening", "titles are plain text");
  assert.equal(ch[0].html, "<p>a b c</p>&lt;script&gt;x&lt;/script&gt;", "each chapter runs the document sanitizer");
  assert.equal(ch[1].title, "Chapter 2", "an empty title is numbered by position");
  assert.match(ch[2].id, /^[0-9a-f]{12}$/);
  assert.notEqual(ch[2].id, "not-a-real-one", "an unknown id is replaced");
  assert.deepEqual(ch.map((c) => c.wordCount), [4, 2, 1], "entities are decoded before counting, so the escaped script is ONE run of text");
  assert.equal(r.data.doc.wordCount, 7, "the document's count is the sum");
  assert.equal(r.data.doc.html, ch.map((c) => c.html).join(""));
  // reorder and drop the middle one
  r = await ctx.api("/api/docs/" + doc.id, { chapters: [{ id: ch[2].id, title: "Third", html: "<p>f</p>" }, { id: first, title: "Opening", html: "<p>a b c</p>" }] }, alice.token, "PUT");
  assert.deepEqual(r.data.doc.chapters.map((c) => c.id), [ch[2].id, first], "the array order is the new order; the omitted chapter is gone");
  // the legacy body shape only fits a single-chapter document
  assert.equal((await ctx.api("/api/docs/" + doc.id, { html: "<p>x</p>" }, alice.token, "PUT")).status, 400);
  assert.equal((await ctx.api("/api/docs/" + doc.id, { chapters: [] }, alice.token, "PUT")).status, 400);
  assert.equal((await ctx.api("/api/docs/" + doc.id, { chapters: Array.from({ length: 201 }, () => ({ html: "" })) }, alice.token, "PUT")).status, 400);
  // and the stories listing counts chapters as `lines`
  await ctx.api("/api/docs/" + doc.id + "/visibility", { visibility: "public" }, alice.token);
  const st = await ctx.api("/api/stories", null, bob.token, "GET");
  assert.equal(st.data.stories.find((s) => s.id === doc.id).lines, 2);
});

test("chapters: solo word credit is the sum over chapters, once", async () => {
  const before = (await ctx.api("/api/me", null, alice.token, "GET")).data.user.wordCount;
  const doc = await newDoc(alice.token, "Credit");
  await ctx.api("/api/docs/" + doc.id, { chapters: [{ id: doc.chapters[0].id, title: "1", html: "<p>one two three</p>" }, { title: "2", html: "<p>four five</p>" }] }, alice.token, "PUT");
  let me = (await ctx.api("/api/me", null, alice.token, "GET")).data.user;
  assert.equal(me.wordCount - before, 5);
  // moving words between chapters is not new words
  await ctx.api("/api/docs/" + doc.id, { chapters: [{ title: "1", html: "<p>one</p>" }, { title: "2", html: "<p>two three four five</p>" }] }, alice.token, "PUT");
  me = (await ctx.api("/api/me", null, alice.token, "GET")).data.user;
  assert.equal(me.wordCount - before, 5, "the high-water mark is the document total");
});

// A two-chapter document for the comment tests: chapter one is BODY, chapter
// two is a different paragraph.
const BODY2 = "<p>second chapter</p><p>the quarry at night</p>";
async function twoChapterDoc() {
  const doc = await newDoc(alice.token, "Two chapters");
  const r = await ctx.api("/api/docs/" + doc.id, { chapters: [{ id: doc.chapters[0].id, title: "One", html: BODY }, { title: "Two", html: BODY2 }] }, alice.token, "PUT");
  await ctx.api("/api/docs/" + doc.id + "/readers", { username: "bobbeta" }, alice.token);
  await ctx.api("/api/docs/" + doc.id + "/visibility", { visibility: "readers" }, alice.token);
  return r.data.doc;
}

test("chapters: a reader's comment lands in the chapter it names, and the html push carries that chapter", async () => {
  const doc = await twoChapterDoc();
  const [c1, c2] = doc.chapters;
  const B = await ctx.conn();
  const pushes = [];
  B.on("doc-html", (p) => pushes.push(p));
  B.emit("doc-open", { auth: bob.token, id: doc.id });
  await ctx.wait(150);
  const inner = "quarry at night";
  const html2 = BODY2.replace(inner, `<span class="cmt" data-cid="a2a2a2a2a2a2">${inner}</span>`);
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "a2a2a2a2a2a2", chapterId: c2.id, html: html2, text: "moody" });
  await ctx.wait(200);
  const after = await docOf(doc.id);
  assert.equal(after.comments.length, 1);
  assert.equal(after.comments[0].chapterId, c2.id, "the comment knows its chapter");
  assert.equal(after.comments[0].quote, inner);
  assert.equal(after.chapters[0].html, BODY, "chapter one is untouched");
  assert.ok(after.chapters[1].html.includes('data-cid="a2a2a2a2a2a2"'));
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].chapterId, c2.id, "doc-html names the chapter");
  assert.equal(pushes[0].html, after.chapters[1].html);
  assert.equal(pushes[0].chapterWordCount, 6);
  assert.equal(pushes[0].wordCount, after.wordCount);

  // a multi-chapter document refuses a comment that names no chapter
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "b2b2b2b2b2b2", html: anchored("b2b2b2b2b2b2"), text: "which chapter?" });
  // chapter one's html under chapter two's id — the baseline doesn't match
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "c2c2c2c2c2c2", chapterId: c2.id, html: anchored("c2c2c2c2c2c2"), text: "wrong chapter" });
  // a cid already used in chapter two can't be reused in chapter one
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "a2a2a2a2a2a2", chapterId: c1.id, html: anchored("a2a2a2a2a2a2"), text: "reused" });
  await ctx.wait(200);
  assert.equal((await docOf(doc.id)).comments.length, 1, "none of the three landed");

  // a comment in chapter one does, and it names chapter one
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "d1d1d1d1d1d1", chapterId: c1.id, html: anchored("d1d1d1d1d1d1"), text: "shirt" });
  await ctx.wait(200);
  const both = await docOf(doc.id);
  assert.deepEqual(both.comments.map((c) => c.chapterId).sort(), [c1.id, c2.id].sort());
});

test("chapters: accepting a suggestion rewrites only its chapter; a dropped chapter orphans its comments; doc-updated carries chapters", async () => {
  const doc = await twoChapterDoc();
  const [c1, c2] = doc.chapters;
  const B = await ctx.conn(), A = await ctx.conn();
  B.emit("doc-open", { auth: bob.token, id: doc.id });
  A.emit("doc-open", { auth: alice.token, id: doc.id });
  await ctx.wait(150);
  const inner = "quarry at night";
  const html2 = BODY2.replace(inner, `<span class="cmt" data-cid="e2e2e2e2e2e2">${inner}</span>`);
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "e2e2e2e2e2e2", chapterId: c2.id, html: html2, text: "", suggestion: "quarry at dawn" });
  await ctx.wait(200);
  const commentId = (await docOf(doc.id)).comments[0].id;
  const pushes = [];
  B.on("doc-html", (p) => pushes.push(p));
  A.emit("doc-comment-decide", { auth: alice.token, id: doc.id, commentId, accept: true });
  await ctx.wait(200);
  const after = await docOf(doc.id);
  assert.equal(after.chapters[1].html, "<p>second chapter</p><p>the quarry at dawn</p>");
  assert.equal(after.chapters[0].html, BODY);
  assert.equal(pushes[0]?.chapterId, c2.id, "the reader is pushed the chapter that changed");

  // a comment in chapter one, then chapter one is dropped by the author
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "f1f1f1f1f1f1", chapterId: c1.id, html: anchored("f1f1f1f1f1f1"), text: "shirt" });
  await ctx.wait(200);
  const updates = [];
  B.on("doc-updated", (p) => updates.push(p));
  await ctx.api("/api/docs/" + doc.id, { chapters: [{ id: c2.id, title: "Two", html: after.chapters[1].html }] }, alice.token, "PUT");
  A.emit("doc-saved", { auth: alice.token, id: doc.id });
  await ctx.wait(200);
  const gone = await docOf(doc.id);
  const orphan = gone.comments.find((c) => c.cid === "f1f1f1f1f1f1");
  assert.equal(orphan.orphaned, true, "its words left with the chapter");
  assert.equal(orphan.chapterId, null);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].chapters.map((c) => c.id), [c2.id], "readers receive the chapter list");
  assert.equal(updates[0].chapters[0].wordCount, 6);
});

// ---- comments, chapter by chapter ----
// Every comment action names, changes and pushes ONE chapter: the one holding
// its anchor. The other chapters' html must come through byte-identical.
const B2 = (cid, inner = "quarry at night") => BODY2.replace(inner, `<span class="cmt" data-cid="${cid}">${inner}</span>`);
const opened = async (token, id) => {
  const s = await ctx.conn();
  s.pushes = []; s.boards = []; s.updates = [];
  s.on("doc-html", (p) => s.pushes.push(p));
  s.on("doc-comments", (p) => s.boards.push(p.comments));
  s.on("doc-updated", (p) => s.updates.push(p));
  s.emit("doc-open", { auth: token, id });
  await ctx.wait(120);
  return s;
};
const last = (a) => a[a.length - 1];

test("chapters: the author's own note in chapter two, with unsaved edits in that chapter, lands there and only the reader is pushed", async () => {
  const doc = await twoChapterDoc();
  const [c1, c2] = doc.chapters;
  const A = await opened(alice.token, doc.id), B = await opened(bob.token, doc.id);
  // the author has typed since the last save — no byte match applies to them
  const dirty = "<p>second chapter, revised</p><p>the quarry at night</p>";
  A.emit("doc-comment", { auth: alice.token, id: doc.id, cid: "aa0000000002", chapterId: c2.id, html: dirty.replace("quarry", '<span class="cmt" data-cid="aa0000000002">quarry</span>'), text: "tighten this" });
  await ctx.wait(200);
  const d = await docOf(doc.id);
  assert.equal(d.comments.length, 1);
  assert.equal(d.comments[0].chapterId, c2.id);
  assert.equal(d.comments[0].isAuthor, true, "the author's note reads as their own");
  assert.equal(d.comments[0].quote, "quarry");
  assert.ok(d.chapters[1].html.startsWith("<p>second chapter, revised</p>"), "the author's edit came along with the anchor");
  assert.equal(d.chapters[0].html, BODY, "chapter one untouched");
  assert.equal(A.pushes.length, 0, "the author is never pushed their own html (a re-render would move their caret)");
  assert.equal(B.pushes.length, 1);
  assert.equal(B.pushes[0].chapterId, c2.id);
  assert.ok(last(A.boards).some((c) => c.chapterId === c2.id), "the board comes straight back to the author, chapter named");
  assert.ok(last(B.boards).some((c) => c.chapterId === c2.id));
});

test("chapters: a reader's rewrite in chapter one is rejected — the underline goes from chapter one alone, chapter two's anchor stands", async () => {
  const doc = await twoChapterDoc();
  const [c1, c2] = doc.chapters;
  const A = await opened(alice.token, doc.id), B = await opened(bob.token, doc.id);
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "bb0000000002", chapterId: c2.id, html: B2("bb0000000002"), text: "keep" });
  await ctx.wait(150);
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "bb0000000001", chapterId: c1.id, html: anchored("bb0000000001"), text: "", suggestion: "plaid shirt" });
  await ctx.wait(200);
  let d = await docOf(doc.id);
  const rewrite = d.comments.find((c) => c.cid === "bb0000000001");
  assert.equal(rewrite.suggestion, "plaid shirt");
  assert.equal(rewrite.chapterId, c1.id);
  assert.equal(d.chapters[0].html, anchored("bb0000000001"));
  assert.equal(d.chapters[1].html, B2("bb0000000002"));
  const before = B.pushes.length;
  A.emit("doc-comment-decide", { auth: alice.token, id: doc.id, commentId: rewrite.id, accept: false });
  await ctx.wait(200);
  d = await docOf(doc.id);
  assert.equal(d.chapters[0].html, BODY, "rejected: the words stand, the underline goes");
  assert.equal(d.chapters[1].html, B2("bb0000000002"), "chapter two's anchor is untouched");
  const r = d.comments.find((c) => c.id === rewrite.id);
  assert.equal(r.resolved, true); assert.equal(r.accepted, false);
  assert.equal(r.chapterId, null, "with its anchor gone it belongs to no chapter");
  assert.equal(r.orphaned, true, "on the wire, no anchor = orphaned; the rail only calls an UNRESOLVED one an orphan");
  assert.equal(B.pushes.length, before + 1);
  assert.equal(last(B.pushes).chapterId, c1.id, "the push names the chapter that changed");
  assert.equal(last(B.pushes).html, BODY);
  assert.equal(last(B.boards).find((c) => c.cid === "bb0000000002").chapterId, c2.id, "the kept comment still knows its chapter");
  // the reader cannot decide their own rewrite
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "bb0000000003", chapterId: c1.id, html: anchored("bb0000000003", "hangs"), text: "", suggestion: "hung" });
  await ctx.wait(150);
  const own = (await docOf(doc.id)).comments.find((c) => c.cid === "bb0000000003");
  B.emit("doc-comment-decide", { auth: bob.token, id: doc.id, commentId: own.id, accept: true });
  await ctx.wait(150);
  assert.equal((await docOf(doc.id)).chapters[0].html, anchored("bb0000000003", "hangs"), "nothing changed");
});

test("chapters: resolving strips one chapter's anchor and pushes that chapter; deleting does the same in the other; the rest of the board is untouched", async () => {
  const doc = await twoChapterDoc();
  const [c1, c2] = doc.chapters;
  const A = await opened(alice.token, doc.id), B = await opened(bob.token, doc.id);
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "cc0000000001", chapterId: c1.id, html: anchored("cc0000000001"), text: "one" });
  await ctx.wait(150);
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "cc0000000002", chapterId: c2.id, html: B2("cc0000000002"), text: "two" });
  await ctx.wait(150);
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "cc0000000003", chapterId: c2.id, html: B2("cc0000000002").replace("second chapter", '<span class="cmt" data-cid="cc0000000003">second chapter</span>'), text: "three" });
  await ctx.wait(200);
  let d = await docOf(doc.id);
  assert.deepEqual(d.comments.map((c) => c.chapterId), [c1.id, c2.id, c2.id]);
  const [one, two, three] = d.comments;
  // the author resolves "two" (chapter two)
  A.pushes.length = 0; B.pushes.length = 0;
  A.emit("doc-comment-resolve", { auth: alice.token, id: doc.id, commentId: two.id, resolved: true });
  await ctx.wait(200);
  d = await docOf(doc.id);
  assert.ok(!d.chapters[1].html.includes("cc0000000002"), "its underline is gone");
  assert.ok(d.chapters[1].html.includes("cc0000000003"), "the other chapter-two anchor stays");
  assert.equal(d.chapters[0].html, anchored("cc0000000001"), "chapter one untouched");
  assert.deepEqual([A.pushes.length, B.pushes.length], [1, 1], "a resolve pushes everyone (the decider too — nothing of theirs is unsaved)");
  assert.equal(A.pushes[0].chapterId, c2.id);
  assert.equal(A.pushes[0].chapterWordCount, 6);
  // the reader deletes their own "one" (chapter one)
  B.emit("doc-comment-delete", { auth: bob.token, id: doc.id, commentId: one.id });
  await ctx.wait(200);
  d = await docOf(doc.id);
  assert.equal(d.chapters[0].html, BODY);
  assert.deepEqual(d.comments.map((c) => c.cid), ["cc0000000002", "cc0000000003"]);
  assert.equal(last(B.pushes).chapterId, c1.id);
  assert.equal(last(B.pushes).html, BODY);
  // a resolved one can be unresolved; its anchor can't come back, so it reads orphaned
  A.emit("doc-comment-resolve", { auth: alice.token, id: doc.id, commentId: two.id, resolved: false });
  await ctx.wait(150);
  const re = (await docOf(doc.id)).comments.find((c) => c.id === two.id);
  assert.equal(re.resolved, false); assert.equal(re.orphaned, true); assert.equal(re.chapterId, null);
  // the stranger can do none of it
  const C = await ctx.conn();
  C.emit("doc-comment-delete", { auth: carol.token, id: doc.id, commentId: three.id });
  C.emit("doc-comment-resolve", { auth: carol.token, id: doc.id, commentId: three.id, resolved: true });
  await ctx.wait(150);
  const still = (await docOf(doc.id)).comments.find((c) => c.id === three.id);
  assert.ok(still && !still.resolved);
});

test("chapters: comments follow their chapter through a reorder, and a chapter added by the author takes comments as soon as it has an id", async () => {
  const doc = await twoChapterDoc();
  const [c1, c2] = doc.chapters;
  const B = await opened(bob.token, doc.id);
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "dd0000000001", chapterId: c1.id, html: anchored("dd0000000001"), text: "in one" });
  await ctx.wait(150);
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "dd0000000002", chapterId: c2.id, html: B2("dd0000000002"), text: "in two" });
  await ctx.wait(200);
  let d = await docOf(doc.id);
  // the author swaps the chapters and adds a third
  const r = await ctx.api("/api/docs/" + doc.id, { chapters: [
    { id: c2.id, title: "Two", html: d.chapters[1].html },
    { id: c1.id, title: "One", html: d.chapters[0].html },
    { title: "Three", html: "<p>a third chapter, new</p>" },
  ] }, alice.token, "PUT");
  assert.equal(r.status, 200);
  d = r.data.doc;
  assert.deepEqual(d.chapters.map((c) => c.title), ["Two", "One", "Three"]);
  const c3 = d.chapters[2];
  assert.match(c3.id, /^[0-9a-f]{12}$/);
  const by = Object.fromEntries(d.comments.map((c) => [c.cid, c.chapterId]));
  assert.equal(by.dd0000000001, c1.id, "the comment moved with its chapter, not its position");
  assert.equal(by.dd0000000002, c2.id);
  assert.ok(d.comments.every((c) => !c.orphaned));
  assert.equal(d.chapters[0].html, B2("dd0000000002"), "anchors survive the reorder");
  // the reader can comment in the new chapter now that it has an id
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "dd0000000003", chapterId: c3.id, html: '<p>a third chapter, <span class="cmt" data-cid="dd0000000003">new</span></p>', text: "in three" });
  await ctx.wait(200);
  d = await docOf(doc.id);
  assert.equal(d.comments.find((c) => c.cid === "dd0000000003").chapterId, c3.id);
  assert.equal(last(B.pushes).chapterId, c3.id);
  // but never under an id the document doesn't have
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "dd0000000004", chapterId: "0123456789ab", html: anchored("dd0000000004"), text: "nowhere" });
  await ctx.wait(150);
  assert.equal((await docOf(doc.id)).comments.length, 3);
});

test("chapters: a document written before chapters existed takes a reader's comment with or without a chapter id, and keeps taking them", async () => {
  const id = "22222222-3333-4444-8555-666666666666";
  const me = (await ctx.api("/api/me", null, alice.token, "GET")).data.user.id;
  const bobId = (await ctx.api("/api/me", null, bob.token, "GET")).data.user.id;
  writeFileSync(joinPath(ctx.dataDir, "docs", id + ".json"), JSON.stringify({
    id, ownerId: me, title: "Legacy", html: BODY, betaReaders: [bobId], visibility: "readers", comments: [], wordCount: 5, createdAt: 1, updatedAt: 1,
  }));
  // the reader loads it (the read migrates and persists the chapter id)…
  const seen = await docOf(id, bob.token);
  assert.equal(seen.chapters.length, 1);
  const chId = seen.chapters[0].id;
  const B = await opened(bob.token, id);
  // …and comments under the id they were shown
  B.emit("doc-comment", { auth: bob.token, id, cid: "ee0000000001", chapterId: chId, html: anchored("ee0000000001"), text: "old story, new note" });
  await ctx.wait(200);
  let d = await docOf(id);
  assert.equal(d.comments.length, 1, "the id from the read is the id the server holds");
  assert.equal(d.comments[0].chapterId, chId);
  // a client that never learned chapters sends none — the single chapter takes it
  B.emit("doc-comment", { auth: bob.token, id, cid: "ee0000000002", chapterId: null, html: anchored("ee0000000001").replace("hangs", '<span class="cmt" data-cid="ee0000000002">hangs</span>'), text: "still works" });
  await ctx.wait(200);
  d = await docOf(id);
  assert.equal(d.comments.length, 2);
  assert.ok(d.comments.every((c) => c.chapterId === chId));
  assert.equal(d.html, d.chapters[0].html, "one chapter: the join is the chapter");
  // the author's rewrite decision works on it like any other
  B.emit("doc-comment", { auth: bob.token, id, cid: "ee0000000003", chapterId: chId, html: d.chapters[0].html.replace("first", '<span class="cmt" data-cid="ee0000000003">first</span>'), text: "", suggestion: "First" });
  await ctx.wait(150);
  const sug = (await docOf(id)).comments.find((c) => c.cid === "ee0000000003");
  const A = await opened(alice.token, id);
  A.emit("doc-comment-decide", { auth: alice.token, id, commentId: sug.id, accept: true });
  await ctx.wait(200);
  d = await docOf(id);
  assert.ok(d.chapters[0].html.startsWith("<p>First</p>"), "accepted rewrite applied");
  assert.equal(last(B.pushes).chapterId, chId);
});

test("autosave conflict: a save naming a stale rev is refused with 409; one without a base overwrites", async () => {
  const doc = await newDoc(alice.token, "Two tabs");
  const first = await ctx.api("/api/docs/" + doc.id, { chapters: [{ title: "One", html: "<p>tab A</p>" }] }, alice.token, "PUT");
  assert.equal(first.status, 200);
  const seen = first.data.doc.rev;
  assert.equal(typeof seen, "number");
  // tab B saves after A last looked
  const b = await ctx.api("/api/docs/" + doc.id, { chapters: [{ title: "One", html: "<p>tab B</p>" }], baseRev: seen }, alice.token, "PUT");
  assert.equal(b.status, 200, "a base that matches the stored copy saves");
  assert.equal(b.data.doc.rev, seen + 1, "every save is one rev");
  // tab A's autosave, still holding the old rev, is refused
  const a = await ctx.api("/api/docs/" + doc.id, { chapters: [{ title: "One", html: "<p>tab A again</p>" }], baseRev: seen }, alice.token, "PUT");
  assert.equal(a.status, 409);
  assert.equal(a.data.conflict, true);
  assert.equal(a.data.rev, b.data.doc.rev, "the refusal names the current rev");
  const kept = await ctx.api("/api/docs/" + doc.id, null, alice.token, "GET");
  assert.equal(kept.data.doc.html, "<p>tab B</p>", "the refused save changed nothing");
  // a deliberate Save carries no base and wins
  const force = await ctx.api("/api/docs/" + doc.id, { chapters: [{ title: "One", html: "<p>tab A wins</p>" }] }, alice.token, "PUT");
  assert.equal(force.status, 200);
  assert.equal(force.data.doc.html, "<p>tab A wins</p>");
});

// ---- comments are not edits ----
// Reported from production: a beta reader commented while the author was
// writing, and the author's autosave was refused — "changed in another tab,
// reload to see it" — so new comments cost them their unsaved words. Nothing a
// reader (or the author's own sprint timer, or the share menu) does may stand
// between an author and their save.
test("a beta reader comments, replies, edits, resolves and deletes while the author is mid-sentence: the author's autosave is never refused", async () => {
  const doc = await commentableDoc();
  const base = (await docOf(doc.id)).rev;
  const B = await ctx.conn();
  B.emit("doc-open", { auth: bob.token, id: doc.id });
  await ctx.wait(150);
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "a1a1a1a1a1a1", html: anchored("a1a1a1a1a1a1"), text: "lovely" });
  await ctx.wait(200);
  let now = await docOf(doc.id);
  const c = now.comments[0];
  assert.deepEqual(c.pos, { chapterId: now.chapters[0].id, start: "firsthis ".length, text: "striped shirt", before: "firsthis ", after: " hangs" }, "the comment knows where its words sit");
  B.emit("doc-comment-reply", { auth: bob.token, id: doc.id, commentId: c.id, text: "and another thing" });
  await ctx.wait(150);
  B.emit("doc-comment-edit", { auth: bob.token, id: doc.id, commentId: c.id, text: "lovely!" });
  await ctx.wait(150);
  now = await docOf(doc.id);
  assert.equal(now.comments[0].text, "lovely!");
  assert.equal(now.comments[0].replies.length, 1);
  assert.equal(now.rev, base, "none of that was a save");

  // the author's editor merged the underline in place (placeAnchor) and kept typing
  const mine = "<p>first</p><p>a line bob never saw</p><p>his " + '<span class="cmt" data-cid="a1a1a1a1a1a1">striped shirt</span> hangs</p>';
  const saved = await ctx.api("/api/docs/" + doc.id, { chapters: [{ id: now.chapters[0].id, title: "One", html: mine }], baseRev: base }, alice.token, "PUT");
  assert.equal(saved.status, 200, "the autosave goes through");
  assert.ok(saved.data.doc.html.includes("a line bob never saw"));
  assert.equal(saved.data.doc.comments[0].orphaned, false, "and the comment is still pinned to its words");

  B.emit("doc-comment-resolve", { auth: bob.token, id: doc.id, commentId: c.id, resolved: true });
  await ctx.wait(150);
  B.emit("doc-comment-delete", { auth: bob.token, id: doc.id, commentId: c.id });
  await ctx.wait(150);
  const again = await ctx.api("/api/docs/" + doc.id, { chapters: [{ id: now.chapters[0].id, title: "One", html: mine + "<p>more</p>" }], baseRev: saved.data.doc.rev }, alice.token, "PUT");
  assert.equal(again.status, 200, "nor do a resolve and a delete refuse the next one");
  assert.equal(again.data.doc.comments.length, 0);
  assert.ok(!again.data.doc.html.includes("data-cid"), "the dead underline the author still held is pruned on the way in");
});

test("a sprint, an invitation and a visibility change don't refuse the author's next autosave either", async () => {
  const doc = await newDoc(alice.token, "Busy author");
  const first = await ctx.api("/api/docs/" + doc.id, { html: BODY }, alice.token, "PUT");
  const base = first.data.doc.rev;
  assert.equal((await ctx.api("/api/docs/" + doc.id + "/sprint", { words: 12, seconds: 60 }, alice.token)).status, 200);
  assert.equal((await ctx.api("/api/docs/" + doc.id + "/readers", { username: "bobbeta" }, alice.token)).status, 200);
  const save = await ctx.api("/api/docs/" + doc.id, { html: BODY + "<p>still typing</p>", baseRev: base }, alice.token, "PUT");
  assert.equal(save.status, 200);
});

test("the story's record holds no comments and the comment record holds no story", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const doc = await commentableDoc();
  const storyFile = join(ctx.dataDir, "docs", doc.id + ".json");
  const threadFile = join(ctx.dataDir, "comments", doc.id + ".json");
  assert.ok(!existsSync(threadFile), "no comments, no record");
  const B = await ctx.conn();
  B.emit("doc-open", { auth: bob.token, id: doc.id });
  await ctx.wait(150);
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "b2b2b2b2b2b2", html: anchored("b2b2b2b2b2b2"), text: "kept apart" });
  await ctx.wait(250);
  const story = JSON.parse(readFileSync(storyFile, "utf-8"));
  assert.ok(!("comments" in story));
  const before = story.updatedAt;
  const threads = JSON.parse(readFileSync(threadFile, "utf-8"));
  assert.equal(threads.docId, doc.id);
  assert.equal(threads.comments[0].text, "kept apart");
  assert.ok(!JSON.stringify(threads).includes("first</p>"), "not a word of prose");

  // a reply writes the comment record and nothing else
  B.emit("doc-comment-reply", { auth: bob.token, id: doc.id, commentId: threads.comments[0].id, text: "margin only" });
  await ctx.wait(200);
  assert.equal(JSON.parse(readFileSync(storyFile, "utf-8")).updatedAt, before, "the story's record was not even opened");
  assert.equal(JSON.parse(readFileSync(threadFile, "utf-8")).comments[0].replies.length, 1);

  // a stranger still can't write there, and deleting the story takes its threads
  const C = await ctx.conn();
  C.emit("doc-comment-reply", { auth: carol.token, id: doc.id, commentId: threads.comments[0].id, text: "let me in" });
  await ctx.wait(200);
  assert.equal(JSON.parse(readFileSync(threadFile, "utf-8")).comments[0].replies.length, 1, "a normal account with no invitation is refused");
  assert.equal((await ctx.api("/api/docs/" + doc.id, null, alice.token, "DELETE")).status, 200);
  assert.ok(!existsSync(storyFile) && !existsSync(threadFile));
});

// ---- the &amp;amp;amp; bug ----
// The editor sends EVERY chapter on every autosave, and the closed ones are
// the server's own stored html. Each save used to escape them again, growing
// `'` into `&amp;amp;…#39;` until the chapter hit DOC_MAX and lost its tail.
test("autosaving the server's own chapters back changes nothing, however often", async () => {
  const doc = await newDoc(alice.token, "Tattered sign");
  const first = await ctx.api(
    "/api/docs/" + doc.id,
    { chapters: [
      { title: "One", html: `<p>He flipped the sign to 'Closed' & said "don't" — 1 < 2. <a href="https://ao3.org/?a=1&b=2">link</a></p>` },
      { title: "Two", html: "<p>Later.</p>" },
    ] },
    alice.token,
    "PUT"
  );
  const want = first.data.doc;
  assert.ok(want.chapters[0].html.includes("&#39;Closed&#39;"));
  let chapters = want.chapters;
  for (let i = 0; i < 6; i++) {
    const r = await ctx.api("/api/docs/" + doc.id, { chapters: chapters.map(({ id, title, html }) => ({ id, title, html })) }, alice.token, "PUT");
    assert.equal(r.data.doc.chapters[0].html, want.chapters[0].html, "save " + (i + 1));
    assert.equal(r.data.doc.html, want.html, "joined html, save " + (i + 1));
    assert.equal(r.data.doc.wordCount, want.wordCount, "word count, save " + (i + 1));
    chapters = r.data.doc.chapters;
  }
  const back = await ctx.api("/api/docs/" + doc.id, null, alice.token, "GET");
  assert.equal(back.data.doc.html, want.html, "and a reload reads the same");
  assert.ok(!back.data.doc.html.includes("&amp;amp;"));
});

test("an already-mangled chapter is repaired when it is read", () => {
  const bad = "<p>sign to &amp;amp;amp;amp;#39;Closed&amp;amp;amp;amp;#39; &amp;amp;quot;x&amp;amp;quot; &amp;amp;lt;3 Tom &amp;amp; Jerry</p>";
  assert.equal(repairEntities(bad), "<p>sign to &#39;Closed&#39; &quot;x&quot; &lt;3 Tom &amp; Jerry</p>");
  const good = "<p>&#39;fine&#39; &amp; &lt;dandy&gt;</p>";
  assert.equal(repairEntities(good), good, "healthy html is untouched");
  assert.equal(repairEntities(repairEntities(bad)), repairEntities(bad));
  const doc = ensureChapters({ chapters: [{ id: "0123456789ab", title: "One", html: bad }] });
  assert.ok(!doc.html.includes("amp;amp;") && doc.html.includes("&#39;Closed&#39;"));
});

test("words count the way the editor counts them: an entity is part of its word", () => {
  assert.equal(countWords("<p>don&#39;t</p>"), 1);
  assert.equal(countWords("<p>&quot;Closed&quot; he said</p>"), 3);
  assert.equal(countWords("<h2>One</h2><p>two</p>"), 2);
  assert.equal(countWords("<p>said <b>won&#39;t</b>. The <span class=\"cmt\" data-cid=\"0123456789ab\">si</span>gn</p>"), 4, "an inline tag never splits a word");
  assert.equal(countWords(""), 0);
});

test("a chapter too long to store is refused, never silently cut", async () => {
  const doc = await newDoc(alice.token, "Long");
  await ctx.api("/api/docs/" + doc.id, { html: "<p>kept</p>" }, alice.token, "PUT");
  const huge = "<p>" + "word ".repeat(DOC_MAX / 5 + 10) + "</p>";
  const r = await ctx.api("/api/docs/" + doc.id, { chapters: [{ id: null, title: "One", html: huge }] }, alice.token, "PUT");
  assert.equal(r.status, 413);
  assert.match(r.data.error, /too long/i);
  assert.equal((await ctx.api("/api/docs/" + doc.id, { html: huge }, alice.token, "PUT")).status, 413);
  assert.equal((await docOf(doc.id)).html, "<p>kept</p>", "the stored copy is untouched");
});

test("a whole story too large to send is refused in words, and nothing stored changes", async () => {
  const doc = await newDoc(alice.token, "Vast");
  await ctx.api("/api/docs/" + doc.id, { html: "<p>kept</p>" }, alice.token, "PUT");
  // every chapter under DOC_MAX, the request over the body limit
  const big = "<p>" + "word ".repeat(DOC_MAX / 5 - 10) + "</p>";
  const chapters = Array.from({ length: 12 }, (_, i) => ({ id: null, title: "Ch " + (i + 1), html: big }));
  const r = await ctx.api("/api/docs/" + doc.id, { chapters }, alice.token, "PUT");
  assert.equal(r.status, 413);
  assert.match(r.data.error, /too large to save/i);
  assert.equal((await docOf(doc.id)).html, "<p>kept</p>", "the stored copy is untouched");
});

test("a reader can still comment on prose full of quotes after the author has saved many times", async () => {
  const doc = await newDoc(alice.token, "Quoted");
  let r = await ctx.api("/api/docs/" + doc.id, { html: `<p>'Closed' it said.</p>` }, alice.token, "PUT");
  for (let i = 0; i < 3; i++) r = await ctx.api("/api/docs/" + doc.id, { html: r.data.doc.html }, alice.token, "PUT");
  await ctx.api("/api/docs/" + doc.id + "/readers", { username: "bobbeta" }, alice.token);
  const B = await ctx.conn();
  B.emit("doc-open", { auth: bob.token, id: doc.id });
  await ctx.wait(150);
  const cid = "a1b2c3d4e5f6";
  // what a reader's browser sends: the DOM-decoded html with one new anchor
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid, text: "nice", html: `<p>'<span class="cmt" data-cid="${cid}">Closed</span>' it said.</p>` });
  await ctx.wait(200);
  const after = await docOf(doc.id);
  assert.equal(after.comments.length, 1, "the comment was taken");
  assert.ok(!after.html.includes("amp;"), after.html);
  B.close();
});

// ---- threads: replies, editing, the author's Reject ----
async function threadedDoc(cid = "c0c0c0c0c0c0") {
  const doc = await commentableDoc();
  const A = await ctx.conn(), B = await ctx.conn();
  A.emit("doc-open", { auth: alice.token, id: doc.id });
  B.emit("doc-open", { auth: bob.token, id: doc.id });
  await ctx.wait(150);
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid, html: anchored(cid), text: "intentional?" });
  await ctx.wait(200);
  const [c] = (await docOf(doc.id)).comments;
  return { doc, A, B, commentId: c.id };
}
const threadOf = async (id) => (await docOf(id)).comments[0];

test("a comment stored before threads existed reads as a thread with no replies", async () => {
  const { doc } = await threadedDoc();
  const c = await threadOf(doc.id);
  assert.deepEqual(c.replies, [], "no `replies` field on disk, an empty list on the wire");
  assert.equal(c.declined, false);
  assert.equal(c.edited, false);
});

test("the author and the beta reader can reply to each other; ids never ship", async () => {
  const { doc, A, B, commentId } = await threadedDoc();
  A.emit("doc-comment-reply", { auth: alice.token, id: doc.id, commentId, text: "the title is the <b>typo</b>" });
  await ctx.wait(150);
  B.emit("doc-comment-reply", { auth: bob.token, id: doc.id, commentId, text: "phew" });
  await ctx.wait(150);
  const c = await threadOf(doc.id);
  assert.deepEqual(c.replies.map((r) => [r.author, r.text, r.isAuthor]), [
    ["aliceauthor", "the title is the typo", true],
    ["bobbeta", "phew", false],
  ], "in order, tags stripped, the author marked");
  assert.ok(c.replies.every((r) => !("userId" in r)), "account ids never reach the client");
});

test("a stranger, and a public reader, cannot reply", async () => {
  const { doc, commentId } = await threadedDoc();
  const C = await ctx.conn();
  C.emit("doc-comment-reply", { auth: carol.token, id: doc.id, commentId, text: "let me in" });
  await ctx.wait(150);
  assert.equal((await threadOf(doc.id)).replies.length, 0);
  await setVis(doc.id, "public");
  C.emit("doc-comment-reply", { auth: carol.token, id: doc.id, commentId, text: "now I can read it" });
  await ctx.wait(150);
  assert.equal((await threadOf(doc.id)).replies.length, 0, "reading a public write is not an invitation to write on it");
});

test("an empty reply, or one on a closed thread, is dropped", async () => {
  const { doc, A, B, commentId } = await threadedDoc();
  B.emit("doc-comment-reply", { auth: bob.token, id: doc.id, commentId, text: "   " });
  A.emit("doc-comment-resolve", { auth: alice.token, id: doc.id, commentId, resolved: true });
  await ctx.wait(150);
  B.emit("doc-comment-reply", { auth: bob.token, id: doc.id, commentId, text: "one more thing" });
  await ctx.wait(150);
  assert.equal((await threadOf(doc.id)).replies.length, 0);
});

test("you edit your own words; the author cannot rewrite a reader's, nor a reader the author's", async () => {
  const { doc, A, B, commentId } = await threadedDoc();
  A.emit("doc-comment-reply", { auth: alice.token, id: doc.id, commentId, text: "fixing" });
  await ctx.wait(150);
  const replyId = (await threadOf(doc.id)).replies[0].id;

  A.emit("doc-comment-edit", { auth: alice.token, id: doc.id, commentId, text: "I LOVE my own writing" });
  B.emit("doc-comment-edit", { auth: bob.token, id: doc.id, commentId, replyId, text: "I was wrong" });
  await ctx.wait(150);
  let c = await threadOf(doc.id);
  assert.equal(c.text, "intentional?", "the author can delete a note, never put words in a reader's mouth");
  assert.equal(c.replies[0].text, "fixing");

  B.emit("doc-comment-edit", { auth: bob.token, id: doc.id, commentId, text: "intentional, or a typo?" });
  A.emit("doc-comment-edit", { auth: alice.token, id: doc.id, commentId, replyId, text: "fixed" });
  B.emit("doc-comment-edit", { auth: bob.token, id: doc.id, commentId, text: "" });
  await ctx.wait(150);
  c = await threadOf(doc.id);
  assert.equal(c.text, "intentional, or a typo?");
  assert.equal(c.edited, true);
  assert.deepEqual([c.replies[0].text, c.replies[0].edited], ["fixed", true]);
  assert.ok((await docOf(doc.id)).html.includes('data-cid="c0c0c0c0c0c0"'), "editing the note leaves its underline alone");
});

test("the author can delete any reply; a reader only their own; the note survives", async () => {
  const { doc, A, B, commentId } = await threadedDoc();
  A.emit("doc-comment-reply", { auth: alice.token, id: doc.id, commentId, text: "from the author" });
  await ctx.wait(100);
  B.emit("doc-comment-reply", { auth: bob.token, id: doc.id, commentId, text: "from the reader" });
  await ctx.wait(150);
  const [fromAlice, fromBob] = (await threadOf(doc.id)).replies;

  B.emit("doc-comment-delete", { auth: bob.token, id: doc.id, commentId, replyId: fromAlice.id });
  await ctx.wait(150);
  assert.equal((await threadOf(doc.id)).replies.length, 2, "a normal reader can't remove the author's reply");

  A.emit("doc-comment-delete", { auth: alice.token, id: doc.id, commentId, replyId: fromBob.id });
  await ctx.wait(150);
  const c = await threadOf(doc.id);
  assert.deepEqual(c.replies.map((r) => r.text), ["from the author"]);
  assert.equal(c.text, "intentional?", "deleting a reply never takes the note");
});

test("Reject is the author's verdict: a reader's 'declined' is just resolved, and reopening clears it", async () => {
  const { doc, A, B, commentId } = await threadedDoc();
  B.emit("doc-comment-resolve", { auth: bob.token, id: doc.id, commentId, resolved: true, declined: true });
  await ctx.wait(150);
  let c = await threadOf(doc.id);
  assert.deepEqual([c.resolved, c.declined], [true, false]);

  A.emit("doc-comment-resolve", { auth: alice.token, id: doc.id, commentId, resolved: false });
  await ctx.wait(100);
  A.emit("doc-comment-resolve", { auth: alice.token, id: doc.id, commentId, resolved: true, declined: true });
  await ctx.wait(150);
  c = await threadOf(doc.id);
  assert.deepEqual([c.resolved, c.declined], [true, true]);

  A.emit("doc-comment-resolve", { auth: alice.token, id: doc.id, commentId, resolved: false });
  await ctx.wait(150);
  c = await threadOf(doc.id);
  assert.deepEqual([c.resolved, c.declined], [false, false]);
});

// ---- "Saved" means the store took it ----
test("a save the store refuses answers 503 and says so; nothing reads as saved, and the retry goes through", async () => {
  const { chmodSync } = await import("node:fs");
  const { join } = await import("node:path");
  const doc = await newDoc(alice.token, "Durable");
  const first = await ctx.api("/api/docs/" + doc.id, { html: "<p>landed</p>" }, alice.token, "PUT");
  assert.equal(first.status, 200);
  const dir = join(ctx.dataDir, "docs");
  chmodSync(dir, 0o555); // the disk says no — production's version of this is the database refusing the row
  let refused;
  try {
    refused = await ctx.api("/api/docs/" + doc.id, { html: "<p>landed</p><p>three thousand more words</p>", baseRev: first.data.doc.rev }, alice.token, "PUT");
  } finally {
    chmodSync(dir, 0o755);
  }
  assert.equal(refused.status, 503);
  assert.equal(refused.data.unlanded, true);
  assert.match(refused.data.error, /safe in this tab/);
  assert.ok(!("doc" in refused.data), "no document comes back: the editor must not paint itself clean");
  // the editor retries naming the rev it was given, and is not told it conflicts with itself
  const again = await ctx.api("/api/docs/" + doc.id, { html: "<p>landed</p><p>three thousand more words</p>", baseRev: refused.data.rev }, alice.token, "PUT");
  assert.equal(again.status, 200);
  assert.ok((await docOf(doc.id)).html.includes("three thousand more words"));
});

// ---- version history ----
const longHtml = (n, word = "word") => "<p>" + Array.from({ length: n }, () => word).join(" ") + "</p>";
const historyOf = async (id, token = alice.token) => ctx.api("/api/docs/" + id + "/history", null, token, "GET");

test("history: a save that loses a lot of words keeps the copy before it, and Restore brings it back — undoably", async () => {
  const doc = await newDoc(alice.token, "Seventeen thousand");
  const full = longHtml(3000, "letters");
  await ctx.api("/api/docs/" + doc.id, { html: full }, alice.token, "PUT");
  assert.deepEqual((await historyOf(doc.id)).data.versions, [], "nothing to go back to yet: the first save replaced an empty story");

  // thirty seconds later an ordinary autosave: no copy (history is spaced by time, not per save)
  await ctx.api("/api/docs/" + doc.id, { html: full + "<p>and a little more</p>" }, alice.token, "PUT");
  assert.equal((await historyOf(doc.id)).data.versions.filter((v) => v.reason === "time").length <= 1, true);

  // the accident: most of it gone in one save
  await ctx.api("/api/docs/" + doc.id, { html: longHtml(100, "letters") }, alice.token, "PUT");
  const { versions } = (await historyOf(doc.id)).data;
  const kept = versions.find((v) => v.reason === "drop");
  assert.ok(kept, "the copy from before the drop is kept whatever the spacing");
  assert.ok(kept.words >= 3000);

  const one = await ctx.api(`/api/docs/${doc.id}/history/${kept.at}`, null, alice.token, "GET");
  assert.ok(one.data.version.chapters[0].html.includes("and a little more"));

  const revBefore = (await docOf(doc.id)).rev;
  const back = await ctx.api(`/api/docs/${doc.id}/history/${kept.at}/restore`, {}, alice.token);
  assert.equal(back.status, 200);
  assert.ok(back.data.doc.wordCount >= 3000);
  assert.equal(back.data.doc.rev, revBefore + 1, "a restore is a save: an open editor's next save meets it");
  assert.ok((await docOf(doc.id)).html.includes("and a little more"));
  const after = (await historyOf(doc.id)).data.versions;
  assert.ok(after.some((v) => v.reason === "restore" && v.words <= 110), "and the copy the restore replaced is kept too");
});

test("history: removing a chapter keeps the copy that still had it", async () => {
  const doc = await newDoc(alice.token, "Two then one");
  const two = await ctx.api("/api/docs/" + doc.id, { chapters: [{ id: doc.chapters[0].id, title: "One", html: "<p>first chapter stays</p>" }, { title: "Two", html: "<p>second chapter goes</p>" }] }, alice.token, "PUT");
  await ctx.api("/api/docs/" + doc.id, { chapters: [two.data.doc.chapters[0]] }, alice.token, "PUT");
  const kept = (await historyOf(doc.id)).data.versions.find((v) => v.reason === "drop");
  assert.equal(kept?.chapters, 2);
  const copy = await ctx.api(`/api/docs/${doc.id}/history/${kept.at}`, null, alice.token, "GET");
  assert.ok(copy.data.version.chapters[1].html.includes("second chapter goes"));
});

test("history: the author's alone — a beta reader, a stranger and the signed-out can neither read nor restore it", async () => {
  const doc = await commentableDoc();
  await ctx.api("/api/docs/" + doc.id, { html: longHtml(400) }, alice.token, "PUT");
  await ctx.api("/api/docs/" + doc.id, { html: "<p>cut</p>" }, alice.token, "PUT");
  const at = (await historyOf(doc.id)).data.versions[0].at;
  for (const token of [bob.token, carol.token]) {
    assert.equal((await historyOf(doc.id, token)).status, 403);
    assert.equal((await ctx.api(`/api/docs/${doc.id}/history/${at}`, null, token, "GET")).status, 403);
    assert.equal((await ctx.api(`/api/docs/${doc.id}/history/${at}/restore`, {}, token)).status, 403);
  }
  assert.equal((await historyOf(doc.id, null)).status, 401);
  assert.equal((await ctx.api(`/api/docs/${doc.id}/history/12345/restore`, {}, alice.token)).status, 404, "a version that isn't there");
  assert.equal((await docOf(doc.id)).html, "<p>cut</p>", "none of that changed the story");
});

// ---- the author's comment is the one write that skips the save route's version check ----
test("an author's comment from a tab that is behind the stored story is refused, and the chapter is not rolled back", async () => {
  const doc = await commentableDoc();
  const stale = await docOf(doc.id); // what an old tab holds
  const newer = BODY + "<p>three thousand words written on the other device</p>";
  await ctx.api("/api/docs/" + doc.id, { html: newer }, alice.token, "PUT");
  const A = await ctx.conn();
  A.emit("doc-open", { auth: alice.token, id: doc.id });
  await ctx.wait(100);
  const refused = new Promise((r) => A.once("doc-comment-refused", r));
  A.emit("doc-comment", { auth: alice.token, id: doc.id, cid: "dddddddddddd", html: anchored("dddddddddddd"), text: "note to self", baseRev: stale.rev });
  assert.deepEqual(await refused, { id: doc.id, cid: "dddddddddddd", reason: "stale" });
  const now = await docOf(doc.id);
  assert.ok(now.html.includes("written on the other device"), "the newer chapter stands");
  assert.equal(now.comments.length, 0);

  // the same comment from a tab that is up to date — unsaved typing and all — lands as before
  A.emit("doc-comment", { auth: alice.token, id: doc.id, cid: "eeeeeeeeeeee", html: newer.replace("striped shirt", '<span class="cmt" data-cid="eeeeeeeeeeee">striped shirt</span>') + "<p>still typing</p>", text: "note to self", baseRev: now.rev });
  await ctx.wait(200);
  const after = await docOf(doc.id);
  assert.equal(after.comments.length, 1);
  assert.ok(after.html.includes("still typing") && after.html.includes("written on the other device"));
});

test("a comment on a chapter past the size limit is refused, never sliced", async () => {
  const doc = await commentableDoc();
  const A = await ctx.conn();
  A.emit("doc-open", { auth: alice.token, id: doc.id });
  await ctx.wait(100);
  const refused = new Promise((r) => A.once("doc-comment-refused", r));
  const huge = anchored("ffffffffffff") + "<p>" + "x".repeat(200001) + "</p>";
  A.emit("doc-comment", { auth: alice.token, id: doc.id, cid: "ffffffffffff", html: huge, text: "too long", baseRev: (await docOf(doc.id)).rev });
  assert.equal((await refused).reason, "long");
  assert.equal((await docOf(doc.id)).html, BODY, "nothing stored changed");
});

// ---- threads: nested replies ----
test("a reply can answer a reply in its own thread; a parent from anywhere else answers the note", async () => {
  const { doc, A, B, commentId } = await threadedDoc();
  A.emit("doc-comment-reply", { auth: alice.token, id: doc.id, commentId, text: "yes, on purpose" });
  await ctx.wait(150);
  const first = (await threadOf(doc.id)).replies[0].id;
  B.emit("doc-comment-reply", { auth: bob.token, id: doc.id, commentId, parentId: first, text: "then seed it earlier" });
  B.emit("doc-comment-reply", { auth: bob.token, id: doc.id, commentId, parentId: "no-such-reply", text: "stale parent" });
  B.emit("doc-comment-reply", { auth: bob.token, id: doc.id, commentId, parentId: { $ne: null }, text: "not even a string" });
  await ctx.wait(200);
  const c = await threadOf(doc.id);
  assert.deepEqual(c.replies.map((r) => [r.text, r.parentId]), [
    ["yes, on purpose", null],
    ["then seed it earlier", first],
    ["stale parent", null],
    ["not even a string", null],
  ]);
});

test("deleting a reply hands its answers to what it answered", async () => {
  const { doc, A, B, commentId } = await threadedDoc();
  const say = async (S, who, text, parentId) => {
    S.emit("doc-comment-reply", { auth: who.token, id: doc.id, commentId, text, ...(parentId ? { parentId } : {}) });
    await ctx.wait(120);
    return (await threadOf(doc.id)).replies.find((r) => r.text === text).id;
  };
  const top = await say(A, alice, "top");
  const mid = await say(B, bob, "mid", top);
  await say(A, alice, "leaf", mid);
  B.emit("doc-comment-delete", { auth: bob.token, id: doc.id, commentId, replyId: mid });
  await ctx.wait(150);
  let c = await threadOf(doc.id);
  assert.deepEqual(c.replies.map((r) => [r.text, r.parentId]), [["top", null], ["leaf", top]]);
  A.emit("doc-comment-delete", { auth: alice.token, id: doc.id, commentId, replyId: top });
  await ctx.wait(150);
  c = await threadOf(doc.id);
  assert.deepEqual(c.replies.map((r) => [r.text, r.parentId]), [["leaf", null]], "and up to the note when that goes too");
});

// ---- reactions on notes and replies ----
test("the author and a beta reader react to a note and to a reply; a second tap takes it back", async () => {
  const { doc, A, B, commentId } = await threadedDoc();
  const before = await docOf(doc.id);
  A.emit("doc-comment-reply", { auth: alice.token, id: doc.id, commentId, text: "good eye" });
  await ctx.wait(150);
  const replyId = (await threadOf(doc.id)).replies[0].id;
  A.emit("doc-comment-react", { auth: alice.token, id: doc.id, commentId, emoji: "🔥" });
  B.emit("doc-comment-react", { auth: bob.token, id: doc.id, commentId, emoji: "🔥" });
  B.emit("doc-comment-react", { auth: bob.token, id: doc.id, commentId, replyId, emoji: "👀" });
  await ctx.wait(200);
  let c = await threadOf(doc.id);
  assert.deepEqual(c.reactions["🔥"].map((r) => r.name).sort(), ["aliceauthor", "bobbeta"]);
  assert.deepEqual(c.replies[0].reactions["👀"].map((r) => [r.key, r.name]), [["bobbeta", "bobbeta"]]);
  // keyed by username on the wire — never the account id it is stored under
  const wire = JSON.stringify(c);
  assert.ok(alice.user.id && bob.user.id, "the fixture knows the ids it is looking for");
  assert.ok(!wire.includes(alice.user.id) && !wire.includes(bob.user.id));
  B.emit("doc-comment-react", { auth: bob.token, id: doc.id, commentId, emoji: "🔥" });
  B.emit("doc-comment-react", { auth: bob.token, id: doc.id, commentId, replyId, emoji: "👀" });
  await ctx.wait(200);
  c = await threadOf(doc.id);
  assert.deepEqual(c.reactions["🔥"].map((r) => r.name), ["aliceauthor"]);
  assert.deepEqual(c.replies[0].reactions, {}, "the last one off leaves nothing behind");
  // a reaction is words in the margin: the story and its rev never move
  const after = await docOf(doc.id);
  assert.equal(after.rev, before.rev);
  assert.equal(after.html, before.html);
});

test("no reaction from off the list, from a stranger or public reader, on a closed thread or a missing reply", async () => {
  const { doc, A, B, commentId } = await threadedDoc();
  const C = await ctx.conn();
  B.emit("doc-comment-react", { auth: bob.token, id: doc.id, commentId, emoji: "<img src=x>" });
  B.emit("doc-comment-react", { auth: bob.token, id: doc.id, commentId, emoji: "🦖" });
  B.emit("doc-comment-react", { auth: bob.token, id: doc.id, commentId, replyId: "nope", emoji: "🔥" });
  C.emit("doc-comment-react", { auth: carol.token, id: doc.id, commentId, emoji: "🔥" });
  await ctx.wait(150);
  await setVis(doc.id, "public");
  C.emit("doc-comment-react", { auth: carol.token, id: doc.id, commentId, emoji: "🔥" });
  await ctx.wait(150);
  assert.deepEqual((await threadOf(doc.id)).reactions, {}, "reading a public write is not an invitation to react on it");
  A.emit("doc-comment-resolve", { auth: alice.token, id: doc.id, commentId, resolved: true });
  await ctx.wait(150);
  B.emit("doc-comment-react", { auth: bob.token, id: doc.id, commentId, emoji: "🔥" });
  await ctx.wait(150);
  assert.deepEqual((await threadOf(doc.id)).reactions, {});
});

// ---- the author writes while a reader comments ----
// The two roles act on the same story at the same moment. The server can't
// order them for the writer, but it can answer truthfully and say when a
// note didn't land.

test("a save answers with the story as the store holds it when it answers, not as the request found it", async () => {
  const doc = await commentableDoc();
  const B = await ctx.conn();
  B.emit("doc-open", { auth: bob.token, id: doc.id });
  await ctx.wait(150);
  // the note and the save leave at the same moment; whichever the server
  // meets first, the save's answer must carry the note — an editor that took
  // the answer as the truth used to lose the note off its rail (and, with
  // it, the underline it had just placed, orphaning the note for good)
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "a1a1a1a1a1a1", html: anchored("a1a1a1a1a1a1"), text: "at the same moment" });
  const saved = await ctx.api("/api/docs/" + doc.id, { html: BODY + "<p>more</p>", baseRev: (await docOf(doc.id)).rev }, alice.token, "PUT");
  await ctx.wait(200);
  assert.equal(saved.status, 200);
  const now = await docOf(doc.id);
  assert.equal(now.comments.length, 1, "the note landed");
  assert.deepEqual(saved.data.doc.comments.map((c) => c.id), now.comments.map((c) => c.id), "and the save's answer already knew it");
});

test("a reader whose page is behind is told their note didn't land, and the story is untouched", async () => {
  const doc = await commentableDoc();
  const B = await ctx.conn();
  B.emit("doc-open", { auth: bob.token, id: doc.id });
  await ctx.wait(150);
  // the author saves under bob; bob's page still holds the old words
  await ctx.api("/api/docs/" + doc.id, { html: BODY.replace("striped", "checked"), baseRev: (await docOf(doc.id)).rev }, alice.token, "PUT");
  await ctx.wait(100);
  const refused = new Promise((r) => B.once("doc-comment-refused", r));
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "b2b2b2b2b2b2", html: anchored("b2b2b2b2b2b2"), text: "on the old words" });
  assert.deepEqual(await refused, { id: doc.id, cid: "b2b2b2b2b2b2", reason: "moved" });
  const now = await docOf(doc.id);
  assert.equal(now.comments.length, 0, "not taken");
  assert.ok(now.html.includes("checked shirt") && !now.html.includes("data-cid"), "the author's save stands, no stray anchor");

  // a note that names a chapter that is gone, and one whose selection came
  // off the page (no anchor in the html): told the same way, never silent
  const gone = new Promise((r) => B.once("doc-comment-refused", r));
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "b3b3b3b3b3b3", chapterId: "nosuchchapter", html: anchored("b3b3b3b3b3b3"), text: "?" });
  assert.equal((await gone).reason, "moved");
  const detached = new Promise((r) => B.once("doc-comment-refused", r));
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "b4b4b4b4b4b4", html: now.html, text: "my selection was on nodes that are gone" });
  assert.equal((await detached).reason, "moved");

  // on the fresh copy the same note lands — a reader who was told can try again
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "b5b5b5b5b5b5", html: now.html.replace("checked shirt", '<span class="cmt" data-cid="b5b5b5b5b5b5">checked shirt</span>'), text: "on the new words" });
  await ctx.wait(200);
  assert.equal((await docOf(doc.id)).comments.length, 1);
});

test("two readers on the same chapter: the second is told when the first's note got there first, never dropped silently", async () => {
  const doc = await commentableDoc();
  // a second beta reader: dana, befriended for this
  const dana = await signup(ctx, "danabeta", "dana@byers.com");
  await ctx.api("/api/friends/request", { username: "danabeta" }, alice.token);
  const inbox = await ctx.api("/api/inbox", null, dana.token, "GET");
  await ctx.api("/api/friends/respond", { id: inbox.data.messages.find((m) => m.type === "friend-request").id, accept: true }, dana.token);
  await ctx.api("/api/docs/" + doc.id + "/readers", { username: "danabeta" }, alice.token);
  const B = await ctx.conn(), C = await ctx.conn();
  B.emit("doc-open", { auth: bob.token, id: doc.id });
  C.emit("doc-open", { auth: dana.token, id: doc.id });
  await ctx.wait(150);
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "c1c1c1c1c1c1", html: anchored("c1c1c1c1c1c1"), text: "bob" });
  await ctx.wait(200);
  // dana's page never took bob's anchor: her html is the pre-bob copy plus hers
  const refused = new Promise((r) => C.once("doc-comment-refused", r));
  C.emit("doc-comment", { auth: dana.token, id: doc.id, cid: "c2c2c2c2c2c2", html: anchored("c2c2c2c2c2c2", "first"), text: "dana" });
  assert.equal((await refused).reason, "moved");
  assert.equal((await docOf(doc.id)).comments.length, 1);
  // with bob's anchor in her copy, hers is the only change: taken
  const fresh = (await docOf(doc.id)).html;
  C.emit("doc-comment", { auth: dana.token, id: doc.id, cid: "c3c3c3c3c3c3", html: fresh.replace("<p>first</p>", '<p><span class="cmt" data-cid="c3c3c3c3c3c3">first</span></p>'), text: "dana again" });
  await ctx.wait(200);
  assert.equal((await docOf(doc.id)).comments.length, 2);
});

test("a reply or a reaction on a thread that closed first is refused with a word, not silence", async () => {
  const { doc, A, B, commentId } = await threadedDoc();
  A.emit("doc-comment-resolve", { auth: alice.token, id: doc.id, commentId, resolved: true });
  await ctx.wait(150);
  const r1 = new Promise((r) => B.once("doc-comment-refused", r));
  B.emit("doc-comment-reply", { auth: bob.token, id: doc.id, commentId, text: "too late" });
  assert.deepEqual(await r1, { id: doc.id, cid: commentId, reason: "closed" });
  const r2 = new Promise((r) => B.once("doc-comment-refused", r));
  B.emit("doc-comment-react", { auth: bob.token, id: doc.id, commentId, emoji: "🔥" });
  assert.deepEqual(await r2, { id: doc.id, cid: commentId, reason: "closed" });
  const t = await threadOf(doc.id);
  assert.equal((t.replies || []).length, 0);
  assert.deepEqual(t.reactions, {});
  // reopened, the same reply lands
  A.emit("doc-comment-resolve", { auth: alice.token, id: doc.id, commentId, resolved: false });
  await ctx.wait(150);
  B.emit("doc-comment-reply", { auth: bob.token, id: doc.id, commentId, text: "too late" });
  await ctx.wait(150);
  assert.equal((await threadOf(doc.id)).replies.length, 1);
  // a public reader gets nothing back at all — refusal events are for people who may write
  const D = await ctx.conn();
  let heard = false;
  D.once("doc-comment-refused", () => (heard = true));
  D.emit("doc-comment-reply", { auth: null, id: doc.id, commentId, text: "?" });
  await ctx.wait(150);
  assert.equal(heard, false);
});

test("a reader's note reaches the author as the thread first, then the chapter that wears its anchor", async () => {
  const doc = await commentableDoc();
  const A = await ctx.conn(), B = await ctx.conn();
  A.emit("doc-open", { auth: alice.token, id: doc.id });
  B.emit("doc-open", { auth: bob.token, id: doc.id });
  await ctx.wait(150);
  // An idle author's editor takes the pushed html as it comes and prunes any
  // anchor whose comment it doesn't know — so the comment has to be known
  // first, or the underline is stripped on arrival and the next save
  // orphans the note (found in the browser, 2026-09-22).
  const order = [];
  A.onAny((ev) => (ev === "doc-comments" || ev === "doc-html") && order.push(ev));
  B.emit("doc-comment", { auth: bob.token, id: doc.id, cid: "0d0d0d0d0d0d", html: anchored("0d0d0d0d0d0d"), text: "order matters" });
  await ctx.wait(250);
  assert.deepEqual(order, ["doc-comments", "doc-html"]);
});
