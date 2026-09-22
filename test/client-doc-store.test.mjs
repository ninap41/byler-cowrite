// The solo editor's local crash-cache. It must never be mistaken for the save
// path: it only ever OFFERS to restore, and only when it is genuinely newer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installLocalStorage } from "./client-storage.mjs";

installLocalStorage();
const { loadDraft, saveDraft, clearDraft, draftIsNewer, mergeDraft, MAX_DRAFTS } = await import("../public/js/doc-store.js");

const mem = () => {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
};

test("round-trips a draft for its own doc only", () => {
  const s = mem();
  saveDraft("doc-1", [{ id: "aaaaaaaaaaaa", title: "One", html: "<p>hi</p>" }, { id: null, title: "Two", html: "" }], "Title", s);
  const d = loadDraft("doc-1", s);
  assert.deepEqual(d.chapters, [{ id: "aaaaaaaaaaaa", title: "One", html: "<p>hi</p>" }, { id: null, title: "Two", html: "" }]);
  assert.equal(d.title, "Title");
  assert.ok(d.savedAt > 0);
  assert.equal(loadDraft("doc-2", s), null, "another doc's draft is not offered");
});

test("every story has its own draft: typing in a second story no longer overwrites the first one's", () => {
  const s = mem();
  saveDraft("doc-1", [{ html: "<p>three thousand unsaved words</p>" }], "One", s, 7);
  saveDraft("doc-2", [{ html: "<p>a note in another story</p>" }], "Two", s, 1);
  assert.equal(loadDraft("doc-1", s).chapters[0].html, "<p>three thousand unsaved words</p>");
  assert.equal(loadDraft("doc-1", s).baseRev, 7, "and remembers the save it was working from");
  assert.equal(loadDraft("doc-2", s).title, "Two");
  clearDraft("doc-2", s);
  assert.ok(loadDraft("doc-1", s), "clearing one leaves the other");
});

test("drafts don't pile up forever: past MAX_DRAFTS the story drafted longest ago goes", () => {
  const s = mem();
  for (let i = 0; i <= MAX_DRAFTS; i++) saveDraft("doc-" + i, [{ html: "<p>x</p>" }], "T", s);
  assert.equal(loadDraft("doc-0", s), null, "the oldest fell off");
  assert.ok(loadDraft("doc-1", s) && loadDraft("doc-" + MAX_DRAFTS, s));
  saveDraft("doc-1", [{ html: "<p>again</p>" }], "T", s); // touching one makes it the newest
  saveDraft("doc-new", [{ html: "<p>y</p>" }], "T", s);
  assert.ok(loadDraft("doc-1", s), "recently drafted survives");
  assert.equal(loadDraft("doc-2", s), null);
});

test("a draft left in the old single slot is still found, and cleared with its story", () => {
  const s = mem();
  s.setItem("cowriteDocDraft", JSON.stringify({ docId: "doc-1", chapters: [{ id: null, title: "", html: "<p>from before</p>" }], title: "T", savedAt: 5 }));
  assert.equal(loadDraft("doc-1", s).chapters[0].html, "<p>from before</p>");
  clearDraft("doc-1", s);
  assert.equal(loadDraft("doc-1", s), null);
});

test("clearing only drops the cache when it belongs to this doc", () => {
  const s = mem();
  saveDraft("doc-1", [{ html: "<p>a</p>" }], "T", s);
  clearDraft("doc-2", s);
  assert.ok(loadDraft("doc-1", s), "a different doc's clear leaves it alone");
  clearDraft("doc-1", s);
  assert.equal(loadDraft("doc-1", s), null);
});

test("survives unreadable or absent storage", () => {
  const s = mem();
  assert.equal(loadDraft("doc-1", s), null, "nothing stored yet");
  s.setItem("cowriteDocDraft", "{not json");
  assert.equal(loadDraft("doc-1", s), null, "garbage doesn't throw");
  const broken = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("quota"); },
    removeItem: () => { throw new Error("blocked"); },
  };
  assert.equal(saveDraft("d", [{ html: "<p>x</p>" }], "t", broken), false, "reports failure instead of throwing");
  assert.equal(loadDraft("d", broken), null);
  assert.doesNotThrow(() => clearDraft("d", broken));
});

test("a draft that recorded its base is offered whenever it differs — a comment stamping the story can't hide it", () => {
  // the incident shape: she crashed with unsaved words, then a beta reader commented (updatedAt moved past the draft)
  const doc = { chapters: [{ id: "c1", title: "One", html: "<p>server</p>" }], updatedAt: 9000, rev: 4 };
  const draft = { chapters: [{ id: "c1", title: "One", html: "<p>server</p><p>three thousand more</p>" }], savedAt: 2000, baseRev: 4 };
  assert.equal(draftIsNewer(draft, doc), true, "older than updatedAt, and still hers to take back");
  assert.equal(draftIsNewer({ ...draft, chapters: doc.chapters }, doc), false, "identical content is never offered");
});

test("a draft from before bases were recorded is only worth restoring when newer AND different", () => {
  const doc = { chapters: [{ id: "c1", title: "One", html: "<p>server</p>" }], html: "<p>server</p>", updatedAt: 1000 };
  const ch = (html, extra = {}) => [{ id: "c1", title: "One", html, ...extra }];
  assert.equal(draftIsNewer({ chapters: ch("<p>local</p>"), savedAt: 2000 }, doc), true);
  assert.equal(draftIsNewer({ chapters: ch("<p>local</p>"), savedAt: 500 }, doc), false, "older than the server copy");
  assert.equal(draftIsNewer({ chapters: ch("<p>server</p>"), savedAt: 2000 }, doc), false, "identical content is not a change");
  assert.equal(draftIsNewer({ chapters: [{ id: "c1", title: "Renamed", html: "<p>server</p>" }], savedAt: 2000 }, doc), true, "a rename alone is a change");
  assert.equal(draftIsNewer({ chapters: [...ch("<p>server</p>"), { id: null, title: "Two", html: "" }], savedAt: 2000 }, doc), true, "an added chapter is a change");
  assert.equal(draftIsNewer(null, doc), false);
  assert.equal(draftIsNewer({ chapters: ch("x"), savedAt: 2000 }, null), false);
});

test("a pre-chapter draft ({html}) is read as one untitled chapter and compared by position", () => {
  const s = mem();
  s.setItem("cowriteDocDraft", JSON.stringify({ docId: "doc-1", html: "<p>old draft</p>", title: "T", savedAt: 2000 }));
  const d = loadDraft("doc-1", s);
  assert.deepEqual(d.chapters, [{ id: null, title: "", html: "<p>old draft</p>" }], "upgraded on read");
  const doc = { chapters: [{ id: "c1", title: "Chapter 1", html: "<p>server</p>" }], updatedAt: 1000 };
  assert.equal(draftIsNewer(d, doc), true, "differs from the server's first chapter");
  assert.equal(draftIsNewer({ chapters: [{ id: null, title: "", html: "<p>server</p>" }], savedAt: 2000 }, doc), false, "same words under the first chapter's id and title is no change");
  // and a legacy draft against a legacy-shaped doc (html only) still compares
  assert.equal(draftIsNewer({ html: "<p>x</p>", savedAt: 2000 }, { html: "<p>y</p>", updatedAt: 1 }), true);
});

test("a draft remembers which chapters its page edited; one it never touched is not a difference", () => {
  const s = mem();
  saveDraft("doc-1", [{ id: "c1", title: "One", html: "<p>mine, unsaved</p>", touched: true }, { id: "c2", title: "Two", html: "<p>old copy</p>", touched: false }], "T", s, 3);
  const d = loadDraft("doc-1", s);
  assert.deepEqual(d.chapters.map((c) => c.touched), [true, false]);
  // chapter two was saved from another tab since; chapter one matches what the server has
  const server = { rev: 4, chapters: [{ id: "c1", title: "One", html: "<p>mine, unsaved</p>" }, { id: "c2", title: "Two", html: "<p>saved elsewhere since</p>" }] };
  assert.equal(draftIsNewer(d, server), false, "the only difference is a chapter this page never edited: nothing to offer");
  assert.equal(draftIsNewer(d, { ...server, chapters: [{ id: "c1", title: "One", html: "<p>server</p>" }, server.chapters[1]] }), true, "the edited chapter differs: offered");
});

// A marked draft is laid over the server's chapter LIST, not just its text:
// what another tab did to the list since (add, delete, rename) must survive
// a restore, or the next save quietly undoes it.
const ch1 = { id: "c1", title: "One", html: "<p>mine, unsaved</p>", touched: true };
const ch2old = { id: "c2", title: "Two", html: "<p>old copy</p>", touched: false };

test("mergeDraft: a chapter added elsewhere since the draft survives the restore", () => {
  const server = { rev: 5, chapters: [{ id: "c1", title: "One", html: "<p>server</p>" }, { id: "c2", title: "Two", html: "<p>two</p>" }, { id: "c3", title: "Three", html: "<p>added in tab B</p>" }] };
  const out = mergeDraft({ chapters: [ch1, ch2old], baseRev: 3 }, server);
  assert.deepEqual(out.map((c) => [c.id, c.html, c.touched]), [["c1", "<p>mine, unsaved</p>", true], ["c2", "<p>two</p>", false], ["c3", "<p>added in tab B</p>", false]]);
  assert.equal(draftIsNewer({ chapters: [ch1, ch2old], baseRev: 3 }, server), true, "chapter one still differs: offered");
  assert.equal(draftIsNewer({ chapters: [{ ...ch1, html: "<p>server</p>" }, ch2old], baseRev: 3 }, server), false, "a chapter that only exists on the server is not a difference");
});

test("mergeDraft: a chapter deleted elsewhere stays deleted unless this page edited it", () => {
  const server = { rev: 5, chapters: [{ id: "c1", title: "One", html: "<p>server</p>" }] };
  assert.deepEqual(mergeDraft({ chapters: [ch1, ch2old], baseRev: 3 }, server).map((c) => c.id), ["c1"], "untouched and gone there: gone");
  const edited = mergeDraft({ chapters: [ch1, { ...ch2old, html: "<p>typed here</p>", touched: true }], baseRev: 3 }, server);
  assert.deepEqual(edited.map((c) => [c.id, c.html]), [["c1", "<p>mine, unsaved</p>"], ["c2", "<p>typed here</p>"]], "edited here and deleted there: the words come back");
  assert.equal(draftIsNewer({ chapters: [{ ...ch1, html: "<p>server</p>" }, ch2old], baseRev: 3 }, server), false, "only an untouched deleted chapter differs: nothing to offer");
});

test("mergeDraft: a rename elsewhere is kept; a rename here wins for an edited chapter", () => {
  const server = { rev: 5, chapters: [{ id: "c1", title: "One", html: "<p>mine, unsaved</p>" }, { id: "c2", title: "Renamed in B", html: "<p>old copy</p>" }] };
  const out = mergeDraft({ chapters: [{ ...ch1, title: "Renamed here" }, ch2old], baseRev: 3 }, server);
  assert.deepEqual(out.map((c) => c.title), ["Renamed here", "Renamed in B"]);
  assert.equal(draftIsNewer({ chapters: [ch1, ch2old], baseRev: 3 }, server), false, "the other tab's rename alone is no difference");
});

test("mergeDraft: a chapter created here and never saved keeps its place; server order is the frame", () => {
  const server = { rev: 5, chapters: [{ id: "c2", title: "Two", html: "<p>two</p>" }, { id: "c1", title: "One", html: "<p>one</p>" }] };
  const out = mergeDraft({ chapters: [ch1, { id: null, title: "New", html: "<p>new</p>", touched: true }, ch2old], baseRev: 3 }, server);
  assert.deepEqual(out.map((c) => [c.id, c.touched]), [["c2", false], [null, true], ["c1", true]], "server order, the new chapter at its draft index");
});

test("mergeDraft: a draft from before chapters were marked restores whole, by position", () => {
  const server = { rev: 5, chapters: [{ id: "c1", title: "One", html: "<p>server</p>" }, { id: "c2", title: "Two", html: "<p>two</p>" }, { id: "c3", title: "Three", html: "" }] };
  const out = mergeDraft({ chapters: [{ id: null, title: "", html: "<p>old</p>" }, { id: "c2", title: "Two", html: "<p>mine</p>" }], savedAt: 9 }, server);
  assert.deepEqual(out.map((c) => [c.id, c.title, c.html, c.touched]), [["c1", "One", "<p>old</p>", true], ["c2", "Two", "<p>mine</p>", true]]);
});
