import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom, mount } from "./dom.mjs";

installDom();
const { cleanHtml, asterisksToTags, newCid } = await import("../public/js/components/editor.js");

// Normalization table for the contenteditable -> safe-subset converter.
// Mirrors the server-side sanitizer tests: both sides of the trust boundary
// are pinned. cleanHtml is convenience, sanitizeRich() is the security control.
const CASES = [
  ["plain text", "hello there", "hello there"],
  ["text passes through RAW — the server escapes exactly once", `a <div>&"'</div>`, `a <p>&"'</p>`],
  ["b/strong -> b, i/em -> i, u -> u", "<b>a</b><strong>b</strong><em>c</em><i>d</i><u>e</u>", "<b>a</b><b>b</b><i>c</i><i>d</i><u>e</u>"],
  ["DIV becomes p", "<div>line</div>", "<p>line</p>"],
  ["headings pass through", "<h1>t</h1><h2>u</h2><h3>v</h3>", "<h1>t</h1><h2>u</h2><h3>v</h3>"],
  ["br and hr kept", "a<br><hr>", "a<br><hr>"],
  ["center alignment via style", '<p style="text-align:center">c</p>', '<p class="al-c">c</p>'],
  ["right alignment via align attr", '<p align="right">r</p>', '<p class="al-r">r</p>'],
  ["left/junk alignment dropped", '<p style="text-align:left">l</p>', "<p>l</p>"],
  ["unknown tags unwrapped, content kept", "<span><b>keep</b></span><script>x</script>", "<b>keep</b>x"],
  ["attributes never survive", '<b onclick="pwn()">a</b><h1 id="x">t</h1>', "<b>a</b><h1>t</h1>"],
  ["empty blocks dropped, hr-only blocks kept", "<p>  </p><div><hr></div>", "<p><hr></p>"],
  ["nested block inside div flattens to inner", "<div><h2>title</h2></div>", "<p><h2>title</h2></p>"],
];

for (const [name, input, expected] of CASES) {
  test(`cleanHtml: ${name}`, () => {
    const el = mount(input);
    assert.equal(cleanHtml(el), expected);
  });
}

// The solo-write document subset ({doc:true}) adds lists, quotes, strike,
// links and images on top of everything above.
const DOC_CASES = [
  ["lists survive", "<ul><li>a</li><li>b</li></ul>", "<ul><li>a</li><li>b</li></ul>"],
  ["ordered lists survive", "<ol><li>a</li></ol>", "<ol><li>a</li></ol>"],
  ["empty list containers are kept (they hold the items)", "<ul></ul>", "<ul></ul>"],
  ["blockquote survives", "<blockquote>q</blockquote>", "<blockquote>q</blockquote>"],
  ["s/strike/del all normalize to s", "<s>a</s><strike>b</strike><del>c</del>", "<s>a</s><s>b</s><s>c</s>"],
  ["http links keep only their href", '<a href="https://x.com" onclick="e()">t</a>', '<a href="https://x.com">t</a>'],
  ["non-http links are unwrapped, text kept", '<a href="javascript:alert(1)">t</a>', "t"],
  ["http images keep only their src", '<img src="https://x.com/a.png" onerror="e()">', '<img src="https://x.com/a.png">'],
  ["non-http images are dropped entirely", '<img src="javascript:x">', ""],
  ["quote blocks take alignment too", '<blockquote style="text-align:center">c</blockquote>', '<blockquote class="al-c">c</blockquote>'],
];

for (const [name, input, expected] of DOC_CASES) {
  test(`cleanHtml doc mode: ${name}`, () => {
    const el = mount(input);
    assert.equal(cleanHtml(el, { doc: true }), expected);
  });
}

// Word processors carry emphasis as inline STYLE, not tags. Without reading
// styles, a pasted Google Docs draft loses every italic it had.
const STYLE_CASES = [
  ["span font-style:italic becomes i", '<span style="font-style:italic">x</span>', "<i>x</i>"],
  ["span font-weight:700 becomes b", '<span style="font-weight:700">x</span>', "<b>x</b>"],
  ["span font-weight:bold becomes b", '<span style="font-weight:bold">x</span>', "<b>x</b>"],
  ["underline style becomes u", '<span style="text-decoration:underline">x</span>', "<u>x</u>"],
  ["line-through style becomes s", '<span style="text-decoration:line-through">x</span>', "<s>x</s>"],
  ["nested styles compose", '<span style="font-style:italic"><span style="font-weight:700">x</span></span>', "<i><b>x</b></i>"],
  ["styles wrap inside a block, not around it", '<p style="font-style:italic">x</p>', "<p><i>x</i></p>"],
  // Google Docs wraps its whole clipboard payload in <b style="font-weight:normal">.
  // If a tag can't cancel itself, the entire pasted document comes out bold.
  ["an explicit normal weight cancels a b tag", '<b style="font-weight:normal">x</b>', "x"],
  ["an explicit normal style cancels an i tag", '<i style="font-style:normal">x</i>', "x"],
  ["but a bare b/i still means what it says", "<b>a</b><i>c</i>", "<b>a</b><i>c</i>"],
];

for (const [name, input, expected] of STYLE_CASES) {
  test(`cleanHtml doc mode: ${name}`, () => {
    assert.equal(cleanHtml(mount(input), { doc: true }), expected);
  });
}

test("cleanHtml: a real Google Docs paste keeps its italics and isn't all bold", () => {
  const gdocs =
    '<b style="font-weight:normal" id="docs-internal-guid-1"><p dir="ltr">' +
    '<span style="font-style:italic;">I see you queer,</span>' +
    '<span style="font-style:normal;"> He thinks, eyes tearing again, </span>' +
    '<span style="font-style:italic;">Fuck.</span></p></b>';
  assert.equal(
    cleanHtml(mount(gdocs), { doc: true }),
    "<p><i>I see you queer,</i> He thinks, eyes tearing again, <i>Fuck.</i></p>"
  );
});

// Plain-text drafts mark emphasis with asterisks; convert them on paste.
test("asterisksToTags converts *italic* and **bold** markers", () => {
  assert.equal(
    asterisksToTags("*I see you queer,* He thinks, eyes tearing again, *Fuck.*"),
    "<i>I see you queer,</i> He thinks, eyes tearing again, <i>Fuck.</i>"
  );
  assert.equal(asterisksToTags("**shouting**"), "<b>shouting</b>");
  assert.equal(asterisksToTags("<p>*a* and **b**</p>"), "<p><i>a</i> and <b>b</b></p>");
});

test("asterisksToTags leaves non-emphasis asterisks alone", () => {
  assert.equal(asterisksToTags("2 * 3 * 4"), "2 * 3 * 4", "spaced asterisks are maths");
  assert.equal(asterisksToTags("a lone * star"), "a lone * star");
  assert.equal(asterisksToTags("*unclosed here"), "*unclosed here");
  assert.equal(asterisksToTags("no markers"), "no markers");
  // never rewrite inside a tag — an attribute value is not prose
  assert.equal(
    asterisksToTags('<a href="https://x.com/*a*">link</a>'),
    '<a href="https://x.com/*a*">link</a>'
  );
});

test("cleanHtml: font-size spans survive only for sizes on the ladder", () => {
  assert.equal(cleanHtml(mount('<span class="fs-24">big</span>'), { doc: true }), '<span class="fs-24">big</span>');
  assert.equal(cleanHtml(mount('<span class="fs-12">small</span>'), { doc: true }), '<span class="fs-12">small</span>');
  // off the ladder: keep the words, drop the sizing
  assert.equal(cleanHtml(mount('<span class="fs-99">x</span>'), { doc: true }), "x");
  assert.equal(cleanHtml(mount('<span class="fs-13">x</span>'), { doc: true }), "x");
  // sizes compose with other formatting
  assert.equal(
    cleanHtml(mount('<span class="fs-24"><b>x</b></span>'), { doc: true }),
    '<span class="fs-24"><b>x</b></span>'
  );
});

test("cleanHtml: a font size is document content, line spacing never is", () => {
  // sizes ride along in the saved html…
  assert.match(cleanHtml(mount('<p><span class="fs-32">loud</span></p>'), { doc: true }), /fs-32/);
  // …but nothing about line spacing can be expressed through the converter
  const out = cleanHtml(mount('<p style="line-height:3">x</p>'), { doc: true });
  assert.equal(out, "<p>x</p>", "line-height is dropped, not carried into the document");
});

test("cleanHtml: the game subset does NOT gain the document tags", () => {
  const el = mount('<ul><li>a</li></ul><a href="https://x.com">t</a><s>gone</s>');
  const out = cleanHtml(el); // no {doc:true}
  assert.ok(!out.includes("<ul"), "lists stay out of game lines");
  assert.ok(!out.includes("<a "), "links stay out of game lines");
  assert.ok(!out.includes("<s>"), "strikethrough stays out of game lines");
  assert.ok(out.includes("a") && out.includes("t"), "text is still kept");
});

// ---- comment anchors ----
// The author's save runs the whole document back through cleanHtml. If anchors
// didn't survive that, every comment in the doc would quietly come unpinned the
// next time they typed a word.
test("cleanHtml round-trips a comment anchor untouched", () => {
  const el = mount('<p>his <span class="cmt" data-cid="0123456789ab">striped shirt</span> hangs</p>');
  assert.equal(cleanHtml(el, { doc: true }), '<p>his <span class="cmt" data-cid="0123456789ab">striped shirt</span> hangs</p>');
});

test("cleanHtml keeps formatting nested inside an anchor", () => {
  const el = mount('<p><span class="cmt" data-cid="0123456789ab">a <b>bold</b> bit</span></p>');
  assert.equal(cleanHtml(el, { doc: true }), '<p><span class="cmt" data-cid="0123456789ab">a <b>bold</b> bit</span></p>');
});

test("cleanHtml drops an anchor whose id isn't ours, keeping the words", () => {
  for (const bad of ["nothex", "0123456789abcdef", ""]) {
    const el = mount(`<p><span class="cmt" data-cid="${bad}">words</span></p>`);
    assert.equal(cleanHtml(el, { doc: true }), "<p>words</p>", bad);
  }
});

test("anchors are a document feature — game lines never keep them", () => {
  const el = mount('<p><span class="cmt" data-cid="0123456789ab">words</span></p>');
  assert.equal(cleanHtml(el), "<p>words</p>");
});

test("newCid mints ids the sanitizer will accept", () => {
  const ids = Array.from({ length: 50 }, () => newCid());
  ids.forEach((id) => assert.match(id, /^[0-9a-f]{12}$/));
  assert.equal(new Set(ids).size, 50);
});
