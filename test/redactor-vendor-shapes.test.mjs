import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { redactSecretShapes } from "../lib/snippet-redact.mjs";

// SY-3: the two redactors (lib/snippet-redact.mjs, lib/secret_redaction.py) must
// redact every vendor key shape the commit scanner (scripts/check-staged-secrets.mjs)
// blocks. ONE fixture table drives three legs, so parity is an assertion, not a hope:
//   1. the scanner names each fixture's pattern (the table is the scanner's own shapes),
//   2. the JS redactor replaces each with its shape token,
//   3. the Python redactor returns the same shape list as the JS one, case by case.
//
// Every value is synthetic and assembled at run time: each provider prefix is split
// so no committed line matches the provider's pattern (ours or a hosted scanner's).

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCANNER = join(ROOT, "scripts", "check-staged-secrets.mjs");

/** `n` characters of a letters-and-digits body. */
const body = (n) => "Fx7k".repeat(Math.ceil(n / 4)).slice(0, n);
/** A compact JWT with the given payload and a fake signature. */
const jwt = (payload) =>
  "eyJhbGciOiJIUzI1NiJ9." + Buffer.from(JSON.stringify(payload)).toString("base64url") + ".FIXTUREsignature";

// [scanner pattern name (null = the scanner deliberately stays silent), redactor shape, value]
const VENDOR = [
  ["render-api-key", "render-api-key", "rn" + "d_" + body(32)],
  ["render-api-key", "render-api-key", "rn" + "d_" + body(128)],
  ["doppler-token", "doppler-token", "d" + "p.st." + body(43)],
  ["doppler-token", "doppler-token", "d" + "p.st.my-config_1." + body(44)],
  ["doppler-token", "doppler-token", "d" + "p.ct." + body(40)],
  ["doppler-token", "doppler-token", "d" + "p.pt." + body(43)],
  ["doppler-token", "doppler-token", "d" + "p.sa." + body(43)],
  ["doppler-token", "doppler-token", "d" + "p.said." + body(43)],
  ["doppler-token", "doppler-token", "d" + "p.scim." + body(43)],
  ["doppler-token", "doppler-token", "d" + "p.audit." + body(43)],
  ["sendgrid-key", "sendgrid-key", "S" + "G." + body(22) + "." + body(21) + "-_" + body(20)],
  ["supabase-access-token", "supabase-access-token", "sb" + "p_" + body(40)],
  ["supabase-access-token", "supabase-access-token", "sb" + "p_v0_" + body(40)],
  ["supabase-secret-key", "supabase-secret-key", "sb" + "_secret_" + body(24) + "-_" + body(6)],
  ["posthog-personal-key", "posthog-personal-key", "ph" + "x_" + body(43)],
  ["sentry-token", "sentry-token", "sntr" + "ys_" + body(40)],
  ["sentry-token", "sentry-token", "sntr" + "yu_" + body(40)],
  ["sentry-token", "sentry-token", "sntr" + "ya_" + body(40)],
  ["sentry-token", "sentry-token", "sntr" + "yi_" + body(36) + "+/=_"],
  ["stripe-webhook-secret", "stripe-webhook-secret", "wh" + "sec_" + body(32)],
  ["slack-webhook", "slack-webhook", "https://hooks.slack" + "-gov.com/services/T0001/B0001/" + body(24)],
  // Already covered before SY-3, by the redactors' broader shapes; kept so a later
  // narrowing of either shape goes red here.
  ["stripe-restricted-live", "stripe-key", "r" + "k_live_" + body(24)],
  ["supabase-service-role-jwt", "jwt", jwt({ role: "service_role" })],
  // Ruled 2026-10-13 (manager review 8e00c300): the scanner's "service_role only" rule
  // is a COMMIT-BLOCKING rule, where a public anon key would be a false alarm. The
  // redactors keep redacting every JWT; an anon key is redacted too.
  [null, "jwt", jwt({ role: "anon" })],
];

const line = (value) => `…context before ${value} context after…`;

test("the fixture table covers every vendor shape the scanner gained in SY-1 (c)", () => {
  const names = new Set(VENDOR.map(([s]) => s).filter(Boolean));
  for (const n of [
    "render-api-key", "doppler-token", "sendgrid-key", "supabase-access-token", "supabase-secret-key",
    "supabase-service-role-jwt", "posthog-personal-key", "sentry-token", "stripe-restricted-live",
    "stripe-webhook-secret", "slack-webhook",
  ]) assert.ok(names.has(n), `no fixture for scanner pattern ${n}`);
});

test("leg 1: the scanner names each fixture's pattern (the table is the scanner's own shapes)", () => {
  const dir = mkdtempSync(join(tmpdir(), "sy3-"));
  try {
    const file = join(dir, "msg.txt");
    writeFileSync(file, VENDOR.map(([, , v]) => line(v)).join("\n") + "\n");
    const r = spawnSync(process.execPath, [SCANNER, "--message-file", file], { encoding: "utf8" });
    const hits = new Map();
    for (const m of r.stderr.matchAll(/\[([a-z0-9-]+)\]\s+message line (\d+)/g)) hits.set(Number(m[2]), m[1]);
    VENDOR.forEach(([scanner], i) => {
      assert.equal(hits.get(i + 1) ?? null, scanner, `fixture ${i + 1}: scanner named ${hits.get(i + 1)}, expected ${scanner}`);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const [, shape, value] of VENDOR) {
  test(`leg 2: JS redacts ${shape}: ${value.slice(0, 9)}…`, () => {
    const { text, shapes } = redactSecretShapes(line(value));
    assert.deepEqual(shapes, [shape]);
    assert.equal(text, line(`[redacted:${shape}]`));
  });
}

test("leg 2: the vendor shapes redact behind escape residue as every prefixed shape does", () => {
  for (const residue of ["x\\n", "x\\t", "x\\r", "a%3D", "\\u0022", "\\\\n"]) {
    for (const [, shape, value] of VENDOR) {
      if (shape === "jwt" || shape === "slack-webhook") continue; // pinned in snippet-redact.test.mjs
      const { text } = redactSecretShapes(`{"text":"line1${residue}${value}"}`);
      assert.ok(text.includes(`line1${residue}[redacted:${shape}]`), `${JSON.stringify(residue)} ${shape}: ${text}`);
    }
  }
});

/** A Python 3.10+ interpreter, or null. */
function findPython() {
  for (const cmd of ["python3", "python"]) {
    const r = spawnSync(cmd, ["-c", "import sys; print(sys.version_info >= (3, 10))"], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim() === "True") return cmd;
  }
  return null;
}

test("leg 3: the Python redactor returns the same shapes and text as the JS one, case by case", (t) => {
  const py = findPython();
  if (!py) return t.skip("no Python 3.10+ on PATH; CI's python job runs the same table in the self-check");
  const lines = VENDOR.map(([, , v]) => line(v));
  const code =
    "import sys, json; sys.path.insert(0, sys.argv[1]); import secret_redaction as s; " +
    "print(json.dumps([list(s.redact_secret_shapes(x)) for x in json.load(sys.stdin)]))";
  // -X utf8: Windows Python otherwise reads stdin as cp1252 and mangles the "…" in every line.
  const r = spawnSync(py, ["-I", "-X", "utf8", "-c", code, join(ROOT, "lib")], { input: JSON.stringify(lines), encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  lines.forEach((l, i) => {
    const js = redactSecretShapes(l);
    assert.deepEqual(got[i], [js.text, js.shapes], `fixture ${i + 1} (${VENDOR[i][1]}) differs between JS and Python`);
  });
});

test("LIMIT: a body shorter than the scanner's floor passes (the redactors claim the scanner's shapes, no more)", () => {
  for (const v of [
    "rn" + "d_" + body(23),
    "ph" + "x_" + body(29),
    "sb" + "p_" + body(31),
    "wh" + "sec_" + body(23),
    "sntr" + "yu_" + body(29),
    "d" + "p.st." + body(39),
    "S" + "G." + body(17) + "." + body(20), // SendGrid's segments are exactly 22 and 43
  ]) {
    assert.deepEqual(redactSecretShapes(line(v)).shapes, [], v.slice(0, 8));
  }
});

test("LIMIT: a body past the scanner's ceiling redacts only the first ceiling-length run", () => {
  // Bounded on purpose (linear time). A Render key has a 128-character ceiling; a longer
  // run leaves its tail, which the long-base64 rule then takes when it carries a digit.
  const { text, shapes } = redactSecretShapes(line("rn" + "d_" + body(200)));
  assert.deepEqual(shapes, ["render-api-key", "long-base64"]);
  assert.ok(!text.includes(body(40)));
});

test("vendor shapes stay linear on adversarial input (many starts, long runs)", () => {
  const started = Date.now();
  for (const probe of [
    ("sb" + "_secret_").repeat(20_000),
    ("sntr" + "yu_").repeat(25_000),
    ("d" + "p.st.").repeat(30_000),
    "d" + "p.st." + "a-".repeat(100_000),
    ("S" + "G.").repeat(60_000),
    "S" + "G." + "a".repeat(22) + "." + "-".repeat(200_000),
    "rn" + "d_" + "a".repeat(200_000),
    ("wh" + "sec_").repeat(30_000),
    ("https://hooks.slack" + "-gov.com/services/").repeat(5_000),
  ]) {
    redactSecretShapes(probe);
  }
  assert.ok(Date.now() - started < 2000, "redaction should stay linear on ~200k-char vendor-shaped input");
});
