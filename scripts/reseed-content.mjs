#!/usr/bin/env node
// Push the repo's content pack and writers' reference INTO the production
// database, overwriting whatever it holds. In production the database is the
// store and the repo files only seed it once (src/storage.js), so an edit to
// content/*.json or writers-reference/*.json made in the repo reaches a
// deployed site only through this script (or the same edit in /admin).
//
//   DATABASE_URL=postgres://… npm run reseed-content                          # everything
//   DATABASE_URL=postgres://… npm run reseed-content -- content               # one kind
//   DATABASE_URL=postgres://… npm run reseed-content -- content achievements  # one file
//   DATABASE_URL=postgres://… npm run reseed-achievements                     # the same, spelled out
//
// It only ever writes content/reference rows: users, saves, docs and inbox
// rows are never read or touched. Rows for files that no longer exist in the
// repo are left alone.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { defaultDirs } from "../src/storage.js";

if (!process.env.DATABASE_URL) {
  console.error("reseed-content: DATABASE_URL is not set — locally the repo files ARE the store; nothing to do.");
  process.exit(1);
}
const only = process.argv[2];
const onlyFile = process.argv[3]; // a single file's name, without .json
const dirs = defaultDirs();
const targets = [["content", dirs.contentDir], ["reference", dirs.refDir]].filter(([k]) => !only || k === only);
if (!targets.length) { console.error(`reseed-content: unknown kind "${only}" (content | reference)`); process.exit(1); }

const { default: pg } = await import("pg");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
let n = 0;
for (const [kind, dir] of targets) {
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const name = f.slice(0, -5);
    if (onlyFile && name !== onlyFile) continue;
    await pool.query(
      `INSERT INTO cowrite_blobs (kind, name, doc, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (kind, name) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()`,
      [kind, name, readFileSync(join(dir, f), "utf-8")]
    );
    console.log(`  ${kind}/${name}`);
    n++;
  }
}
await pool.end();
if (!n) { console.error(`reseed-content: no file named "${onlyFile}.json" in ${targets.map(([k]) => k).join("/")}; nothing written.`); process.exit(1); }
console.log(`reseed-content: ${n} row(s) written. Restart the server to load them.`);
