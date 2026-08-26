// The admin backup's zip writer: a real archive that a standard unzip reads
// back byte-for-byte, with the names and the layout the route promises.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { buildZip } from "../src/zip.js";

test("buildZip produces an archive unzip can extract, contents intact", () => {
  const big = JSON.stringify({ words: Array.from({ length: 500 }, (_, i) => `word${i}`) });
  const zip = buildZip([
    { name: "content/site.json", data: '{"name":"Byler Cowrite ✍"}' },
    { name: "writers-reference/index.json", data: big },
  ], new Date(2026, 0, 2, 3, 4, 6));
  assert.equal(zip.readUInt32LE(0), 0x04034b50, "starts with a local file header");
  const dir = mkdtempSync(join(tmpdir(), "cowrite-zip-"));
  try {
    writeFileSync(join(dir, "a.zip"), zip);
    execFileSync("unzip", ["-q", "a.zip", "-d", "out"], { cwd: dir });
    assert.equal(readFileSync(join(dir, "out/content/site.json"), "utf-8"), '{"name":"Byler Cowrite ✍"}');
    assert.equal(readFileSync(join(dir, "out/writers-reference/index.json"), "utf-8"), big);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
