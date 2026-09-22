// Pure string builders for the solo-write pages. Everything user-supplied
// (titles, usernames, comment text) must be escaped here — only the document
// body itself is trusted, and that arrives sanitizeDoc()'d from the server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.mjs";
import { readFileSync } from "node:fs";

installDom(); // plainBlockHtml parses through a detached div
import { docCardHtml, docListHtml, docShelfHtml, DOC_GROUPS, presenceHtml, soloRowHtml, soloListHtml, wireSoloDeletes, commentHtml, commentThreadHtml, versionListHtml, readerChipsHtml, wordsLabel, formatSource, unformatSource, plainBlockHtml, visChipHtml, visMenuHtml, visLabel, VIS, scrollTargetFor, inviteOptions, inviteRowHtml, inviteListHtml, promptInsertHtml, insertAfterHeading, betaReadingHtml, commentModeBannerHtml, chapterListHtml, chapNavHtml, chapChipLabel, countWordsHtml } from "../public/js/write-view.js";

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
  assert.ok(shared.includes("👥 Beta readers"), "the pill uses the same words as the editor's chip");
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

test("the shelf separates what you write from what you were invited to read", () => {
  const mine = { ...DOC, id: "m1", mine: true };
  const reading = { ...DOC, id: "r1", mine: false, owner: "mikewheeler" };
  const html = docShelfHtml([mine, reading]);
  assert.match(html, /data-group="mine"/);
  assert.match(html, /data-group="reading"/);
  assert.ok(html.indexOf('data-group="mine"') < html.indexOf('data-group="reading"'), "your own work comes first");
  assert.equal(html.match(/class="doc-grid"/g).length, 2, "each section keeps its own grid");
  assert.equal(html.match(/doc-card"/g).length, 2);
  // each section says how many, and names the relationship
  assert.match(html, /My solo writes<span class="doc-group-count">1</);
  assert.match(html, /Beta reading<span class="doc-group-count">1</);

  // a section with nothing in it isn't drawn — no empty "beta reading" box
  const onlyMine = docShelfHtml([mine]);
  assert.match(onlyMine, /data-group="mine"/);
  assert.ok(!onlyMine.includes('data-group="reading"'));
  const onlyReading = docShelfHtml([reading]);
  assert.ok(!onlyReading.includes('data-group="mine"'));
  assert.match(onlyReading, /data-group="reading"/);

  // and an empty shelf is one empty state, not two
  for (const empty of [[], null, undefined]) {
    assert.ok(docShelfHtml(empty).includes("Nothing written yet"));
    assert.ok(!docShelfHtml(empty).includes("doc-group"));
  }
  assert.deepEqual(DOC_GROUPS.map((g) => g.key), ["mine", "reading"]);
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
  }, { isOwner: true });
  assert.ok(!html.includes("<img src=x"), "comment text is escaped");
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("<b>evil</b>"), "author names are escaped");
  assert.ok(html.includes("Resolve"));
});

test("resolved comments are marked, and orphans explain themselves", () => {
  const c = { id: "c1", text: "hi", author: "a", color: "#e63946", ts: Date.now(), resolved: true };
  assert.ok(commentHtml(c).includes("resolved"));
  assert.ok(commentHtml(c, { isOwner: true }).includes("dc-reopen"), "the ⋮ menu offers Reopen");
  assert.ok(!commentHtml(c).includes("dc-reopen"), "but not to someone who can't");
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

test("unformatSource(formatSource(x)) === x: the round trip is exact", () => {
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

test("plainBlockHtml keeps line breaks, clearing formatting must not join lines", () => {
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

// ---- comment cards ----
const CMT = {
  id: "c9", cid: "0123456789ab", quote: "striped shirt", text: "this repeats",
  suggestion: null, author: "bobbeta", color: "#6c8cff", ts: Date.now(),
  resolved: false, accepted: false, orphaned: false, isAuthor: false,
};

test("a comment card carries the anchor id both halves jump between", () => {
  const html = commentHtml(CMT);
  assert.ok(html.includes('data-cid="0123456789ab"'), "the card knows which words it points at");
  assert.ok(html.includes('data-id="c9"'));
  assert.ok(html.includes("striped shirt"), "it quotes the text it's about");
});

test("a suggestion shows old text struck through and the proposal beside it", () => {
  const html = commentHtml({ ...CMT, suggestion: "striped tee" });
  assert.ok(html.includes("<s>striped shirt</s>"));
  assert.ok(html.includes("<ins>striped tee</ins>"));
  assert.ok(html.includes("suggested"), "the card is marked as a suggestion");
});

test("only the author gets Accept/Reject on a suggestion", () => {
  const s = { ...CMT, suggestion: "striped tee" };
  const owner = commentHtml(s, { isOwner: true });
  assert.ok(owner.includes("dc-accept") && owner.includes("dc-reject"));
  const reader = commentHtml({ ...s, author: "bobbeta" }, { isOwner: false, meName: "bobbeta" });
  assert.ok(!reader.includes("dc-accept"), "a reader cannot offer to accept their own suggestion");
  assert.ok(reader.includes("dc-resolve"), "they still get the ordinary actions on their own comment");
});

test("a decided suggestion says which way it went and stops offering buttons", () => {
  const taken = commentHtml({ ...CMT, suggestion: "x", resolved: true, accepted: true }, { isOwner: true });
  assert.ok(taken.includes("✓ Accepted"));
  assert.ok(!taken.includes("dc-accept"), "no re-deciding a resolved suggestion");
  const refused = commentHtml({ ...CMT, suggestion: "x", resolved: true, accepted: false }, { isOwner: true });
  assert.ok(refused.includes("Not taken"));
});

test("an orphaned comment is marked, not silently dropped", () => {
  assert.ok(commentHtml({ ...CMT, orphaned: true }).includes("orphaned"));
});

test("the author's own notes are tagged as theirs", () => {
  assert.ok(commentHtml({ ...CMT, isAuthor: true }).includes("dc-tag"));
});

test("comment cards escape the quote, the note and the suggestion", () => {
  const evil = '<img src=x onerror="alert(1)">';
  const html = commentHtml({ ...CMT, quote: evil, text: evil, suggestion: evil }, { isOwner: true });
  assert.ok(!html.includes("<img"), html);
  assert.ok(html.includes("&lt;img"));
});

test("isOwner reaches every card in a thread", () => {
  const thread = commentThreadHtml([{ ...CMT, suggestion: "a" }, { ...CMT, id: "c10", suggestion: "b" }], { isOwner: true });
  assert.equal(thread.match(/dc-accept/g).length, 2);
});

test("Resolve/Delete appear only for someone who could actually use them", () => {
  // a beta reader looking at the author's note: no dead buttons
  const other = commentHtml({ ...CMT, author: "aliceauthor" }, { isOwner: false, meName: "bobbeta" });
  assert.ok(!other.includes("dc-resolve") && !other.includes("dc-del"));
  // their own note, on someone else's doc
  const own = commentHtml({ ...CMT, author: "bobbeta" }, { isOwner: false, meName: "bobbeta" });
  assert.ok(own.includes("dc-resolve") && own.includes("dc-del"));
  // the document's author can manage anyone's
  const owner = commentHtml({ ...CMT, author: "bobbeta" }, { isOwner: true, meName: "aliceauthor" });
  assert.ok(owner.includes("dc-resolve") && owner.includes("dc-del"));
});

// ---- visibility: one vocabulary, three levels ----

test("the chip states where you stand, it does not ask", () => {
  for (const v of ["private", "readers", "public"]) {
    const chip = visChipHtml(v);
    assert.ok(chip.includes(`>${VIS[v].icon} ${VIS[v].label}<`), v + " names itself in words — it is a dropdown, not an icon");
    assert.ok(chip.includes(`data-tip="${VIS[v].label}: `), "and the tooltip says what that state means");
    assert.ok(chip.includes(`data-vis="${v}"`), "the state is readable by the page too");
  }
  // an action label ("Share…") would leave the off state ambiguous
  assert.ok(!visChipHtml("private").includes("Share"));
});

test("the menu is a radio list of all three, each with its consequence", () => {
  const html = visMenuHtml("readers");
  assert.equal((html.match(/role="menuitemradio"/g) || []).length, 3, "three levels can't be a switch");
  assert.ok(html.includes('data-vis="private"') && html.includes('data-vis="readers"') && html.includes('data-vis="public"'));
  assert.ok(html.includes('aria-checked="true"'), "the current one is marked");
  assert.equal((html.match(/aria-checked="true"/g) || []).length, 1, "and only one is");
  assert.ok(html.includes("Only you."), "private says what it means");
  assert.ok(html.includes("Anyone with an account can read it"), "so does public");
  assert.ok(html.includes("Only your beta readers can comment"), "public hands out a reader, not a pen");
});

test("the listing pill and the editor chip say the same words", () => {
  for (const v of ["private", "readers", "public"]) {
    const pill = docCardHtml({ ...DOC, visibility: v });
    assert.ok(pill.includes(visLabel(v)), v + " reads the same in both places");
  }
  const notMine = docCardHtml({ ...DOC, mine: false, visibility: "public" });
  assert.ok(notMine.includes("📖 Public read"), "someone else's public write says why you can see it");
});

// ---- jumping to a comment's words ----

test("scrollTargetFor centres the words in the space the sticky head leaves", () => {
  // 800px window, a 120px head: the usable band is 680, so a 20px line wants
  // to sit 330px below the head.
  const at = (rectTop, extra = {}) =>
    scrollTargetFor({ rectTop, rectH: 20, scrollY: 0, viewportH: 800, headH: 120, maxScroll: 5000, ...extra });
  assert.equal(at(450), 0, "already in the middle, don't move");
  assert.equal(at(1450), 1000, "further down the page scrolls down");
  assert.equal(at(-550), 0, "above the viewport, but the page can't go past the top");
  assert.equal(scrollTargetFor({ rectTop: 1450, rectH: 20, scrollY: 200, viewportH: 800, headH: 120, maxScroll: 5000 }), 1200,
    "the answer is absolute, so it accounts for where the page already is");
});

test("scrollTargetFor never asks for a position the page doesn't have", () => {
  assert.equal(scrollTargetFor({ rectTop: 9000, rectH: 20, scrollY: 0, viewportH: 800, headH: 120, maxScroll: 300 }), 300);
  assert.equal(scrollTargetFor({ rectTop: -9000, rectH: 20, scrollY: 0, viewportH: 800, headH: 120, maxScroll: 300 }), 0);
  assert.equal(scrollTargetFor({ rectTop: 100, rectH: 20, scrollY: 0, viewportH: 800, headH: 120, maxScroll: 0 }), 0,
    "a document shorter than the window can't scroll at all");
});

test("with no sticky head it is plain centring", () => {
  assert.equal(scrollTargetFor({ rectTop: 900, rectH: 100, scrollY: 0, viewportH: 500, headH: 0, maxScroll: 5000 }), 700);
});


// ---- inviting a beta reader ----

const U = (username, extra = {}) => ({ username, color: "#ff3ea5", ...extra });

test("the invite picker lists everyone, friends first and chipped", () => {
  const rows = inviteOptions({
    users: [U("zoe"), U("alice"), U("mike"), U("will")],
    friends: [U("will"), U("zoe")],
    readers: [],
    me: "mike",
  });
  assert.deepEqual(rows.map((r) => r.username), ["will", "zoe", "alice"], "friends first, then the rest, each A-Z");
  assert.ok(!rows.some((r) => r.username === "mike"), "you can't invite yourself");
  assert.equal(rows[0].friend, true);
  assert.equal(rows[2].friend, false);

  const html = inviteListHtml(rows);
  assert.ok(html.includes(">friend<"), "a friend says so on the row");
  assert.ok(html.includes("not a friend yet"), "and everyone else says why they're not offerable");
  const alice = inviteRowHtml(rows[2]);
  assert.match(alice, /^<div class="pick-row not-friend" data-user="alice"/, "a non-friend's row is not a pick");
  assert.match(alice, /<button type="button" class="ghost add-friend" data-add-friend="alice">Add friend<\/button>/, "but carries the way to become one");
  assert.match(inviteRowHtml({ ...rows[2], requested: true }), /<span class="pick-chip requested">requested<\/span>/, "sent once, it says so");
  assert.ok(!/add-friend/.test(inviteRowHtml({ ...rows[2], requested: true })));
  assert.match(inviteRowHtml(rows[0]), /^<button type="button" class="pick-row" data-user="will"/, "a friend's row is the invite");
});

test("the picker filters by what you type and drops people already reading", () => {
  const users = [U("will"), U("willow"), U("mike")];
  const friends = users;
  assert.deepEqual(
    inviteOptions({ users, friends, q: " WIL " }).map((r) => r.username), ["will", "willow"],
    "case- and space-insensitive substring search",
  );
  assert.deepEqual(
    inviteOptions({ users, friends, readers: [U("will")] }).map((r) => r.username), ["mike", "willow"],
    "a current beta reader isn't offered again",
  );
  assert.ok(inviteListHtml([]).includes("Nobody here by that name"));
});

test("a picker row escapes the name and can't smuggle a color into the style", () => {
  const html = inviteRowHtml({ username: '<img src=x onerror=alert(1)>', color: "red;}bad", friend: true });
  assert.ok(!html.includes("<img"), "the name is escaped");
  assert.ok(!html.includes("bad"), "and an unpalettable color is dropped");
});

test("solo rows: mine → Continue + Delete, viewable → Read, private → locked; the list caps and empties", () => {
  const mine = soloRowHtml({ id: "d1", title: "Mine", wordCount: 12, updatedAt: 0, visibility: "private", mine: true, viewable: true });
  assert.match(mine, /class="solo-row" data-id="d1"/);
  assert.match(mine, /href="\/write\?id=d1">Continue</);
  assert.match(mine, /class="ghost danger solo-del" data-id="d1"/);
  const pub = soloRowHtml({ id: "d2", title: "Theirs <b>", wordCount: 1, updatedAt: 0, visibility: "public", mine: false, viewable: true });
  assert.match(pub, /Read</);
  assert.doesNotMatch(pub, /solo-del/);
  assert.match(pub, /Theirs &lt;b&gt;/, "escaped");
  const priv = soloRowHtml({ id: "d3", title: "Secret", wordCount: 0, updatedAt: 0, visibility: "private", mine: false, viewable: false });
  assert.match(priv, /class="solo-row locked"/);
  assert.match(priv, /🔒 Private/);
  assert.doesNotMatch(priv, /href=/, "nothing to click");
  // an admin viewing someone else's shelf: Delete beside Read, or beside the lock
  const modPub = soloRowHtml({ id: "d4", title: "Theirs", wordCount: 1, updatedAt: 0, visibility: "public", mine: false, viewable: true, deletable: true });
  assert.match(modPub, /Read<\/a>/);
  assert.match(modPub, /class="ghost danger solo-del" data-id="d4"/);
  const modPriv = soloRowHtml({ id: "d5", title: "Secret", wordCount: 0, updatedAt: 0, visibility: "private", mine: false, viewable: false, deletable: true });
  assert.match(modPriv, /🔒 Private/);
  assert.match(modPriv, /solo-del/);
  assert.doesNotMatch(modPub, /Continue/, "deletable is not a pen");
  assert.match(soloListHtml([], { empty: "Nada." }), /Nada\./);
  const many = Array.from({ length: 7 }, (_, i) => ({ id: "x" + i, title: "T" + i, mine: true, viewable: true }));
  assert.equal((soloListHtml(many).match(/class="solo-row/g) || []).length, 5, "capped at 5");
});

test("wireSoloDeletes: the first click arms, the second deletes and removes the row", async () => {
  const box = document.createElement("div");
  box.innerHTML = soloListHtml([{ id: "d9", title: "Gone soon", mine: true, viewable: true }]);
  document.body.appendChild(box);
  const deleted = [];
  wireSoloDeletes(box, async (id) => deleted.push(id));
  const b = box.querySelector(".solo-del");
  b.click();
  assert.equal(b.dataset.armed, "1");
  assert.match(b.textContent, /Delete\?/);
  assert.deepEqual(deleted, []);
  b.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(deleted, ["d9"]);
  assert.equal(box.querySelector(".solo-row"), null, "row removed");
  box.remove();
});

test("sprints list: total, each row names its project, and a solo row wears its sprinted words", async () => {
  const { sprintListHtml, soloRowHtml } = await import("../public/js/write-view.js");
  assert.match(sprintListHtml([]), /No sprints yet/);
  const html = sprintListHtml(
    [{ docId: "d1", title: "Snow <b>Ball</b>", words: 210, seconds: 900, at: 1_700_000_000_000 }],
    { total: 210, count: 1 },
  );
  assert.match(html, /210 words across 1 sprint</);
  assert.ok(html.includes("Snow &lt;b&gt;Ball&lt;/b&gt;"), "titles are escaped");
  assert.ok(html.includes('href="/write?id=d1"') && html.includes("210 words in 15m 00s"));
  assert.match(soloRowHtml({ id: "d1", title: "T", wordCount: 5, sprintWords: 3, mine: true }), /⏱ 3 sprinted/);
  assert.doesNotMatch(soloRowHtml({ id: "d1", title: "T", wordCount: 5, mine: true }), /sprinted/);
});

test("promptInsertHtml: one centred paragraph, categories in bold, lines stacked; a curated line is just centred text; everything escaped", () => {
  const guided = "• Season: S2\n• Canon: canon-compliant\n• Trope: only one bed <b>x</b>";
  assert.equal(promptInsertHtml(guided), '<p class="al-c"><b>Season:</b> S2<br><b>Canon:</b> canon-compliant<br><b>Trope:</b> only one bed &lt;b&gt;x&lt;/b&gt;</p>');
  assert.equal(promptInsertHtml("Mike & Will, the last night before the move."), '<p class="al-c">Mike &amp; Will, the last night before the move.</p>');
  assert.equal(promptInsertHtml(""), "");
});

test("insertAfterHeading: right under the first heading, else at the very top", () => {
  document.body.innerHTML = `<div id="ed"><p>intro</p><h2>Chapter 1</h2><p>first</p></div>`;
  const ed = document.getElementById("ed");
  const node = insertAfterHeading(ed, '<p class="al-c"><b>Season:</b> S2</p>');
  assert.equal(node.className, "al-c");
  assert.equal(ed.children[2].outerHTML, '<p class="al-c"><b>Season:</b> S2</p>', "after the heading, before the text");
  document.body.innerHTML = `<div id="ed2"><p>no heading here</p></div>`;
  const ed2 = document.getElementById("ed2");
  insertAfterHeading(ed2, '<p class="al-c">x</p>');
  assert.equal(ed2.firstElementChild.textContent, "x", "at the top when there is no heading");
  assert.equal(insertAfterHeading(ed2, ""), null);
});

test("the write page carries the Prompt? chip (author only), the roller modal with Roll, Cancel and an Insert that waits for a roll, and Insert goes under the heading", () => {
  // the page plus its script (emitted from client/pages/write.ts), read as one text
  const src = readFileSync(new URL("../public/write.html", import.meta.url), "utf-8") + "\n" + readFileSync(new URL("../public/js/pages/write.js", import.meta.url), "utf-8");
  assert.match(src, /class="vis-opt menu-row hidden" id="promptBtn"/, "hidden until the author is known");
  assert.ok(src.includes('$("promptBtn").classList.toggle("hidden", !canEdit)'), "author only");
  assert.match(src, /id="promptModal"/);
  assert.match(src, /id="soloPrompt"/, "the game's mode picker is mounted inside");
  assert.ok(src.includes('mountPromptModes($("soloPrompt"), { prefix: "soloPm" })'));
  assert.match(src, /id="promptRollBtn"[^>]*>🎲 Roll</);
  assert.match(src, /id="promptCancel"[^>]*>Cancel</);
  assert.match(src, /class="primary hidden" id="promptInsert"[^>]*>Insert</, "Insert only after a roll");
  assert.ok(src.includes('$("promptInsert").classList.remove("hidden")'), "…revealed by showRolled");
  assert.ok(src.includes('api("/api/prompt/roll", { mode: promptMode, controls: promptControls })'));
  assert.ok(src.includes('insertAfterHeading($("docEditor"), promptInsertHtml(rolled.prompt))'));
  // [;\s]* because esbuild adds semicolons to the emitted script
  assert.ok(/insertAfterHeading\(\$\("docEditor"\), promptInsertHtml\(rolled\.prompt\)\)[;\s]*onEdit\(\{ immediate: true \}\)[;\s]*closePromptModal\(\)/.test(src), "an insert is an edit (dirty, undo step) and closes the modal");
});

test("the prompt roller's card is one list of category | value rows and the modal scrolls instead of overflowing", () => {
  const css = readFileSync(new URL("../public/css/base.css", import.meta.url), "utf-8");
  const card = css.match(/\.prompt-roll-card \{[^}]*\}/)[0];
  assert.match(card, /max-height: calc\(100vh - 32px\)/);
  assert.match(card, /overflow-y: auto/);
  assert.match(css, /\.prompt-roll-card \.prompt-roll-result \.prompt-grid \{\s*grid-template-columns:\s*max-content 1fr;\s*\}/, "never the two-pair ballot layout");
  assert.match(css.match(/\.prompt-roll-card \.prompt-roll-result \{[^}]*\}/)[0], /overflow-wrap: anywhere/);
});

test("betaReadingHtml: others' fics grouped by owner, mine excluded, empty is blank", () => {
  const docs = [
    { id: "a", title: "Mine", mine: true, owner: "me" },
    { id: "b", title: "Their Fic", mine: false, viewable: true, owner: "willbyers", visibility: "readers" },
    { id: "c", title: "Their Other", mine: false, viewable: true, owner: "willbyers", visibility: "readers" },
    { id: "d", title: "Someone", mine: false, viewable: true, owner: "mikewheeler", visibility: "public" },
  ];
  const h = betaReadingHtml(docs);
  assert.match(h, /Beta reading for willbyers/);
  assert.match(h, /Beta reading for mikewheeler/);
  assert.match(h, /Their Fic/);
  assert.doesNotMatch(h, /Mine/);
  assert.match(h, /data-owner="willbyers"[\s\S]*Their Fic[\s\S]*Their Other/);
  assert.equal(betaReadingHtml([{ id: "a", mine: true }]), "");
  assert.equal(betaReadingHtml([]), "");
});

test("sprint rows carry a Delete only when mine; wireSprintDeletes needs two clicks and posts the timestamp", async () => {
  const { sprintListHtml, sprintRowHtml, wireSprintDeletes } = await import("../public/js/write-view.js");
  const sp = { docId: "d1", title: "Chapter", words: 50, seconds: 60, at: 1_700_000_000_123 };
  // no delete on someone else's profile
  assert.doesNotMatch(sprintListHtml([sp], { total: 50, count: 1 }), /sprint-del/);
  assert.doesNotMatch(sprintRowHtml(sp), /sprint-del/);
  // delete appears with mine:true and carries the timestamp
  const mineHtml = sprintRowHtml(sp, { mine: true });
  assert.match(mineHtml, /class="[^"]*sprint-del[^"]*"[^>]*data-at="1700000000123"/);
  assert.match(sprintListHtml([sp], { total: 50, count: 1, mine: true }), /sprint-del/);

  // wiring: first click arms, second calls onDelete(at) and removes the row
  const box = document.createElement("div");
  box.innerHTML = sprintRowHtml(sp, { mine: true });
  document.body.appendChild(box);
  let got = null;
  wireSprintDeletes(box, async (at) => { got = at; });
  const btn = box.querySelector(".sprint-del");
  btn.click();
  assert.equal(btn.dataset.armed, "1");
  assert.match(btn.textContent, /Delete\?/);
  assert.equal(got, null, "first click only arms");
  btn.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(got, "1700000000123", "second click posts the timestamp");
  assert.equal(box.querySelector(".sprint-row"), null, "the row is removed");
});

// ---- chapters ----
const CHAPS = [
  { id: "aaaaaaaaaaaa", title: "One <b>bold</b>", html: "<p>one two three</p>", wordCount: 3 },
  { id: "bbbbbbbbbbbb", title: "Two", html: "<p>four five</p>" },
  { id: null, title: "", html: "" },
];

test("countWordsHtml mirrors the server's count: tags are spaces, entities are letters", () => {
  assert.equal(countWordsHtml("<h2>One</h2><p>Mike knocked twice.</p>"), 4);
  assert.equal(countWordsHtml("<p>don&#39;t stop</p>"), 2);
  assert.equal(countWordsHtml("<p>a&nbsp;b</p>"), 2);
  assert.equal(countWordsHtml("<p>said <b>won&#39;t</b>. The end</p>"), 4, "an inline tag never splits a word");
  assert.equal(countWordsHtml(""), 0);
});

test("chapterListHtml: an author's rows carry ↑ ↓ ✎ ✕ and an Add foot; the open row is marked; a reader gets a table of contents", () => {
  const out = chapterListHtml(CHAPS, { openIdx: 1, canEdit: true, commentCounts: { bbbbbbbbbbbb: 2 } });
  const rows = out.match(/<div class="chap-row[^"]*"/g);
  assert.equal(rows.length, 3);
  assert.match(out, /class="chap-row open" data-i="1" data-id="bbbbbbbbbbbb"/, "the open chapter is marked and keyed by id");
  assert.match(out, /class="chap-row" data-i="2">/, "an unsaved chapter has no id yet, only its position");
  assert.match(out, /One &lt;b&gt;bold&lt;\/b&gt;/, "titles are escaped");
  assert.match(out, /<span class="chap-title">Chapter 3<\/span>/, "an untitled chapter is numbered");
  assert.match(out, /<span class="chap-n">1<\/span>/);
  assert.match(out, /3 words/); assert.match(out, /2 words/, "a chapter with no wordCount is counted from its html");
  assert.match(out, /💬 2/, "the comment count sits on its chapter");
  assert.match(out, /class="chap-up" data-i="0"[^>]* disabled/, "the first can't move up");
  assert.match(out, /class="chap-down" data-i="2"[^>]* disabled/, "the last can't move down");
  assert.match(out, /class="chap-del" data-i="1"[^>]*>✕/);
  assert.match(out, /chap-add">\+ Add chapter/);
  assert.match(out, /3 chapters · 5 words/, "the foot totals");
  const single = chapterListHtml([CHAPS[0]], { canEdit: true });
  assert.match(single, /class="chap-del"[^>]*A story keeps at least one chapter[^>]* disabled/, "the last chapter can't be deleted");
  assert.match(single, /1 chapter · 3 words/);
  const reader = chapterListHtml(CHAPS, { openIdx: 0 });
  assert.ok(!/chap-acts|chap-add|chap-del/.test(reader), "a reader gets no controls");
  assert.match(out, /^<div class="doc-side-head chap-head"><h3>📑 Chapters<\/h3><button type="button" class="ghost doc-side-close chap-close"/, "the panel opens with a head and its own ✕");
  assert.match(reader, /chap-close/, "a reader can close it too");
  assert.match(reader, /class="chap-open" data-i="2"/, "but every chapter opens");
});

test("chapNavHtml: Prev/Next name their chapters, the ends are blank, one chapter has no nav; chapChipLabel", () => {
  assert.equal(chapNavHtml([CHAPS[0]], 0), "", "no nav for a single chapter");
  const first = chapNavHtml(CHAPS, 0);
  assert.match(first, /^<nav class="chap-nav"/);
  assert.match(first, /class="chap-arrow chap-prev" disabled/, "nothing before the first: the arrow stays, disabled");
  assert.match(first, /class="chap-arrow chap-next" data-i="1" aria-label="Two" data-tip="Two">›/);
  assert.match(first, /Chapter 1 of 3/);
  const last = chapNavHtml(CHAPS, 2);
  assert.match(last, /class="chap-arrow chap-prev" data-i="1" aria-label="Two"/);
  assert.match(last, /class="chap-arrow chap-next" disabled/);
  assert.match(chapNavHtml(CHAPS, 1), /aria-label="One &lt;b&gt;bold&lt;\/b&gt;"/, "escaped");
  assert.equal(chapChipLabel(CHAPS, 1), "📑 " + CHAPS[1].title, "the chip names the open chapter");
  assert.equal(chapChipLabel(CHAPS, 1, false), chapChipLabel(CHAPS, 1), "the same whether the panel is open or shut");
  assert.equal(chapChipLabel([{ title: "  " }], 0), "📑 Chapter 1", "a blank title falls back to its number");
  assert.equal(chapChipLabel([], 0), "📑");
  assert.equal(chapChipLabel(null, 0), "📑");
});

test("commentModeBannerHtml: names the mode, says the gesture, Done only for the author", () => {
  const author = commentModeBannerHtml({ canExit: true });
  assert.ok(author.includes("Comment mode"));
  assert.ok(author.includes("Select any words to leave a note"));
  assert.ok(author.includes('id="commentDone"'), "the author can leave");
  assert.ok(!author.includes(" · "), "no count when there are none");
  const reader = commentModeBannerHtml({ canExit: false, count: 1 });
  assert.ok(reader.includes("Reading to comment"));
  assert.ok(!reader.includes("commentDone"), "a reader is always in comment mode: nothing to leave");
  assert.ok(reader.includes(" · 1 note"), "singular");
  assert.ok(commentModeBannerHtml({ count: 3 }).includes(" · 3 notes"), "plural");
  assert.ok(commentModeBannerHtml().includes("commentDone"), "defaults to the author's strip");
});

test("visOptionsHtml: three radio rows, the current one ticked; fontListHtml: a row per face in its own face", async () => {
  const { visOptionsHtml } = await import("../public/js/write-view.js");
  const { fontListHtml, DOC_FONTS } = await import("../public/js/doc-prefs.js");
  const v = visOptionsHtml("readers");
  assert.equal((v.match(/role="menuitemradio"/g) || []).length, 3);
  assert.match(v, /class="vis-opt on"[^>]*aria-checked="true" data-vis="readers"/);
  assert.ok(!v.includes('id="visMenu"'), "rows only: the page owns the menu around them");
  const f = fontListHtml("theme");
  assert.equal((f.match(/data-font="/g) || []).length, DOC_FONTS.length);
  assert.match(f, /font-opt on"[^>]*aria-checked="true" data-font="theme"/);
  assert.match(f, /style="font-family:/);
});

// ---- threads: replies, pills, the ⋮ menu, the closing row ----
const REPLY = { id: "r1", text: "good catch", author: "nina", color: "#6c8cff", ts: Date.now(), isAuthor: true };
const THREAD = { id: "c9", cid: "abcdef012345", text: "intentional?", author: "mike", color: "#e63946", ts: Date.now(), replies: [REPLY] };

test("every voice wears a pill: beta on a reader, author on the writer", () => {
  const html = commentHtml(THREAD);
  assert.match(html, /dc-tag beta">beta</, "the reader's note");
  assert.match(html, /data-rid="r1"[\s\S]*dc-tag author">author</, "the author's reply");
});

test("reply text is escaped", () => {
  const html = commentHtml({ ...THREAD, replies: [{ ...REPLY, text: "<img src=x onerror=1>" }] });
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img"));
});

test("the reply box is only for people who may write on the document", () => {
  assert.ok(commentHtml(THREAD, { canReply: true }).includes("dc-reply-input"));
  assert.ok(!commentHtml(THREAD).includes("dc-reply-input"), "a public reader just reads");
  assert.ok(!commentHtml({ ...THREAD, resolved: true }, { canReply: true }).includes("dc-reply-input"), "a closed thread takes no replies");
});

test("the closing row: the author resolves or rejects, a reader only resolves their own", () => {
  const owner = commentHtml(THREAD, { isOwner: true, meName: "nina" });
  assert.ok(owner.includes("dc-resolve") && owner.includes("dc-decline"));
  const own = commentHtml(THREAD, { meName: "mike" });
  assert.ok(own.includes("dc-resolve") && !own.includes("dc-decline"), "Reject is the author's verdict");
  assert.ok(!commentHtml(THREAD, { meName: "zed" }).includes("dc-actions"));
});

test("⋮ offers Edit on your own words only; the author may delete anyone's", () => {
  const menus = (html) => [...html.matchAll(/<span class="dc-menu hidden" role="menu">(.*?)<\/span><\/span>/g)].map((m) => m[1]);
  const [noteForOwner, replyForOwner] = menus(commentHtml(THREAD, { isOwner: true, meName: "nina" }));
  assert.ok(noteForOwner.includes("dc-del") && !noteForOwner.includes("dc-edit"), "the author can't rewrite a reader's note");
  assert.ok(replyForOwner.includes("dc-edit") && replyForOwner.includes("dc-del"));
  const forMike = menus(commentHtml(THREAD, { meName: "mike" }));
  assert.equal(forMike.length, 1, "no menu on the author's reply for a reader");
  assert.ok(forMike[0].includes("dc-edit") && forMike[0].includes("dc-del"));
  assert.equal(menus(commentHtml(THREAD, { meName: "zed" })).length, 0, "a bystander gets no ⋮ at all");
});

test("a closed thread says how it closed and how long it ran", () => {
  const done = commentHtml({ ...THREAD, resolved: true, replies: [REPLY, { ...REPLY, id: "r2" }] });
  assert.ok(done.includes("✓ resolved") && done.includes("2 replies"));
  assert.ok(commentHtml({ ...THREAD, resolved: true, declined: true }).includes("✕ declined"));
  assert.ok(commentHtml({ ...THREAD, resolved: true }).includes("1 reply"));
});

test("an edited note says so; a comment from before threads still renders", () => {
  assert.ok(commentHtml({ ...THREAD, edited: true }).includes("· edited"));
  const { replies, ...old } = THREAD;
  assert.ok(!commentHtml(old).includes("dc-replies"));
});

// ---- version history ----
test("the version list says when, how long, how it differs from the page, and why a copy was kept", () => {
  const at = Date.UTC(2026, 8, 21, 17, 30);
  const html = versionListHtml([{ at, reason: "drop", words: 17000, chapters: 3 }, { at: at - 600000, reason: "time", words: 14000, chapters: 1 }], 14000, 2);
  assert.match(html, /class="history-row drop" data-at="\d+"/);
  assert.ok(html.includes('class="history-now">Now: <b>14,000 words</b> · 2 chapters'), "the figure every row is measured against is on screen too");
  assert.ok(!versionListHtml([{ at, reason: "time", words: 1, chapters: 1 }], 1, 1).includes("chapters"), "one chapter goes unsaid");
  assert.ok(html.includes("17,000 words") && html.includes("3,000 more than now") && html.includes("3 chapters"));
  assert.ok(html.includes("Kept because the next save was much shorter"));
  assert.ok(html.includes("same length as now"));
  assert.equal((html.match(/history-restore/g) || []).length, 2);
  assert.equal((html.match(/history-get/g) || []).length, 2);
  assert.ok(versionListHtml([]).includes("No earlier copies yet"));
  assert.ok(!versionListHtml([{ at, reason: '"><img>', words: 1, chapters: 1 }]).includes("<img"));
});
