// /announcements builders: the composer (a markdown textarea + Post to Discord) and Delete exist
// only in an admin's markup; a post's html is injected as-is (server-sanitized)
// while the plain fields are escaped.
import test from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.mjs";

installDom();
const { postHtml, postListHtml, composerHtml } = await import("../public/js/announcements-view.js");

const post = { id: "abc", title: "Big news", html: "<h2>Big news</h2><p>First <b>para</b></p>", at: 1_700_000_000_000, byName: "nina<admin>" };

test("a normal account's page has no Delete button and no composer markup at all", () => {
  const html = postListHtml([post], { admin: false });
  assert.ok(!html.includes("data-ann-delete") && !html.includes("Delete"));
  assert.ok(!postListHtml([post]).includes("data-ann-delete"), "admin defaults to false");
});

test("an admin's page carries Delete on every post and a markdown composer with a Post to Discord button", () => {
  const html = postListHtml([post, { ...post, id: "def" }], { admin: true });
  assert.ok(html.includes('data-ann-delete="abc"') && html.includes('data-ann-delete="def"'));
  const c = composerHtml();
  assert.ok(c.includes('<textarea class="ann-editor" id="annEditor"') && c.includes('id="annPost"'));
  assert.ok(html.includes('data-ann-discord="abc"'), "each post has Post to Discord");
  assert.ok(!postListHtml([post], { admin: false }).includes("data-ann-discord"), "and a normal account doesn't");
  assert.ok(!c.includes("contenteditable") && !c.includes("toolbar"), "no WYSIWYG: markdown only");
});

test("the post's html is injected as-is (it was sanitized when posted), the head is date + author, escaped", () => {
  const html = postHtml(post, { admin: true });
  assert.ok(html.includes("<h2>Big news</h2><p>First <b>para</b></p>"), "the heading IS the title, nothing repeats it");
  assert.ok(!html.includes("<h3>Big news</h3>"));
  assert.ok(html.includes("nina&lt;admin&gt;"));
  assert.match(postListHtml([]), /Nothing announced yet/);
});
