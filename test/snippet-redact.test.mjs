import { test } from "node:test";
import assert from "node:assert/strict";
import { redactSecretShapes, NONCONVERGENT_TOKEN } from "../lib/snippet-redact.mjs";

// Fixture values are synthetic (pragma: allowlist secret applies to the file's
// intent — every "secret" below is fabricated for shape-matching only).

const CASES = [
  ["private-key", "-----BEGIN RSA PRIVATE KEY-----\nMIIEow…\n-----END RSA PRIVATE KEY-----"], // pragma: allowlist secret
  ["db-uri-creds", "postgres://bususer:hunter22secret@db.example.internal:5432/bus"], // pragma: allowlist secret
  ["aws-key", "AKIAIOSFODNN7EXAMPLE"], // pragma: allowlist secret
  // Synthetic, not Stripe's published docs key — a real-looking sk_live_ value
  // in a public repo trips secret scanners for no benefit.
  ["stripe-key", "sk_live_FAKEfakeFAKEfake0123456789"], // pragma: allowlist secret
  ["github-token", "ghp_abcdefghijklmnopqrstuvwxyz0123456789"], // pragma: allowlist secret
  ["google-api-key", "AIzaSyA1234567890abcdefghijklmnopqrstuv"], // pragma: allowlist secret
  ["slack-token", "xoxb-123456789012-abcdefghijklmnop"], // pragma: allowlist secret
  ["slack-webhook", "https://hooks.slack.com/services/T00000001/B00000001/XXXXfakeXXXX1234"], // pragma: allowlist secret
  ["anthropic-key", "sk-ant-admin01-abc123def456"],
  ["openai-key", "sk-proj-abcdefghijklmnopqrstuvwxyz123456"],
  ["jwt", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9P"],
  ["long-hex", "a".repeat(24) + "0123456789abcdef0123456789abcdef"],
  ["long-base64", 'TOKEN="QWxhZGRpbjpvcGVuIHNlc2FtZUFsYWRkaW46b3BlbiBzZXNhbWU="'],
];

for (const [shape, secret] of CASES) {
  test(`redacts ${shape} to its shape token, preserving surrounding text`, () => {
    const line = `…context before ${secret} context after…`;
    const { text, shapes } = redactSecretShapes(line);
    assert.ok(shapes.includes(shape), `expected shape ${shape} in ${JSON.stringify(shapes)}`);
    assert.ok(text.includes(`[redacted:${shape}]`));
    assert.ok(text.includes("context before"));
    assert.ok(text.includes("context after"));
    // No fragment of the secret's tail survives (head prefixes like "sk-" may
    // legitimately appear inside the redaction token's neighborhood).
    assert.ok(!text.includes(secret.slice(-12)));
  });
}

test("passes benign text through byte-identical", () => {
  const benign =
    "R-071 closed at commit 0c71e3a — feed restored; see docs/specs/x.md and https://example.com/path?utm_source=bus";
  const { text, shapes } = redactSecretShapes(benign);
  assert.equal(text, benign);
  assert.deepEqual(shapes, []);
});

test("does NOT redact a 40-hex git SHA (development text cites them constantly)", () => {
  const line = "shipped at f6efe271a1277aca79586ee51ef9db30592ac1c5 on main";
  assert.equal(redactSecretShapes(line).text, line);
});

test("redacts a 64-hex token (sha256-length secrets are above the 48 floor)", () => {
  const line = `token=${"0123456789abcdef".repeat(4)}`;
  const r = redactSecretShapes(line);
  assert.ok(r.shapes.includes("long-hex"));
  assert.equal(r.text, "token=[redacted:long-hex]");
});

test("is idempotent (a redacted snippet re-redacts to itself)", () => {
  const once = redactSecretShapes("key sk-ant-admin01-abc123def456 end").text;
  assert.equal(redactSecretShapes(once).text, once);
});

test("is idempotent on ADJACENT padded base64 runs (fixed-point scan)", () => {
  // Two padded runs back-to-back: the first run's trailing "=" blocks the
  // lookahead until the second run is replaced — a single pass caught only
  // one of them, so f(f(x)) !== f(x). The fixed-point loop closes that.
  const b64 = "QWJjMTIzZGVmNDU2Z2hpNzg5amtsMDEybW5vMzQ1cHFy"; // pragma: allowlist secret
  const input = `${b64}==${b64}==`;
  const once = redactSecretShapes(input);
  assert.equal(once.shapes.filter((s) => s === "long-base64").length, 2);
  assert.ok(!once.text.includes(b64.slice(-12)));
  assert.equal(redactSecretShapes(once.text).text, once.text);
});

test("an ADJACENCY CHAIN of any length is fully redacted in one pass", () => {
  // Two bugs used to live in the trailing `=` of the base64 lookahead. It
  // vetoed a run followed by another `=`, which (a) meant adjacent padded runs
  // could only be peeled one per pass, and (b) let a chain like `<secret>=<secret>`
  // return the FIRST secret raw. Lengths well past any old pass cap must now
  // come back clean; against the vetoing boundary, 6 and 65 both leave raw runs.
  const b64 = "QWJjMTIzZGVmNDU2Z2hpNzg5amtsMDEybW5vMzQ1cHFy"; // pragma: allowlist secret
  for (const n of [2, 6, 65, 300]) {
    const r = redactSecretShapes(`${b64}==`.repeat(n));
    assert.equal(r.shapes.length, n, `${n} runs → ${n} redactions`);
    assert.ok(!r.text.includes(b64.slice(-12)), `no run may survive at n=${n}`);
    assert.equal(redactSecretShapes(r.text).text, r.text, "idempotent");
  }
});

test("a stray `=` between two runs hides neither of them", () => {
  // The leak the boundary veto caused: the first complete secret came back raw
  // while the scan reported itself finished.
  const b64 = "QWJjMTIzZGVmNDU2Z2hpNzg5amtsMDEybW5vMzQ1cHFy"; // pragma: allowlist secret
  const r = redactSecretShapes(`${b64}===${b64}==`);
  assert.equal(r.shapes.length, 2);
  assert.ok(!r.text.includes(b64.slice(-12)), "neither run may survive");
});

test("FAIL-CLOSED: a scan that cannot stabilize returns no text at all", () => {
  // No known input reaches this branch, which is exactly why it needs a seam:
  // a guard nobody can make fire is a guard nobody has checked. Driving
  // maxPasses to 1 on input that needs a confirming pass proves the branch is
  // wired, and proves it discards the partial text rather than returning it.
  const b64 = "QWJjMTIzZGVmNDU2Z2hpNzg5amtsMDEybW5vMzQ1cHFy"; // pragma: allowlist secret
  const r = redactSecretShapes(`${b64}==`.repeat(3), { maxPasses: 1 });
  assert.equal(r.text, NONCONVERGENT_TOKEN, "partial output must never escape");
  assert.ok(!r.text.includes(b64.slice(-12)));
  assert.ok(r.shapes.includes("nonconvergent-snippet"), "and it must be visible in shapes");

  // The seam must not weaken the default path.
  assert.notEqual(redactSecretShapes(`${b64}==`.repeat(3)).text, NONCONVERGENT_TOKEN);
});

test("handles null/undefined/empty without throwing", () => {
  assert.equal(redactSecretShapes(null).text, "");
  assert.equal(redactSecretShapes(undefined).text, "");
  assert.equal(redactSecretShapes("").text, "");
});

test("redacts multiple distinct shapes in one snippet", () => {
  const line = "creds: AKIAIOSFODNN7EXAMPLE + xoxb-123456789012-abcdefghijklmnop"; // pragma: allowlist secret
  const { text, shapes } = redactSecretShapes(line);
  assert.ok(shapes.includes("aws-key") && shapes.includes("slack-token"));
  assert.equal(text, "creds: [redacted:aws-key] + [redacted:slack-token]");
});

// A recall snippet is routinely cut mid-text, so a secret can land at index 0
// or behind a bracket. The old delimiter-allowlist lookbehind missed both.
test("redacts a base64 token at the very start of a snippet", () => {
  const b64 = "QWxhZGRpbjpvcGVuIHNlc2FtZUFsYWRkaW46b3BlbiBzZXNhbWU="; // pragma: allowlist secret
  const { text, shapes } = redactSecretShapes(b64);
  assert.ok(shapes.includes("long-base64"));
  assert.equal(text, "[redacted:long-base64]");
});

test("redacts a base64 token behind a non-delimiter character", () => {
  const b64 = "QWxhZGRpbjpvcGVuIHNlc2FtZUFsYWRkaW46b3BlbiBzZXNhbWU="; // pragma: allowlist secret
  assert.ok(redactSecretShapes(`(${b64})`).shapes.includes("long-base64"));
});

// ---------------------------------------------------------------------------
// DOCUMENTED LIMITS. These assert what the lib deliberately does NOT catch, so
// the boundary is a tested contract rather than a surprise. See the "WHAT THIS
// DOES NOT CATCH" block in lib/snippet-redact.mjs.
// ---------------------------------------------------------------------------

test("LIMIT: 40-hex passes — a git SHA and a legacy GitHub PAT are one shape", () => {
  // Pre-2021 GitHub PATs are 40 hex chars, identical in shape to a git SHA.
  // We pass 40-hex (redacting every SHA in dev text is worse than useless).
  // Rotate legacy tokens; this lib will not save you. Floor is 48.
  const legacyPat = "e72c1b4a9f3d5e6a8b0c2d4f6a8b0c2d4f6a8b0c"; // pragma: allowlist secret
  assert.equal(redactSecretShapes(`token=${legacyPat}`).shapes.length, 0);
});

test("LIMIT: opaque unprefixed credentials pass (no key-name rules by design)", () => {
  // Key-name rules (KEY=…) false-positive hard on source code; this lib runs
  // on recalled prose. Pair with an ingestion-side scrubber if you need them.
  assert.equal(redactSecretShapes("MY_SERVICE_TOKEN=hunter2hunter2").shapes.length, 0);
});

test("LIMIT: vendors absent from SHAPES pass (adding one is a one-line PR)", () => {
  for (const s of ["SG.abcdefghijklmnopq.abcdefghij1234567890", "xapp-1-A012-3456-abcdef"]) {
    assert.equal(redactSecretShapes(s).shapes.length, 0); // pragma: allowlist secret
  }
});

test("does NOT redact a long benign URL path (base64 skips URL interiors)", () => {
  const line =
    "see https://api.example.com/v2/projects/abc123def456ghi789/resources/jkl012mno345pqr678stu901 for details";
  const r = redactSecretShapes(line);
  assert.equal(r.text, line);
  assert.deepEqual(r.shapes, []);
});

test("does NOT redact a data: URI payload or an npm/SRI integrity hash", () => {
  const b64 = "QWJjMTIzZGVmNDU2Z2hpNzg5amtsMDEybW5vMzQ1cHFy"; // pragma: allowlist secret
  for (const line of [`data:image/png;base64,${b64}`, `integrity sha512-${b64}==`]) {
    assert.equal(redactSecretShapes(line).text, line);
  }
});

test("LIMIT: digit-free 40+ char letter runs pass (identifier/prose, not token-shaped)", () => {
  const line = "const VERYLONGCONSTANTNAMEWITHOUTANYDIGITSATALLXYZ = value";
  assert.equal(redactSecretShapes(line).text, line);
});

test("LIMIT: base64 under 40 chars passes (the documented floor)", () => {
  assert.equal(redactSecretShapes('t="QWJjMTIzZGVmNDU2Z2hpNzg5amts"').shapes.length, 0); // pragma: allowlist secret
});

test("LIMIT: a secret split across a snippet boundary passes (each fragment is under-shape)", () => {
  assert.equal(redactSecretShapes("ghp_abcdefghij").shapes.length, 0); // truncated github token fragment
});

test("no catastrophic backtracking on adversarial input", () => {
  // Every SHAPE regex is anchored and free of nested quantifiers. Guard the
  // property so a future shape can't quietly introduce a ReDoS.
  const started = Date.now();
  for (const probe of [
    "postgres://u:" + "a".repeat(50_000),
    "-----BEGIN RSA PRIVATE KEY-----\n" + "A".repeat(200_000),
    "eyJ" + "a".repeat(200_000),
    " " + "A".repeat(200_000),
    "sk-" + "a".repeat(200_000),
  ]) {
    redactSecretShapes(probe);
  }
  assert.ok(Date.now() - started < 2000, "redaction should stay linear on 200k-char input");
});
