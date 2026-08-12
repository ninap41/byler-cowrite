// Pure string builders for the solo-write pages. Everything user-supplied
// (titles, usernames, comment text) must be escaped here — only the document
// body itself is trusted, and that arrives sanitizeDoc()'d from the server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.mjs";

installDom(); // plainBlockHtml parses through a detached div
import { docCardHtml, docListHtml, presenceHtml, commentHtml, commentThreadHtml, readerChipsHtml, wordsLabel, formatSource, unformatSource, plainBlockHtml } from "../public/js/write-view.js";

const DOC = {
  id: "abc", title: "The Upside Down", wordCount: 120, visibility: "private",
  updatedAt: Date.now(), owner: "alice", readers: [], comments: 0, mine: true,
};

test("wordsLabel pluralizes", () => {
  assert.equal(wordsLabel(1), "1 word");
  assert.equal(wordsLabel(0), "0 words");
  assert.equal(wordsLabel(12), "12 words");
});

test("a doc card shows state and links to the editor", () => {
  const html = docCardHtml(DOC);
  assert.ok(html.includes("The Upside Down"));
  assert.ok(html.includes("120 words"));
  assert.ok(html.includes("🔒 Private"));
  assert.ok(html.includes('href="/write?id=abc"'));
  assert.ok(html.includes("doc-del"), "the author gets a delete button");

  const shared = docCardHtml({ ...DOC, visibility: "readers", readers: ["bob"], comments: 3 });
  assert.ok(shared.includes("👥 Shared"));
  assert.ok(shared.includes("💬 3"));
  assert.ok(shared.includes("bob"));
});

test("a doc someone shared with me reads differently and can't be deleted", () => {
  const html = docCardHtml({ ...DOC, mine: false });
  assert.ok(html.includes("📖 Beta reading"));
  assert.ok(html.includes("by alice"));
  assert.ok(!html.includes("doc-del"), "only the author may delete");
});

test("the empty listing invites you to start", () => {
  assert.ok(docListHtml([]).includes("Nothing written yet"));
  assert.ok(docListHtml(null).includes("Nothing written yet"));
  assert.equal(docListHtml([DOC, { ...DOC, id: "d2" }]).match(/doc-card"/g).length, 2);
});

test("presence renders one hoverable avatar per viewer", () => {
  const html = presenceHtml([{ username: "bob", color: "#6c8cff", avatar: "", avatarFit: "cover" }]);
  assert.ok(html.includes('data-tip="bob"'), "the tooltip carries the name");
  assert.ok(html.includes("mini-avatar"));
  assert.equal(presenceHtml([]), "", "nobody watching renders nothing");
});

test("comments escape their text and author", () => {
  const html = commentHtml({
    id: "c1", text: '<img src=x onerror=1> "quoted"', author: "<b>evil</b>",
    color: "#e63946", avatar: "", avatarFit: "cover", ts: Date.now(), resolved: false,
  });
  assert.ok(!html.includes("<img src=x"), "comment text is escaped");
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("<b>evil</b>"), "author names are escaped");
  assert.ok(html.includes("Resolve"));
});

test("resolved comments are marked, and orphans explain themselves", () => {
  const c = { id: "c1", text: "hi", author: "a", color: "#e63946", ts: Date.now(), resolved: true };
  assert.ok(commentHtml(c).includes("resolved"));
  assert.ok(commentHtml(c).includes("Unresolve"));
  assert.equal(commentThreadHtml([]), "", "no comments, no markup");
  const orphan = commentThreadHtml([c], { orphaned: true });
  assert.ok(/has since changed/.test(orphan), "orphaned comments are surfaced, not dropped");
});

test("reader chips escape names and only offer removal to the author", () => {
  assert.ok(readerChipsHtml([], true).includes("No beta readers yet"));
  const rows = [{ username: "bob", color: "#6c8cff", avatar: "", avatarFit: "cover" }];
  assert.ok(readerChipsHtml(rows, true).includes("reader-x"));
  assert.ok(!readerChipsHtml(rows, false).includes("reader-x"), "readers can't manage the list");
  const evil = readerChipsHtml([{ username: '"><script>x</script>', color: "#6c8cff" }], true);
  assert.ok(!evil.includes("<script>"));
});

// ---- html source pretty-printing ----
// The invariant that protects the rich text: newlines are cosmetic only. They go
// in at tag boundaries and come back out exactly, so nothing the source view adds
// can survive into the document as a <br> or as stray whitespace.
const DOC_HTML =
  '<h2>Chapter 11</h2><p>The bedroom threshold feels like a <b>boundary</b> between two worlds.</p>' +
  '<p>“Crawl faster, Mike.” Will beckons.</p><hr><ul><li>one</li><li>two</li></ul>' +
  '<blockquote>quoted</blockquote><p>End.</p>';

test("formatSource puts one block per line", () => {
  const out = formatSource(DOC_HTML);
  assert.ok(out.includes("</h2>\n<p>"), "blocks are broken apart");
  assert.ok(out.includes("<hr>\n<ul>"));
  assert.ok(out.includes("</li>\n<li>"));
  assert.ok(out.split("\n").length > 5, "a wall of text becomes readable lines");
});

test("formatSource never breaks inline runs or text", () => {
  const out = formatSource(DOC_HTML);
  assert.ok(out.includes("a <b>boundary</b> between"), "inline tags stay on the text's line");
  assert.ok(!/\n[^<]/.test(out), "no newline is ever followed by text content");
  assert.ok(!/[^>]\n/.test(out), "every newline follows a closing angle bracket");
});

test("unformatSource(formatSource(x)) === x — the round trip is exact", () => {
  for (const html of [DOC_HTML, "<p>solo</p>", "<p>a</p><p>b</p>", "", "<p>text with < angle</p>"]) {
    assert.equal(unformatSource(formatSource(html)), html, html);
  }
});

test("hand-typed newlines and indentation in the source view are dropped, not turned into breaks", () => {
  const typed = '<p>one</p>\n\n   <p>two</p>\n\t<h3>three</h3>\n';
  assert.equal(unformatSource(typed), "<p>one</p><p>two</p><h3>three</h3>");
  assert.ok(!unformatSource(typed).includes("<br>"), "switching back adds no breaks");
});

test("a newline inside a paragraph's text is left alone for the parser to collapse", () => {
  // Not at a tag boundary, so unformatSource must not touch it — HTML parsing
  // collapses it to a space, which is the existing rich-text behaviour.
  assert.equal(unformatSource("<p>one\ntwo</p>"), "<p>one\ntwo</p>");
});

// ---- clear formatting (the toolbar's ✕) ----
test("plainBlockHtml strips every inline tag down to its text", () => {
  assert.equal(
    plainBlockHtml('<p>a <b>bold</b> <i>and <u>nested</u></i> <s>gone</s></p>'),
    "<p>a bold and nested gone</p>",
  );
});

test("plainBlockHtml drops fs-* size spans and link hrefs but keeps the words", () => {
  const out = plainBlockHtml('<p>size <span class="fs-36">big</span> and <a href="http://x.com">linked</a></p>');
  assert.equal(out, "<p>size big and linked</p>");
  assert.ok(!out.includes("fs-36") && !out.includes("href"));
});

test("plainBlockHtml flattens headings, quotes and lists to paragraphs", () => {
  assert.equal(
    plainBlockHtml('<h2>Chapter</h2><blockquote>quoted</blockquote><ul><li>one</li><li>two</li></ul>'),
    "<p>Chapter</p><p>quoted</p><p>one</p><p>two</p>",
  );
});

test("plainBlockHtml drops alignment and rules", () => {
  assert.equal(plainBlockHtml('<p class="al-c" style="text-align:center">mid</p><hr><p>after</p>'), "<p>mid</p><p>after</p>");
});

test("plainBlockHtml keeps line breaks — clearing formatting must not join lines", () => {
  assert.equal(plainBlockHtml("<p>one<br>two</p>"), "<p>one<br>two</p>");
});

test("plainBlockHtml escapes text, so cleared content can never inject markup", () => {
  const out = plainBlockHtml("<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; co</p>");
  assert.ok(!out.includes("<script>"), out);
  assert.ok(out.includes("&lt;script&gt;") && out.includes("&amp;"));
});

test("plainBlockHtml on empty or whitespace-only input yields nothing to insert", () => {
  assert.equal(plainBlockHtml(""), "");
  assert.equal(plainBlockHtml("<p>   </p><p></p>"), "");
});
