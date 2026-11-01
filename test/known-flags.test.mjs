import { test } from "node:test";
import assert from "node:assert/strict";
import { findUnknownFlags, assertKnownFlags } from "../lib/known-flags.mjs";

const KNOWN = ["project", "verify-by", "list", "dry-run"];

test("an unknown flag is refused with a suggestion; known flags and values pass", () => {
  const msgs = findUnknownFlags(["--projct", "x", "--list", "--verify-by=2026-09-01"], KNOWN);
  assert.equal(msgs.length, 1);
  assert.match(msgs[0], /unknown flag at argument #1/);
  assert.match(msgs[0], /did you mean --project\?/);
});

test("an unrelated token gets no misleading suggestion", () => {
  const msgs = findUnknownFlags(["--frobnicate"], KNOWN);
  assert.equal(msgs.length, 1);
  assert.ok(!msgs[0].includes("did you mean"), msgs[0]);
});

test("everything after a literal -- passes untouched; positionals are ignored", () => {
  assert.deepEqual(findUnknownFlags(["--list", "--", "--not-a-flag"], KNOWN), []);
  assert.deepEqual(findUnknownFlags(["positional", "-s"], KNOWN), []);
});

test("every offender is reported, not just the first — one re-run fixes the line", () => {
  const msgs = findUnknownFlags(["--aa", "--bb", "--list"], KNOWN);
  assert.equal(msgs.length, 2);
});

test("fail-soft on junk argv: non-array / non-string tokens do not throw", () => {
  assert.deepEqual(findUnknownFlags(null, KNOWN), []);
  assert.deepEqual(findUnknownFlags([42, null, "--list"], KNOWN), []);
});

test("assertKnownFlags: clean argv returns true and touches nothing", () => {
  let exited = null;
  const ok = assertKnownFlags(["--list"], KNOWN, "t", { exit: (c) => { exited = c; }, log: () => {} });
  assert.equal(ok, true);
  assert.equal(exited, null);
});

test("assertKnownFlags: refusal logs every offender plus the summary, then exits 2", () => {
  const lines = [];
  let exited = null;
  const ok = assertKnownFlags(["--aa", "--bb"], KNOWN, "myscript", {
    exit: (c) => { exited = c; },
    log: (m) => lines.push(m),
  });
  assert.equal(ok, false);
  assert.equal(exited, 2);
  assert.equal(lines.filter((l) => l.includes("unknown flag at argument #")).length, 2);
  assert.ok(lines.at(-1).includes("nothing was written"));
  assert.ok(lines.every((l) => l.startsWith("myscript: ")));
});

// The trap an adversarial review found in the origin: the documented contract
// read as "pass a number", two authors did, and the function-only signature
// turned a clean refusal into a TypeError. Both forms must work.
test("exit accepts a plain exit-code number without crashing", () => {
  // A number can't capture the call, so prove it by NOT throwing and by the
  // false return under a stubbed process.exit.
  const realExit = process.exit;
  let code = null;
  // @ts-ignore — deliberate stub
  process.exit = (c) => { code = c; };
  try {
    const ok = assertKnownFlags(["--zz"], KNOWN, "t", { exit: 7, log: () => {} });
    assert.equal(ok, false);
    assert.equal(code, 7, "the number IS the exit code");
  } finally {
    process.exit = realExit;
  }
});

// The importer trap: a module-scope guard in an IMPORTED script must not scan
// the importer's argv.
test("entry gating: a non-entry module is a no-op even with unknown flags in argv", () => {
  let exited = null;
  const ok = assertKnownFlags(["--definitely-unknown"], KNOWN, "t", {
    exit: (c) => { exited = c; },
    log: () => { throw new Error("must not log — not the entry module"); },
    entry: "file:///definitely/not/the/entry.mjs",
  });
  assert.equal(ok, true);
  assert.equal(exited, null);
});

// A security review found the refusal echoing the whole token: a secret passed
// as `--<secret>` landed in stderr, which is a CI log. Sentinels are built at
// run time so this file itself carries no secret shape.
const SENTINEL = "ZQXJSENTINEL";
const SECRET_TOKENS = [
  `--${["sk", "live", SENTINEL, "a1b2c3d4e5"].join("-")}`, // known token prefix
  `--${SENTINEL}${"0123456789abcdef".repeat(2)}`, // hex run
  `--${SENTINEL}+a/b=c`, // base64 punctuation (the value after = is never printed anyway)
  `--${SENTINEL}${"x".repeat(60)}`, // longer than any flag name
  `--${["gh", "p"].join("")}_${SENTINEL}`, // GitHub token prefix
  `--${SENTINEL.toLowerCase()}`, // short, letters only: shaped exactly like a flag name
  `--correcthorse${SENTINEL}`, // a passphrase, no digits
];

test("no unknown token is ever echoed, whatever its shape; each is reported by position", () => {
  const lines = [];
  let exited = null;
  const ok = assertKnownFlags(["--list", ...SECRET_TOKENS], KNOWN, "t", {
    exit: (c) => { exited = c; },
    log: (m) => lines.push(m),
  });
  assert.equal(ok, false);
  assert.equal(exited, 2);
  const out = lines.join("\n");
  assert.ok(!out.toLowerCase().includes(SENTINEL.toLowerCase()), `token echoed:\n${out}`);
  assert.equal(lines.filter((l) => /unknown flag at argument #\d+/.test(l)).length, SECRET_TOKENS.length);
  assert.match(out, /unknown flag at argument #2\b/);
  assert.ok(lines.at(-1).includes(`${SECRET_TOKENS.length} unknown flag(s)`), lines.at(-1));
});

test("a typo still gets its known-flag suggestion, without the typo echoed", () => {
  const msgs = findUnknownFlags(["--projct", SECRET_TOKENS[0]], KNOWN);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0], "unknown flag at argument #1 (did you mean --project?)");
  assert.equal(msgs[1], "unknown flag at argument #2");
});

test("LIMIT: the offender is found by position and suggestion, not by seeing it echoed", () => {
  // The cost of never echoing: an unrelated typo with no close known flag is
  // reported by position only, so the reader looks it up in their own command.
  assert.deepEqual(findUnknownFlags(["--list", "--frobnicate"], KNOWN), ["unknown flag at argument #2"]);
});

// LIMIT pinned: a KNOWN flag that is unimplemented passes — this guard checks
// recognition, not implementation. Keeping known == implemented is the caller's contract.
test("LIMIT: a known-but-unimplemented flag is not caught here", () => {
  assert.deepEqual(findUnknownFlags(["--verify-by"], KNOWN), []);
});
