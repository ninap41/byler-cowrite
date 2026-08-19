// The inbox delete confirmation on jsdom: cancel keeps, confirm deletes,
// and the modal wording tells a message from a conversation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.mjs";

installDom();
const { confirmInboxDelete, INBOX_DEL_MODAL } = await import("../public/js/components/confirm-delete.js");

test("confirmInboxDelete: mounts once, words itself, resolves true on confirm and false on cancel / escape / backdrop", async () => {
  const p1 = confirmInboxDelete({ conversation: false });
  const modal = document.getElementById("ibDelModal");
  assert.ok(modal && !modal.classList.contains("hidden"));
  assert.equal(document.getElementById("ibDelTitle").textContent, "Delete this message?");
  document.getElementById("ibDelCancel").click();
  assert.equal(await p1, false);
  assert.ok(modal.classList.contains("hidden"));

  const p2 = confirmInboxDelete({ conversation: true, count: 3 });
  assert.equal(document.getElementById("ibDelTitle").textContent, "Delete this conversation?");
  assert.match(document.getElementById("ibDelText").textContent, /All 3 messages/);
  document.getElementById("ibDelConfirm").click();
  assert.equal(await p2, true);
  assert.equal(document.querySelectorAll("#ibDelModal").length, 1, "mounted once");

  const p3 = confirmInboxDelete();
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
  assert.equal(await p3, false);
  const p4 = confirmInboxDelete();
  modal.click(); // the backdrop
  assert.equal(await p4, false);
  assert.match(INBOX_DEL_MODAL, /confirm-card/);
});

test("confirmDialog is the general form: title/text/label/danger are the caller's; the inbox delete is one wording of it", async () => {
  const { confirmDialog } = await import("../public/js/components/confirm-delete.js");
  const p = confirmDialog({ title: "End “X” and reveal?", text: "It ends here.", confirmLabel: "End & reveal", danger: false });
  const ok = document.getElementById("ibDelConfirm");
  assert.equal(document.getElementById("ibDelTitle").textContent, "End “X” and reveal?");
  assert.equal(document.getElementById("ibDelText").textContent, "It ends here.");
  assert.equal(ok.textContent, "End & reveal");
  assert.equal(ok.className, "primary", "not a danger button when the caller says so");
  ok.click();
  assert.equal(await p, true);
  const p2 = confirmDialog({ title: "Delete?", confirmLabel: "Delete forever" });
  assert.equal(document.getElementById("ibDelConfirm").className, "primary danger");
  document.getElementById("ibDelCancel").click();
  assert.equal(await p2, false);
});
