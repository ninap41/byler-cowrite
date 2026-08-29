// The two-pane /inbox builders: filters with counts, list rows, the reading
// pane's head/body/composer — all pure strings, all escaped.
import { test } from "node:test";
import assert from "node:assert/strict";
import "./dom.mjs";
import {
  threadInbox, inboxCounts, inboxFiltersHtml, inboxListRowHtml, inboxPaneHeadHtml, inboxPaneBodyHtml,
  inboxPaneComposerHtml, paneCanReply, msgFilter, INBOX_FILTERS,
} from "../public/js/dashboard-view.js";

const will = { username: "willthewise", color: "#6c8cff" };
const msgs = [
  { id: "a", type: "friend-request", from: will, text: "willthewise sent you a friend request.", ts: 1, read: false },
  { id: "b", type: "note", from: will, text: "<hi> there", ts: 2, read: true, threadId: "b" },
  { id: "c", type: "note", from: will, to: will, mine: true, text: "You: no, me", ts: 3, read: true, threadId: "b" },
  { id: "d", type: "system", from: null, text: "🏆 Rank up", ts: 4, read: false, unlocks: { themes: [{ id: "x", name: "Hellfire" }] } },
  { id: "e", type: "game-invite", from: will, code: "ABCD", text: "join me", ts: 5, read: true },
];
const threads = threadInbox(msgs);

test("filters: every kind files under one filter and the chips count conversations", () => {
  const counts = inboxCounts(threads);
  assert.equal(counts.all, 4);
  assert.equal(counts.requests, 1);
  assert.equal(counts.notes, 1);
  assert.equal(counts.system, 1);
  assert.equal(counts.invites, 1);
  assert.equal(msgFilter({ type: "doc-invite" }), "invites");
  assert.equal(msgFilter({ type: "whatever" }), "notes", "unknown kinds are notes");
  const html = inboxFiltersHtml(counts, "notes");
  assert.equal((html.match(/class="ib-filter[ "]/g) || []).length, INBOX_FILTERS.length);
  assert.ok(html.includes('data-filter="notes" aria-pressed="true"'));
  assert.ok(html.includes('Requests <span class="ib-filter-n">1</span>'));
  assert.ok(!html.includes('All <span'), "All carries no count");
});

test("a list row: sender in their colour, a tag for the kind, the newest line as snippet, unread or reply counts", () => {
  const req = threads.find((t) => t.head.id === "a");
  let html = inboxListRowHtml(req);
  assert.ok(html.includes('class="ib-check"'), "a select box");
  assert.ok(html.includes("color:#6c8cff"));
  assert.ok(html.includes(">friend request<"));
  assert.ok(html.includes('class="ib-unread-n"'), "unread count");
  const conv = threads.find((t) => t.head.id === "b");
  html = inboxListRowHtml(conv);
  assert.ok(html.includes("You: You: no, me"), "the newest line, prefixed You: when mine");
  assert.ok(html.includes("↩ 1"), "reply count when nothing is unread");
  assert.ok(!html.includes(">note<"), "a plain note wears no tag");
  const sys = threads.find((t) => t.head.id === "d");
  html = inboxListRowHtml(sys);
  assert.ok(html.includes("ib-site"), "the site's own disc on a system note");
  assert.ok(html.includes(">system<"));
  assert.ok(inboxListRowHtml(conv, { checked: true }).includes("checked"));
});

test("the pane: head actions follow the kind, the body is sided bubbles with unlocks, the composer only where a person can answer", () => {
  const req = threads.find((t) => t.head.id === "a");
  let head = inboxPaneHeadHtml(req);
  assert.ok(head.includes('data-act="accept"') && head.includes('data-act="decline"') && head.includes('data-act="delete"'));
  assert.ok(!head.includes('data-act="rejoin"'));
  assert.equal(paneCanReply(req), false, "a friend request is answered with buttons");
  assert.equal(inboxPaneComposerHtml(req), "");
  const inv = threads.find((t) => t.head.id === "e");
  assert.ok(inboxPaneHeadHtml(inv).includes('data-act="rejoin"'));
  const conv = threads.find((t) => t.head.id === "b");
  const body = inboxPaneBodyHtml(conv);
  assert.ok(body.includes("&lt;hi&gt; there"), "escaped");
  assert.ok(body.includes('class="ib-bubble mine"'), "my reply sits on my side");
  assert.ok(inboxPaneComposerHtml(conv).includes('placeholder="Reply to willthewise…"'));
  const sys = threads.find((t) => t.head.id === "d");
  assert.ok(inboxPaneBodyHtml(sys).includes("🔓 Hellfire"), "a rank-up lists its unlocks");
  assert.equal(paneCanReply(sys), false, "nobody answers a system note");
  assert.ok(inboxPaneHeadHtml(sys).includes("Delete"));
});
