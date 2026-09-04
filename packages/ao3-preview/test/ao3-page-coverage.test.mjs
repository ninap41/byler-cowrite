// Every element of the shipped AO3 work page, through the previewer's whole
// path: the inspector names it, the lint keeps a rule on it for each common
// AO3-allowed property, the selector is valid CSS that matches the element
// (inside the work — outside it AO3's #workskin prefix matches nothing, which
// is the truth), and the declared style actually lands on the element.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { selectorFor } from "../public/ao3/inspect.js";
import { renderWork, WORK_DEFAULTS } from "../public/ao3/work-content.js";
import { lintCss } from "../public/ao3/ao3-rules.js";

// the work page is a template; walk it as the previewer renders it
const PAGE = renderWork(readFileSync(new URL("../public/ao3/html/work.html", import.meta.url), "utf-8"), WORK_DEFAULTS);
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

// property → [value to declare, computed-style key, expected computed value]
// (a key with a dash is read via getPropertyValue — jsdom keeps border-radius
// and list-style as the shorthand rather than expanding them)
const PROPS = [
  ["background-color", "#abcdef", "backgroundColor", "rgb(171, 205, 239)"],
  ["display", "block", "display", "block"],
  ["background", 'url("https://example.org/bg.png")', "backgroundImage", 'url("https://example.org/bg.png")'],
  ["background-image", "url(https://example.org/bg.jpg)", "backgroundImage", 'url("https://example.org/bg.jpg")'],
  ["color", "#123456", "color", "rgb(18, 52, 86)"],
  ["font-size", "14px", "fontSize", "14px"],
  ["font-weight", "bold", "fontWeight", "bold"],
  ["font-style", "italic", "fontStyle", "italic"],
  ["font-family", "Georgia, serif", "fontFamily", "Georgia, serif"],
  ["text-align", "center", "textAlign", "center"],
  ["text-transform", "uppercase", "textTransform", "uppercase"],
  ["text-decoration", "underline", "textDecoration", "underline"],
  ["letter-spacing", "1px", "letterSpacing", "1px"],
  ["line-height", "1.5", "lineHeight", "1.5"],
  ["margin", "4px", "marginTop", "4px"],
  ["padding", "2px 4px", "paddingLeft", "4px"],
  ["border", "1px solid #000", "borderTopStyle", "solid"],
  ["border-radius", "6px", "border-radius", "6px"],
  ["box-shadow", "0 0 4px #000", "boxShadow", "0 0 4px #000"],
  ["width", "100%", "width", "100%"],
  ["max-width", "40em", "maxWidth", "40em"],
  ["opacity", "0.5", "opacity", "0.5"],
  ["float", "left", "float", "left"],
  ["position", "relative", "position", "relative"],
  ["visibility", "hidden", "visibility", "hidden"],
  ["list-style", "none", "list-style", "none"],
  ["text-indent", "2em", "textIndent", "2em"],
  ["vertical-align", "middle", "verticalAlign", "middle"],
];

function page() {
  const dom = new JSDOM(`<!doctype html><html><body>${PAGE}</body></html>`, { url: "https://archiveofourown.org/" });
  const doc = dom.window.document;
  const all = Array.from(doc.body.querySelectorAll("*")).filter((el) => !SKIP.has(el.tagName));
  return { dom, doc, all };
}

test("the page has a #workskin with content inside and chrome outside", () => {
  const { doc, all } = page();
  const ws = doc.getElementById("workskin");
  assert.ok(ws, "#workskin present");
  const inside = all.filter((el) => el === ws || ws.contains(el));
  const outside = all.filter((el) => el !== ws && !ws.contains(el));
  assert.ok(inside.length > 20, "elements inside the work: " + inside.length);
  assert.ok(outside.length > 20, "elements outside the work: " + outside.length);
});

test("every element: the inspector's selector is #workskin-prefixed, valid, and matches it inside the work — and nothing outside", () => {
  const { doc, all } = page();
  const ws = doc.getElementById("workskin");
  for (const el of all) {
    const sel = selectorFor(el);
    assert.match(sel, /^#workskin( |$)/, `${el.tagName}#${el.id}.${el.className}: ${sel}`);
    let hits;
    assert.doesNotThrow(() => (hits = doc.querySelectorAll(sel)), `${sel} is valid CSS`);
    if (el === ws || ws.contains(el)) assert.ok(el.matches(sel), `${sel} matches its own element`);
    else assert.ok(!el.matches(sel), `${sel} — outside the work, the prefixed selector never reaches the element it was picked from (as on AO3)`);
    for (const hit of hits) assert.ok(hit === ws || ws.contains(hit), `${sel} only ever matches inside the work`);
  }
});

for (const [prop, value, key, expected] of PROPS) {
  test(`${prop}: ${value} — a rule on every element passes the lint and lands on the element`, () => {
    const { dom, doc, all } = page();
    const ws = doc.getElementById("workskin");
    const selectors = Array.from(new Set(all.map(selectorFor)));
    const css = selectors.map((s) => `${s} { ${prop}: ${value}; }`).join("\n");
    const { rules, problems, cleaned } = lintCss(css);
    assert.deepEqual(problems, [], `${prop}: no lint problem on any selector`);
    assert.equal(rules.length, selectors.length, "one rule kept per selector");
    for (const s of selectors) assert.ok(cleaned.includes(`${s} {`), `${s} survives cleaning`);
    assert.equal((cleaned.match(new RegExp(prop.replace(/-/g, "\\-") + ":", "g")) || []).length, selectors.length, "every declaration survives cleaning");
    // the cleaned sheet in the page: the style reaches every element inside the work
    const style = doc.createElement("style");
    style.textContent = cleaned;
    doc.head.appendChild(style);
    let checked = 0;
    for (const el of all) {
      if (!(el === ws || ws.contains(el))) continue;
      const cs = dom.window.getComputedStyle(el);
      const got = key.includes("-") ? cs.getPropertyValue(key) : cs[key];
      assert.equal(got, expected, `${selectorFor(el)} ${key}`);
      checked++;
    }
    assert.ok(checked > 20, "checked " + checked);
  });
}
