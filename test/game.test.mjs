import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, signup, startedGame } from "./helpers.mjs";

let ctx;
before(async () => (ctx = await startServer()));
after(async () => ctx.stop());

test("guests cannot host; signed-in create works and announces start", async () => {
  const G = await ctx.conn();
  const denied = await ctx.emit(G, "create-session", { name: "guest", color: "#e63946" });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /Sign in to host/);

  const u = await signup(ctx, "hostuser1", "h1@x.com");
  const A = await ctx.conn();
  const chats = [];
  A.on("chat", (m) => chats.push(m));
  const c = await ctx.emit(A, "create-session", { name: "ignored", color: "#e63946", auth: u.token });
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
      text: isHost ? 'Five words <b>bold</b> here now <script>alert(1)</script>' : "guest line",
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
  assert.equal(hostLine.guest, false);
  assert.equal(ov.story.find((l) => l.name === "GuestMike").guest, true);

  const me = await ctx.api("/api/me", null, host.token, "GET");
  assert.ok(me.data.user.wordCount >= 5, "host words credited");
  assert.equal(me.data.user.currentBadge, "✏️ Inkling");
  assert.ok(me.data.user.games.includes(code));
});

test("submit-line rejected when not your turn; rules host-only", async () => {
  const { A, B, state } = await startedGame(ctx);
  const notCurrent = state.current.currentId === A.id ? B : A;
  const r = await ctx.emit(notCurrent, "submit-line", { text: "sneaky" });
  assert.equal(r.ok, false);
  const rules = await ctx.emit(B, "update-rules", { turnSeconds: 600 });
  assert.equal(rules.ok, false, "guest cannot change rules");
  const ok = await ctx.emit(A, "update-rules", { turnSeconds: 120 });
  assert.equal(ok.ok, true);
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

test("timeout commits RAW typed text — quotes escape exactly once", async () => {
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

test("chat: length cap, echo id, badges/guest flags", async () => {
  const { A, B } = await startedGame(ctx);
  const got = new Promise((r) => B.on("chat", r));
  A.emit("chat", { text: "  hello there  " + "x".repeat(600) });
  const m = await got;
  assert.equal(m.id, A.id);
  assert.ok(m.text.length <= 500);
  assert.equal(m.guest, false);
  assert.equal(m.host, true);
});
