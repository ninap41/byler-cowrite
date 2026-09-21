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
  dataDir: join(root, "data"), saveDir: join(root, "saves"), docDir: join(root, "data", "docs"), commentDir: join(root, "data", "comments"),
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
    assert.match(describeStorage(), /^storage: files \(users 1, announcements 0, saves 0, docs 1/);
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

test("postgres: rows are the store, loaded at boot, read from memory, written in order, never on disk", async () => {
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
    // a write always sends the row as it is NOW: two saves before the first query
    // runs are one upsert of the newest, never an older value after a newer one
    assert.deepEqual(upserts, ['{"code":"ABCD","v":2}']);
    // nothing was written to disk
    assert.ok(!existsSync(join(root, "saves")) || readdirSync(join(root, "saves")).length === 0, "saves/ untouched");
    assert.ok(!existsSync(join(root, "data", "users.json")), "users.json untouched");
    assert.equal(storage.lastError, null);
    assert.match(describeStorage(), /^storage: postgres \(users 1, announcements 0, saves 1, docs 0, comment records 0, content 1, reference 0, seeded 0\)/);
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
  writeFileSync(join(dirs.dataDir, "announcements.json"), '{"posts":[{"id":"p1","title":"Hi"}]}');
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
    assert.equal(storage.seeded, 7, "users, announcements, save, doc, site, index, romance, not the README, not prompts");
    await storage.flush();
    assert.deepEqual(getJson("users", "users"), { users: [{ id: "disk" }] });
    assert.deepEqual(storage.list("save"), ["OLDG"]);
    assert.deepEqual(getJson("announcements", "announcements"), { posts: [{ id: "p1", title: "Hi" }] }, "the admin's blog rides the same store");
    assert.deepEqual(storage.list("doc"), ["doc1"]);
    assert.deepEqual(getJson("content", "prompts"), { prompts: ["edited in /admin"] }, "the database's copy wins over the repo file");
    assert.deepEqual(getJson("content", "site"), { name: "Repo" });
    assert.deepEqual(storage.list("reference").sort(), ["index", "romance"]);
    assert.equal(pool.rows.size, 8, "every seeded key is now a row");
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

test("postgres: a failed query is remembered and reported to an awaiting caller without stopping later writes", async () => {
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
    await assert.rejects(storage.put("save", "BOOM", "{}"), /connection reset/);
    await storage.put("save", "FINE", "{}");
    assert.match(storage.lastError, /save\/BOOM: connection reset/);
    assert.equal(storage.get("save", "BOOM"), "{}", "the cache still holds it, the app keeps working");
    assert.ok(pool.rows.has("save/FINE"), "other writes are unaffected");
  } finally {
    storage._reset();
    rmSync(root, { recursive: true, force: true });
  }
});

test("postgres: a write the database refused is retried until it lands — with the newest words, not the ones that failed", async () => {
  delete process.env.DATABASE_URL;
  process.env.COWRITE_STORAGE_RETRY_MS = "5,5,5";
  const root = tmp();
  const pool = fakePool();
  const realQuery = pool.query.bind(pool);
  let failures = 2;
  pool.query = async (text, params) => {
    if (text.startsWith("INSERT") && params[1] === "STORY" && failures-- > 0) throw new Error("connection terminated");
    return realQuery(text, params);
  };
  try {
    await storage.init({ ...dirsIn(root), pool });
    await assert.rejects(storage.put("doc", "STORY", '{"v":1}'), /connection terminated/, "the caller that awaits is told");
    assert.deepEqual(storage.unlanded, ["doc/STORY"], "and the row is known to be owed");
    storage.put("doc", "STORY", '{"v":2}').catch(() => {}); // the writer kept typing; this one fails too
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(pool.rows.get("doc/STORY")?.doc, '{"v":2}', "the retry carried the newest copy");
    assert.deepEqual(storage.unlanded, [], "nothing owed once it lands");
  } finally {
    delete process.env.COWRITE_STORAGE_RETRY_MS;
    storage._reset();
    rmSync(root, { recursive: true, force: true });
  }
});

test("postgres: flush() makes one more attempt at every owed row at once — what a stopping server calls", async () => {
  delete process.env.DATABASE_URL;
  process.env.COWRITE_STORAGE_RETRY_MS = "60000"; // the timer alone would never fire in this test
  const root = tmp();
  const pool = fakePool();
  const realQuery = pool.query.bind(pool);
  let down = true;
  pool.query = async (text, params) => {
    if (down && text.startsWith("INSERT")) throw new Error("db asleep");
    return realQuery(text, params);
  };
  try {
    await storage.init({ ...dirsIn(root), pool });
    await assert.rejects(storage.put("doc", "STORY", '{"v":1}'));
    down = false;
    await storage.flush();
    assert.equal(pool.rows.get("doc/STORY")?.doc, '{"v":1}');
    assert.deepEqual(storage.unlanded, []);
  } finally {
    delete process.env.COWRITE_STORAGE_RETRY_MS;
    storage._reset();
    rmSync(root, { recursive: true, force: true });
  }
});

test("postgres: a pool error (a dropped idle connection) is logged, never thrown", async () => {
  delete process.env.DATABASE_URL;
  const root = tmp();
  const pool = fakePool();
  const listeners = {};
  pool.on = (ev, fn) => { listeners[ev] = fn; };
  try {
    await storage.init({ ...dirsIn(root), pool });
    assert.equal(typeof listeners.error, "function", "without a listener the emit is an uncaught exception: the process dies with its queue");
    assert.doesNotThrow(() => listeners.error(new Error("Connection terminated unexpectedly")));
    assert.match(storage.lastError, /pool: Connection terminated unexpectedly/);
  } finally {
    storage._reset();
    rmSync(root, { recursive: true, force: true });
  }
});

// ---- comments move out of the story blobs (migrateDocComments) ----
// Production is the postgres backend, so the carry-over is proven against it:
// rows that look like today's production go in, and what comes out is one
// comment record per document with every thread intact.
const DOC_ID = "11111111-2222-3333-4444-555555555555";
const OTHER_ID = "99999999-2222-3333-4444-555555555555";
const oldComments = [
  { id: "c1", cid: "aaaaaaaaaaaa", quote: "striped shirt", userId: "u2", text: "lovely", suggestion: null, ts: 10, resolved: false, accepted: false,
    replies: [{ id: "r1", userId: "u1", text: "thank you", ts: 11 }] },
  { id: "c2", cid: "bbbbbbbbbbbb", quote: "hangs", userId: "u2", text: "", suggestion: "drapes", ts: 20, resolved: true, accepted: true, declined: false, editedAt: 21 },
];
const oldDoc = (id, comments) => ({
  id, ownerId: "u1", title: "Before the split",
  chapters: [{ id: "abcdefabcdef", title: "Chapter 1", html: '<p>his <span class="cmt" data-cid="aaaaaaaaaaaa">striped shirt</span> hangs</p>' }],
  betaReaders: ["u2"], visibility: "readers", comments, wordCount: 4, createdAt: 1, updatedAt: 1234,
});

test("postgres: comments embedded in story rows become comment rows at boot — every thread, nothing else touched, and only once", async () => {
  delete process.env.DATABASE_URL;
  const root = tmp();
  const pool = fakePool([
    { kind: "doc", name: DOC_ID, doc: JSON.stringify(oldDoc(DOC_ID, oldComments)) },
    { kind: "doc", name: OTHER_ID, doc: JSON.stringify(oldDoc(OTHER_ID, [])) },
  ]);
  try {
    await storage.init({ ...dirsIn(root), pool });
    const { migrateDocComments, readDoc } = await import("../src/docs.js");
    assert.deepEqual(migrateDocComments(), { docs: 1, comments: 2 });
    await storage.flush();

    const record = JSON.parse(pool.rows.get("comment/" + DOC_ID).doc);
    assert.equal(record.docId, DOC_ID);
    assert.deepEqual(record.comments, oldComments, "ids, replies, suggestions, resolved flags — all of it");
    const story = JSON.parse(pool.rows.get("doc/" + DOC_ID).doc);
    assert.ok(!("comments" in story), "the story row no longer carries them");
    assert.equal(story.updatedAt, 1234, "a migration is not an edit");
    assert.deepEqual(story.chapters, oldDoc(DOC_ID, []).chapters, "the prose and its underline are byte for byte the same");
    assert.ok(!pool.rows.has("comment/" + OTHER_ID), "a story with no comments gets no record");
    assert.ok(!("comments" in JSON.parse(pool.rows.get("doc/" + OTHER_ID).doc)));

    // what the app reads is what it read before
    const doc = readDoc(DOC_ID);
    assert.deepEqual(doc.comments, oldComments);
    assert.ok(doc.html.includes('data-cid="aaaaaaaaaaaa"'));

    // the next boot finds nothing to do
    const writes = pool.log.length;
    assert.deepEqual(migrateDocComments(), { docs: 0, comments: 0 });
    await storage.flush();
    assert.equal(pool.log.length, writes, "not one more query");
  } finally {
    storage._reset();
    rmSync(root, { recursive: true, force: true });
  }
});

test("postgres: a story row that still carries comments is unioned into an existing record, never over it", async () => {
  delete process.env.DATABASE_URL;
  const root = tmp();
  const newer = { id: "c3", cid: "cccccccccccc", quote: "his", userId: "u2", text: "made after the split", suggestion: null, ts: 30, resolved: false, accepted: false };
  const pool = fakePool([
    // a crash between the two writes, or an old blob restored over a migrated one
    { kind: "doc", name: DOC_ID, doc: JSON.stringify(oldDoc(DOC_ID, oldComments)) },
    { kind: "comment", name: DOC_ID, doc: JSON.stringify({ docId: DOC_ID, comments: [oldComments[0], newer] }) },
  ]);
  try {
    await storage.init({ ...dirsIn(root), pool });
    const { migrateDocComments } = await import("../src/docs.js");
    assert.deepEqual(migrateDocComments(), { docs: 1, comments: 1 }, "only the one the record lacked");
    await storage.flush();
    const ids = JSON.parse(pool.rows.get("comment/" + DOC_ID).doc).comments.map((c) => c.id);
    assert.deepEqual(ids, ["c1", "c2", "c3"], "all three, oldest first, none twice");
  } finally {
    storage._reset();
    rmSync(root, { recursive: true, force: true });
  }
});

test("files: the same carry-over on disk, and a blob met by a plain read migrates itself", async () => {
  delete process.env.DATABASE_URL;
  const root = tmp();
  const dirs = dirsIn(root);
  try {
    await storage.init(dirs);
    writeFileSync(join(dirs.docDir, DOC_ID + ".json"), JSON.stringify(oldDoc(DOC_ID, oldComments)));
    const { readDoc } = await import("../src/docs.js");
    assert.deepEqual(readDoc(DOC_ID).comments, oldComments, "no boot sweep ran: the read did it");
    assert.deepEqual(JSON.parse(readFileSync(join(dirs.commentDir, DOC_ID + ".json"), "utf-8")).comments, oldComments);
    const story = JSON.parse(readFileSync(join(dirs.docDir, DOC_ID + ".json"), "utf-8"));
    assert.ok(!("comments" in story));
    assert.equal(story.updatedAt, 1234);
  } finally {
    storage._reset();
    rmSync(root, { recursive: true, force: true });
  }
});

test("postgres: a story from before chapters AND before the comment split keeps every word through the boot migration", async () => {
  delete process.env.DATABASE_URL;
  const root = tmp();
  const prose = "<p>the whole story, written before chapters existed</p>";
  const legacy = { id: DOC_ID, ownerId: "u1", title: "Untouched since August", html: prose, betaReaders: [], visibility: "private", comments: [], wordCount: 8, createdAt: 1, updatedAt: 2 };
  const pool = fakePool([{ kind: "doc", name: DOC_ID, doc: JSON.stringify(legacy) }]);
  try {
    await storage.init({ ...dirsIn(root), pool });
    const { migrateDocComments, readDoc } = await import("../src/docs.js");
    migrateDocComments();
    await storage.flush();
    const stored = JSON.parse(pool.rows.get("doc/" + DOC_ID).doc);
    assert.equal(stored.chapters?.length, 1, "it became one chapter");
    assert.equal(stored.chapters[0].html, prose, "holding every word");
    assert.ok(!("html" in stored) && !("comments" in stored));
    assert.equal(readDoc(DOC_ID).html, prose);
  } finally {
    storage._reset();
    rmSync(root, { recursive: true, force: true });
  }
});
