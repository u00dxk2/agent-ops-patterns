import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { redactSecretShapes } from "../lib/snippet-redact.mjs";
import { redactSecretShapes as redactBeforeSy3 } from "./fixtures/snippet-redact-before-sy3.mjs";

// SY-3: the two redactors (lib/snippet-redact.mjs, lib/secret_redaction.py) gain the
// vendor key shapes the commit scanner (scripts/check-staged-secrets.mjs) blocks.
// ONE fixture table drives three legs:
//   1. the scanner refuses each fixture under the expected pattern name,
//   2. the JS redactor replaces each with its vendor token,
//   3. the Python redactor gives the same text and shapes as the JS one, case by case.
// Then the ADDITIVE property: against a frozen copy of the pre-SY-3 JS file, nothing
// that file hid shows now.
//
// Every value is synthetic and assembled at run time: each provider prefix is split
// so no committed line matches the provider's pattern (ours or a hosted scanner's).

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCANNER = join(ROOT, "scripts", "check-staged-secrets.mjs");

/**
 * `n` characters of a LETTERS-ONLY body. The generic base64 rule skips digit-free
 * runs, so these fixtures reach the vendor shapes, which run last. A body with
 * digits is usually taken by a generic rule first; that case is the LIMIT below.
 */
const body = (n) => "Fxkq".repeat(Math.ceil(n / 4)).slice(0, n);
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
  ["stripe-restricted-live", "stripe-key", "r" + "k_live_" + body(23) + "7"],
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

test("leg 1: the scanner refuses each fixture under the expected pattern name", () => {
  const dir = mkdtempSync(join(tmpdir(), "sy3-"));
  try {
    const file = join(dir, "msg.txt");
    writeFileSync(file, VENDOR.map(([, , v]) => line(v)).join("\n") + "\n");
    const r = spawnSync(process.execPath, [SCANNER, "--message-file", file], { encoding: "utf8" });
    assert.equal(r.status, 1, `the scanner must REFUSE the message (exit 1), got ${r.status}`);
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

test("the common env-file forms redact: KEY=value, KEY: value, quoted, after a slash", () => {
  const render = "rn" + "d_" + body(32);
  for (const [before, after] of [["RENDER_API_KEY=", ""], ["render_key: ", ""], ['"', '"'], ["'", "'"], ["/", ""], ["+", ""]]) {
    assert.deepEqual(redactSecretShapes(`${before}${render}${after}`).shapes, ["render-api-key"], JSON.stringify(before));
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

// Three Codex rounds (2026-10-13) reproduced each of these against earlier versions of
// this change, which ran the vendor shapes before other rules: a vendor shape redacted a
// piece out of another key, or an older shape cut a vendor key, and the rest showed.
const OVERLAP = [
  ["sk-ant-" + "rn" + "d_" + "A".repeat(24), "[redacted:anthropic-key]"],
  ["sk-short-" + "rn" + "d_" + "A".repeat(24), "[redacted:openai-key]"],
  ["eyJabcdefghij-" + "rn" + "d_" + "A".repeat(24) + ".BBBBBBBBBBBBBBBB.CCCCCCCCCCCCCCCC", "[redacted:jwt]"],
  ["eyJabcdefghij." + "rn" + "d_" + "A".repeat(24) + "." + "A".repeat(16), "[redacted:jwt]"],
  ["S" + "G." + "A".repeat(22) + "." + "B".repeat(14) + "-" + "rn" + "d_" + "C".repeat(24), "[redacted:sendgrid-key]"],
  ["S" + "G." + "A".repeat(22) + "." + "sntr" + "yu_" + "A".repeat(36), "[redacted:sendgrid-key]"],
  ["d" + "p.st." + "sb" + "_secret_" + "A".repeat(20) + "." + "A".repeat(40), "[redacted:doppler-token]"],
  ["wh" + "sec_" + "A".repeat(24) + "/" + "gh" + "p_" + "A".repeat(36), "[redacted:stripe-webhook-secret][redacted:github-token]"],
  // An older shape runs first and takes its key; nothing secret is left showing.
  ["sb" + "_secret_-" + "gh" + "p_" + "A".repeat(36), "sb_secret_-[redacted:github-token]"],
  ["sntr" + "yu_" + "A".repeat(20) + "-" + "ph" + "x_" + body(30), "[redacted:sentry-token]"],
  // Past Render's 128 ceiling: no vendor match, so the base64 rule takes the body as it did before.
  ["rn" + "d_" + "G7".repeat(70), "rnd_[redacted:long-base64]"],
];

for (const [value, expected] of OVERLAP) {
  test(`a vendor shape never redacts a piece out of another key: ${value.slice(0, 12)}…`, () => {
    assert.equal(redactSecretShapes(line(value)).text, line(expected));
  });
}

const TOKEN = /\[redacted:[a-z0-9-]+\]/;

/**
 * True when `now` can be made from `before` by replacing NON-EMPTY substrings of
 * `before` with redaction tokens, so nothing `before` showed redacted shows in
 * `now`. Anchored: the first raw stretch must start `before`, the last must end
 * it, and each token must stand for at least one character.
 */
export function onlyAddsRedaction(before, now) {
  const raws = now.split(TOKEN);
  if (raws.length === 1) return before === now;
  if (!before.startsWith(raws[0])) return false;
  let at = raws[0].length;
  for (const raw of raws.slice(1, -1)) {
    const found = before.indexOf(raw, at + 1);
    if (found === -1) return false;
    at = found + raw.length;
  }
  const last = raws[raws.length - 1];
  return before.endsWith(last) && before.length - last.length >= at + 1;
}

test("onlyAddsRedaction is anchored: dropped ends, dropped middles and empty replacements are refused", () => {
  assert.equal(onlyAddsRedaction("abc", "b"), false);
  assert.equal(onlyAddsRedaction("abc", ""), false);
  assert.equal(onlyAddsRedaction("x [redacted:long-base64] y", "redacted"), false);
  assert.equal(onlyAddsRedaction("ab", "a[redacted:k]b"), false); // a token must replace something
  assert.equal(onlyAddsRedaction("a SECRET b", "a [redacted:k] b"), true);
  assert.equal(onlyAddsRedaction("a [redacted:k] b", "a [redacted:k] b"), true);
  assert.equal(onlyAddsRedaction("a [redacted:k] SECRET", "a [redacted:k] [redacted:j]"), true);
  assert.equal(onlyAddsRedaction("a [redacted:k] b", "a SECRET b"), false);
});

const OLD = [
  "sk-" + "ant-admin01-abc123def456", "sk-" + "proj-abcdefghijklmnopqrstuvwxyz123456",
  "gh" + "p_abcdefghijklmnopqrstuvwxyz0123456789", "AKIA" + "IOSFODNN7EXAMPLE",
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9P",
  "a".repeat(24) + "0123456789abcdef0123456789abcdef", "QWxhZGRpbjpvcGVuIHNlc2FtZUFsYWRkaW46b3BlbiBzZXNhbWU",
  "xox" + "b-123456789012-abcdefghijklmnop", "sk_" + "live_FAKEfakeFAKEfake0123456789",
];
// Base64 runs of 36-38 characters: just under the generic rule's 40 on their own,
// over it once a separator and a vendor prefix join them. A vendor shape that cut a
// run shows up only with these.
const EDGE = ["Q1w2".repeat(9), "Q1w2".repeat(9) + "Z", "Q1w2".repeat(9) + "Zz"];
// Vendor keys whose bodies carry digits, so a generic rule can take them first.
const DIGIT_VENDOR = ["rn" + "d_" + "Fx7k".repeat(8), "rn" + "d_" + "Fx7k".repeat(32), "d" + "p.st." + "Fx7k".repeat(11), "ph" + "x_" + "Fx7k".repeat(11)];
const PIECES = [...OLD, ...EDGE, ...DIGIT_VENDOR, ...VENDOR.map(([, , v]) => v), ...OVERLAP.map(([v]) => v)];
const SEPS = ["", "-", "_", ".", "/", "+", "=", ":", " ", "\\n", "%3D"];

test("ADDITIVE: on every pair of fixtures, nothing the pre-SY-3 redactor hid shows now", () => {
  let checked = 0;
  const failures = [];
  for (const a of PIECES) for (const b of PIECES) for (const sep of SEPS) {
    const text = `x ${a}${sep}${b} y`;
    checked++;
    if (!onlyAddsRedaction(redactBeforeSy3(text).text, redactSecretShapes(text).text)) failures.push(text.slice(0, 60));
  }
  assert.deepEqual(failures.slice(0, 5), [], `${failures.length} of ${checked} pairs redacted LESS than before SY-3`);
  assert.ok(checked > 20_000, `the pair sweep must actually run (checked ${checked})`);
});

test("ADDITIVE inside a URL look-back: replacing a key never moves a later run into the base64 rule's URL skip", () => {
  // Codex round 3's reproducer: with the vendor shapes running before the generic
  // rules, a 132-character key became a 24-character token, the final run moved
  // inside the base64 rule's 2048-character look-back for "https://", and the run it
  // used to redact came back raw. Swept here over look-back distances around the edge.
  const failures = [];
  let checked = 0;
  for (let dots = 1880; dots <= 2040; dots += 8) {
    for (const key of [...DIGIT_VENDOR, ...VENDOR.map(([, , v]) => v)]) {
      for (const tail of [...EDGE, "Q1w2".repeat(10)]) {
        const text = "https://x/" + ".".repeat(dots) + key + "." + tail;
        checked++;
        if (!onlyAddsRedaction(redactBeforeSy3(text).text, redactSecretShapes(text).text)) failures.push(`${dots} ${key.slice(0, 8)}`);
      }
    }
  }
  assert.deepEqual(failures.slice(0, 5), [], `${failures.length} of ${checked} URL-context cases redacted LESS than before SY-3`);
});

test("leg 3: the Python redactor returns the same shapes and text as the JS one, case by case", (t) => {
  const py = findPython();
  if (!py) {
    // A skip in CI would let the parity this file exists for go unchecked; fail instead.
    assert.ok(!process.env.CI, "CI must have Python 3.10+ on PATH for the cross-language leg");
    return t.skip("no Python 3.10+ on PATH (local only; CI fails here instead)");
  }
  const lines = [...VENDOR.map(([, , v]) => line(v)), ...OVERLAP.map(([v]) => line(v)), ...DIGIT_VENDOR.map(line)];
  for (const a of PIECES) for (const sep of SEPS) lines.push(`x ${a}${sep}${EDGE[1]} y`, `x ${EDGE[1]}${sep}${a} y`);
  const code =
    "import sys, json; sys.path.insert(0, sys.argv[1]); import secret_redaction as s; " +
    "print(json.dumps([list(s.redact_secret_shapes(x)) for x in json.load(sys.stdin)]))";
  // -X utf8: Windows Python otherwise reads stdin as cp1252 and mangles the "…" in every line.
  const r = spawnSync(py, ["-I", "-X", "utf8", "-c", code, join(ROOT, "lib")], { input: JSON.stringify(lines), encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  assert.equal(got.length, lines.length);
  lines.forEach((l, i) => {
    const js = redactSecretShapes(l);
    assert.deepEqual(got[i], [js.text, js.shapes], `line ${i + 1} differs between JS and Python: ${l.slice(0, 40)}`);
  });
});

const VENDOR_SHAPES = new Set(VENDOR.map(([, s]) => s).filter((s) => s !== "jwt" && s !== "stripe-key" && s !== "slack-webhook"));
const vendorHits = (text) => redactSecretShapes(text).shapes.filter((s) => VENDOR_SHAPES.has(s));

test("LIMIT: where a generic rule takes a vendor key's body first, the token is the generic one and the prefix shows", () => {
  // The price of running the vendor shapes last. The body is still hidden.
  assert.equal(redactSecretShapes("k " + DIGIT_VENDOR[1] + " e").text, "k rnd_[redacted:long-base64] e");
  assert.equal(redactSecretShapes("k " + DIGIT_VENDOR[2] + " e").text, "k dp.st.[redacted:long-base64] e");
  // A hex body right after `_` is neither long-hex's (no start after `_`) nor
  // long-base64's (pure hex is skipped), so before SY-3 it showed whole; now the
  // vendor token appears. Same for any body under 40 characters.
  assert.equal(redactSecretShapes("k " + "sntr" + "yu_" + "0123456789abcdef".repeat(4) + " e").text, "k [redacted:sentry-token] e");
  assert.equal(redactSecretShapes("k " + DIGIT_VENDOR[0] + " e").text, "k [redacted:render-api-key] e");
});

test("LIMIT: a vendor shape does not fire on a body shorter than the scanner's floor (another rule still may)", () => {
  for (const v of [
    "rn" + "d_" + body(23),
    "ph" + "x_" + body(29),
    "sb" + "p_" + body(31),
    "wh" + "sec_" + body(23),
    "sntr" + "yu_" + body(29),
    "d" + "p.st." + body(39),
    "S" + "G." + body(17) + "." + body(20), // SendGrid's segments are exactly 22 and 43
  ]) {
    assert.deepEqual(vendorHits(line(v)), [], v.slice(0, 8));
  }
});

test("LIMIT: a body past the scanner's ceiling is not a vendor match; only the generic rules can take it", () => {
  // A digit-free run is skipped by the base64 rule too, as it was before SY-3.
  for (const v of ["rn" + "d_" + "A".repeat(200), "d" + "p.st." + "A".repeat(45), "S" + "G." + "A".repeat(22) + "." + "A".repeat(44)]) {
    assert.deepEqual(redactSecretShapes(line(v)).shapes, [], v.slice(0, 8));
  }
});

test("LIMIT: no vendor shape starts right after a word character, `_` or `-` (the scanner's anchor)", () => {
  for (const [, shape, value] of VENDOR) {
    if (!VENDOR_SHAPES.has(shape)) continue;
    for (const c of ["x", "7", "_", "-"]) {
      assert.deepEqual(vendorHits(`a ${c}${value} b`), [], `${shape} after ${JSON.stringify(c)}`);
    }
  }
});

test("LIMIT: no vendor shape ends right before `+ / = _ -` when that character is outside its body", () => {
  const render = "rn" + "d_" + body(32);
  for (const c of ["+", "/", "=", "_", "-"]) {
    assert.deepEqual(vendorHits(`a ${render}${c} b`), [], `render-api-key before ${JSON.stringify(c)}`);
  }
});

test("LIMIT: a JWT whose header has 8 or 9 characters after eyJ passes the redactors (the scanner takes it)", () => {
  // The redactors' JWT floor stays eyJ + 10: lowering it to the scanner's eyJ + 8 let
  // a short JWT right after a base64 run cut that run below 40 characters.
  const shortJwt = "eyJAAAAAAAA." + Buffer.from('{"role":"service_role"}').toString("base64url") + ".AAAAAAAA";
  assert.ok(!redactSecretShapes(line(shortJwt)).shapes.includes("jwt"));
});

test("vendor shapes stay linear on adversarial input (many starts, long runs)", () => {
  const started = Date.now();
  for (const probe of [
    ("sb" + "_secret_").repeat(20_000),
    ("sntr" + "yu_").repeat(25_000),
    ("sntr" + "yu_/").repeat(25_000),
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
