// /announcements builders: the composer and Delete exist only in an admin's
// markup, and every user-supplied string is escaped.
import test from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.mjs";

installDom();
const { postHtml, postListHtml, composerHtml, bodyHtml } = await import("../public/js/announcements-view.js");

const post = { id: "abc", title: "Big <news>", body: "First para\nsame para\n\nSecond <b>para</b>", at: 1_700_000_000_000, byName: "nina<admin>" };

test("a normal account's page has no Delete button and no composer markup at all", () => {
  const html = postListHtml([post], { admin: false });
  assert.ok(!html.includes("data-ann-delete"), "no delete button");
  assert.ok(!html.includes("Delete"));
  assert.ok(!postListHtml([post]).includes("data-ann-delete"), "admin defaults to false");
});

test("an admin's page carries Delete on every post", () => {
  const html = postListHtml([post, { ...post, id: "def" }], { admin: true });
  assert.ok(html.includes('data-ann-delete="abc"') && html.includes('data-ann-delete="def"'));
  assert.ok(composerHtml().includes('id="annComposer"') && composerHtml().includes("annTitle") && composerHtml().includes("annBody"));
});

test("titles, authors and bodies are escaped; blank lines paragraph, single breaks stay", () => {
  const html = postHtml(post, { admin: true });
  assert.ok(html.includes("Big &lt;news&gt;") && !html.includes("<news>"));
  assert.ok(html.includes("nina&lt;admin&gt;"));
  assert.equal(bodyHtml(post.body), "<p>First para<br />same para</p><p>Second &lt;b&gt;para&lt;/b&gt;</p>");
  assert.match(postListHtml([]), /Nothing announced yet/);
});
