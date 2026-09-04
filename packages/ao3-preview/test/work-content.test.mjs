// The Work Content model: fields, boilerplate, the token renderer, the form.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as W from "../public/ao3/work-content.js";
import { installDom } from "./dom.mjs";

const TPL = readFileSync(new URL("../public/ao3/html/work.html", import.meta.url), "utf-8");

test("every field has a boilerplate value of its kind, and the shipped page renders with no token left", () => {
  for (const f of W.WORK_FIELDS) {
    const d = W.WORK_DEFAULTS[f.id];
    assert.ok(f.id in W.WORK_DEFAULTS, f.id + " has a default");
    if (f.kind === "checks" || f.kind === "tags") assert.ok(Array.isArray(d), f.id);
    else assert.equal(typeof d, "string", f.id);
    if (f.kind === "select") assert.ok(f.options.includes(d));
  }
  assert.ok(W.WORK_DEFAULTS.chapterText.length > 10000, "the story text is the chapter boilerplate");
  const tokens = new Set(Array.from(TPL.matchAll(W.TOKEN_RE), (m) => m[1]));
  assert.ok(tokens.size >= 14, "the page carries the tokens: " + tokens.size);
  const out = W.renderWork(TPL, W.WORK_DEFAULTS);
  assert.equal((out.match(W.TOKEN_RE) || []).length, 0, "all filled");
  assert.ok(out.includes("Bottled Up, Falling Down") && out.includes("Mike stood on the edge") && out.includes('href="/tags/Will%20Byers*s*Mike%20Wheeler/works"'));
  assert.equal(W.renderWork("x {{NOPE}} y", {}), "x {{NOPE}} y", "an unknown token is left alone");
});

test("cleanWork: typed, unknown keys dropped, bad choices fall back, tag strings split; renderers omit empty modules and escape", () => {
  const v = W.cleanWork({ title: "T", rating: "Bogus", warnings: ["Major Character Death", "Nope"], fandoms: "A, B ,, C", junk: 1 });
  assert.equal(v.title, "T");
  assert.equal(v.rating, W.WORK_DEFAULTS.rating, "a rating off the list falls back");
  assert.deepEqual(v.warnings, ["Major Character Death"]);
  assert.deepEqual(v.fandoms, ["A", "B", "C"]);
  assert.ok(!("junk" in v));
  assert.equal(v.summary, W.WORK_DEFAULTS.summary, "unset fields take the boilerplate");
  assert.ok(W.sameWork(W.WORK_DEFAULTS, {}), "an empty set IS the boilerplate");
  assert.ok(!W.sameWork(W.WORK_DEFAULTS, { title: "x" }));
  assert.equal(W.tagListHtml(["a/b", "<i>"]), '<li><a class="tag" href="/tags/a*s*b/works">a/b</a></li><li><a class="tag" href="/tags/%3Ci%3E/works">&lt;i&gt;</a></li>');
  assert.equal(W.summaryHtml("  "), "");
  assert.match(W.summaryHtml("<p>s</p>"), /^<div class="summary module">[\s\S]*<blockquote class="userstuff">\s*<p>s<\/p>/);
  assert.equal(W.notesHtml("", ""), "");
  assert.match(W.notesHtml("", "<p>e</p>"), /See the end of the work for <a href="#work_endnotes">notes<\/a>/);
  assert.match(W.notesHtml("<p>n</p>", "<p>e</p>"), /<blockquote class="userstuff"><p>n<\/p><\/blockquote>[\s\S]*for more <a/);
  assert.equal(W.endNotesHtml(""), "");
  assert.equal(W.chapterPrefaceHtml({}), "");
  assert.match(W.chapterPrefaceHtml({ chapterTitle: "One" }), /<h3 class="title">One<\/h3>/);
  assert.match(W.chapterPrefaceHtml({ chapterSummary: "<p>s</p>" }), /<h3 class="title">Chapter 1<\/h3>[\s\S]*id="summary"/);
  assert.match(W.chapterEndNotesHtml("<p>x</p>"), /id="chapter_1_endnotes"/);
  const t = W.workTokens({ warnings: [] });
  assert.match(t.WARNING_TAGS, /No Archive Warnings Apply/, "no warning chosen reads as none apply");
  assert.equal(W.workTokens({ title: "<b>" }).TITLE, "&lt;b&gt;");
});

test("the form round-trips: workFormHtml → readWorkForm gives the values back", () => {
  installDom();
  const root = document.createElement("form");
  const values = W.cleanWork({ title: "T \"q\"", rating: "Explicit", warnings: ["Underage Sex"], categories: ["Gen", "Multi"], fandoms: ["F1", "F2"], summary: "<p>a & b</p>", chapterTitle: "Ch" });
  root.innerHTML = W.workFormHtml(values);
  assert.equal(root.querySelectorAll(".ap-work-sec").length, 3, "Tags · Preface · Chapter");
  assert.equal(root.querySelectorAll(".ap-work-row").length, W.WORK_FIELDS.length);
  assert.equal(root.querySelectorAll("textarea[hidden]").length, W.WORK_FIELDS.filter((f) => f.kind === "html").length);
  assert.equal(root.querySelector('textarea[name="summary"]').value, "<p>a & b</p>");
  assert.deepEqual(W.readWorkForm(root), values);
});
