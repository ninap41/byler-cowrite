// Test harness: boots one isolated server per test file (random port, temp
// data/save dirs) and exposes tiny HTTP + Socket.IO helpers.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { io } from "socket.io-client";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function startServer(extraEnv = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "cowrite-data-"));
  const saveDir = mkdtempSync(join(tmpdir(), "cowrite-saves-"));
  // The content pack is copied too: the admin prompt editor writes to it, and
  // a test must never edit the real content/prompts.json.
  const contentDir = mkdtempSync(join(tmpdir(), "cowrite-content-"));
  cpSync(join(ROOT, "content"), contentDir, { recursive: true });
  // and the writers-reference bank, which the admin reference editor rewrites
  const refDir = mkdtempSync(join(tmpdir(), "cowrite-ref-"));
  cpSync(join(ROOT, "writers-reference"), refDir, { recursive: true });
  // Random ports can collide across parallel test files — retry on a fresh
  // port if the child dies before it says "running" (e.g. EADDRINUSE).
  let port, child;
  for (let attempt = 0; ; attempt++) {
    port = 4100 + Math.floor(Math.random() * 20000);
    child = spawn("node", ["server.js"], {
      cwd: ROOT,
      env: {
        ...process.env,
        DATABASE_URL: "", // a developer's shell must never point the suite at real Postgres
        PORT: String(port),
        COWRITE_DATA_DIR: dataDir,
        COWRITE_SAVE_DIR: saveDir,
        COWRITE_CONTENT_DIR: contentDir,
        COWRITE_REF_DIR: refDir,
        // tests accumulate sessions freely; the cap test lowers this itself
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "inherit"],
    });
    try {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("server did not start")), 8000);
        child.stdout.on("data", (d) => {
          if (String(d).includes("running")) {
            clearTimeout(t);
            resolve();
          }
        });
        child.on("exit", (code) => reject(new Error("server exited early: " + code)));
      });
      break;
    } catch (e) {
      child.kill("SIGKILL");
      if (attempt >= 3) throw e;
    }
  }
  const url = `http://localhost:${port}`;
  const sockets = [];
  const ctx = {
    url,
    saveDir,
    dataDir,
    api: async (path, body, token, method = body === undefined ? "GET" : "POST") => {
      const r = await fetch(url + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        body: body === undefined || body === null ? undefined : JSON.stringify(body),
      });
      return { status: r.status, data: await r.json().catch(() => ({})) };
    },
    conn: async () => {
      const s = io(url, { transports: ["websocket"], forceNew: true });
      sockets.push(s);
      await new Promise((r) => s.on("connect", r));
      return s;
    },
    emit: (s, ev, data) => new Promise((r) => s.emit(ev, data, r)),
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    stop: async () => {
      sockets.forEach((s) => s.disconnect());
      child.kill("SIGKILL");
      await new Promise((r) => child.on("exit", r)).catch?.(() => {});
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(saveDir, { recursive: true, force: true });
    },
  };
  return ctx;
}

// Common fixture: signed-up user.
export async function signup(ctx, username = "willthewise", email = "will@byers.com", color = "#6c8cff") {
  const r = await ctx.api("/api/signup", { email, username, password: "1234", color });
  if (r.status === 200) return r.data; // { token, user }
  const login = await ctx.api("/api/login", { user: username, password: "1234" });
  if (login.status !== 200) throw new Error("signup fixture failed: " + JSON.stringify(r.data));
  return login.data;
}

// Common fixture: two accounts (host + one writer) in a started, writing-phase game.
export async function startedGame(ctx, { turnSeconds = 60, rounds = 2, friendly } = {}) {
  const host = await signup(ctx);
  const mike = await signup(ctx, "mikewheeler", "mike@wheeler.com", "#e63946");
  const A = await ctx.conn();
  const B = await ctx.conn();
  const state = { current: null };
  A.on("game-state", (st) => (state.current = st));
  const c = await ctx.emit(A, "create-session", { auth: host.token });
  const j = await ctx.emit(B, "join-session", { code: c.code, auth: mike.token });
  await ctx.emit(A, "start-game", { turnSeconds, rounds, friendly });
  await ctx.wait(150);
  A.emit("vote", { prompt: state.current.options[0] });
  B.emit("vote", { prompt: state.current.options[0] });
  await ctx.wait(200);
  return { host, mike, A, B, code: c.code, hostSeatToken: c.token, mikeSeatToken: j.token, state };
}
