// Links and images in the solo editor: ⌘K / ⌘⇧I and the toolbar buttons share
// one dialog, a link is a real <a href>, and you can SEE it while editing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { installDom } from "./dom.mjs";

installDom();
const { cleanHtml } = await import("../public/js/components/editor.js");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf-8");

test("the write page: one #urlModal with text, url, remove, cancel and ok — no window.prompt left", () => {
  const html = read("public/write.html");
  for (const id of ["urlModal", "urlModalTitle", "urlTextRow", "urlText", "urlInput", "urlErr", "urlRemove", "urlCancel", "urlOk"]) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.ok(/id="urlModal"[^>]*role="dialog"/.test(html), "a dialog");
  const js = read("public/js/pages/write.js");
  assert.ok(!/\bprompt\(/.test(js), "the browser prompt is gone");
  assert.ok(js.includes('"createLink"') && js.includes('"insertImage"') && js.includes('"unlink"'), "real anchors via execCommand, and unlink");
  assert.ok(js.includes('link: () => void insertLink()') && js.includes('image: () => void insertImage()'), "the hot keys reach the same functions as the buttons");
});

test("a link's hover tip never persists: cleanHtml keeps href alone", () => {
  document.body.innerHTML = '<div id="ed"><p>see <a href="https://x.test/a" data-tip="https://x.test/a" target="_blank" rel="noopener">this</a></p></div>';
  assert.equal(cleanHtml(document.getElementById("ed"), { doc: true }), '<p>see <a href="https://x.test/a">this</a></p>');
});

test("links you can see: accent + underline everywhere, a chain glyph only while editing", () => {
  const css = read("public/css/base.css");
  const rule = css.slice(css.indexOf(".doc-editor a,\n.doc-read a {"), css.indexOf(".doc-img {"));
  assert.match(rule, /text-decoration: underline/);
  assert.match(rule, /\.doc-editor\[contenteditable="true"\] a::after \{[^}]*content: "\\f0c1"/, "the Font Awesome link glyph, editing only");
  assert.ok(!/\.doc-read a::after/.test(rule), "a reader's links carry no glyph");
});

test("withScheme: the dialog adds https:// for you; a full url and a foreign scheme are left alone", async () => {
  const js = read("public/js/pages/write.js");
  const m = js.match(/withScheme = \(raw\) => \{[\s\S]*?\n\};/);
  assert.ok(m, "withScheme is emitted");
  const HTTP_URL = /^https?:\/\//i;
  const withScheme = new Function("HTTP_URL", "return " + m[0].replace(/;$/, ""))(HTTP_URL);
  assert.equal(withScheme("archiveofourown.org/works/1"), "https://archiveofourown.org/works/1");
  assert.equal(withScheme("  //cdn.x/y.png "), "https://cdn.x/y.png");
  assert.equal(withScheme("http://plain.test"), "http://plain.test");
  assert.equal(withScheme("HTTPS://caps.test"), "HTTPS://caps.test");
  assert.equal(withScheme("javascript:alert(1)"), "javascript:alert(1)", "not prefixed — and then refused by the http check");
  assert.equal(withScheme(""), "");
});
