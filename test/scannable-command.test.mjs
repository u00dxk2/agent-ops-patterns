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

  it("decodes ANSI-C hex, octal and unicode spellings, not just the five common escapes", () => {
    // The decoder used to handle \n \t \r \\ \' and strip the backslash from
    // everything else, so $'\x2d\x2dbody' normalized to "x2dx2dbody" — the
    // --body it actually runs never reached the scanner. That is a NARROWING,
    // which the raw-OR-normalized doctrine forbids.
    const BODY = /--body/;
    assert.equal(scannableCommand(String.raw`printf $'\x2d\x2dbody'`), "printf --body");
    assert.equal(scannableCommand(String.raw`printf $'\055\055body'`), "printf --body");
    assert.equal(scannableCommand(String.raw`printf $'\u002d\u002dbody'`), "printf --body");
    assert.equal(matchesRawOrScannable(BODY, String.raw`printf $'\x2d\x2dbody'`), true);
    // \a \b \e \f \v are real ANSI-C escapes too; they must not survive as letters.
    assert.equal(scannableCommand(String.raw`$'a\eb'`), "a\x1bb");
  });

  it("octal escapes are EIGHT-BIT, as Bash defines them", () => {
    // \455 masks to 0x2d ("-"). Decoding it as U+012D would mean $'\455\455body'
    // runs as --body while normalizing to something no --body regex can match:
    // a narrowing, which the raw-OR-normalized doctrine forbids.
    assert.equal(scannableCommand(String.raw`printf $'\455\455body'`), "printf --body");
    assert.equal(scannableCommand(String.raw`$'\777'`), String.fromCharCode(0o777 & 0xff));
    // \c? is DEL in Bash; the generic control-char rule would give 0x1f.
    assert.equal(scannableCommand(String.raw`$'\c?'`), "\x7f");
  });

  it("an out-of-range unicode escape does not take the normalizer down", () => {
    // fromCodePoint throws above 0x10FFFF. A throw here would return NOTHING to
    // scan, which is strictly worse than an undecoded literal.
    assert.doesNotThrow(() => scannableCommand(String.raw`$'\UFFFFFFFF'`));
    assert.ok(scannableCommand(String.raw`cmd $'\UFFFFFFFF' --body`).includes("--body"));
  });

  it("LIMIT: interior path separators do NOT survive normalization", () => {
    // Only the C:\ and \\server PREFIXES are protected. In POSIX shell the
    // interior backslashes really are escapes, so this reading is correct - but
    // it means the normalized form is useless for path-shaped policy rules, and
    // the header used to claim "path shapes survive" without that caveat.
    assert.equal(scannableCommand(String.raw`type C:\Users\me\notes.txt`), String.raw`type C:\Usersmenotes.txt`);
    assert.equal(scannableCommand(String.raw`type docs\specs\plan.md`), "type docsspecsplan.md");
    // Which is survivable only because the doctrine scans the RAW text too.
    assert.equal(matchesRawOrScannable(/docs\\specs/, String.raw`type docs\specs\plan.md`), true);
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
