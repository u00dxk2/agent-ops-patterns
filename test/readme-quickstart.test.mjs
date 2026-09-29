import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// The README says the Quickstart block "runs as written". It imports ./lib/*.mjs
// by relative path and reads ./memory relative to the working directory, so
// "as written" means: saved at a clone's root and run from there. These tests
// pin the prose that says so and run the block from a clone-shaped root, both
// with no memory directory (a fresh clone has none) and with one.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8").replace(/\r\n/g, "\n");

function quickstart() {
  const start = readme.indexOf("\n## Quickstart\n");
  assert.ok(start >= 0, "README has a Quickstart section");
  const section = readme.slice(start);
  const open = section.indexOf("```js\n");
  assert.ok(open >= 0, "Quickstart has a ```js block");
  const close = section.indexOf("\n```", open + 6);
  return { prose: section.slice(0, open), code: section.slice(open + 6, close + 1) };
}

// A clone-shaped directory: lib/ copied beside the saved block, nothing else.
// The two libs the block imports have no imports of their own.
function runFromCloneRoot({ withMemory }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aop-quickstart-"));
  try {
    fs.cpSync(path.join(root, "lib"), path.join(dir, "lib"), { recursive: true });
    fs.writeFileSync(path.join(dir, "quickstart.mjs"), quickstart().code);
    if (withMemory) {
      fs.mkdirSync(path.join(dir, "memory"));
      fs.writeFileSync(path.join(dir, "memory", "MEMORY.md"), "- [A fact](a.md) — one line\n");
      fs.writeFileSync(path.join(dir, "memory", "a.md"), "---\nname: a\n---\nA fact.\n");
    }
    return spawnSync(process.execPath, ["quickstart.mjs"], { cwd: dir, encoding: "utf8" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("README Quickstart", () => {
  it("says, before the block, to clone and cd (it imports ./lib by relative path)", () => {
    const { prose, code } = quickstart();
    assert.match(code, /from "\.\/lib\//, "the block imports ./lib (if not, this test is stale)");
    assert.match(prose, /git clone https:\/\/github\.com\/u00dxk2\/agent-ops-patterns/);
    assert.match(prose, /cd agent-ops-patterns/);
  });

  it("a fresh clone with no memory/ prints NOTHING SWEPT and exits 4 — never a stack trace", () => {
    const r = runFromCloneRoot({ withMemory: false });
    assert.equal(r.status, 4, `exit ${r.status}; stderr: ${r.stderr}`);
    assert.match(r.stderr, /NOTHING SWEPT/);
    assert.doesNotMatch(r.stderr, /\n\s+at /, "no stack trace");
  });

  it("with a memory directory it sweeps and exits 0 (clean) or 3 (findings)", () => {
    const r = runFromCloneRoot({ withMemory: true });
    assert.ok(r.status === 0 || r.status === 3, `exit ${r.status}; stderr: ${r.stderr}`);
    assert.match(r.stdout, /^swept [1-9]\d* files/m);
  });
});
