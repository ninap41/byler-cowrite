import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom, mount } from "./dom.mjs";

installDom();
const { cleanHtml } = await import("../public/js/components/editor.js");

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
