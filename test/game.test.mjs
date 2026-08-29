import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, signup, startedGame } from "./helpers.mjs";

let ctx;
before(async () => (ctx = await startServer()));
after(async () => ctx.stop());

test("signed-out sockets cannot host; signed-in create works and announces start", async () => {
  const G = await ctx.conn();
  const denied = await ctx.emit(G, "create-session", {});
  assert.equal(denied.ok, false);
  assert.match(denied.error, /Sign in to host/);

  const u = await signup(ctx, "hostuser1", "h1@x.com");
  const A = await ctx.conn();
  const chats = [];
  A.on("chat", (m) => chats.push(m));
  const c = await ctx.emit(A, "create-session", { auth: u.token });
  assert.equal(c.ok, true);
  assert.match(c.code, /^[A-Z0-9]{4}$/);
  await ctx.emit(A, "start-game", { turnSeconds: 60, rounds: 1 });
  await ctx.wait(150);
  const sys = chats.find((m) => m.sys);
  assert.equal(sys.name, "hostuser1");
  assert.equal(sys.text, "started the game");
});

test("full round: vote -> lines -> game over; badge + word credit; sanitize", async () => {
  const { host, A, B, code, state } = await startedGame(ctx, { rounds: 1 });
  assert.equal(state.current.phase, "writing");
  assert.equal(state.current.hostName, "willthewise");
  assert.equal(state.current.code, code);
  const over = new Promise((r) => A.on("game-over", r));
  for (let i = 0; i < 2; i++) {
    const sock = state.current.currentId === A.id ? A : B;
    const isHost = sock === A;
    const res = await ctx.emit(sock, "submit-line", {
      text: isHost ? 'Five words <b>bold</b> here now <script>alert(1)</script>' : "second writer line",
    });
    assert.equal(res.ok, true);
    await ctx.wait(150);
  }
  const ov = await over;
  assert.equal(ov.story.length, 2);
  const hostLine = ov.story.find((l) => l.name === "willthewise");
  assert.ok(hostLine.html.includes("<b>bold</b>"), "allowed formatting kept");
  assert.ok(!hostLine.html.includes("<script>"), "script neutralized");
  assert.ok(hostLine.html.includes("&lt;script&gt;"), "script escaped inert");
  assert.equal(hostLine.host, true);
  assert.equal(ov.story.find((l) => l.name === "mikewheeler").host, false);

  const me = await ctx.api("/api/me", null, host.token, "GET");
  assert.ok(me.data.user.wordCount >= 5, "host words credited");
  assert.equal(me.data.user.currentBadge, "🔫 There. Out Loud.", "starter badge until 5000 words");
  assert.ok(me.data.user.nextBadge && me.data.user.nextBadge.min === 5000);
  assert.ok(me.data.user.games.includes(code));
});

test("sanitizer: block formats and alignment classes survive, everything else stays inert", async () => {
  const { A, B, state } = await startedGame(ctx, { rounds: 1 });
  const cur = state.current.currentId === A.id ? A : B;
  await ctx.emit(cur, "submit-line", {
    text:
      '<h2>Chapter</h2><p class="al-c">centered</p><hr><p class="al-r">right</p>' +
      '<p class="al-x">evil class</p><h1 onclick="x()">attr</h1><img src=x onerror=alert(1)>done',
  });
  await ctx.wait(150);
  const html = state.current.story[0].html;
  assert.ok(html.includes("<h2>Chapter</h2>"), "h2 allowed");
  assert.ok(html.includes('<p class="al-c">centered</p>'), "center alignment allowed");
  assert.ok(html.includes("<hr>"), "hr allowed");
  assert.ok(html.includes('<p class="al-r">right</p>'), "right alignment allowed");
  assert.ok(!html.includes('class="al-x"'), "unknown class escaped");
  assert.ok(!html.includes("<h1 "), "attribute-bearing heading escaped");
  assert.ok(!html.includes("<img"), "img stays escaped");
  assert.ok(html.includes("&lt;img"), "img visible as inert text");
});

test("submit-line rejected when not your turn; rules host-only", async () => {
  const { A, B, state } = await startedGame(ctx);
  const notCurrent = state.current.currentId === A.id ? B : A;
  const r = await ctx.emit(notCurrent, "submit-line", { text: "sneaky" });
  assert.equal(r.ok, false);
  const rules = await ctx.emit(B, "update-rules", { turnSeconds: 600 });
  assert.equal(rules.ok, false, "non-host cannot change rules");
  const before = state.current.deadline;
  const ok = await ctx.emit(A, "update-rules", { turnSeconds: 120 });
  assert.equal(ok.ok, true);
  await ctx.wait(120);
  assert.equal(state.current.turnSeconds, 120);
  assert.ok(state.current.deadline > before, "Apply restarts the running clock at the new length immediately");
  assert.ok(state.current.maxTurns != null, "the game has a finish line before going endless");
  await ctx.emit(A, "update-rules", { endless: true });
  await ctx.wait(120);
  assert.equal(state.current.maxTurns, null, "♾ infinite rounds removes the finish line");
  // mid-game Apply can also flip the story mode and disable the timer
  await ctx.emit(A, "update-rules", { turnSeconds: 0, friendly: false });
  await ctx.wait(120);
  assert.equal(state.current.friendly, false, "mode change broadcast mid-game");
  assert.equal(state.current.turnSeconds, 0, "no-timer applied mid-game");
  assert.equal(state.current.deadline, 0, "running clock cleared immediately");
});

test("untimed non-friendly story: turnSeconds 0 disables the clock; mode broadcast + snapshot", async () => {
  const { A, B, code, state } = await startedGame(ctx, { turnSeconds: 0, rounds: 1, friendly: false });
  assert.equal(state.current.turnSeconds, 0, "untimed rules broadcast");
  assert.equal(state.current.deadline, 0, "no deadline while untimed");
  assert.equal(state.current.friendly, false, "non-friendly mode broadcast");
  const before = state.current.currentId;
  await ctx.wait(600);
  assert.equal(state.current.currentId, before, "turn never auto-advances without a clock");
  assert.equal((state.current.story || []).length, 0, "nothing auto-committed");
  const cur = state.current.currentId === A.id ? A : B;
  const r = await ctx.emit(cur, "submit-line", { text: "in our own time" });
  assert.equal(r.ok, true, "manual submit still advances");
  await ctx.wait(150);
  assert.equal(state.current.deadline, 0, "next turn is untimed too");
  // the mode + untimed rules survive in the snapshot
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const snap = JSON.parse(readFileSync(join(ctx.saveDir, code + ".json"), "utf-8"));
  assert.equal(snap.friendly, false);
  assert.equal(snap.turnSeconds, 0);
});

test("💩 Resume it, Stupid: poking the editor while paused awards once, toasts everyone", async () => {
  const { A, B, state } = await startedGame(ctx);
  const toasts = [];
  B.on("badge-earned", (b) => toasts.push(b));
  await ctx.emit(A, "pause-game", {});
  await ctx.wait(120);
  A.emit("paused-poke");
  await ctx.wait(200);
  assert.deepEqual(toasts.map((t) => t.badge), ["💩 Resume it, Stupid"], "everyone gets the toast");
  A.emit("paused-poke"); // collectibles award exactly once
  await ctx.wait(200);
  assert.equal(toasts.length, 1, "no double award");
  await ctx.emit(A, "resume-game", {});
  await ctx.wait(120);
  A.emit("paused-poke"); // not paused -> no-op
  B.emit("paused-poke");
  await ctx.wait(200);
  assert.equal(toasts.length, 1, "pokes while running do nothing");
});

test("pause/resume host-only and clock freezing", async () => {
  const { A, B, state } = await startedGame(ctx);
  assert.equal((await ctx.emit(B, "pause-game", {})).ok, false);
  assert.equal((await ctx.emit(A, "pause-game", {})).ok, true);
  await ctx.wait(120);
  assert.equal(state.current.paused, true);
  assert.ok(state.current.remaining > 0);
  assert.equal((await ctx.emit(B, "resume-game", {})).ok, false);
  assert.equal((await ctx.emit(A, "resume-game", {})).ok, true);
  await ctx.wait(120);
  assert.equal(state.current.paused, false);
});

test("timeout commits RAW typed text, quotes escape exactly once", async () => {
  const { A, B, state } = await startedGame(ctx, { turnSeconds: 10, rounds: 1 });
  const cur = state.current.currentId === A.id ? A : B;
  cur.emit("typing", { text: '"What?" Mike said & stared.' });
  for (let i = 0; i < 60 && !(state.current.story || []).length; i++) await ctx.wait(300);
  const line = state.current.story?.[0];
  assert.ok(line, "line committed at deadline");
  assert.ok(line.html.includes("&quot;What?&quot;"), "quotes escaped once: " + line.html);
  assert.ok(!line.html.includes("&amp;quot;"), "not double-escaped");
});

test("session rename: host-only, sanitized, broadcast", async () => {
  const { A, B, state } = await startedGame(ctx);
  assert.equal((await ctx.emit(B, "rename-session", { name: "nope" })).ok, false);
  const r = await ctx.emit(A, "rename-session", { name: "  The <b>Tale</b>  " });
  assert.equal(r.name, "The Tale");
  await ctx.wait(120);
  assert.equal(state.current.name, "The Tale");
});

test("submit-line: quotes and ampersands escape exactly once (no &quot; on screen)", async () => {
  const { A, B, state } = await startedGame(ctx, { rounds: 1 });
  const cur = state.current.currentId === A.id ? A : B;
  // the client's cleanHtml now sends text RAW — the server is the only escaper
  await ctx.emit(cur, "submit-line", { text: '"Michael?" Will said & <b>smiled</b>.' });
  await ctx.wait(150);
  const html = state.current.story[0].html;
  assert.ok(html.includes("&quot;Michael?&quot;"), "quotes escaped once: " + html);
  assert.ok(html.includes("said &amp; "), "ampersand escaped once");
  assert.ok(html.includes("<b>smiled</b>"), "formatting kept");
  assert.ok(!html.includes("&amp;quot;"), "not double-escaped");
});

test("edit-line: authors revise their own lines only; sanitized once; marked edited", async () => {
  const { A, B, state } = await startedGame(ctx);
  const first = state.current.currentId === A.id ? A : B;
  const second = first === A ? B : A;
  await ctx.emit(first, "submit-line", { text: "the original line" });
  await ctx.wait(150);
  const notAuthor = await ctx.emit(second, "edit-line", { index: 0, text: "hijacked" });
  assert.equal(notAuthor.ok, false, "only the author can edit");
  const missing = await ctx.emit(first, "edit-line", { index: 99, text: "x" });
  assert.equal(missing.ok, false);
  const empty = await ctx.emit(first, "edit-line", { index: 0, text: "  " });
  assert.equal(empty.ok, false, "cannot blank a line");
  const ok = await ctx.emit(first, "edit-line", { index: 0, text: '"Fixed!" he said & <b>meant it</b> <script>x</script>' });
  assert.equal(ok.ok, true);
  await ctx.wait(150);
  const line = state.current.story[0];
  assert.ok(line.html.includes("&quot;Fixed!&quot;"), "escaped exactly once");
  assert.ok(line.html.includes("<b>meant it</b>"));
  assert.ok(!line.html.includes("<script>"));
  assert.equal(line.edited, true);
});

test("delete-line: authors remove their own lines only; story re-broadcasts", async () => {
  const { A, B, state } = await startedGame(ctx);
  const first = state.current.currentId === A.id ? A : B;
  const second = first === A ? B : A;
  await ctx.emit(first, "submit-line", { text: "a line to delete" });
  await ctx.wait(150);
  await ctx.emit(second, "submit-line", { text: "a line that stays" });
  await ctx.wait(150);
  assert.equal(state.current.story.length, 2);
  const notAuthor = await ctx.emit(second, "delete-line", { index: 0 });
  assert.equal(notAuthor.ok, false, "only the author can delete");
  const missing = await ctx.emit(first, "delete-line", { index: 99 });
  assert.equal(missing.ok, false);
  const ok = await ctx.emit(first, "delete-line", { index: 0 });
  assert.equal(ok.ok, true);
  await ctx.wait(150);
  assert.equal(state.current.story.length, 1);
  assert.ok(state.current.story[0].html.includes("a line that stays"), "the right line was removed");
});

test("idle sleep: a live game with no activity for the window goes to SLEEP (not revealed); the snapshot survives and wakes paused", async () => {
  const idleCtx = await startServer({ COWRITE_IDLE_SLEEP_MS: "700" });
  try {
    const { A, host, code, state } = await startedGame(idleCtx);
    let slept = null, over = null;
    A.on("game-slept", (d) => (slept = d));
    A.on("game-over", (d) => (over = d));
    await idleCtx.wait(300);
    assert.equal(slept, null, "not before the window");
    await idleCtx.wait(700);
    assert.ok(slept, "no activity → asleep");
    assert.equal(over, null, "asleep, not revealed");
    assert.equal(slept.code, code);
    // it's off "games in progress"? no — a sleeping game still shows, as paused
    const dash = await idleCtx.api("/api/dashboard", null, host.token, "GET");
    const card = dash.data.myGames.find((g) => g.code === code);
    assert.ok(card && card.paused && !card.live, "listed as paused, not live");
    // and it's continuable — the archive still has it
    const detail = await idleCtx.api("/api/games/" + code, null, host.token, "GET");
    assert.equal(detail.status, 200);
    assert.notEqual(detail.data.phase, "over");
  } finally {
    await idleCtx.stop();
  }
});

test("idle sleep: real activity resets the window, a game being written in never sleeps", async () => {
  const idleCtx = await startServer({ COWRITE_IDLE_SLEEP_MS: "700" });
  try {
    const { A, B, state } = await startedGame(idleCtx);
    let slept = null;
    A.on("game-slept", (d) => (slept = d));
    // chat every 300ms across the 700ms window: activity keeps it awake
    for (let i = 0; i < 4; i++) {
      const who = state.current.currentId === A.id ? A : B;
      who.emit("chat", { text: "still here " + i });
      await idleCtx.wait(300);
    }
    assert.equal(slept, null, "activity keeps the window from firing");
    // now go quiet
    await idleCtx.wait(800);
    assert.ok(slept, "silence finally sleeps it");
  } finally {
    await idleCtx.stop();
  }
});

test("host puts a live game to sleep from the dashboard; non-hosts can't; a sleeping one is a 409", async () => {
  const sctx = await startServer();
  try {
    const { host, mike, A, code } = await startedGame(sctx);
    const slept = new Promise((r) => A.on("game-slept", r));
    assert.equal((await sctx.api(`/api/games/${code}/sleep`, {}, mike.token)).status, 403, "not the host");
    assert.equal((await sctx.api(`/api/games/${code}/sleep`, {}, host.token)).status, 200);
    await slept;
    await sctx.wait(100);
    assert.equal((await sctx.api(`/api/games/${code}/sleep`, {}, host.token)).status, 409, "already asleep (unloaded)");
    const dash = await sctx.api("/api/dashboard", null, host.token, "GET");
    const card = dash.data.myGames.find((g) => g.code === code);
    assert.ok(card && !card.live, "wakeable from the dashboard");
  } finally {
    await sctx.stop();
  }
});

test("delete-game: host-only, snapshot removed, live players notified", async () => {
  const { host, mike, A, B, code } = await startedGame(ctx);
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const snap = join(ctx.saveDir, code + ".json");
  assert.ok(existsSync(snap));
  const notHost = await ctx.api("/api/games/" + code, null, mike.token, "DELETE");
  assert.equal(notHost.status, 403, "seat-holder but not host cannot delete");
  const stranger = await signup(ctx, "delstranger", "dstr@x.com");
  assert.equal((await ctx.api("/api/games/" + code, null, stranger.token, "DELETE")).status, 403);
  const deletedP = new Promise((r) => B.on("game-deleted", r));
  const ok = await ctx.api("/api/games/" + code, null, host.token, "DELETE");
  assert.equal(ok.status, 200);
  await deletedP; // other player told live
  assert.equal(existsSync(snap), false, "snapshot gone");
  assert.equal((await ctx.api("/api/games/" + code, null, host.token, "GET")).status, 404);
  const C = await ctx.conn();
  const rejoin = await ctx.emit(C, "join-session", { code, auth: host.token });
  assert.equal(rejoin.ok, false, "the code is dead");
});

test("host leaving mid-writing pauses the game and announces it", async () => {
  const { A, B, state } = await startedGame(ctx);
  const chats = [];
  B.on("chat", (m) => chats.push(m));
  const stB = { current: null };
  B.on("game-state", (st) => (stB.current = st));
  A.disconnect(); // host routes away / closes the tab
  await ctx.wait(300);
  assert.equal(stB.current.paused, true, "clock frozen");
  assert.ok(stB.current.remaining > 0, "remaining time stashed");
  assert.ok(chats.some((m) => m.sys && /stepped away: game paused/.test(m.text)), "pause announced");
});

test("chat: length cap, echo id, host flag", async () => {
  const { A, B } = await startedGame(ctx);
  const got = new Promise((r) => B.on("chat", r));
  A.emit("chat", { text: "  hello there  " + "x".repeat(600) });
  const m = await got;
  assert.equal(m.id, A.id);
  assert.ok(m.text.length <= 500);
  assert.equal(m.host, true);
});

test("a new session is born with a random title, ≤40 chars, until the host renames it", async () => {
  const { host, A, state, code } = await startedGame(ctx);
  const st = state.current;
  assert.ok(st.name && st.name.length <= 40, "named at birth: " + JSON.stringify(st.name));
  assert.notEqual(st.name, code, "not just the code");
  const B = await ctx.conn();
  const second = await ctx.emit(B, "create-session", { auth: host.token });
  assert.ok(second.name && second.name.length <= 40);
  await ctx.emit(A, "rename-session", { name: "Our story" });
  await ctx.wait(100);
  assert.equal(state.current.name, "Our story");
});


test("plainText / clip: a line's words with entities decoded, and a preview cut on a word with an ellipsis", async () => {
  const { plainText, clip } = await import("../src/sanitize.js");
  assert.equal(plainText("<p>It shouldn&#39;t matter, &quot;Mike&quot; &amp; Will&hellip;</p>"), "It shouldn't matter, \"Mike\" & Will&hellip;");
  assert.equal(plainText("<b>one</b><i>two</i>"), "one two");
  assert.equal(clip("short", 20), "short");
  assert.equal(clip("the quick brown fox jumps", 17), "the quick brown…");
});

test("cancel-game: a brand-new lobby (no story) is discarded; non-host can't; not once writing", async () => {
  const host = await signup(ctx, "cancelhost", "ch@x.com");
  const other = await signup(ctx, "cancelother", "co@x.com");
  const A = await ctx.conn();
  const B = await ctx.conn();
  const c = await ctx.emit(A, "create-session", { auth: host.token });
  await ctx.emit(B, "join-session", { code: c.code, auth: other.token });
  await ctx.wait(80);

  // a non-host writer cannot cancel
  const denied = await ctx.emit(B, "cancel-game", {});
  assert.equal(denied.ok, false);
  assert.match(denied.error, /host/i);

  // still there after the denied attempt
  assert.equal((await ctx.api("/api/games/" + c.code, null, host.token, "GET")).status, 200);

  // the host cancels a never-started game — it is discarded
  const gone = new Promise((r) => B.once("game-deleted", r));
  const res = await ctx.emit(A, "cancel-game", {});
  assert.equal(res.ok, true);
  assert.equal(res.deleted, true, "a brand-new game is deleted");
  await gone; // the room is told
  assert.equal((await ctx.api("/api/games/" + c.code, null, host.token, "GET")).status, 404, "snapshot unlinked");
});

test("cancel-game: refused once the game is writing", async () => {
  const { A, code, host } = await startedGame(ctx, { rounds: 1 });
  await ctx.wait(150);
  const res = await ctx.emit(A, "cancel-game", {});
  assert.equal(res.ok, false);
  assert.match(res.error, /underway/i);
  // the game is untouched
  assert.equal((await ctx.api("/api/games/" + code, null, host.token, "GET")).status, 200);
});

test("cancel-game: a continued (reopened) lobby is PRESERVED — story kept, closed back to the reveal", async () => {
  const { A, B, code, host, state } = await startedGame(ctx, { rounds: 1 });
  await ctx.wait(150);
  // write one line so the story is non-empty (whoever's turn it is commits;
  // the other gets a harmless "not your turn" ack)
  for (const sock of [A, B]) await ctx.emit(sock, "submit-line", { text: "a line" });
  await ctx.wait(150);
  await ctx.emit(A, "end-game", {});
  await ctx.wait(100);
  const before = await ctx.api("/api/games/" + code, null, host.token, "GET");
  assert.ok(before.data.story.length >= 1, "the finished story has lines");

  // reopen it into a lobby (keeps the lines)
  const re = await ctx.api("/api/games/" + code + "/reopen", {}, host.token);
  assert.equal(re.status, 200);
  await ctx.wait(120);

  // cancel the reopened lobby — preserve, don't delete
  const res = await ctx.emit(A, "cancel-game", {});
  assert.equal(res.ok, true);
  assert.equal(res.preserved, true, "a continued game is preserved, not deleted");

  const after = await ctx.api("/api/games/" + code, null, host.token, "GET");
  assert.equal(after.status, 200, "the story still exists");
  assert.equal(after.data.phase, "over", "closed back to the reveal");
  assert.deepEqual(
    after.data.story.map((l) => l.text),
    before.data.story.map((l) => l.text),
    "every line is preserved",
  );
});
