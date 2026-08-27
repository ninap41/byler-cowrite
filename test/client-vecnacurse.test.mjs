// Vecna's Curse gimmick's client half (components/vecna-curse.js) on jsdom:
// the target list, the veil falling on the VICTIM only, writing your way
// out, and the watchers' red pulse. Cosmetic dread — nothing is blocked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.mjs";

installDom();
const { layerHtml, targetsHtml, CURSE_LIFT_WORDS, mountVecnaCurse } =
  await import("../public/js/components/vecna-curse.js");

const TABLE = [
  { userId: "u1", name: "me", color: "#6c8cff", connected: true },
  { userId: "u2", name: "Mike", color: "#e63946", connected: true },
  { userId: "u3", name: "Will", color: "#3ddc84", connected: false },
];

test("layerHtml: veil with rising motes + the WRITE word, HUD with targets/way out", () => {
  const h = layerHtml();
  for (const id of ["vcxLayer", "vcxVeil", "vcxWord", "vcxHud", "vcxHint", "vcxTargets"]) assert.match(h, new RegExp(`id="${id}"`));
  assert.ok((h.match(/vcx-mote/g) || []).length >= 6, "debris drifts upward");
  assert.match(h, /data-act="vcx-exit"/);
});

test("targetsHtml: every other connected writer is clickable; me and the away are listed but disabled", () => {
  const h = targetsHtml(TABLE, "u1");
  assert.match(h, /data-target="u2"(?! disabled)/, "Mike is fair game");
  assert.match(h, /data-target="u1" disabled[^>]*>me \(you\)/, "not yourself");
  assert.match(h, /data-target="u3" disabled[^>]*>Will \(away\)/, "not the away");
  assert.match(targetsHtml([], "u1"), /Nobody else/);
});

function fakeSocket(reply = () => ({ ok: true })) {
  const handlers = {};
  const sent = [];
  return {
    sent,
    on: (ev, fn) => (handlers[ev] = fn),
    emit: (ev, data, ack) => (sent.push([ev, data]), ack?.(reply(data))),
    fire: (ev, data) => handlers[ev]?.(data),
  };
}

const key = (k) => new window.KeyboardEvent("keydown", { key: k, bubbles: true });

test("mountVecnaCurse: start lists the table; clicking a target asks the server; a refusal shows its reason", () => {
  document.body.innerHTML = "";
  const socket = fakeSocket((d) => (d?.targetUserId ? { ok: false, error: "A curse is already in flight…" } : { ok: true }));
  const m = mountVecnaCurse({ socket, getMyUserId: () => "u1", getTable: () => TABLE, document });
  m.start();
  assert.equal(m.open, true);
  const target = document.querySelector('#vcxTargets [data-target="u2"]');
  assert.ok(target && !target.disabled);
  target.dispatchEvent(new window.Event("click", { bubbles: true }));
  assert.ok(socket.sent.some(([ev, d]) => ev === "gimmick-curse" && d.targetUserId === "u2"), "the curse asks the server");
  assert.equal(document.getElementById("vcxHint").textContent, "A curse is already in flight…");
  m.exit();
  assert.equal(m.open, false);
});

test("the veil falls only on the VICTIM; typing CURSE_LIFT_WORDS words sings them out", () => {
  document.body.innerHTML = "";
  const socket = fakeSocket();
  const chime = { rang: 0 };
  const m = mountVecnaCurse({ socket, getMyUserId: () => "u1", getTable: () => TABLE, playChime: () => chime.rang++, document });
  const veil = document.getElementById("vcxVeil");
  // someone ELSE is cursed: no veil for me, but the layer shows (chips pulse)
  socket.fire("gimmick-curse", { byName: "Mike", byColor: "#e63946", targetUserId: "u2", targetName: "Mike", duration: 60000 });
  assert.equal(m.cursedUserId, "u2");
  assert.ok(veil.classList.contains("hidden"), "the veil is the victim's alone");
  assert.equal(chime.rang, 0, "and so is the chime");
  assert.ok(document.documentElement.classList.contains("vcx-live"), "the clock tells on every screen");
  // my keys do nothing while it isn't my curse
  document.dispatchEvent(key("a"));
  assert.equal(m.typed, 0);
  socket.fire("gimmick-curse", { targetUserId: "u2", lift: true });
  assert.equal(m.cursedUserId, null);
  assert.ok(!document.documentElement.classList.contains("vcx-live"));
  // now I am taken: veil + chime, and my writing is the way out
  socket.fire("gimmick-curse", { byName: "Mike", byColor: "#e63946", targetUserId: "u1", targetName: "me", duration: 60000 });
  assert.ok(!veil.classList.contains("hidden"), "the veil falls on me");
  assert.equal(chime.rang, 1, "the clock strikes for me");
  assert.ok(document.documentElement.classList.contains("vcx-taken"), "and my page runs backwards, mirrored, the Upside Down's way");
  const word = document.getElementById("vcxWord");
  assert.match(word.textContent, /WRITE\. 0\/32 words · \d+s/, "the veil counts words and seconds");
  for (let i = 0; i < CURSE_LIFT_WORDS - 1; i++) {
    document.dispatchEvent(key("x"));
    document.dispatchEvent(key("x")); // more letters of the same word don't count twice
    document.dispatchEvent(key(" "));
  }
  assert.equal(m.typed, CURSE_LIFT_WORDS - 1);
  assert.match(word.textContent, /WRITE\. 31\/32 words/);
  assert.ok(!socket.sent.some(([ev]) => ev === "gimmick-uncurse"), "one short of the song");
  document.dispatchEvent(key("!"));
  assert.ok(socket.sent.some(([ev]) => ev === "gimmick-uncurse"), "the 32nd word sings me out");
  // modifier keys never counted
  socket.fire("gimmick-curse", { targetUserId: "u1", lift: true });
  assert.equal(m.cursedUserId, null);
  assert.ok(!document.documentElement.classList.contains("vcx-taken"), "the lift turns my page right way round");
});

test("gimmicksOff: a friendly switch lifts any live curse and folds the HUD, reporting whether anything was out", () => {
  document.body.innerHTML = "";
  const socket = fakeSocket();
  const m = mountVecnaCurse({ socket, getMyUserId: () => "u1", getTable: () => TABLE, document });
  assert.equal(m.gimmicksOff(), false, "nothing out, nothing to say");
  m.start();
  socket.fire("gimmick-curse", { byName: "Mike", byColor: "#e63946", targetUserId: "u1", targetName: "me", duration: 60000 });
  assert.equal(m.gimmicksOff(), true);
  assert.equal(m.open, false);
  assert.equal(m.cursedUserId, null);
  assert.ok(!document.documentElement.classList.contains("vcx-live"));
});
