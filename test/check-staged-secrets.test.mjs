// Unit-level arms for scripts/check-staged-secrets.mjs, run as a real child process.
// The script's own --selftest covers the git-reading paths end to end; these pin
// single-line verdicts through --message-file, which uses the same firstPatternHit
// as the staged and history paths. Fixture values are split at the provider prefix
// so this file's own text matches no pattern.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/check-staged-secrets.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "css-unit-"));
let seq = 0;

/** Scan one commit message; returns the exit status and stderr. */
function scanMessage(text, timeout = 30_000) {
  const f = join(dir, `msg-${seq++}.txt`);
  writeFileSync(f, text);
  const r = spawnSync(process.execPath, [SCRIPT, "--message-file", f], { encoding: "utf8", timeout });
  return { status: r.status, signal: r.signal, err: r.stderr ?? "" };
}

test("a Google-shaped key whose last character is `-` fires (AOP-R1)", () => {
  const key = "AI" + "za" + "a".repeat(34) + "-";
  for (const line of [`GOOGLE=${key}`, `GOOGLE="${key}"`, `GOOGLE=${key} trailing`]) {
    const r = scanMessage(`${line}\n`);
    assert.equal(r.status, 1, line.slice(0, 12));
    assert.match(r.err, /\[google-api-key\]/);
  }
  // A key ending in a word character still fires, as before.
  assert.equal(scanMessage(`GOOGLE=${"AI" + "za" + "b".repeat(35)}\n`).status, 1);
});
