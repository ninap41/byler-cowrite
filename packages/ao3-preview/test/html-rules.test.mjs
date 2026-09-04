// AO3's HTML rules for the Work Content fields (html-rules.js) — mirroring
// otwarchive's sanitizer_config.rb / html_cleaner.rb / config.yml and the
// "Formatting content on AO3 with HTML" FAQ.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as H from "../public/ao3/html-rules.js";

const codes = (text, kind) => H.lintHtml(text, kind).problems.map((p) => p.code);

test("the whitelist is the FAQ's list, and clean HTML passes", () => {
  // the FAQ's tag list (attributes in brackets left out)
  const faq = "a, abbr, acronym, address, b, big, blockquote, br, caption, center, cite, code, col, colgroup, dd, del, details, dfn, div, dl, dt, em, figcaption, figure, h1, h2, h3, h4, h5, h6, hr, i, img, ins, kbd, li, ol, p, pre, q, ruby, rt, rp, s, samp, small, span, strike, strong, sub, summary, sup, table, tbody, td, tfoot, th, thead, tr, tt, u, ul, var".split(", ");
  assert.deepEqual([...H.ELEMENTS].sort(), [...faq].sort());
  assert.deepEqual(codes('<p class="note">a <b>b</b> <a href="https://x.y">l</a> <img src="https://x.y/a.png" alt="" width="200"></p><hr><ul type="disc"><li>i</li></ul><details open><summary>s</summary>t</details>', "content"), []);
  assert.deepEqual(codes("<p>a</p>\n<p>b</p>", "summary"), []);
});

test("tags: off-list removed (text kept), remove_contents lose their insides, unclosed/stray are notes", () => {
  assert.deepEqual(codes("<font color=red>x</font>", "content"), ["tag_removed"]);
  assert.deepEqual(codes("<script>alert(1)</script>", "content"), ["removed_with_contents"]);
  assert.deepEqual(codes("<style>p{}</style><svg></svg>", "content"), ["removed_with_contents", "removed_with_contents"]);
  const r = H.lintHtml("<p>a<b>b</p>", "content").problems;
  assert.deepEqual(r.map((p) => [p.code, p.tag, p.severity]), [["unclosed", "b", "info"]]);
  assert.deepEqual(codes("a</i>", "content"), ["stray_close"]);
  assert.deepEqual(codes("<br><hr/><img src=\"https://a.b/c.png\">", "content"), [], "void tags never read as unclosed");
});

test("attributes: per-tag list + align/dir/lang/title; style and on* never; class only in work text and notes; protocols", () => {
  assert.deepEqual(codes('<p style="color:red">x</p>', "content"), ["inline_style"]);
  assert.deepEqual(codes('<a href="https://x.y" onclick="x()">l</a>', "content"), ["event_attr"]);
  assert.deepEqual(codes('<p id="x" data-y="1">x</p>', "content"), ["attr_removed", "attr_removed"]);
  assert.deepEqual(codes('<td colspan="2" scope="row">x</td>', "content"), ["attr_removed"], "scope is a th attribute, not td");
  assert.deepEqual(codes('<p class="note">x</p>', "content"), []);
  assert.deepEqual(codes('<p class="note">x</p>', "notes"), []);
  assert.deepEqual(codes('<p class="note">x</p>', "summary"), ["class_not_here"]);
  assert.deepEqual(codes('<p class="1st -x ok_1 y">x</p>', "content"), ["class_name"]);
  assert.deepEqual(codes('<a href="javascript:alert(1)">l</a>', "content"), ["protocol"]);
  assert.deepEqual(codes('<a href="mailto:a@b.c">l</a><a href="/works/1">r</a><a href="ftp://x">f</a>', "content"), []);
  assert.deepEqual(codes('<img src="/images/a.png">', "content"), ["protocol"], "img src must be http(s)");
  assert.deepEqual(codes('<img src="data:image/png;base64,xx">', "content"), ["protocol"]);
  assert.deepEqual(codes('<blockquote cite="https://x.y">q</blockquote>', "content"), []);
});

test("embeds: only in work text, only from AO3's hosts", () => {
  assert.deepEqual(codes('<iframe src="https://www.youtube.com/embed/abc"></iframe>', "content"), []);
  assert.deepEqual(codes('<iframe src="https://player.vimeo.com/video/1"></iframe>', "content"), []);
  assert.deepEqual(codes('<iframe src="https://evil.example/x"></iframe>', "content"), ["embed_host"]);
  assert.deepEqual(codes('<iframe src="https://www.youtube.com/embed/abc"></iframe>', "notes"), ["embed_not_here"]);
  assert.deepEqual(codes('<embed src="https://open.spotify.com/embed/track/1">', "content"), []);
});

test("limits and titles: SUMMARY_MAX 1250, NOTES_MAX 5000, CONTENT_MAX 510000, TITLE_MAX 255; a title takes no HTML; comments are stripped", () => {
  assert.deepEqual(H.FIELD_KINDS.summary.max, 1250);
  assert.deepEqual(H.FIELD_KINDS.notes.max, 5000);
  assert.deepEqual(H.FIELD_KINDS.content.max, 510000);
  assert.deepEqual(H.FIELD_KINDS.title.max, 255);
  assert.deepEqual(codes("x".repeat(1251), "summary"), ["too_long"]);
  assert.deepEqual(codes("x".repeat(1250), "summary"), []);
  assert.deepEqual(codes("<b>t</b>", "title"), ["no_html"]);
  assert.deepEqual(codes("x".repeat(256), "title"), ["too_long"]);
  assert.deepEqual(codes("<!-- c --><p>x</p>", "content"), ["comment"]);
  // field ids map to kinds
  assert.equal(H.FIELD_KIND.chapterSummary, "summary");
  assert.equal(H.FIELD_KIND.chapterEndNotes, "notes");
  assert.equal(H.FIELD_KIND.chapterText, "content");
  assert.deepEqual(H.lintField("summary", '<p class="note">s</p>').map((p) => p.code), ["class_not_here"]);
  assert.deepEqual(H.lintField("chapterText", '<p class="note">s</p>'), []);
  assert.deepEqual(H.lintField("chapterText", '<p class="x">s</p>').map((p) => p.code), ["class_name"], "AO3's class regex /^[a-zA-Z][\\w-]+$/ needs two characters — a one-letter class is dropped");
});

test("the shipped boilerplate is clean under AO3's rules", async () => {
  const W = await import("../public/ao3/work-content.js");
  for (const f of W.WORK_FIELDS) {
    if (f.kind !== "html" && !(f.id in { title: 1, chapterTitle: 1 })) continue;
    const ps = H.lintField(f.id, W.WORK_DEFAULTS[f.id]).filter((p) => p.severity !== "info");
    assert.deepEqual(ps, [], f.id);
  }
});
