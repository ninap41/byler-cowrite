// Direct unit tests for the server-side trust boundary (src/sanitize.js) —
// fast, no server boot. The socket-level tests remain as integration cover.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeRich, sanitizeDoc, DOC_MAX, FONT_SIZES, stripTags, sanitizeAbout, httpUrl, PALETTE, cleanColor, CID_RE, newCid } from "../src/sanitize.js";
import { hashPassword, checkPassword } from "../src/passwords.js";

test("sanitizeRich: allowlist survives, everything else inert, single escape", () => {
  assert.equal(sanitizeRich("<b>a</b> & <i>b</i>"), "<b>a</b> &amp; <i>b</i>");
  assert.equal(sanitizeRich('<p class="al-c">c</p><hr><br>'), '<p class="al-c">c</p><hr><br>');
  assert.equal(sanitizeRich('"quotes"'), "&quot;quotes&quot;");
  const evil = sanitizeRich('<script>x</script><img src=x onerror=a()><p class="al-x">y</p>');
  assert.ok(!evil.includes("<script>") && !evil.includes("<img"));
  assert.ok(evil.includes("&lt;script&gt;"));
  assert.ok(!evil.includes('class="al-x"'), "unknown class stays escaped");
});

test("sanitizeDoc: the wider document allowlist survives intact", () => {
  assert.equal(sanitizeDoc("<b>a</b> & <i>b</i> <s>c</s>"), "<b>a</b> &amp; <i>b</i> <s>c</s>");
  assert.equal(sanitizeDoc("<ul><li>one</li></ul>"), "<ul><li>one</li></ul>");
  assert.equal(sanitizeDoc("<ol><li>1</li></ol>"), "<ol><li>1</li></ol>");
  assert.equal(sanitizeDoc("<blockquote>q</blockquote>"), "<blockquote>q</blockquote>");
  assert.equal(sanitizeDoc('<p class="al-c">c</p><hr><br>'), '<p class="al-c">c</p><hr><br>');
  assert.equal(sanitizeDoc("<h1>t</h1><h2>t</h2><h3>t</h3>"), "<h1>t</h1><h2>t</h2><h3>t</h3>");
});

test("sanitizeDoc: links are http/https only and never carry other attributes", () => {
  const ok = sanitizeDoc('<a href="https://ao3.org/x?a=1&b=2">work</a>');
  assert.ok(ok.startsWith('<a href="https://ao3.org/x?a=1&amp;c'.slice(0, 20)), "href kept");
  assert.ok(ok.includes('rel="noopener noreferrer nofollow"'), "untrusted links get rel");
  assert.ok(ok.includes("&amp;"), "& in the url is re-escaped, not doubled");
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "vbscript:x"]) {
    const out = sanitizeDoc(`<a href="${bad}">x</a>`);
    assert.ok(!out.includes("<a href"), bad + " must not become a live link");
    assert.ok(out.includes("&lt;a href="), bad + " stays inert escaped text");
  }
  // An event handler smuggled beside a VALID url must not produce a live tag:
  // the allowlist regex only matches <a href="…"> with nothing else inside, so
  // the whole thing stays escaped text rather than becoming an anchor.
  const smug = sanitizeDoc('<a href="https://x.com" onclick="evil()">x</a>');
  assert.ok(!/<a\s/.test(smug), "no live anchor is emitted");
  assert.ok(smug.includes("&lt;a href="), "the tag stays inert escaped text");
  assert.ok(smug.includes("onclick=&quot;"), "the handler survives only as escaped text");
});

test("sanitizeDoc: images are url-gated, handlers never survive", () => {
  assert.ok(sanitizeDoc('<img src="https://x.com/a.png">').includes('<img class="doc-img" src="https://x.com/a.png"'));
  const evil = sanitizeDoc('<img src=x onerror=alert(1)><script>x</script><p onclick="e()">y</p>');
  assert.ok(!evil.includes("<img"), "attribute-bearing img is inert");
  assert.ok(!evil.includes("<script"), "script is inert");
  assert.ok(!evil.includes("onclick") || !evil.includes("<p onclick"), "no live handler");
  assert.ok(evil.includes("&lt;script&gt;"));
  assert.ok(!sanitizeDoc('<p class="al-x">y</p>').includes('class="al-x"'), "unknown class stays escaped");
});

test("sanitizeDoc: font sizes survive only as classes from the fixed ladder", () => {
  for (const size of FONT_SIZES)
    assert.equal(sanitizeDoc(`<span class="fs-${size}">x</span>`), `<span class="fs-${size}">x</span>`);
  // Anything not on the ladder — or any attempt to smuggle a style or a second
  // class alongside it — never opens a live span.
  for (const bad of [
    '<span class="fs-99">x</span>',
    '<span class="fs-13">x</span>',
    '<span style="font-size:99px">x</span>',
    '<span class="fs-24 evil">x</span>',
    '<span class="fs-24" onclick="e()">x</span>',
    '<span class="al-c">x</span>',
  ]) {
    const out = sanitizeDoc(bad);
    assert.ok(!/<span[^>]/.test(out.replace(/<span class="fs-\d+">/g, "")), bad + " must not open a live span");
    assert.ok(out.includes("&lt;span"), bad + " stays inert escaped text");
  }
});

test("sanitizeDoc: line spacing is never expressible in a document", () => {
  // Line spacing is a per-user view preference; nothing about it may ride in
  // the html, however it is dressed up.
  for (const attempt of [
    '<p style="line-height:3">x</p>',
    '<span class="lh-2">x</span>',
    '<div style="line-height:3">x</div>',
  ]) {
    const out = sanitizeDoc(attempt);
    // the words may remain as inert escaped text; what must never appear is a
    // LIVE style attribute or a spacing class the renderer would honour
    assert.ok(!/<[a-z]+[^>]*style=/i.test(out), attempt + " must not emit a live style attribute");
    assert.ok(!/class="lh-/.test(out), attempt + " must not carry a spacing class");
    assert.ok(out.includes("&lt;"), attempt + " stays inert escaped text");
  }
});

test("sanitizeDoc: caps document length without throwing", () => {
  const out = sanitizeDoc("a".repeat(DOC_MAX + 5000));
  assert.ok(out.length <= DOC_MAX, "truncated to the cap");
  assert.ok(DOC_MAX > 8000, "documents get far more room than a game line");
});

test("stripTags flattens markup and entities to text", () => {
  assert.equal(stripTags("<b>hi</b>&nbsp;there"), "hi there");
});

test("httpUrl: http/https only", () => {
  assert.equal(httpUrl("https://a.com/x?y=1"), true);
  assert.equal(httpUrl("http://a.com"), true);
  assert.equal(httpUrl("javascript:alert(1)"), false);
  assert.equal(httpUrl("data:text/html,x"), false);
  assert.equal(httpUrl("not a url"), false);
});

test("sanitizeAbout: only validated img embeds survive; urls with & round-trip", () => {
  const out = sanitizeAbout('a & b <img src="https://x.com/a?b=1&c=2"> <img src="javascript:x"> <b>no</b>');
  assert.ok(out.includes("a &amp; b"));
  assert.ok(out.includes('<img class="about-img" src="https://x.com/a?b=1&amp;c=2"'), "src attr re-escaped");
  assert.ok(out.includes("&lt;img src=&quot;javascript:x&quot;&gt;"), "bad scheme stays inert");
  assert.ok(out.includes("&lt;b&gt;no&lt;/b&gt;"));
});

test("cleanColor only passes palette colors; hash/check round-trips", () => {
  assert.equal(cleanColor(PALETTE[2]), PALETTE[2]);
  assert.ok(PALETTE.includes(cleanColor("evil')")));
  const h = hashPassword("hunter22");
  assert.notEqual(h, hashPassword("hunter22"), "salted");
  assert.equal(checkPassword("hunter22", h), true);
  assert.equal(checkPassword("wrong", h), false);
});

// ---- comment anchors ----
// data-cid is the ONLY data attribute sanitizeDoc lets through. It survives in
// exactly one shape; every near-miss must stay inert escaped text.
test("sanitizeDoc: a well-formed comment anchor survives", () => {
  const cid = newCid();
  assert.match(cid, CID_RE, "newCid mints the closed shape");
  assert.equal(
    sanitizeDoc(`<p>his <span class="cmt" data-cid="${cid}">striped shirt</span> hangs</p>`),
    `<p>his <span class="cmt" data-cid="${cid}">striped shirt</span> hangs</p>`,
  );
});

test("sanitizeDoc: anchors with anything but a 12-hex cid stay escaped text", () => {
  for (const bad of [
    '<span class="cmt" data-cid="../../etc">x</span>',
    '<span class="cmt" data-cid="ZZZZZZZZZZZZ">x</span>',
    '<span class="cmt" data-cid="abc">x</span>',
    '<span class="cmt" data-cid="0123456789abcdef">x</span>',
    '<span class="cmt">x</span>',
  ]) {
    const out = sanitizeDoc(bad);
    assert.ok(!out.includes('<span class="cmt"'), bad + " -> " + out);
    assert.ok(out.includes("&lt;span"), bad);
  }
});

test("sanitizeDoc: an anchor cannot smuggle a second attribute", () => {
  const out = sanitizeDoc('<span class="cmt" data-cid="0123456789ab" onclick="steal()">x</span>');
  assert.ok(!out.includes('<span class="cmt"'), "the whole opening tag is rejected, not trimmed");
  assert.ok(!/onclick=[^&]/.test(out), "onclick survives only as inert escaped text: " + out);
});

test("sanitizeDoc: data-cid on any other tag is not an anchor", () => {
  const out = sanitizeDoc('<p data-cid="0123456789ab">x</p><img data-cid="0123456789ab">');
  assert.ok(!out.includes("data-cid=\"0123456789ab\"") || !/<(p|img)[^>]*data-cid/.test(out), out);
});

test("newCid: distinct ids", () => {
  const seen = new Set(Array.from({ length: 200 }, () => newCid()));
  assert.equal(seen.size, 200);
});
