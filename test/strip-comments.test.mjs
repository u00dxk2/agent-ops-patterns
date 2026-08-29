import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stripComments,
  includesOutsideComments,
  stripShellComments,
  includesOutsideShellComments,
} from "../lib/strip-comments.mjs";

// The motivating failure, verbatim shape: the needle survives only in the
// comment explaining its removal, and a raw grep goes false-green.
test("a needle that lives only in a comment is NOT present", () => {
  const src = `render(<Btn label="Start now" />);\n// removed the old "Get started" label 2026-08-20\n`;
  assert.equal(includesOutsideComments(src, "Get started"), false, "rationale must not satisfy the guard");
  assert.equal(includesOutsideComments(src, "Start now"), true);
});

test("line and block comments stripped; newlines preserved so line numbers hold", () => {
  const src = "a; // one\nb; /* two\nthree */ c;\n";
  const out = stripComments(src);
  assert.equal(out.split("\n").length, src.split("\n").length, "line count must not shift");
  assert.ok(!out.includes("one") && !out.includes("two") && !out.includes("three"));
  assert.ok(out.includes("a;") && out.includes("b;") && out.includes("c;"));
  // keepNewlines: false collapses the stripped block-comment newlines.
  const collapsed = stripComments(src, { keepNewlines: false });
  assert.ok(collapsed.split("\n").length < src.split("\n").length);
});

test("comment markers inside string literals survive (the over-strip direction)", () => {
  const src = `const u = "https://example.com/x"; const v = 'a /* not a comment */ b';`;
  const out = stripComments(src);
  assert.ok(out.includes("https://example.com/x"), "a // inside a string is not a comment");
  assert.ok(out.includes("/* not a comment */"), "a /* inside a string is not a comment");
});

test("template text is opaque; a substitution's comment is code and is stripped", () => {
  // Needle in backtick TEXT is real output the program emits — must be found.
  assert.equal(includesOutsideComments("const t = `Get started`;", "Get started"), true);
  // A block comment inside ${...} is JS — must NOT satisfy the guard.
  const src = "const t = `a ${x /* Get started */} b`;";
  assert.equal(includesOutsideComments(src, "Get started"), false);
  // Nested template inside a substitution must not flip backtick parity: the
  // comment AFTER the expression is still a comment.
  const nested = "const t = `a ${f(`b`)} c`; // Get started\n";
  assert.equal(includesOutsideComments(nested, "Get started"), false);
});

test("THE regression: a quote/backtick inside a regex character class must not desync the scanner", () => {
  // First cut tracked strings but not regex literals; this backtick read as a
  // template opener and every comment after it survived — false green.
  const src = [
    String.raw`const RE = /(?:^|[\s\`(\[<"'])tmp\/[A-Za-z0-9_-]+/m;`,
    `// ---- needle-only-in-comment ----`,
    `real();`,
  ].join("\n");
  assert.equal(includesOutsideComments(src, "needle-only-in-comment"), false);
  assert.ok(stripComments(src).includes("real();"));
});

test("division vs regex: `return a / b; // note` strips the note", () => {
  // `return` allows a regex and the `//` would supply a closing slash; the
  // scanner must reject that candidate (closing delimiter followed by `/`).
  const src = "function f(a, b) { return a / b; // secret-note\n}";
  assert.equal(includesOutsideComments(src, "secret-note"), false);
  assert.ok(stripComments(src).includes("return a / b;"));
});

test("a real regex body may contain // and is copied verbatim", () => {
  const src = String.raw`const p = /https:\/\/example/; // trailing`;
  const out = stripComments(src);
  assert.ok(out.includes(String.raw`/https:\/\/example/`), "regex body must survive");
  assert.ok(!out.includes("trailing"));
});

test("fail-soft on junk input: non-strings coerce, nothing throws", () => {
  assert.equal(stripComments(null), "");
  assert.equal(stripComments(undefined), "");
  assert.equal(includesOutsideComments(42, "4"), true); // "42" contains "4" — coerced, not thrown
  assert.equal(stripShellComments(null), "");
});

// LIMIT pinned as a tested expectation, not prose: ASI regex-vs-division is
// out of coverage — both paths copy verbatim, so no code is ever eaten.
test("LIMIT: ASI ambiguity copies verbatim in both readings — never strips code", () => {
  const src = "a = b\n/re/.test(c)\n";
  assert.ok(stripComments(src).includes("/re/.test(c)"));
});

test("shell: # opens a comment only at word start, outside quotes", () => {
  const src = [
    `echo "x # y" # real-comment`,
    `n=$#`,
    `tag=a#b`,
    `run.sh ; # after-semicolon`,
  ].join("\n");
  const out = stripShellComments(src);
  assert.ok(out.includes('"x # y"'), "quoted # survives");
  assert.ok(out.includes("$#") && out.includes("a#b"), "word-internal # survives");
  assert.ok(!out.includes("real-comment") && !out.includes("after-semicolon"));
  assert.equal(out.split("\n").length, src.split("\n").length);
});

test("shell presence guard: a rationale naming a script is not the script running", () => {
  const hook = `#!/bin/sh\n# we removed check-cold-readability.sh on purpose\nnode other-check.mjs\n`;
  assert.equal(includesOutsideShellComments(hook, "check-cold-readability"), false);
  assert.equal(includesOutsideShellComments(hook, "other-check.mjs"), true);
});

// LIMIT pinned: heredoc bodies are scanned like code — errs toward FOUND,
// never toward a false absence.
test("LIMIT: a needle in a heredoc body reads as present (fail toward FOUND)", () => {
  const hook = "cat <<EOF\nthe-needle\nEOF\n";
  assert.equal(includesOutsideShellComments(hook, "the-needle"), true);
});
