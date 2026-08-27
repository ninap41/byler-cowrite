import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../lib/markdown.js";
import { sanitizeRich } from "../src/sanitize.js";

test("headings, paragraphs, inline marks, lists, quotes, rules", () => {
  const md = "# Title\n\nHello **bold** and *it* ~~gone~~\nsecond line\n\n- a\n- b\n\n1. one\n2. two\n\n> quoted\n\n---";
  assert.equal(renderMarkdown(md),
    "<h1>Title</h1><p>Hello <b>bold</b> and <i>it</i> <s>gone</s><br>second line</p><ul><li>a</li><li>b</li></ul><ol><li>one</li><li>two</li></ol><blockquote><p>quoted</p></blockquote><hr>");
});

test("raw html is escaped and the output survives sanitizeRich unchanged", () => {
  const html = renderMarkdown("## Hi <script>x()</script>\n\n<img src=x onerror=1> **ok**");
  assert.ok(!html.includes("<script>") && !html.includes("<img"));
  assert.ok(!sanitizeRich(html).includes("<script") && sanitizeRich(html).includes("<b>ok</b>"));
});
