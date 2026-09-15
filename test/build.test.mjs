// The TypeScript build (scripts/build.mjs): every client/**/*.ts has an
// emitted twin at the same path under public/js, the twin is CURRENT (a fresh
// emit into a temp dir is byte-identical), every generated file in public/js
// still has a source, and the sources type-check. `npm test` runs the build
// first (pretest), so a stale twin here means the build itself drifted.
// The server is checked too (tsconfig.server.json: checkJs over server.js,
// src/, lib/ against client/shared/wire.ts) so the two halves of the socket
// contract can't disagree — a handler, an emit or an ack that wire.ts
// doesn't describe fails here.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { sourceFiles, emittedPath, BANNER, esbuildOptions } from "../scripts/build.mjs";

const root = new URL("..", import.meta.url).pathname;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

test("every TypeScript source has a current emitted twin under public/js", async () => {
  const sources = sourceFiles();
  assert.ok(sources.length >= 2, "the pipeline has sources");
  const tmp = mkdtempSync(join(tmpdir(), "cowrite-build-"));
  try {
    await build({ entryPoints: sources, ...esbuildOptions({ outdir: tmp }), logLevel: "silent" });
    for (const src of sources) {
      const out = emittedPath(src);
      assert.ok(existsSync(out), relative(root, out) + " is emitted");
      const fresh = readFileSync(join(tmp, relative(join(root, "client"), src).replace(/\.ts$/, ".js")), "utf-8");
      assert.equal(readFileSync(out, "utf-8"), fresh, relative(root, out) + " is up to date — run npm run build");
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("no generated file in public/js has lost its source", () => {
  const twins = new Set(sourceFiles().map(emittedPath));
  for (const f of walk(join(root, "public", "js")).filter((f) => f.endsWith(".js"))) {
    const generated = readFileSync(f, "utf-8").startsWith(BANNER);
    assert.equal(generated, twins.has(f), relative(root, f) + (generated ? " is generated but has no client/ source" : " has a client/ source but is not marked generated"));
  }
});

test("the client sources type-check (tsc --noEmit)", () => {
  execFileSync("npx", ["tsc", "--noEmit"], { cwd: root, stdio: "pipe" });
});

test("the server type-checks against the wire contract (tsc -p tsconfig.server.json)", () => {
  execFileSync("npx", ["tsc", "-p", "tsconfig.server.json"], { cwd: root, stdio: "pipe" });
});
