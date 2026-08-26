// The one place data is persisted. Every document the app keeps — the user
// store, game snapshots, solo-write docs, the fandom content pack and the
// writers' reference — is a named JSON blob under a KIND:
//
//   users/users            data/users.json
//   announcements/announcements  data/announcements.json (the admin's blog posts)
//   save/<CODE>            saves/<CODE>.json
//   doc/<uuid>             data/docs/<uuid>.json
//   content/<name>         content/<name>.json        (prompts, site, quotes …)
//   reference/<name>       writers-reference/<name>.json (index, romance …)
//
// Two backends behind the same sync-read / async-write surface:
//
//   files     — no DATABASE_URL (local dev, tests). Reads and writes the JSON
//               files above; writes are temp-file + rename so a crash can't
//               leave a half-written store.
//   postgres  — DATABASE_URL set (Replit's built-in Postgres). Postgres IS the
//               store: every row is loaded into memory at boot, reads serve
//               from that cache, writes update the cache and queue an ordered
//               upsert. Nothing under data/, saves/ or docs/ is touched — the
//               deploy's filesystem is disposable. On first boot each kind is
//               SEEDED from whatever files exist (a repo checkout's content
//               pack and reference bank; a migrating deploy's restored data),
//               and from then on the database wins — `npm run reseed-content`
//               pushes repo pack edits up deliberately.
//
// Reads stay synchronous so store.js/game.js/docs.js keep their shape; the
// data is small (~100 users) and the live game already lives in memory.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, unlinkSync, renameSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

export const KINDS = ["users", "announcements", "save", "doc", "content", "reference"];
// Kinds that are ONE document rather than a directory of them.
const SINGLE = new Set(["users", "announcements"]);

export function defaultDirs() {
  const dataDir = process.env.COWRITE_DATA_DIR || join(ROOT, "data");
  return {
    dataDir,
    saveDir: process.env.COWRITE_SAVE_DIR || join(ROOT, "saves"),
    docDir: process.env.COWRITE_DOC_DIR || join(dataDir, "docs"),
    contentDir: process.env.COWRITE_CONTENT_DIR || join(ROOT, "content"),
    refDir: process.env.COWRITE_REF_DIR || join(ROOT, "writers-reference"),
  };
}

const dirFor = (dirs, kind) =>
  SINGLE.has(kind) ? dirs.dataDir
    : kind === "doc" ? dirs.docDir
      : kind === "content" ? dirs.contentDir
        : kind === "reference" ? dirs.refDir
          : dirs.saveDir;
const pathFor = (dirs, kind, name) => join(dirFor(dirs, kind), (SINGLE.has(kind) ? kind : name) + ".json");

// Every *.json in a directory as {name, doc} — the file backend's list and
// the postgres backend's seed both walk this.
function readDir(dir) {
  let files = [];
  try { files = readdirSync(dir); } catch { return []; }
  const out = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try { out.push({ name: f.slice(0, -5), doc: readFileSync(join(dir, f), "utf-8") }); } catch { /* skip unreadable */ }
  }
  return out;
}

// ---- files ---------------------------------------------------------------

function fileBackend(dirs) {
  for (const k of ["dataDir", "saveDir", "docDir"]) mkdirSync(dirs[k], { recursive: true });
  return {
    mode: "files",
    get(kind, name) {
      try { return readFileSync(pathFor(dirs, kind, name), "utf-8"); } catch { return null; }
    },
    has: (kind, name) => existsSync(pathFor(dirs, kind, name)),
    list: (kind) => (SINGLE.has(kind) ? (existsSync(pathFor(dirs, kind, kind)) ? [kind] : []) : readDir(dirFor(dirs, kind)).map((r) => r.name)),
    async put(kind, name, doc) {
      const p = pathFor(dirs, kind, name);
      const tmp = p + ".tmp";
      writeFileSync(tmp, doc);
      renameSync(tmp, p);
    },
    async del(kind, name) {
      try { unlinkSync(pathFor(dirs, kind, name)); } catch { /* already gone */ }
    },
    counts: () => Object.fromEntries(KINDS.map((k) => [k, SINGLE.has(k) ? (existsSync(pathFor(dirs, k, k)) ? 1 : 0) : readDir(dirFor(dirs, k)).length])),
    async close() {},
  };
}

// ---- postgres ------------------------------------------------------------

async function postgresBackend(dirs, pool) {
  if (!pool) {
    const { default: pg } = await import("pg");
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  }
  await pool.query(
    `CREATE TABLE IF NOT EXISTS cowrite_blobs (
       kind text NOT NULL, name text NOT NULL, doc text NOT NULL,
       updated_at timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY (kind, name))`
  );
  const cache = new Map(KINDS.map((k) => [k, new Map()]));
  const { rows } = await pool.query("SELECT kind, name, doc FROM cowrite_blobs");
  for (const r of rows) cache.get(r.kind)?.set(r.name, r.doc);

  const chains = new Map(); // per-key promise chain: writes to one row land in order
  let lastError = null;
  const enqueue = (kind, name, job) => {
    const key = kind + "/" + name;
    const next = (chains.get(key) ?? Promise.resolve()).then(job).catch((e) => {
      lastError = `${new Date().toISOString()} ${key}: ${e.message}`;
      console.error("storage: query failed: ", key, e.message);
    });
    chains.set(key, next);
    return next;
  };
  const upsert = (kind, name, doc) =>
    enqueue(kind, name, () =>
      pool.query(
        `INSERT INTO cowrite_blobs (kind, name, doc, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (kind, name) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()`,
        [kind, name, doc]
      ));

  // Seed-once: a key the database doesn't hold yet is taken from disk.
  let seeded = 0;
  const seedDir = (kind, dir) => {
    for (const { name, doc } of readDir(dir)) {
      if (cache.get(kind).has(name)) continue;
      cache.get(kind).set(name, doc);
      upsert(kind, name, doc);
      seeded++;
    }
  };
  for (const kind of SINGLE) {
    if (cache.get(kind).has(kind)) continue;
    try {
      const doc = readFileSync(pathFor(dirs, kind, kind), "utf-8");
      cache.get(kind).set(kind, doc);
      upsert(kind, kind, doc);
      seeded++;
    } catch { /* no local file */ }
  }
  seedDir("save", dirs.saveDir);
  seedDir("doc", dirs.docDir);
  seedDir("content", dirs.contentDir);
  seedDir("reference", dirs.refDir);
  await Promise.all(chains.values());

  return {
    mode: "postgres",
    seeded,
    get: (kind, name) => cache.get(kind)?.get(name) ?? null,
    has: (kind, name) => !!cache.get(kind)?.has(name),
    list: (kind) => [...(cache.get(kind)?.keys() ?? [])],
    put(kind, name, doc) {
      cache.get(kind)?.set(name, doc);
      return upsert(kind, name, doc);
    },
    del(kind, name) {
      cache.get(kind)?.delete(name);
      return enqueue(kind, name, () => pool.query("DELETE FROM cowrite_blobs WHERE kind = $1 AND name = $2", [kind, name]));
    },
    counts: () => Object.fromEntries(KINDS.map((k) => [k, cache.get(k).size])),
    get lastError() { return lastError; },
    flush: () => Promise.all(chains.values()),
    close: () => pool.end(),
  };
}

// ---- the singleton -------------------------------------------------------

let backend = null;
let dirs = null;

// A module that reads before init() (tests import store.js directly) gets the
// file backend from the environment; server.js calls init() first so a
// DATABASE_URL deploy never falls back to files.
const ensure = () => {
  if (!backend) { dirs = defaultDirs(); backend = fileBackend(dirs); }
  return backend;
};

export const storage = {
  async init(opts = {}) {
    dirs = { ...defaultDirs(), ...opts };
    backend = process.env.DATABASE_URL || opts.pool ? await postgresBackend(dirs, opts.pool) : fileBackend(dirs);
    return backend.mode;
  },
  get mode() { return ensure().mode; },
  get dirs() { ensure(); return dirs; },
  get lastError() { return ensure().lastError ?? null; },
  get seeded() { return ensure().seeded ?? 0; },
  get: (kind, name) => ensure().get(kind, name),
  has: (kind, name) => ensure().has(kind, name),
  list: (kind) => ensure().list(kind),
  put: (kind, name, doc) => ensure().put(kind, name, doc),
  del: (kind, name) => ensure().del(kind, name),
  counts: () => ensure().counts(),
  flush: () => ensure().flush?.() ?? Promise.resolve(),
  close: () => ensure().close(),
  // tests only: forget the backend so the next call re-reads the environment
  _reset() { backend = null; dirs = null; },
};

// Parse a stored JSON blob, null when absent or malformed.
export const getJson = (kind, name) => {
  const doc = storage.get(kind, name);
  if (doc == null) return null;
  try { return JSON.parse(doc); } catch { return null; }
};

export const describeStorage = () => {
  const c = storage.counts();
  return `storage: ${storage.mode} (users ${c.users}, announcements ${c.announcements}, saves ${c.save}, docs ${c.doc}, content ${c.content}, reference ${c.reference}${storage.mode === "postgres" ? `, seeded ${storage.seeded}` : ""})`;
};
