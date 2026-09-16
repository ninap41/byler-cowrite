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
  assert.deepEqual(ch.map((c) => c.wordCount), [6, 2, 1], "the escaped script counts as words, as it always did");
  assert.equal(r.data.doc.wordCount, 9, "the document's count is the sum");
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

test("autosave conflict: a save naming a stale base is refused with 409; one without a base overwrites", async () => {
  const doc = await newDoc(alice.token, "Two tabs");
  const first = await ctx.api("/api/docs/" + doc.id, { chapters: [{ title: "One", html: "<p>tab A</p>" }] }, alice.token, "PUT");
  assert.equal(first.status, 200);
  const seen = first.data.doc.updatedAt;
  await new Promise((r) => setTimeout(r, 5));
  // tab B saves after A last looked
  const b = await ctx.api("/api/docs/" + doc.id, { chapters: [{ title: "One", html: "<p>tab B</p>" }], baseUpdatedAt: seen }, alice.token, "PUT");
  assert.equal(b.status, 200, "a base that matches the stored copy saves");
  // tab A's autosave, still holding the old stamp, is refused
  const a = await ctx.api("/api/docs/" + doc.id, { chapters: [{ title: "One", html: "<p>tab A again</p>" }], baseUpdatedAt: seen }, alice.token, "PUT");
  assert.equal(a.status, 409);
  assert.equal(a.data.conflict, true);
  assert.equal(a.data.updatedAt, b.data.doc.updatedAt, "the refusal names the current stamp");
  const kept = await ctx.api("/api/docs/" + doc.id, null, alice.token, "GET");
  assert.equal(kept.data.doc.html, "<p>tab B</p>", "the refused save changed nothing");
  // a deliberate Save carries no base and wins
  const force = await ctx.api("/api/docs/" + doc.id, { chapters: [{ title: "One", html: "<p>tab A wins</p>" }] }, alice.token, "PUT");
  assert.equal(force.status, 200);
  assert.equal(force.data.doc.html, "<p>tab A wins</p>");
});
