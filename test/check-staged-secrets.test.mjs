// Unit-level arms for scripts/check-staged-secrets.mjs, run as a real child process.
// The script's own --selftest covers the git-reading paths end to end; these pin
// single-line verdicts through --message-file, which uses the same firstPatternHit
// as the staged and history paths. Fixture values are split at the provider prefix
// so this file's own text matches no pattern.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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
  // What the old `\b` matched still matches: a word-character ending, and a `-` ending
  // followed by a word character.
  assert.equal(scanMessage(`GOOGLE=${"AI" + "za" + "b".repeat(35)}\n`).status, 1);
  assert.equal(scanMessage(`GOOGLE=${key}x\n`).status, 1);
});

test("repeated credential-URI prefixes scan in linear time (AOP-R3)", () => {
  // 40k repeats took ~46 s before the bound (quadratic); a linear scan is well under 15 s
  // even with process start-up on a slow runner. One probe per scheme family.
  for (const prefix of ["postgres://u:", "mongodb://u:", "mysql://u:", "mssql://u:", "redis://:", "amqp://u:"]) {
    const t0 = Date.now();
    const r = scanMessage(prefix.repeat(40_000) + "\n", 15_000);
    assert.equal(r.signal, null, `${prefix} timed out after ${Date.now() - t0} ms`);
    assert.equal(r.status, 0, prefix);
  }
});

test("judging a candidate for placeholders is linear too (Codex round 1)", () => {
  // A long run of "<" inside a candidate made `<[^>]*>` search to the end from every
  // "<": 160k took ~27 s on the regex alone. The candidate is real, so it must fire.
  const t0 = Date.now();
  const r = scanMessage("postgres://u:password@localhost postgres://u:" + "<".repeat(160_000) + "@db.prod.internal\n", 15_000);
  assert.equal(r.signal, null, `timed out after ${Date.now() - t0} ms`);
  assert.equal(r.status, 1);
});

test("LIMIT: a credential-URI password containing `://` passes (the bound that keeps the scan linear)", () => {
  assert.equal(scanMessage("DB=postgres://u:" + "a://b-c-d@db.prod.internal/x\n").status, 0);
});

test("an equals-form flag is refused with exit 2, never run as the default scan (AOP-R4)", () => {
  // A clean index: before the fix every one of these fell through to the staged scan,
  // found nothing staged and exited 0 — a clean verdict over a scope nobody asked for.
  const repo = join(dir, "equals-form");
  execFileSync("git", ["init", "-q", repo]);
  for (const args of [
    ["--range=HEAD~1..HEAD"],
    ["--history=1"],
    ["--message-file=msg.txt"],
    ["--history", "1", "--repo=elsewhere"],
    ["--history", "1", "--selftest=yes"],
  ]) {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, encoding: "utf8" });
    assert.equal(r.status, 2, args.join(" "));
    assert.match(r.stderr, /nothing was scanned/, args.join(" "));
    assert.doesNotMatch(r.stdout, /^history:/m, args.join(" "));
    // The value after "=" is never echoed, on either stream.
    for (const a of args.filter((x) => x.includes("="))) {
      const value = a.slice(a.indexOf("=") + 1);
      assert.ok(!r.stdout.includes(value) && !r.stderr.includes(value), `value of ${a.split("=")[0]} echoed`);
    }
  }
});

test("a placeholder URI voids only itself, not other secrets on the line (AOP-R2)", () => {
  const token = "gh" + "p_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
  const placeholder = "postgres://user:password@localhost:5432/app";
  const real = "postgres://svc:" + "Zq9wLk2@db.prod.internal/x";
  // A placeholder URI and a token on one JSON line: the token still fires.
  const r1 = scanMessage(`{"db":"${placeholder}","t":"${token}"}\n`);
  assert.equal(r1.status, 1);
  assert.match(r1.err, /\[github-pat\]/);
  // Two URIs where only the first is a placeholder: the second still fires.
  const r2 = scanMessage(`{"a":"${placeholder}","b":"${real}"}\n`);
  assert.equal(r2.status, 1);
  assert.match(r2.err, /\[postgres-uri-with-creds\]/);
  // ...and in the other order, with no quote between them: a real URI's candidate
  // stops at its host and does not borrow the next URI's placeholder.
  assert.equal(scanMessage(`${real},${placeholder}\n`).status, 1);
  // Markup straight after a real host is not a placeholder (Codex round 1).
  assert.equal(scanMessage(`DB=${real.replace("/x", "")}<br>\n`).status, 1);
  // Other families: a placeholder URL next to a real basic-auth URL still fires.
  const r3 = scanMessage(`a=https://user:pass@example.com/r b=https://deploy:${"Qw8" + "rTy2"}@git.prod.internal/r\n`);
  assert.equal(r3.status, 1);
  assert.match(r3.err, /\[basic-auth-url\]/);
  // A placeholder word elsewhere on the line no longer voids a real URI.
  assert.equal(scanMessage(`see example.com — DATABASE_URL=${real}\n`).status, 1);
  // Placeholders alone stay silent, in every form the selftest's SILENT list uses.
  for (const line of [
    placeholder,
    "MONGODB_URI=mongodb" + "+srv://<user>:<password>@cluster.example.com/db",
    "GIT_REMOTE=https://user:" + "pass@example.com/repo.git",
    `{"a":"${placeholder}","b":"mysql://root:changeme@127.0.0.1/x"}`,
  ]) {
    assert.equal(scanMessage(`${line}\n`).status, 0, line.slice(0, 24));
  }
});
