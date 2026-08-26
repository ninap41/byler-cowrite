// src/storage.js — the one persistence layer. Files without DATABASE_URL;
// Postgres (exercised here against a fake pool) with it. Local dev and the
// whole suite rely on the file backend being exactly the old file layout, and
// production relies on the postgres backend never touching the disk.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { storage, getJson, describeStorage, KINDS } = await import("../src/storage.js");

const tmp = () => mkdtempSync(join(tmpdir(), "cowrite-storage-"));
const dirsIn = (root) => ({
  dataDir: join(root, "data"), saveDir: join(root, "saves"), docDir: join(root, "data", "docs"),
  contentDir: join(root, "content"), refDir: join(root, "ref"),
});

// A pg.Pool stand-in that keeps rows in a Map and records every query.
function fakePool(seedRows = []) {
  const rows = new Map(seedRows.map((r) => [r.kind + "/" + r.name, r]));
  const log = [];
  return {
    rows, log,
    async query(text, params = []) {
      log.push({ text: text.replace(/\s+/g, " ").trim(), params });
      if (text.startsWith("CREATE TABLE")) return { rows: [] };
      if (text.startsWith("SELECT")) return { rows: [...rows.values()] };
      if (text.startsWith("INSERT")) { rows.set(params[0] + "/" + params[1], { kind: params[0], name: params[1], doc: params[2] }); return { rows: [] }; }
      if (text.startsWith("DELETE")) { rows.delete(params[0] + "/" + params[1]); return { rows: [] }; }
      throw new Error("unexpected query " + text);
    },
    async end() {},
  };
}

test("files: no DATABASE_URL means the JSON files are the store", async () => {
  delete process.env.DATABASE_URL;
  const root = tmp();
  try {
    assert.equal(await storage.init(dirsIn(root)), "files");
    assert.equal(storage.mode, "files");
    assert.equal(storage.get("users", "users"), null);
    assert.deepEqual(storage.list("save"), []);
    await storage.put("users", "users", '{"users":[]}');
    await storage.put("save", "ABCD", '{"code":"ABCD"}');
    await storage.put("doc", "d1", '{"id":"d1"}');
    assert.equal(readFileSync(join(root, "data", "users.json"), "utf-8"), '{"users":[]}', "users.json is where it always was");
    assert.equal(readFileSync(join(root, "saves", "ABCD.json"), "utf-8"), '{"code":"ABCD"}');
    assert.ok(existsSync(join(root, "data", "docs", "d1.json")));
    assert.ok(!readdirSync(join(root, "saves")).some((f) => f.endsWith(".tmp")), "the temp file is renamed away");
    assert.deepEqual(getJson("save", "ABCD"), { code: "ABCD" });
    assert.ok(storage.has("save", "ABCD"));
    assert.deepEqual(storage.list("save"), ["ABCD"]);
    await storage.del("save", "ABCD");
    assert.ok(!storage.has("save", "ABCD"));
    assert.equal(storage.get("save", "ABCD"), null);
    assert.equal(storage.lastError, null);
    assert.match(describeStorage(), /^storage: files \(users 1, saves 0, docs 1/);
  } finally {
    storage._reset();
    rmSync(root, { recursive: true, force: true });
  }
});

test("files: a module that reads before init gets the environment's directories", () => {
  const root = tmp();
  const saved = process.env.COWRITE_DATA_DIR;
  process.env.COWRITE_DATA_DIR = root;
  try {
    storage._reset();
    assert.equal(storage.mode, "files");
    assert.equal(storage.dirs.dataDir, root);
    assert.equal(storage.dirs.docDir, join(root, "docs"));
  } finally {
    if (saved === undefined) delete process.env.COWRITE_DATA_DIR; else process.env.COWRITE_DATA_DIR = saved;
    storage._reset();
    rmSync(root, { recursive: true, force: true });
  }
});

test("postgres: rows are the store — loaded at boot, read from memory, written in order, never on disk", async () => {
  delete process.env.DATABASE_URL;
  const root = tmp();
  const dirs = dirsIn(root);
  const pool = fakePool([
    { kind: "users", name: "users", doc: '{"users":[{"id":"u1"}]}' },
    { kind: "save", name: "WXYZ", doc: '{"code":"WXYZ"}' },
    { kind: "content", name: "prompts", doc: '{"prompts":["from the database"]}' },
  ]);
  try {
    assert.equal(await storage.init({ ...dirs, pool }), "postgres");
    assert.equal(storage.mode, "postgres");
    assert.deepEqual(getJson("users", "users"), { users: [{ id: "u1" }] });
    assert.deepEqual(storage.list("save"), ["WXYZ"]);
    assert.deepEqual(getJson("content", "prompts"), { prompts: ["from the database"] });
    // writes: cache first (sync), then the upsert
    storage.put("save", "ABCD", '{"code":"ABCD","v":1}');
    storage.put("save", "ABCD", '{"code":"ABCD","v":2}');
    storage.del("save", "WXYZ");
    assert.deepEqual(storage.list("save").sort(), ["ABCD"], "the cache answers before the queries land");
    await storage.flush();
    assert.equal(pool.rows.get("save/ABCD").doc, '{"code":"ABCD","v":2}', "last write wins, in order");
    assert.ok(!pool.rows.has("save/WXYZ"));
    const upserts = pool.log.filter((q) => q.text.startsWith("INSERT") && q.params[1] === "ABCD").map((q) => q.params[2]);
    assert.deepEqual(upserts, ['{"code":"ABCD","v":1}', '{"code":"ABCD","v":2}']);
    // nothing was written to disk
    assert.ok(!existsSync(join(root, "saves")) || readdirSync(join(root, "saves")).length === 0, "saves/ untouched");
    assert.ok(!existsSync(join(root, "data", "users.json")), "users.json untouched");
    assert.equal(storage.lastError, null);
    assert.match(describeStorage(), /^storage: postgres \(users 1, saves 1, docs 0, content 1, reference 0, seeded 0\)/);
    assert.deepEqual(Object.keys(storage.counts()), KINDS);
  } finally {
    storage._reset();
    rmSync(root, { recursive: true, force: true });
  }
});

test("postgres: first boot seeds every kind from disk once; afterwards the database wins", async () => {
  delete process.env.DATABASE_URL;
  const root = tmp();
  const dirs = dirsIn(root);
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  writeFileSync(join(dirs.dataDir, "users.json"), '{"users":[{"id":"disk"}]}');
  writeFileSync(join(dirs.saveDir, "OLDG.json"), '{"code":"OLDG"}');
  writeFileSync(join(dirs.docDir, "doc1.json"), '{"id":"doc1"}');
  writeFileSync(join(dirs.contentDir, "prompts.json"), '{"prompts":["repo"]}');
  writeFileSync(join(dirs.contentDir, "site.json"), '{"name":"Repo"}');
  writeFileSync(join(dirs.contentDir, "README.md"), "not a blob");
  writeFileSync(join(dirs.refDir, "index.json"), '{"romance":{"path":"./romance.json"}}');
  writeFileSync(join(dirs.refDir, "romance.json"), '{"kisses":["kiss"]}');
  // the database already knows one of them — that row must win
  const pool = fakePool([{ kind: "content", name: "prompts", doc: '{"prompts":["edited in /admin"]}' }]);
  try {
    await storage.init({ ...dirs, pool });
    assert.equal(storage.seeded, 6, "users, save, doc, site, index, romance — not the README, not prompts");
    await storage.flush();
    assert.deepEqual(getJson("users", "users"), { users: [{ id: "disk" }] });
    assert.deepEqual(storage.list("save"), ["OLDG"]);
    assert.deepEqual(storage.list("doc"), ["doc1"]);
    assert.deepEqual(getJson("content", "prompts"), { prompts: ["edited in /admin"] }, "the database's copy wins over the repo file");
    assert.deepEqual(getJson("content", "site"), { name: "Repo" });
    assert.deepEqual(storage.list("reference").sort(), ["index", "romance"]);
    assert.equal(pool.rows.size, 7, "every seeded key is now a row");
    assert.ok(!pool.rows.has("content/README"));

    // second boot against the same rows: nothing is re-seeded, the repo file is ignored
    storage._reset();
    writeFileSync(join(dirs.contentDir, "site.json"), '{"name":"Repo edited later"}');
    await storage.init({ ...dirs, pool });
    assert.equal(storage.seeded, 0);
    assert.deepEqual(getJson("content", "site"), { name: "Repo" }, "a later repo edit does not reach a seeded database");
  } finally {
    storage._reset();
    rmSync(root, { recursive: true, force: true });
  }
});

test("postgres: a failed query is remembered on lastError instead of crashing the app", async () => {
  delete process.env.DATABASE_URL;
  const root = tmp();
  const pool = fakePool();
  const realQuery = pool.query.bind(pool);
  pool.query = async (text, params) => {
    if (text.startsWith("INSERT") && params[1] === "BOOM") throw new Error("connection reset");
    return realQuery(text, params);
  };
  try {
    await storage.init({ ...dirsIn(root), pool });
    await storage.put("save", "BOOM", "{}");
    await storage.put("save", "FINE", "{}");
    assert.match(storage.lastError, /save\/BOOM: connection reset/);
    assert.equal(storage.get("save", "BOOM"), "{}", "the cache still holds it — the app keeps working");
    assert.ok(pool.rows.has("save/FINE"), "other writes are unaffected");
  } finally {
    storage._reset();
    rmSync(root, { recursive: true, force: true });
  }
});
