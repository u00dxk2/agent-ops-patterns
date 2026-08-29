import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  formatResultLine,
  verdictForExitCode,
  unknownLabelsInMap,
} from "../lib/result-line.mjs";

const LIB = path
  .join(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "result-line.mjs")
  .replaceAll("\\", "/");

/** Run an inline module in a child node and capture stdout/stderr/exit.
 * spawnSync, not execFileSync — the latter discards stderr on a zero exit,
 * and half of what these tests assert lives on stderr. */
function runChild(code, env = {}) {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

test("formatResultLine: verdict, collapsed detail, exit code", () => {
  assert.equal(formatResultLine({ verdict: "PASS", exitCode: 0 }), "RESULT: PASS (exit 0)");
  assert.equal(
    formatResultLine({ verdict: "FAIL", detail: "  3   findings\n", exitCode: 3 }),
    "RESULT: FAIL — 3 findings (exit 3)",
  );
  // An out-of-vocabulary verdict renders UNKNOWN — a wrong verdict is worse
  // than an illegible one.
  assert.equal(formatResultLine({ verdict: "GREAT", exitCode: 0 }), "RESULT: UNKNOWN (exit 0)");
  assert.equal(formatResultLine({}), "RESULT: UNKNOWN");
});

test("verdictForExitCode: mapped hits, unmapped and junk maps render UNKNOWN", () => {
  const map = { 0: "PASS", 3: "FAIL" };
  assert.equal(verdictForExitCode(0, map), "PASS");
  assert.equal(verdictForExitCode(3, map), "FAIL");
  assert.equal(verdictForExitCode(7, map), "UNKNOWN");
  assert.equal(verdictForExitCode(0, null), "UNKNOWN");
  assert.equal(verdictForExitCode(0, { 0: "GREAT" }), "UNKNOWN");
});

test("unknownLabelsInMap names every out-of-vocabulary label, deduped", () => {
  assert.deepEqual(unknownLabelsInMap({ 0: "PASS", 2: "GREAT", 3: "GREAT", 4: 7 }), ["GREAT", "7"]);
  assert.deepEqual(unknownLabelsInMap({ 0: "PASS", 3: "FAIL" }), []);
  assert.deepEqual(unknownLabelsInMap(null), []);
});

// The lib's whole point rides process.on("exit"), which cannot be observed
// from inside this process without exiting it — so these run a child node.
test("the line fires on process.exit() and carries the mapped verdict", () => {
  const r = runChild(
    `import { armResultLine, setResultDetail } from "file:///${LIB}";` +
      `armResultLine({ 0: "PASS", 3: "FAIL" });` +
      `setResultDetail("2 findings");` +
      `console.log("work output");` +
      `process.exit(3);`,
  );
  assert.equal(r.status, 3, "arming must not change the exit code");
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.at(-1), "RESULT: FAIL — 2 findings (exit 3)", "last stdout line carries the verdict");
});

test("fd:2 keeps stdout parseable and puts the verdict on stderr", () => {
  const r = runChild(
    `import { armResultLine } from "file:///${LIB}";` +
      `armResultLine({ 0: "PASS" }, { fd: 2 });` +
      `console.log(JSON.stringify({ ok: true }));`,
  );
  assert.equal(r.status, 0);
  assert.doesNotThrow(() => JSON.parse(r.stdout), "stdout must stay a valid JSON document");
  assert.match(r.stderr, /^RESULT: PASS \(exit 0\)/m);
});

test("an unmapped exit renders UNKNOWN with the raw code; arming twice prints once", () => {
  const r = runChild(
    `import { armResultLine } from "file:///${LIB}";` +
      `armResultLine({ 0: "PASS" });` +
      `armResultLine({ 0: "PASS" });` +
      `process.exit(9);`,
  );
  assert.equal(r.status, 9);
  const hits = r.stdout.split("\n").filter((l) => l.startsWith("RESULT:"));
  assert.deepEqual(hits, ["RESULT: UNKNOWN (exit 9)"]);
});

test("an out-of-vocabulary label warns loudly at ARM time, not silently at exit", () => {
  const r = runChild(
    `import { armResultLine } from "file:///${LIB}";` +
      `armResultLine({ 0: "GREAT" });`,
  );
  assert.match(r.stderr, /label\(s\) GREAT not in the RESULT vocabulary/);
  assert.match(r.stdout, /^RESULT: UNKNOWN \(exit 0\)/m);
});

test("RESULT_LINE_NEST labels a child's line after the grep token, sanitized and bounded", () => {
  const r = runChild(
    `import { armResultLine } from "file:///${LIB}";` +
      `armResultLine({ 0: "PASS" });`,
    { RESULT_LINE_NEST: "kick off$(rm){}" + "x".repeat(100) },
  );
  const line = r.stdout.trim().split("\n").at(-1);
  assert.ok(line.startsWith("RESULT: ["), line);
  const label = line.slice(line.indexOf("[") + 1, line.indexOf("]"));
  assert.match(label, /^[\w.\-/]+$/, "sanitized — no spaces, $, or punctuation survives");
  assert.ok(label.length <= 48, "bounded to 48 chars");
  assert.match(line, /^RESULT: \[[\w.\-/]+\] PASS \(exit 0\)$/);
});

// LIMIT pinned: the emitter swallows a dead fd — the exit code still stands.
test("LIMIT: a closed stdout cannot crash the check or change its exit code", () => {
  const r = runChild(
    `import { armResultLine } from "file:///${LIB}";` +
      `import fs from "node:fs";` +
      `armResultLine({ 0: "PASS", 3: "FAIL" });` +
      `fs.closeSync(1);` +
      `process.exit(3);`,
  );
  assert.equal(r.status, 3, "exit code survives the dead verdict line");
});
