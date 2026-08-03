import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.mjs";

let ctx;
before(async () => (ctx = await startServer()));
after(async () => ctx.stop());

const page = async (path) => {
  const r = await fetch(ctx.url + path);
  return { status: r.status, body: await r.text(), headers: r.headers };
};

test("pages/modules/css are never cached (stale-module mixing breaks handlers)", async () => {
  for (const path of ["/", "/dashboard", "/js/chrome.js", "/js/theme.js", "/css/base.css"]) {
    const r = await page(path);
    assert.equal(r.headers.get("cache-control"), "no-store", path + " uncacheable");
  }
  const snd = await fetch(ctx.url + "/sounds/incomingline.mp3");
  assert.match(snd.headers.get("cache-control") || "", /max-age=6048/, "sounds may cache");
});

test("homepage serves the hero + auth card", async () => {
  const { status, body } = await page("/");
  assert.equal(status, 200);
  assert.ok(body.includes('id="hero"'));
  assert.ok(body.includes('id="authChoice"'));
  assert.ok(!body.includes("Play as guest"), "guest path fully removed");
  assert.ok(body.includes('id="liveWatch"'), "spectate list on the homepage");
});

test("clean URLs serve each page", async () => {
  const dash = await page("/dashboard");
  assert.equal(dash.status, 200);
  assert.ok(dash.body.includes('id="writersList"'), "writers directory present");
  assert.ok(dash.body.includes('id="inviteBtn"'));
  const game = await page("/game");
  assert.equal(game.status, 200);
  assert.ok(game.body.includes('id="writerEditor"'));
  assert.ok(game.body.includes('id="playersRow"'));
  assert.ok(game.body.includes('id="headerInput"'), "chapter-header control");
  const arch = await page("/archive");
  assert.equal(arch.status, 200);
  assert.ok(arch.body.includes('id="archiveList"'));
  for (const id of ["delModal", "archDelete", "delHtml", "delPdf", "delConfirm", "delCancel"])
    assert.ok(arch.body.includes(`id="${id}"`), id + " in the delete flow");
  const prof = await page("/profile");
  assert.equal(prof.status, 200);
  assert.ok(prof.body.includes('id="ladder"') && prof.body.includes('id="usageCase"'));
  const set = await page("/settings");
  assert.equal(set.status, 200);
  assert.ok(set.body.includes('id="savePass"'));
  // color picker leads; username/email/password are collapsed behind toggles
  assert.ok(set.body.indexOf('id="swatches"') < set.body.indexOf('data-toggle="secUsername"'), "color first");
  for (const sec of ["secUsername", "secEmail", "secPass"]) {
    assert.ok(set.body.includes(`data-toggle="${sec}"`), sec + " toggle");
    assert.ok(new RegExp(`id="${sec}" class="sec-body hidden"`).test(set.body), sec + " starts collapsed");
  }
});
