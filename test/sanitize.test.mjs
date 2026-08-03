// Direct unit tests for the server-side trust boundary (src/sanitize.js) —
// fast, no server boot. The socket-level tests remain as integration cover.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeRich, stripTags, sanitizeAbout, httpUrl, PALETTE, cleanColor } from "../src/sanitize.js";
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
