import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scannableCommand, matchesRawOrScannable } from "../lib/scannable-command.mjs";

describe("scannableCommand — quoting evasions normalize to scannable form", () => {
  it("quote-split tokens, double-quote splits, backslash escapes, ANSI-C wrappers", () => {
    assert.equal(scannableCommand("node scripts/agent-'status'.mjs"), "node scripts/agent-status.mjs");
    assert.equal(scannableCommand('--bo"dy"'), "--body");
    assert.equal(scannableCommand("--bo\\dy"), "--body");
    assert.equal(scannableCommand("$'--body'"), "--body");
  });

  it("decodes common ANSI-C escapes inside $'…'", () => {
    assert.equal(scannableCommand("$'a\\tb'"), "a\tb");
    assert.equal(scannableCommand("$'line1\\nline2'"), "line1\nline2");
  });

  it("empty and non-string input → empty string, never a throw", () => {
    assert.equal(scannableCommand(""), "");
    assert.equal(scannableCommand(null), "");
    assert.equal(scannableCommand(undefined), "");
  });

  it("preserves Windows and UNC path shapes (backslash after colon or backslash survives)", () => {
    assert.ok(scannableCommand("type C:\\dev\\project\\f.txt").includes("C:\\"));
    assert.ok(scannableCommand("read \\\\server\\share\\f.txt").includes("\\\\server"));
  });

  it("nested quoting terminates at the depth bound — bounded, not infinite", () => {
    const nested = "$'" + "$'".repeat(20) + "--body" + "'".repeat(21);
    const out = scannableCommand(nested);
    assert.equal(typeof out, "string"); // termination is the assertion; full normalization is not promised past depth 8
  });
});

describe("matchesRawOrScannable — the doctrine as a function (widening only)", () => {
  const BODY_RE = /(^|\s)--body(=|\s|$)/;

  it("catches the quote-split spelling a raw-only regex misses", () => {
    assert.equal(BODY_RE.test('cmd --bo"dy" x'), false, "raw-only regex misses — the reason this lib exists");
    assert.equal(matchesRawOrScannable(BODY_RE, 'cmd --bo"dy" x'), true);
    assert.equal(matchesRawOrScannable(BODY_RE, "cmd $'--body' x"), true);
    assert.equal(matchesRawOrScannable(BODY_RE, "cmd --bo\\dy x"), true);
  });

  it("a raw match still counts even when normalization destroys it — never narrowing", () => {
    // This pattern depends on the quotes themselves; normalization strips them.
    const QUOTED_RE = /"--body"/;
    assert.equal(QUOTED_RE.test(scannableCommand('cmd "--body"')), false);
    assert.equal(matchesRawOrScannable(QUOTED_RE, 'cmd "--body"'), true);
  });

  it("clean text stays clean on both legs — normalization cannot invent a hit from nothing", () => {
    assert.equal(matchesRawOrScannable(BODY_RE, "cmd --body-file tmp/b.md"), false);
    assert.equal(matchesRawOrScannable(BODY_RE, "echo plain words"), false);
  });

  it("defuses a /g regex's lastIndex state and tolerates garbage input", () => {
    const g = /--body/g;
    assert.equal(matchesRawOrScannable(g, "x --body y"), true);
    assert.equal(matchesRawOrScannable(g, "x --body y"), true); // a second call must not be skipped by lastIndex
    assert.equal(matchesRawOrScannable(g, null), false);
    assert.equal(matchesRawOrScannable("not a regex", "x --body y"), false);
  });
});

describe("scannable-command — limits, pinned as tested expectations", () => {
  const BODY_RE = /(^|\s)--body(=|\s|$)/;

  it("LIMIT: space-separated tokens are NOT joined — a mention must not become a match", () => {
    assert.equal(scannableCommand("--bo dy"), "--bo dy");
    assert.equal(matchesRawOrScannable(BODY_RE, "cmd --bo dy"), false);
  });

  it("LIMIT: variable expansion is not modeled — $X carrying the flag passes", () => {
    assert.equal(matchesRawOrScannable(BODY_RE, "X=--body; cmd $X"), false);
  });

  it("LIMIT: encoded payloads pass — base64 is data until an interpreter runs it", () => {
    // "LS1ib2R5" is base64 for "--body"; no decode pass exists, deliberately.
    assert.equal(matchesRawOrScannable(BODY_RE, "echo LS1ib2R5 | base64 -d | sh"), false);
  });

  it("LIMIT: heredoc quoting semantics are not modeled — <<'EOF' and <<EOF normalize identically", () => {
    assert.equal(scannableCommand("cat <<'EOF'\nx\nEOF"), scannableCommand("cat <<EOF\nx\nEOF"));
    // Heredoc BODIES remain visible text, though — a policy regex still sees them:
    assert.equal(matchesRawOrScannable(BODY_RE, "sh <<'EOF'\ncmd --body x\nEOF"), true);
  });
});
