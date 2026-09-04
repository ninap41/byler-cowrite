import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as R from "../public/ao3/ao3-rules.js";
import * as V from "../public/ao3/css-values.js";

const json = JSON.parse(readFileSync(new URL("../public/ao3/ao3-rules.json", import.meta.url), "utf-8"));

test("ao3-rules.json and the module carry the same whitelist", () => {
  assert.deepEqual(R.PROPERTIES, json.properties);
  assert.deepEqual(R.SHORTHANDS, json.shorthands);
  assert.deepEqual(R.VENDOR_PREFIXES, json.vendorPrefixes);
  assert.deepEqual(R.UNITS, json.units);
  assert.deepEqual(R.URL_PROPERTIES, json.urlProperties);
  assert.deepEqual(R.URL_EXTENSIONS, json.urlExtensions);
  assert.deepEqual(R.TRANSFORM_FUNCTIONS, json.transformFunctions);
  assert.deepEqual(R.FILTER_FUNCTIONS, json.filterFunctions);
  assert.deepEqual(R.COLOR_FUNCTIONS, json.colorFunctions);
  assert.deepEqual(R.GRADIENT_FUNCTIONS, json.gradientFunctions);
  assert.deepEqual(R.FORBIDDEN_FUNCTIONS, json.forbiddenFunctions);
  assert.deepEqual(R.KEYWORDS, json.keywords);
  assert.deepEqual(R.AT_RULES, json.atRules);
  assert.deepEqual(R.ERRORS, json.errors);
  assert.equal(new Set(R.PROPERTIES).size, R.PROPERTIES.length, "no duplicate property");
});

test("properties: exact list, shorthand substring, vendor prefix, custom", () => {
  const ok = (p) => assert.equal(R.propertyStatus(p).ok, true, p + " passes");
  const no = (p, code = "banned_property") => assert.deepEqual(R.propertyStatus(p), { ok: false, code }, p + " fails");
  ok("color"); ok("position"); ok("z-index"); ok("aspect-ratio");
  ok("column-gap"); ok("border-top-left-radius"); ok("text-shadow"); ok("overflow-x"); ok("flex-basis"); ok("transition-delay");
  no("gap"); ok("grid-template-columns"); /* "column" substring — AO3 really lets it through */ no("grid-template-rows"); no("grid-area"); no("animation"); no("object-fit"); no("pointer-events"); no("mix-blend-mode"); no("backdrop-filter"); no("inset");
  ok("-webkit-transform"); ok("-moz-appearance"); ok("-ms-user-select"); no("-xyz-color");
  assert.deepEqual(R.propertyStatus("--my-color"), { ok: true, custom: true });
  no("--bad name", "invalid_custom_property_name");
  assert.equal(R.propertyStatus("COLOR").ok, true, "case-insensitive");
});

test("values: units, numbers, colours, functions, url, content, font-family, !important", () => {
  const ok = (p, v) => assert.equal(R.valueStatus(p, v).ok, true, `${p}: ${v} passes`);
  const no = (p, v) => {
    const r = R.valueStatus(p, v);
    assert.equal(r.ok, false, `${p}: ${v} fails`);
    assert.equal(r.code, "banned_value_for_property");
    return r;
  };
  ok("margin", "1em 2% 3px .5in"); ok("transform", "rotate(10deg)"); ok("transition", "color 1s");
  no("margin", "1rem"); no("width", "50vw"); no("height", "10vh"); no("transition", "100ms");
  ok("width", "1000px"); no("width", "1234567px"); no("width", "1.23456px"); ok("opacity", ".5"); ok("line-height", "1.5");
  no("width", "calc(1px + 1px)"); no("width", "clamp(1px, 2px, 3px)"); no("width", "min(1px, 2px)"); no("color", "color-mix(in srgb, red, blue)");
  ok("color", "#abc"); ok("color", "#aabbcc"); ok("color", "rgba(0, 0, 0, .5)"); ok("color", "hsl(10, 50%, 50%)"); no("color", "#abcdefgh");
  ok("filter", "blur(2px) brightness(1.2)"); ok("filter", "drop-shadow(1px 1px 2px #000)"); ok("transform", "translate(2px, 3px) skewx(2deg)");
  no("transform", "translate(2rem, 0)"); no("transform", "perspective(1px)");
  ok("background", "linear-gradient(to right, #000, #fff)"); ok("background-image", "url(https://example.com/a.png)");
  ok("background", 'url("https://example.com/dir/pic.jpeg") no-repeat');
  ok("list-style-image", "url(https://example.com/a.gif)"); ok("border-image", "url(https://example.com/a.jpg) 30");
  no("color", "url(https://example.com/a.png)"); no("background", "url(https://example.com/a.webp)");
  no("background", "url(https://example.com/a.png?x=1)"); no("background", "url(/images/a.png)"); no("background", "url(data:image/png;base64,AAAA)");
  ok("content", '"a"'); ok("content", "none"); ok("content", "url(https://example.com/a.png)"); ok("content", "open-quote");
  no("content", "attr(x)"); no("content", "hello"); no("content", "var(--x)");
  ok("font-family", '"Times New Roman", Georgia, serif'); ok("font-family", "'Comic Sans MS'"); no("font-family", "Times<script>");
  const imp = R.valueStatus("color", "red !important");
  assert.equal(imp.ok, true); assert.equal(imp.important, true);
  assert.equal(R.valueStatus("--x", "anything at all").ok, true);
  assert.equal(R.valueStatus("--x", "1").warnings[0].code, "custom_property");
  const v = R.valueStatus("border-color", "var(--x)");
  assert.equal(v.ok, true); assert.equal(v.warnings[0].code, "var_in_workskin");
  assert.equal(R.valueStatus("color", "").code, "no_valid_css_for_selectors");
});

test("lintCss: at-rules, dropped rules, prefix warning, line numbers, cleaned output", () => {
  const src = `/* a comment
     across lines */
#workskin .userstuff p {
  color: red;
  gap: 4px;
  width: calc(1px + 1px);
}
.unprefixed { color: blue }
@font-face { font-family: x; src: url(https://example.com/a.woff) }
@media (max-width: 600px) { #workskin p { color: blue } }
@import url(https://example.com/x.css);
#workskin .dead { pointer-events: none }
#workskin .ok { transform: rotate(10deg); color: rgba(0, 0, 0, .5) !important }`;
  const r = R.lintCss(src);
  const by = (code) => r.problems.filter((p) => p.code === code);
  assert.deepEqual(by("banned_property").map((p) => [p.line, p.prop]), [[5, "gap"], [12, "pointer-events"]]);
  assert.deepEqual(by("banned_value_for_property").map((p) => [p.line, p.prop]), [[6, "width"]]);
  assert.deepEqual(by("font_face").map((p) => p.line), [9]);
  assert.deepEqual(by("at_rule_dropped").map((p) => [p.line, p.selector]), [[10, "@media"], [11, "@import"]]);
  assert.deepEqual(by("workskin_prefix").map((p) => [p.line, p.severity]), [[8, "warning"]]);
  assert.deepEqual(by("no_rules_for_selectors").map((p) => p.selector), ["#workskin .dead"]);
  assert.equal(r.rules.length, 4);
  assert.equal(r.cleaned, `#workskin .userstuff p {\n  color: red;\n}\n\n#workskin .unprefixed {\n  color: blue;\n}\n\n#workskin .ok {\n  transform: rotate(10deg);\n  color: rgba(0, 0, 0, .5) !important;\n}`);
  assert.ok(!r.cleaned.includes("calc") && !r.cleaned.includes("gap") && !r.cleaned.includes("@"));
});

test("the #workskin note is for bare classes and ids, never for element selectors", () => {
  const codes = (css) => R.lintCss(css).problems.map((p) => p.code);
  for (const sel of ["body", "html", "p", "span", "p > em", "a:hover", "*", "ul li", "p:first-child::before", "input[type=\"text\"]", "body, p"]) {
    assert.deepEqual(codes(`${sel} { color: red }`), [], sel + " raises nothing");
    assert.equal(R.elementOnly(sel), true, sel);
  }
  for (const sel of [".note", "#foo", "p.note", "div > .x", "#workskin2 p, .y"]) {
    assert.deepEqual(codes(`${sel} { color: red }`), ["workskin_prefix"], sel + " gets the note");
  }
  assert.deepEqual(codes("#workskin .note { color: red }"), []);
  assert.deepEqual(codes("#workskin .a, p { color: red }"), []);
  assert.equal(R.elementOnly(""), false);
});

test("lintCss: a clean sheet has no problems, an all-dead sheet says no_valid_css, quotes/parens don't split", () => {
  const clean = R.lintCss(`#workskin .a { color: red; font-family: "A B", serif; content: "a; b"; background: url("https://x.com/a.png") }`);
  assert.deepEqual(clean.problems, []);
  assert.equal(clean.rules[0].decls.length, 4);
  const dead = R.lintCss(`#workskin .a { gap: 1px }`);
  assert.ok(dead.problems.some((p) => p.code === "no_valid_css"));
  assert.equal(dead.cleaned, "");
  assert.deepEqual(R.lintCss("").problems, []);
});

test("the shipped default skin is AO3-clean as the SITE skin it is", () => {
  const css = readFileSync(new URL("../public/ao3/default-skin.css", import.meta.url), "utf-8");
  assert.deepEqual(R.lintCss(css, { kind: "site" }).problems, []);
  assert.ok(R.lintCss(css).problems.some((p) => p.code === "workskin_prefix"), "read as a work skin it is full of site selectors — which is why the previewer defaults to Site skin");
});

test("lintCss kind: a site skin is stored as written, a work skin prefixed", () => {
  assert.deepEqual(R.SKIN_KINDS, ["work", "site"]);
  assert.equal(R.cleanKind("site"), "site");
  assert.equal(R.cleanKind("junk"), "work");
  const src = "#header { color: red }\n.x, #workskin em { color: blue }";
  const site = R.lintCss(src, { kind: "site" });
  assert.deepEqual(site.problems, []);
  assert.equal(site.cleaned, "#header {\n  color: red;\n}\n\n.x, #workskin em {\n  color: blue;\n}");
  const work = R.lintCss(src);
  assert.deepEqual(work.problems.map((p) => p.code), ["workskin_prefix", "workskin_prefix"]);
  assert.equal(work.cleaned, "#workskin #header {\n  color: red;\n}\n\n#workskin .x, #workskin em {\n  color: blue;\n}");
  assert.equal(R.storedSelector("p, .x", "site"), "p, .x");
});

test("css-values: every suggested value is one AO3 keeps, every key a property AO3 keeps", () => {
  for (const [prop, list] of Object.entries(V.VALUES)) {
    assert.equal(R.propertyStatus(prop).ok, true, prop + " is whitelisted");
    for (const k of list) {
      assert.match(k, /^[a-z0-9][a-z0-9-]*$/, `${prop}: ${k} is a bare identifier`);
      assert.equal(R.valueStatus(prop, k).ok, true, `${prop}: ${k} passes the value check`);
    }
  }
  for (const [prop, fns] of Object.entries(V.FUNCTIONS)) {
    assert.equal(R.propertyStatus(prop).ok, true, prop);
    for (const f of fns) {
      assert.ok(!R.FORBIDDEN_FUNCTIONS.includes(f), f + " is forbidden");
      const sample = f === "url" ? "url(https://example.org/a.png)" : f + "(1)";
      const st = R.valueStatus(f === "url" && !R.URL_PROPERTIES.includes(prop) ? "background" : prop, sample);
      assert.equal(st.ok, true, `${prop}: ${sample} — ${st.message || ""}`);
    }
  }
  for (const c of V.NAMED_COLORS) assert.equal(R.valueStatus("color", c).ok, true, c);
  for (const p of V.COLOR_PROPERTIES) assert.equal(R.propertyStatus(p).ok, true, p);
  assert.deepEqual(V.valuesFor("-webkit-transform"), V.valuesFor("transform"), "vendor prefix looked through");
  const t = V.valuesFor("transform").map((v) => v.label);
  assert.ok(t.includes("rotate(") && t.includes("none") && !t.includes("rgb("));
  const c = V.valuesFor("color").map((v) => v.label);
  assert.ok(c.includes("rgba(") && c.includes("rebeccapurple") && !c.includes("color-stop("));
  const u = V.valuesFor("no-such-thing").map((v) => v.label);
  assert.deepEqual(u, [...V.GLOBALS, V.IMPORTANT], "an unknown property still gets the globals and !important");
  for (const p of Object.keys(V.VALUES)) {
    const labels = V.valuesFor(p).map((v) => v.label);
    assert.equal(new Set(labels).size, labels.length, p + ": no duplicate option");
    assert.equal(labels.at(-1), V.IMPORTANT);
  }
});

test("storedSelector: the cleaned sheet carries every selector as AO3 stores it", () => {
  assert.equal(R.storedSelector("button"), "#workskin button");
  assert.equal(R.storedSelector("#workskin p"), "#workskin p");
  assert.equal(R.storedSelector("#workskinner"), "#workskin #workskinner", "a word that only starts with the letters is prefixed");
  assert.equal(R.storedSelector("p, #workskin em,  .x:has(a, b) "), "#workskin p, #workskin em, #workskin .x:has(a, b)");
  const r = R.lintCss("button { color: red }\n#workskin p { color: blue }");
  assert.equal(r.cleaned, "#workskin button {\n  color: red;\n}\n\n#workskin p {\n  color: blue;\n}");
});
