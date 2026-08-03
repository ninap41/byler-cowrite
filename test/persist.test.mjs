// Without DATABASE_URL the persistence mirror must be a perfect no-op —
// local dev and this whole test suite rely on that.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("persist: everything no-ops without DATABASE_URL", async () => {
  delete process.env.DATABASE_URL;
  const { initPersistence, mirror, mirrorDelete } = await import("../src/persist.js");
  const dir = mkdtempSync(join(tmpdir(), "cowrite-persist-"));
  try {
    assert.equal(await initPersistence({ dataDir: dir, saveDir: join(dir, "saves") }), false);
    // fire-and-forget writes must not throw or touch anything
    mirror("users", "users", "{}");
    mirror("save", "ABCD", "{}");
    mirrorDelete("save", "ABCD");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
