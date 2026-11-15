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

test("usage errors never echo the value they refuse (SR-1)", () => {
  // A token pasted into the wrong argument lands in an error message, and this script's
  // output goes to transcripts and CI logs. Every refusal names the flag, not the value.
  const token = "gh" + "p_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
  const repo = join(dir, "echo");
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "--allow-empty", "-m", "base"]);
  // A ref NAMED like a token resolves, so a range over it runs (and reads NOTHING SWEPT).
  execFileSync("git", ["-C", repo, "branch", token]);
  // An unprefixed, plain-letters credential: no prefix rule can know it is one.
  const plain = "Ab3dEf7hIj9kLm2nOp4qRs6tUv8wXy0z";
  for (const [args, value] of [
    [["--history", token], token],
    [["--range", token], token],
    [["--range", `${token}..HEAD`], token],
    [["--range", `HEAD:${token}`], token], // git prints the path part on its own
    [["--range", `${token}..${token}`], token], // resolves: NOTHING SWEPT summary
    [[`--${token}`], token],
    [[`--${token}=x`], token],
    [[`--${plain}`], plain],
    [[`--${plain}=x`], plain],
  ]) {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, encoding: "utf8" });
    // Refused (2), or — where the token is a real ref name — a run that resolves (0).
    // Either way, no outcome may print the value.
    assert.ok(r.status === 2 || r.status === 0, `${args.join(" ").slice(0, 20)} exit ${r.status}`);
    const out = `${r.stdout}\n${r.stderr}`;
    assert.ok(!out.includes(value.slice(4)), `value echoed for ${args.join(" ").slice(0, 12)}…`);
  }
  // Still legible: a typo gets a suggestion that names only the known flag...
  const typo = spawnSync(process.execPath, [SCRIPT, "--histroy", "1"], { cwd: repo, encoding: "utf8" });
  assert.equal(typo.status, 2);
  assert.match(typo.stderr, /did you mean --history\?/);
  // ...and a commit-id range is printed in the denominator, as CI needs.
  const head = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const ok = spawnSync(process.execPath, [SCRIPT, "--range", `${head}..${head}`], { cwd: repo, encoding: "utf8" });
  assert.match(ok.stdout, new RegExp(`range ${head}\\.\\.${head}`));
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

test("a git failure prints a fixed diagnostic: never the --repo path or git's text (prepublish review round 2)", () => {
  // Reviewer input: a missing --repo whose basename is secret-shaped. The diagnostic used
  // to quote the path, outside the path rule.
  const name = "rn" + "d_" + "A".repeat(24);
  const r = spawnSync(process.execPath, [SCRIPT, "--history", "1", "--repo", join(dir, "missing", name)], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stdout + r.stderr, /git unreadable/);
  assert.ok(!`${r.stdout}\n${r.stderr}`.includes(name), "the secret-shaped path was printed");
});

test("the staged path never forwards git's stderr (prepublish review round 2)", () => {
  // A config value git cannot parse is quoted back in git's error text. The scan stays
  // fail-soft (exit 0) and prints a fixed line instead.
  const value = "rn" + "d_" + "B".repeat(24);
  const repo = join(dir, "bad-config");
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["-C", repo, "config", "core.autocrlf", value]);
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: repo, encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.ok(!`${r.stdout}\n${r.stderr}`.includes(value), "git's stderr (quoting the config value) was forwarded");
});

test("LIMIT: a placeholder word anywhere in a URI's credentials or host skips it, so a real host containing one passes", () => {
  // Reviewer inputs (prepublish review 2026-11-15). The words are substrings by design; a
  // whole-host matcher was tried and had its own gaps, so the script claims less instead.
  const pw = "Zq9w" + "Lk2";
  for (const uri of [
    "postgres://svc:" + pw + "@notlocalhost.prod.internal/db",
    "postgres://svc:" + pw + "@redacted-db.internal/db",
    "https://svc:" + pw + "@example.com%2eevil.tld/",
  ]) {
    assert.equal(scanMessage(`DB=${uri}\n`).status, 0, uri.slice(0, 40));
  }
  // Without the word, the same credentials fire.
  assert.equal(scanMessage("DB=postgres://svc:" + pw + "@db.prod.internal/db\n").status, 1);
});

test("LIMIT: an allowlist marker ANYWHERE on the line skips it: a trust statement, not a parsed comment", () => {
  // Reviewer inputs: the marker is JSON data before the key, and YAML data after it.
  const key = "rn" + "d_" + "A".repeat(24);
  assert.equal(scanMessage(`{"note":"secret-scan:ignore","key":"${key}"}\n`).status, 0);
  assert.equal(scanMessage(`value: ${key} secret-scan:ignore\n`).status, 0);
  assert.equal(scanMessage(`KEY=${key} // pragma: allowlist secret (why)\n`).status, 0);
  // Without a marker, the same line fires.
  assert.equal(scanMessage(`{"key":"${key}"}\n`).status, 1);
});

// SY-1 (c): vendor shapes ported from the fleet scanner (skylark-site 885414a72 / c2ffc4fb3).
// Every value is fake and split at its provider prefix.
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (payload) => `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u(payload)}.${"sig".repeat(15)}`;
const VENDOR = [
  ["stripe-restricted-live", "STRIPE=" + "rk_" + "live_" + "Fx7Fx7Fx7Fx7Fx7Fx7Fx7Fx7"],
  ["stripe-webhook-secret", "WEBHOOK=" + "wh" + "sec_" + "Fx7Fx7Fx7Fx7Fx7Fx7Fx7Fx7Fx7Fx7"],
  ["slack-webhook", "HOOK=https://hooks." + "slack.com/services/" + "T0FX7/B0FX7/" + "Fx7Fx7Fx7Fx7Fx7Fx7Fx7Fx7"],
  ["render-api-key", "RENDER=" + "rn" + "d_" + "Fx7Fx7Fx7Fx7Fx7Fx7Fx7Fx7Fx7Fx7"],
  ["doppler-token", "DOPPLER=" + "dp" + ".st." + "Fx7".repeat(14)],
  ["sendgrid-key", "SENDGRID=" + "SG" + "." + "Fx7".repeat(7) + "F" + "." + "Fx7".repeat(14) + "F"],
  ["supabase-access-token", "SUPABASE=" + "sb" + "p_" + "Fx7Fx7Fx7Fx7Fx7Fx7Fx7Fx7Fx7Fx7Fx7Fx7Fx"],
  ["supabase-secret-key", "SUPABASE=" + "sb_" + "secret_" + "Fx7Fx7Fx7Fx7Fx7Fx7Fx7Fx7"],
  ["supabase-service-role-jwt", "SUPABASE_SERVICE=" + jwt({ iss: "supabase", role: "service" + "_role" })],
  ["posthog-personal-key", "POSTHOG=" + "ph" + "x_" + "Fx7Fx7Fx7Fx7Fx7Fx7Fx7Fx7Fx7Fx7Fx7Fx7Fx"],
  ["sentry-token", "SENTRY=" + "sntry" + "u_" + "Fx7Fx7Fx7Fx7Fx7Fx7Fx7Fx7Fx7Fx7Fx7Fx7Fx"],
];

test("each fleet vendor shape fires, naming its pattern (SY-1 c)", () => {
  for (const [name, line] of VENDOR) {
    const r = scanMessage(`${line}\n`);
    assert.equal(r.status, 1, name);
    assert.match(r.err, new RegExp(`\\[${name}\\]`), name);
  }
});

test("documented variants of the vendor shapes fire too (SY-1 c, Codex round 1)", () => {
  for (const [name, line] of [
    ["supabase-access-token", "SUPABASE=" + "sb" + "p_v0_" + "a1".repeat(20)],
    ["doppler-token", "DOPPLER=" + "dp" + ".said." + "Fx7".repeat(14)],
    ["slack-webhook", "HOOK=https://hooks." + "slack-gov.com/services/" + "T0FX7/B0FX7/" + "Fx7".repeat(8)],
    ["sentry-token", "SENTRY=" + "sntry" + "a_" + "0f".repeat(32)],
    ["sentry-token", "SENTRY=" + "sntry" + "i_" + "0f".repeat(32)],
  ]) {
    const r = scanMessage(`${line}\n`);
    assert.equal(r.status, 1, line.slice(0, 20));
    assert.match(r.err, new RegExp(`\\[${name}\\]`), line.slice(0, 20));
  }
});

test("ordinary code that shares a vendor prefix stays silent (SY-1 c, Codex round 1)", () => {
  for (const line of [
    "dp.st.application.configuration.reload();",
    "SG.ConfigurationManager.ApplicationConfigurationProvider.initialize();",
    // A base64url blob in which `rnd_` follows a `-`: not a key start.
    "AAAA-rnd_" + "a1".repeat(20),
  ]) {
    assert.equal(scanMessage(`${line}\n`).status, 0, line.slice(0, 30));
  }
});

test("LIMIT: an identifier shaped like `rnd_` + 24 or more letters and digits fires as a Render key", () => {
  // Render publishes no body format, so the rule claims only prefix + length (Codex round 2).
  // A letters-only key fires, and so does an identifier of the same shape.
  assert.equal(scanMessage("const rn" + "d_DeterministicRandomNumberGenerator = 1;\n").status, 1);
  assert.equal(scanMessage("RENDER=rn" + "d_" + "aBcD".repeat(8) + "\n").status, 1);
});

test("overlapping JWT starts do not rescan a long payload (SY-1 c, Codex round 1)", () => {
  // Codex measured 29.7 s for 1000 repeats (a 6 MB line) before the start boundary.
  const unit = "eyJ" + "-eyJ".repeat(512) + ".eyJ" + "A".repeat(4096) + "!";
  const t0 = Date.now();
  const r = scanMessage(unit.repeat(1000) + "\n", 15_000);
  assert.equal(r.signal, null, `timed out after ${Date.now() - t0} ms`);
  assert.equal(r.status, 0);
});

test("a Supabase ANON key stays silent: only a service_role JWT fires (SY-1 c)", () => {
  // Anon keys are public by design and ship in front-end code.
  assert.equal(scanMessage(`SUPABASE_ANON=${jwt({ iss: "supabase", role: "anon" })}\n`).status, 0);
  // A JWT-looking string whose payload is not JSON is not a Supabase key either.
  assert.equal(scanMessage(`X=eyJ${"a".repeat(20)}.eyJ${"b".repeat(20)}.${"c".repeat(20)}\n`).status, 0);
});

test("the vendor shapes scan in linear time on repeated prefixes (SY-1 c)", () => {
  // Every new quantifier is bounded; an unbounded run whose charset contains its own
  // prefix rescans to end of line from every start (the fleet measured >1.5 s on 48 KB).
  for (const prefix of ["rk_live_", "whsec_", "rnd_", "dp.st.", "SG.", "sbp_", "sb_secret_", "phx_", "sntryu_", "eyJa.eyJa.", "https://hooks.slack.com/services/a/"]) {
    const t0 = Date.now();
    const r = scanMessage(prefix.repeat(40_000) + "\n", 15_000);
    assert.equal(r.signal, null, `${prefix} timed out after ${Date.now() - t0} ms`);
    // A finished scan, not a crash: exit 0 (clean) or 1 with a finding line. Checking the
    // signal alone let an immediate erroneous exit pass (prepublish review round 2).
    assert.ok(r.status === 0 || (r.status === 1 && /^\s+\[[a-z-]+\]\s+message line 1 /m.test(r.err)), `${prefix} exit ${r.status}`);
  }
});
