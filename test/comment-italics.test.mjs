// A robust, browser-faithful stress test of beta-reader commenting on a real,
// heavily-italicised chapter. The fixture is STRW CH5 converted from RTF and
// run through sanitizeDoc (test/fixtures/strw-ch5.html). Using jsdom we do the
// REAL Range.surroundContents a browser does — which SPLITS the <i> runs the
// commented words sit inside — and comment on a word every two paragraphs,
// asserting every single comment is accepted (none refused, none orphaned).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installDom } from "./dom.mjs";
import { startServer, signup } from "./helpers.mjs";
import { cleanHtml } from "../public/js/components/editor.js";

installDom(); // gives us document + Range/surroundContents

const FIXTURE = readFileSync(new URL("./fixtures/strw-ch5.html", import.meta.url), "utf-8");
const randCid = () => Array.from({ length: 12 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

// Find a text node with a comfortable word to wrap inside the i-th paragraph,
// build a Range over a SUB-RANGE of it (so parent <i>/<b> tags split), wrap it
// in a fresh comment anchor, and return { cid, html, quote } — exactly what the
// client emits.
function wrapWordInParagraph(html, pIndex, cid) {
  const box = document.createElement("div");
  box.innerHTML = html;
  const p = box.querySelectorAll("p")[pIndex];
  if (!p) return null;
  // deepest text node with >= 5 non-space chars
  const walker = document.createTreeWalker(p, 4 /* SHOW_TEXT */);
  let node = null;
  while (walker.nextNode()) {
    const t = walker.currentNode;
    if ((t.textContent || "").trim().length >= 5) { node = t; break; }
  }
  if (!node) return null;
  const text = node.textContent;
  const s = Math.max(0, text.search(/\S/));
  const e = Math.min(text.length, s + Math.min(4, text.trim().length)); // a sub-word slice
  const range = document.createRange();
  range.setStart(node, s + 1);      // start mid-run so the parent tag splits on the left
  range.setEnd(node, e);
  const span = document.createElement("span");
  span.className = "cmt";
  span.setAttribute("data-cid", cid);
  range.surroundContents(span);
  return { cid, html: cleanHtml(box, { doc: true }), quote: span.textContent };
}

let ctx, alice, bob;
before(async () => {
  ctx = await startServer();
  alice = await signup(ctx, "aliceauthor", "alice@byers.com");
  bob = await signup(ctx, "bobbeta", "bob@byers.com");
  await ctx.api("/api/friends/request", { username: "bobbeta" }, alice.token);
  const inbox = await ctx.api("/api/inbox", null, bob.token, "GET");
  const req = inbox.data.messages.find((m) => m.type === "friend-request");
  await ctx.api("/api/friends/respond", { id: req.id, accept: true }, bob.token);
});
after(async () => ctx.stop());

const docOf = async (id, token = alice.token) => (await ctx.api("/api/docs/" + id, null, token, "GET")).data.doc;

test("beta reader comments on a word every two paragraphs across the whole italic-heavy chapter; none are refused", async () => {
  // author creates the story with the exact chapter text
  const created = await ctx.api("/api/docs", { title: "STRW CH5 — Mike Escaping Vecna" }, alice.token);
  const id = created.data.doc.id;
  const put = await ctx.api("/api/docs/" + id, { html: FIXTURE }, alice.token, "PUT");
  assert.equal(put.status, 200);
  const paraCount = (put.data.doc.html.match(/<p[\s>]/g) || []).length;
  assert.ok(paraCount > 100, "the whole chapter was stored");

  // invite the beta reader (auto-promotes private -> readers)
  await ctx.api("/api/docs/" + id + "/readers", { username: "bobbeta" }, alice.token);

  const B = await ctx.conn();
  B.emit("doc-open", { auth: bob.token, id });
  // keep the canonical html the server pushes back (the client does the same)
  let base = put.data.doc.html;
  let onSync = null;
  B.on("doc-html", ({ html }) => { base = html; onSync?.(); onSync = null; });
  // the next comment must be built from the html the server pushed back after
  // the last one — a fixed sleep is a race under a loaded suite, so wait for
  // the push itself (bounded, so a refused comment can't hang the test)
  const synced = () => new Promise((r) => { onSync = r; setTimeout(r, 2000); });
  await ctx.wait(150);

  let attempted = 0, skipped = 0;
  for (let pIndex = 0; pIndex < paraCount; pIndex += 2) {
    const w = wrapWordInParagraph(base, pIndex, randCid());
    if (!w) { skipped++; continue; } // a blank/short paragraph, nothing to wrap
    attempted++;
    const sync = synced();
    B.emit("doc-comment", { auth: bob.token, id, cid: w.cid, html: w.html, text: `note on para ${pIndex}` });
    await sync; // the round trip and the doc-html resync have landed
  }
  await ctx.wait(300);

  const after = await docOf(id);
  assert.equal(after.comments.length, attempted, `every one of ${attempted} comments was accepted (skipped ${skipped} blank paras)`);
  assert.ok(attempted > 40, "this really exercised a lot of comments");
  assert.ok(after.comments.every((c) => !c.orphaned), "no comment is orphaned");
  // and the prose is intact — commenting never changed a word
  const strip = (h) => h.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  assert.equal(strip(after.html), strip(put.data.doc.html), "the chapter text is unchanged by all the comments");
});
