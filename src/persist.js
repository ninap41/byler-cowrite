// Durable persistence for Replit deployments. Deploys replace the filesystem
// with a snapshot of the repo, wiping data/users.json and saves/*.json — so
// when DATABASE_URL is set (Replit's built-in Postgres provides it), this
// module mirrors every file write into a two-column blob table and restores
// the files from it at boot. The JSON files remain the working store: all the
// synchronous read paths in store.js/game.js/routes.js are untouched, and
// without DATABASE_URL (local dev, tests) everything here is a no-op.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "fs";
import { join } from "path";

let pool = null;
const chains = new Map(); // per-blob write queue so upserts can't land out of order

const q = (text, params) =>
  pool.query(text, params).catch((e) => console.error("persist query failed:", e.message));

// Connect, restore every stored blob to disk, and seed the table from any
// local files it doesn't know yet (first boot after enabling the database).
// Must run BEFORE store.js/game.js are imported — they read files at import.
export async function initPersistence({ dataDir, saveDir, docDir, contentDir }) {
  if (!process.env.DATABASE_URL) return false;
  const { default: pg } = await import("pg");
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  await pool.query(
    `CREATE TABLE IF NOT EXISTS cowrite_blobs (
       kind text NOT NULL, name text NOT NULL, doc text NOT NULL,
       updated_at timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY (kind, name))`
  );
  docDir = docDir || join(dataDir, "docs");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(saveDir, { recursive: true });
  mkdirSync(docDir, { recursive: true });
  // "content" blobs are the admin's edits to the fandom pack (the prompt
  // library). They are restored when they exist but never SEEDED from the
  // repo file: an unedited pack keeps following the repo on each deploy, and
  // only an actual admin edit shadows it.
  const pathFor = (kind, name) =>
    kind === "users" ? join(dataDir, "users.json")
      : kind === "doc" ? join(docDir, name + ".json")
        : kind === "content" ? join(contentDir, name + ".json")
          : join(saveDir, name + ".json");

  const { rows } = await pool.query("SELECT kind, name, doc FROM cowrite_blobs");
  const known = new Set();
  for (const r of rows) {
    known.add(r.kind + "/" + r.name);
    if (r.kind === "content" && !contentDir) continue;
    try {
      writeFileSync(pathFor(r.kind, r.name), r.doc);
    } catch (e) {
      console.error("persist restore failed:", r.kind, r.name, e.message);
    }
  }
  const seed = (kind, name, path) => {
    if (known.has(kind + "/" + name)) return;
    try {
      mirror(kind, name, readFileSync(path, "utf-8"));
    } catch { /* file doesn't exist locally either */ }
  };
  seed("users", "users", join(dataDir, "users.json"));
  for (const f of readdirSync(saveDir))
    if (f.endsWith(".json")) seed("save", f.slice(0, -5), join(saveDir, f));
  for (const f of readdirSync(docDir))
    if (f.endsWith(".json")) seed("doc", f.slice(0, -5), join(docDir, f));
  console.log(`persistence: Postgres mirror active (${rows.length} blobs restored)`);
  return true;
}

// Fire-and-forget write-through; callers stay synchronous.
const enqueue = (key, job) =>
  chains.set(key, (chains.get(key) ?? Promise.resolve()).then(job));

export function mirror(kind, name, doc) {
  if (!pool) return;
  enqueue(kind + "/" + name, () =>
    q(
      `INSERT INTO cowrite_blobs (kind, name, doc, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (kind, name) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()`,
      [kind, name, doc]
    )
  );
}

export function mirrorDelete(kind, name) {
  if (!pool) return;
  enqueue(kind + "/" + name, () =>
    q("DELETE FROM cowrite_blobs WHERE kind = $1 AND name = $2", [kind, name])
  );
}
