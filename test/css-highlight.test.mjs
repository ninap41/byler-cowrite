import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { highlightCss, tokenize, plainOf } from "../public/ao3/css-highlight.js";

const SAMPLES = [
  `#workskin .note:hover > p, .a[data-x="1"] { color: #900; margin: 0 .5em 12px; font-family: "Lucida Grande", serif; background: url(https://x.com/a.png) no-repeat !important; --gap: 1px; width: var(--gap) }`,
  `/* a comment\n across lines */\n@media (max-width: 600px) {\n  #workskin p { color: blue }\n}\n@import url(x.css);\n`,
  `a { color: red; broken; b: "unterminated }`,
  ``,
  `\n\n`,
  readFileSync(new URL("../public/ao3/default-skin.css", import.meta.url), "utf-8"),
  readFileSync(new URL("../public/ao3/default-skin-webscraped.css", import.meta.url), "utf-8"),
];

test("the highlight layer reproduces every character of the input, escaped, in order", () => {
  for (const src of SAMPLES) {
    assert.equal(tokenize(src).map((t) => t.text).join(""), src, "tokens concatenate to the source");
    const html = highlightCss(src);
    // each line wrapper appends one \n; the source's own \n's are inside the wrappers' boundaries
    const lines = src.split("\n");
    assert.equal((html.match(/<span class="hl-line/g) || []).length, lines.length, "one .hl-line per source line");
    assert.equal(plainOf(html), lines.map((l) => l + "\n").join(""), "plain text = source with a newline per line");
  }
});

test("tokens get the right classes", () => {
  const html = highlightCss(SAMPLES[0]);
  for (const [cls, text] of [
    ["hl-sel-id", "#workskin"], ["hl-sel-class", ".note"], ["hl-sel-pseudo", ":hover"], ["hl-sel-attr", "[data-x=&quot;1&quot;]"],
    ["hl-prop", "color"], ["hl-color", "#900"], ["hl-num", ".5em"], ["hl-num", "12px"], ["hl-str", "&quot;Lucida Grande&quot;"],
    ["hl-fn", "url"], ["hl-imp", "!important"], ["hl-custom", "--gap"], ["hl-fn", "var"], ["hl-val", "no-repeat"], ["hl-val", "serif"],
  ]) assert.ok(html.includes(cls === "hl-color" ? `<span class="hl-color" style="text-decoration-color:#900">#900</span>` : `<span class="${cls}">${text}</span>`), `${cls} ${text}`);
  const h2 = highlightCss(SAMPLES[1]);
  assert.ok(h2.includes('<span class="hl-at">@media (max-width: 600px) </span>'), "at-rule prelude");
  assert.ok(h2.includes('<span class="hl-at">@import url(x.css)</span>'), "bare at-rule");
  assert.ok(h2.includes('<span class="hl-comment">/* a comment</span>') && h2.includes('<span class="hl-comment"> across lines */</span>'), "a comment split per line");
  assert.ok(h2.includes('<span class="hl-sel-id">#workskin</span>'), "a rule nested in @media still highlights");
});

test("lint lines are tinted; html in the source is escaped, never markup", () => {
  const html = highlightCss("a { color: red }\nb { gap: 1px }\nc { x: 1 }", { badLines: new Set([2]), warnLines: new Set([3]) });
  assert.match(html, /<span class="hl-line hl-bad"><span class="hl-sel">b<\/span>/);
  assert.match(html, /<span class="hl-line hl-warn"><span class="hl-sel">c<\/span>/);
  assert.match(html, /^<span class="hl-line"><span class="hl-sel">a<\/span>/);
  const evil = highlightCss(`<script>alert(1)</script> { content: "<b>" }`);
  assert.ok(!evil.includes("<script") && evil.includes("&lt;script") && evil.includes("&lt;b&gt;"));
  assert.ok(highlightCss("@font-face { font-family: x }").includes('<span class="hl-prop">font-family</span>'), "@font-face holds declarations");
  assert.ok(!highlightCss("a{color:#zz}").includes("style="), "only a real hex gets an inline colour");
  assert.ok(!highlightCss('a{color:#900"onmouseover="x"}').includes('style="text-decoration-color:#900"o'), "nothing user-typed reaches the style attribute");
});
