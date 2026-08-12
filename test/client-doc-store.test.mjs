// The solo editor's local crash-cache. It must never be mistaken for the save
// path: it only ever OFFERS to restore, and only when it is genuinely newer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installLocalStorage } from "./client-storage.mjs";

installLocalStorage();
const { loadDraft, saveDraft, clearDraft, draftIsNewer } = await import("../public/js/doc-store.js");

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
  saveDraft("doc-1", "<p>hi</p>", "Title", s);
  const d = loadDraft("doc-1", s);
  assert.equal(d.html, "<p>hi</p>");
  assert.equal(d.title, "Title");
  assert.ok(d.savedAt > 0);
  assert.equal(loadDraft("doc-2", s), null, "another doc's draft is not offered");
});

test("clearing only drops the cache when it belongs to this doc", () => {
  const s = mem();
  saveDraft("doc-1", "<p>a</p>", "T", s);
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
  assert.equal(saveDraft("d", "<p>x</p>", "t", broken), false, "reports failure instead of throwing");
  assert.equal(loadDraft("d", broken), null);
  assert.doesNotThrow(() => clearDraft("d", broken));
});

test("a draft is only worth restoring when newer AND different", () => {
  const doc = { html: "<p>server</p>", updatedAt: 1000 };
  assert.equal(draftIsNewer({ html: "<p>local</p>", savedAt: 2000 }, doc), true);
  assert.equal(draftIsNewer({ html: "<p>local</p>", savedAt: 500 }, doc), false, "older than the server copy");
  assert.equal(draftIsNewer({ html: "<p>server</p>", savedAt: 2000 }, doc), false, "identical content is not a change");
  assert.equal(draftIsNewer(null, doc), false);
  assert.equal(draftIsNewer({ html: "x", savedAt: 2000 }, null), false);
});
