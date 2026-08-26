import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { startServer, signup } from "./helpers.mjs";

let ctx;
before(async () => (ctx = await startServer()));
after(async () => ctx.stop());

async function startSmtpCapture() {
  const messages = [];
  let resolveMessage;
  const nextMessage = new Promise((resolve) => (resolveMessage = resolve));
  const server = createServer((socket) => {
    let buffer = "";
    let inData = false;
    let message = "";
    socket.write("220 test SMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += String(chunk);
      let end;
      while ((end = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === ".") {
            messages.push(message);
            resolveMessage(message);
            message = "";
            inData = false;
            socket.write("250 queued\r\n");
          } else {
            message += line + "\r\n";
          }
          continue;
        }
        if (/^(EHLO|HELO) /i.test(line)) socket.write("250-test\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n");
        else if (/^AUTH /i.test(line)) socket.write("235 authenticated\r\n");
        else if (/^(MAIL FROM:|RCPT TO:)/i.test(line)) socket.write("250 OK\r\n");
        else if (/^DATA$/i.test(line)) {
          inData = true;
          socket.write("354 send message\r\n");
        } else if (/^QUIT$/i.test(line)) socket.end("221 bye\r\n");
        else socket.write("250 OK\r\n");
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: server.address().port,
    messages,
    nextMessage,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("signup validation: email, username, password, duplicates, @ ban", async () => {
  const bad = [
    [{ email: "nope", username: "someone1", password: "1234" }, /valid email/i],
    [{ email: "a@b.com", username: "abc", password: "1234" }, /Username must be/i],
    [{ email: "a@b.com", username: "who@what", password: "1234" }, /can't contain @/i],
    [{ email: "a@b.com", username: "someone1", password: "123" }, /Password must be at least 4/i],
  ];
  for (const [body, re] of bad) {
    const r = await ctx.api("/api/signup", body);
    assert.equal(r.status, 400);
    assert.match(r.data.error, re);
  }
  const ok = await ctx.api("/api/signup", { email: "will@byers.com", username: "willthewise", password: "1234" });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.token);
  assert.equal(ok.data.user.wordCount, 0);
  assert.equal(ok.data.user.currentBadge, "🔫 There. Out Loud.", "starter badge from signup");

  const dupeEmail = await ctx.api("/api/signup", { email: "WILL@byers.com", username: "other1", password: "1234" });
  assert.match(dupeEmail.data.error, /email already has an account/i);
  const dupeUser = await ctx.api("/api/signup", { email: "z@z.com", username: "WillTheWise", password: "1234" });
  assert.match(dupeUser.data.error, /username is taken/i);
});

test("login: distinct errors and both identifier forms", async () => {
  const cases = [
    [{ user: "", password: "x" }, 400, /Enter your username or email/i],
    [{ user: "not@@valid", password: "x" }, 400, /valid email/i],
    [{ user: "ghost@nowhere.com", password: "x" }, 404, /couldn't find a username associated with that email/i],
    [{ user: "nosuchuser", password: "x" }, 404, /couldn't find an email associated with that username/i],
    [{ user: "willthewise", password: "wrong" }, 401, /Wrong password/i],
    [{ user: "will@byers.com", password: "wrong" }, 401, /Wrong password/i],
  ];
  for (const [body, status, re] of cases) {
    const r = await ctx.api("/api/login", body);
    assert.equal(r.status, status, JSON.stringify(r.data));
    assert.match(r.data.error, re);
  }
  assert.equal((await ctx.api("/api/login", { user: "willthewise", password: "1234" })).status, 200);
  assert.equal((await ctx.api("/api/login", { user: "will@byers.com", password: "1234" })).status, 200);
});

test("me / logout session lifecycle", async () => {
  const { token } = (await ctx.api("/api/login", { user: "willthewise", password: "1234" })).data;
  const me = await ctx.api("/api/me", null, token, "GET");
  assert.equal(me.data.user.username, "willthewise");
  await ctx.api("/api/logout", {}, token);
  assert.equal((await ctx.api("/api/me", null, token, "GET")).status, 401);
});

test("forgot username/password lookup + full reset cycle", async () => {
  let r = await ctx.api("/api/forgot", { email: "bad" });
  assert.match(r.data.error, /valid email/i);
  r = await ctx.api("/api/forgot", { email: "ghost@x.com" });
  assert.equal(r.status, 404);
  assert.match(r.data.error, /no username under that email/i);
  r = await ctx.api("/api/forgot", { email: "Will@Byers.com" });
  assert.equal(r.data.username, "willthewise");

  const live = (await ctx.api("/api/login", { user: "willthewise", password: "1234" })).data;
  r = await ctx.api("/api/send-reset", { email: "will@byers.com" });
  assert.equal(r.status, 200);
  const store = JSON.parse(readFileSync(join(ctx.dataDir, "users.json"), "utf-8"));
  const resetToken = Object.keys(store.resets)[0];
  assert.ok(resetToken, "reset token stored");

  r = await ctx.api("/api/reset", { token: resetToken, password: "123" });
  assert.equal(r.status, 400); // too short
  r = await ctx.api("/api/reset", { token: resetToken, password: "newpass" });
  assert.equal(r.status, 200);
  assert.equal((await ctx.api("/api/me", null, live.token, "GET")).status, 401, "sessions invalidated");
  assert.equal((await ctx.api("/api/login", { user: "willthewise", password: "1234" })).status, 401, "old pw dead");
  assert.equal((await ctx.api("/api/login", { user: "willthewise", password: "newpass" })).status, 200);
  r = await ctx.api("/api/reset", { token: resetToken, password: "again" });
  assert.equal(r.status, 400, "reset token single-use");
});

test("reset emails always use the configured HTTPS origin", async () => {
  const smtp = await startSmtpCapture();
  const mailCtx = await startServer({
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(smtp.port),
    SMTP_USER: "test-user",
    SMTP_PASS: "test-pass",
    SMTP_FROM: "sender@example.test",
    PUBLIC_APP_URL: "https://cowrite.example.test",
  });
  try {
    await signup(mailCtx, "resetlinkuser", "resetlink@example.test");
    const response = await fetch(mailCtx.url + "/api/send-reset", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "attacker.example.test",
        "X-Forwarded-Proto": "http",
      },
      body: JSON.stringify({ email: "resetlink@example.test" }),
    });
    assert.equal(response.status, 200, await response.text());
    const message = (await smtp.nextMessage).replace(/=\r?\n/g, "");
    assert.match(message, /https:\/\/cowrite\.example\.test\/reset\.html\?token=/);
    assert.doesNotMatch(message, /attacker\.example\.test/);
  } finally {
    await mailCtx.stop();
    await smtp.close();
  }
});

test("username change: validation, frees old name, archive label freshness", async () => {
  const el = await signup(ctx, "elhopper", "el@hopper.com");
  let r = await ctx.api("/api/account/username", { username: "abc" }, el.token);
  assert.equal(r.status, 400);
  r = await ctx.api("/api/account/username", { username: "new@name" }, el.token);
  assert.equal(r.status, 400);
  r = await ctx.api("/api/account/username", { username: "WILLTHEWISE" }, el.token);
  assert.match(r.data.error, /taken/i);
  r = await ctx.api("/api/account/username", { username: "janehopper" });
  assert.equal(r.status, 401);
  r = await ctx.api("/api/account/username", { username: "janehopper" }, el.token);
  assert.equal(r.data.user.username, "janehopper");
  assert.equal((await ctx.api("/api/login", { user: "elhopper", password: "1234" })).status, 404, "old name freed");
  assert.equal((await ctx.api("/api/login", { user: "janehopper", password: "1234" })).status, 200);
});

test("account color: palette-validated, auth required", async () => {
  const u = await signup(ctx, "dustinh", "d@h.com");
  let r = await ctx.api("/api/account/color", { color: "#facc15" }, u.token);
  assert.equal(r.data.user.color, "#facc15");
  r = await ctx.api("/api/account/color", { color: "javascript:evil" }, u.token);
  assert.match(r.data.user.color, /^#[0-9a-f]{6}$/, "invalid color falls back to palette");
  r = await ctx.api("/api/account/color", { color: "#facc15" });
  assert.equal(r.status, 401);
});
