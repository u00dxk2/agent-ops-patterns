import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lintMemoryIntegrity,
  buildMemoryLinkGraph,
  suggestMemoryRepairs,
  compactIndexLines,
  extractIndexLinks,
  extractToolReferences,
  classifyMemoryIndexSizes,
  MEMORY_SIZE_STATES,
  DEFAULT_INDEX_BUDGET_BYTES,
} from "../lib/memory-integrity.mjs";

const FILES = [
  { name: "feedback_ship_early.md", content: "---\nname: feedback-ship-early\nmetadata:\n  type: feedback\n---\nShip early. See [[project_launch_plan]]." },
  { name: "project_launch_plan.md", content: "---\nname: project_launch_plan\nmetadata:\n  type: project\n---\nLaunch plan. [[feedback_ship_early]] [[nonexistent_memory]]" },
  { name: "reference_api_docs.md", content: "---\nname: reference-api-docs\nmetadata:\n  type: reference\n---\nAPI docs pointer. [[feedback_ship_early]]" },
];

const INDEX = [
  "# Memory Index",
  "- [Ship early](feedback_ship_early.md) — always ship",
  "- [Launch plan](project_launch_plan.md) — the plan",
  "- [Dead pointer](does_not_exist.md) — stale",
  "- [API docs](reference_api_docs.md) — reference",
  "- [Totally different fact](reference_api_docs.md) — silent merge shape",
].join("\n");

test("dead-index-link WARN for a missing target; live links resolve", () => {
  const { findings } = lintMemoryIntegrity({ indexText: INDEX, files: FILES });
  const dead = findings.filter((f) => f.type === "dead-index-link");
  assert.equal(dead.length, 1);
  assert.equal(dead[0].detail.target, "does_not_exist.md");
  assert.equal(dead[0].severity, "warn");
});

test("duplicate-link-target WARN when clearly different titles share one file", () => {
  const { findings } = lintMemoryIntegrity({ indexText: INDEX, files: FILES });
  const dup = findings.filter((f) => f.type === "duplicate-link-target");
  assert.equal(dup.length, 1);
  assert.equal(dup[0].detail.target, "reference_api_docs.md");
});

test("same-title double listing does NOT flag as silent merge", () => {
  const idx = "- [Ship early](feedback_ship_early.md)\n- [Ship early rule](feedback_ship_early.md)";
  const { findings } = lintMemoryIntegrity({ indexText: idx, files: FILES });
  assert.equal(findings.filter((f) => f.type === "duplicate-link-target").length, 0);
});

test("index-over-budget WARN only past the budget", () => {
  const over = lintMemoryIntegrity({ indexText: INDEX, files: FILES, indexByteLength: DEFAULT_INDEX_BUDGET_BYTES + 1 });
  assert.equal(over.findings.filter((f) => f.type === "index-over-budget").length, 1);
  const under = lintMemoryIntegrity({ indexText: INDEX, files: FILES, indexByteLength: 100 });
  assert.equal(under.findings.filter((f) => f.type === "index-over-budget").length, 0);
});

test("dangling-wiki-link INFO for [[nonexistent_memory]]; resolvable wiki-links pass", () => {
  const { findings } = lintMemoryIntegrity({ indexText: INDEX, files: FILES });
  const dangling = findings.filter((f) => f.type === "dangling-wiki-link");
  assert.equal(dangling.length, 1);
  assert.equal(dangling[0].detail.wiki, "nonexistent_memory");
  assert.equal(dangling[0].severity, "info");
});

test("orphan-memory-file INFO for a file with no index line", () => {
  const files = [...FILES, { name: "feedback_unlisted.md", content: "no frontmatter" }];
  const { findings } = lintMemoryIntegrity({ indexText: INDEX, files });
  const orphans = findings.filter((f) => f.type === "orphan-memory-file").map((f) => f.detail.file);
  assert.deepEqual(orphans, ["feedback_unlisted.md"]);
});

test("near-duplicate-slug is TYPE-GATED", () => {
  const files = [
    { name: "feedback_retry_backoff_rule.md", content: "" },
    { name: "feedback_backoff_retry_rule.md", content: "" }, // same tokens, reordered
    { name: "project_retry_backoff_rule.md", content: "" }, // other type — never compared
  ];
  const { findings } = lintMemoryIntegrity({ indexText: "", files });
  const near = findings.filter((f) => f.type === "near-duplicate-slug");
  assert.equal(near.length, 1);
  assert.deepEqual(near[0].detail.files.sort(), ["feedback_backoff_retry_rule.md", "feedback_retry_backoff_rule.md"]);
});

test("fail-soft: empty/malformed input yields zero findings, no throw", () => {
  assert.deepEqual(lintMemoryIntegrity().findings, []);
  assert.deepEqual(lintMemoryIntegrity({ indexText: null, files: null }).findings, []);
  assert.deepEqual(lintMemoryIntegrity({ indexText: "not markdown [broken", files: [{ name: 42 }] }).findings, []);
});

test("NOTHING SWEPT: a zero-subject run is not a clean run", () => {
  // The repo's own protocol (patterns/checks-that-cant-fail.md) says a sweep
  // that reached nothing must report NOTHING SWEPT rather than clean. This lib
  // used to return {findings: []} for an absent inventory, which is
  // indistinguishable from a healthy memory directory - the exact failure the
  // protocol names, shipped inside the repo that names it.
  const nothing = lintMemoryIntegrity();
  assert.equal(nothing.swept, false, "no index and no files is NOT a sweep");
  assert.equal(nothing.coverage.reached, 0);

  const alsoNothing = lintMemoryIntegrity({ indexText: null, files: [] });
  assert.equal(alsoNothing.swept, false);

  // Malformed entries are dropped silently by the filter, so they have to be
  // counted - otherwise a run that read four hundred junk rows looks clean.
  const allJunk = lintMemoryIntegrity({ indexText: null, files: [{ name: 42 }, null, { nope: true }] });
  assert.equal(allJunk.swept, false, "three unreadable entries is still nothing swept");
  assert.equal(allJunk.coverage.skipped, 3);

  // And a real sweep says so.
  const real = lintMemoryIntegrity({ indexText: "# Index\n", files: [{ name: "a.md", content: "x" }] });
  assert.equal(real.swept, true);
  assert.equal(real.coverage.reached, 1);

  // The index-only branch. A predicate of `fileList.length > 0` alone passes
  // every assertion above, so without this case the red-proof is incomplete —
  // which is exactly what a second reviewer caught in the first version.
  const indexOnly = lintMemoryIntegrity({ indexText: "# Index\n- [A](a.md) - x\n", files: [] });
  assert.equal(indexOnly.swept, true, "an index with content IS a sweep, even with no topic files");
  assert.equal(indexOnly.coverage.reached, 0);
  assert.equal(indexOnly.coverage.indexRead, true);

  // An EMPTY index string is not a read. Truthiness on `indexText` alone would
  // call this swept.
  assert.equal(lintMemoryIntegrity({ indexText: "", files: [] }).swept, false);
});

test("coverage.reached counts files actually LINTED, not names that parsed", () => {
  // An entry with a valid name but no readable content contributes to no check.
  // Counting it as reached inflates the number a caller uses to judge coverage —
  // the same class of lie as reporting clean on a sweep that read nothing.
  const r = lintMemoryIntegrity({
    indexText: "# Index\n",
    files: [
      { name: "real.md", content: "body" },
      { name: "unread.md" },                 // read failed upstream
      { name: "also-unread.md", content: null },
      { name: 42 },                          // malformed
      { name: "MEMORY.md", content: "idx" }, // routine exclusion
    ],
  });
  assert.equal(r.coverage.reached, 1, "only real.md was linted");
  assert.equal(r.coverage.contentless, 2);
  assert.equal(r.coverage.malformed, 1);
  assert.equal(r.coverage.indexExcluded, 1);
  assert.equal(r.coverage.skipped, 4);
});

test("extractIndexLinks skips external/pathed targets", () => {
  const idx = "- [ext](https://example.com/x.md)\n- [pathed](sub/dir.md)\n- [local](feedback_ship_early.md)";
  const links = extractIndexLinks(idx);
  assert.equal(links.length, 1);
  assert.equal(links[0].target, "feedback_ship_early.md");
});

test("extractIndexLinks skips markdown images (![alt](file.md) is not an index link)", () => {
  const links = extractIndexLinks("- ![diagram](missing.md)\n- [real](feedback_ship_early.md)");
  assert.equal(links.length, 1);
  assert.equal(links[0].target, "feedback_ship_early.md");
});

test("buildMemoryLinkGraph: backlinks, dangling, orphans; self/repeat links collapse", () => {
  const g = buildMemoryLinkGraph({ files: FILES });
  assert.deepEqual(g.backlinks["feedback_ship_early.md"].sort(), [
    "project_launch_plan.md",
    "reference_api_docs.md",
  ]);
  assert.equal(g.dangling.length, 1);
  assert.equal(g.dangling[0].wiki, "nonexistent_memory");
  assert.ok(g.orphans.includes("reference_api_docs.md")); // nothing links TO it
  assert.equal(g.stats.nodeCount, 3);
  assert.ok(g.stats.edgeCount >= 3);
});

test("suggestMemoryRepairs: dead link with no close match says remove-or-create", () => {
  const { suggestions } = suggestMemoryRepairs({ indexText: INDEX, files: FILES });
  const dead = suggestions.filter((s) => s.kind === "fix-dead-link");
  assert.equal(dead.length, 1);
  assert.match(dead[0].message, /remove the line/);
});

test("suggestMemoryRepairs: over-budget yields prune candidates from dated lines", () => {
  const idx = INDEX + "\n- old digest 2026-01-05 something\n- newer digest 2026-06-01 something";
  const { suggestions } = suggestMemoryRepairs({
    indexText: idx,
    files: FILES,
    indexByteLength: DEFAULT_INDEX_BUDGET_BYTES + 10,
  });
  const prune = suggestions.find((s) => s.kind === "prune-index");
  assert.ok(prune);
  assert.equal(prune.detail.candidates[0].date, "2026-01-05"); // oldest first
});

test("compactIndexLines: trims only the tail, preserves the link, never grows", () => {
  const long = `- [Title](feedback_ship_early.md) — ${"word ".repeat(60)}end`;
  const { compacted, changes, totalSavedBytes } = compactIndexLines(long, { maxLen: 80 });
  assert.equal(changes.length, 1);
  assert.ok(totalSavedBytes > 0);
  assert.ok(compacted.includes("[Title](feedback_ship_early.md)"));
  assert.ok(compacted.endsWith("…"));
  assert.ok([...compacted].length <= 82);
});

test("compactIndexLines: short lines and non-entry lines untouched", () => {
  const text = "# Header\n- [T](a.md) — short\nplain prose line";
  const r = compactIndexLines(text, { maxLen: 80 });
  assert.equal(r.compacted, text);
  assert.equal(r.changes.length, 0);
});

test("compactIndexLines: never severs a second markdown or wiki link mid-way", () => {
  const long = `- [Primary](a.md) — see [SecondaryLinkWithVeryLongTitle](b.md) plus [[wiki_target_name]] ${"pad ".repeat(30)}end`;
  // maxLen 50 puts the cut INSIDE the second link — the guard must back the
  // cut off to before its "[" instead of leaving a "[Secondary…" fragment.
  const { compacted } = compactIndexLines(long, { maxLen: 50 });
  const opens = (compacted.match(/\[/g) || []).length;
  const closes = (compacted.match(/\]/g) || []).length;
  assert.equal(opens, closes, `unbalanced link brackets in: ${compacted}`);
  assert.ok(compacted.includes("[Primary](a.md)"));
  assert.ok(compacted.endsWith("…"));
});

// The budget is pinned to a LITERAL, not asserted relative to itself. The bug
// this replaces was `Math.floor(24.4 * 1024)` = 24,985 — a check written
// against `DEFAULT_INDEX_BUDGET_BYTES + 1` passes just as happily on the wrong
// constant, which is why it never caught it.
test("index budget is 24,400 decimal bytes — not 24.4 KiB", () => {
  assert.equal(DEFAULT_INDEX_BUDGET_BYTES, 24_400);
  const at = lintMemoryIntegrity({ indexText: INDEX, files: FILES, indexByteLength: 24_400 });
  assert.equal(at.findings.filter((f) => f.type === "index-over-budget").length, 0);
  const over = lintMemoryIntegrity({ indexText: INDEX, files: FILES, indexByteLength: 24_401 });
  assert.equal(over.findings.filter((f) => f.type === "index-over-budget").length, 1);
});

test("extractToolReferences: dedupes to first line, skips URLs and placeholders", () => {
  const text = [
    "- [Ops](a.md) — run scripts/rollup.mjs nightly",
    "- [Again](b.md) — scripts/rollup.mjs, same tool",
    "- [Docs](c.md) — https://example.com/thing.py is not ours",
    "- [Tmpl](d.md) — call <name>.sh with your own name",
  ].join("\n");
  const refs = extractToolReferences(text);
  assert.deepEqual(refs, [{ token: "scripts/rollup.mjs", line: 1 }]);
  assert.deepEqual(extractToolReferences(""), []);
});

test("phantom-tool fires only on a resolver that says provably-absent", () => {
  const idx = "- [Ops](feedback_ship_early.md) — run scripts/ghost.mjs weekly";
  const phantom = (r) =>
    lintMemoryIntegrity({ indexText: idx, files: FILES, toolResolver: r }).findings.filter(
      (f) => f.type === "phantom-tool",
    );
  assert.equal(phantom(() => false).length, 1);
  assert.equal(phantom(() => false)[0].detail.token, "scripts/ghost.mjs");
  assert.equal(phantom(() => true).length, 0);
  assert.equal(phantom(() => null).length, 0); // can't judge → no finding
  assert.equal(phantom(() => { throw new Error("fs blew up"); }).length, 0); // fail-soft
  // No resolver at all: the check does not run, and nothing throws.
  assert.equal(
    lintMemoryIntegrity({ indexText: idx, files: FILES }).findings.filter((f) => f.type === "phantom-tool").length,
    0,
  );
});

test("classifyMemoryIndexSizes: an unmeasurable agent is a finding, never a clean row", () => {
  const r = classifyMemoryIndexSizes({
    rows: [
      { agent: "alpha", path: "/a/MEMORY.md", bytes: 1000 },
      { agent: "beta", path: "/b/MEMORY.md", bytes: 24_401 },
      { agent: "gamma", path: "/c/MEMORY.md", bytes: null }, // dir exists, index unreadable
      { agent: "delta", dirExists: false }, // never held a session
    ],
  });
  assert.deepEqual(r.rows.map((x) => x.state), [
    MEMORY_SIZE_STATES.OK,
    MEMORY_SIZE_STATES.OVER,
    MEMORY_SIZE_STATES.MISSING,
    MEMORY_SIZE_STATES.NO_MEMORY_DIR,
  ]);
  assert.equal(r.sweptCount, 2); // MISSING is a finding, not a measurement
  assert.equal(r.declaredCount, 1); // NO_MEMORY_DIR: declared, not swept, not a finding
  assert.equal(r.findings.length, 2); // over-budget + missing
  assert.equal(r.rows[1].overBy, 1);
  assert.equal(r.verdict, "findings");
});

test("classifyMemoryIndexSizes: zero measured agents is nothing-swept, not clean", () => {
  assert.equal(classifyMemoryIndexSizes({ rows: [] }).verdict, "nothing-swept");
  assert.equal(classifyMemoryIndexSizes({}).verdict, "nothing-swept");
  assert.equal(
    classifyMemoryIndexSizes({ rows: [{ agent: "solo", dirExists: false }] }).verdict,
    "nothing-swept",
  );
  // ...but findings DOMINATE: a one-agent fleet whose index is missing has zero
  // measured agents, and "nothing-swept" would bury the loudest instance of the
  // failure this classifier exists to catch.
  assert.equal(classifyMemoryIndexSizes({ rows: [{ agent: "solo", bytes: null }] }).verdict, "findings");
});

// The Codex adversarial round on PR #2. Each case below reproduced against the
// first version of this port; the numbers in the comments are what it returned.
test("extractToolReferences keeps Windows separators and never sheds a URI scheme", () => {
  // Was: `scripts\foo.py` → `foo.py`. A resolver handed the basename can
  // "prove" absent a file that exists — the extractor inventing a token.
  assert.deepEqual(extractToolReferences(String.raw`run scripts\foo.py nightly`), [
    { token: String.raw`scripts\foo.py`, line: 1 },
  ]);
  // Was: `file:bar.py` → `bar.py`, contradicting the "URLs excluded" comment.
  assert.deepEqual(extractToolReferences("see file:bar.py or mailto:baz.sh"), []);
  // Backticks and link parens are fine delimiters; a placeholder is not a token.
  assert.deepEqual(extractToolReferences("- run `scripts/a.mjs` then [b](tools/b.ts) via <name>.sh"), [
    { token: "scripts/a.mjs", line: 1 },
    { token: "tools/b.ts", line: 1 },
  ]);
});

test("extractToolReferences is linear on a long line with no match", () => {
  // Was quadratic: 30,000 hyphens took 2.5 s — on an input the size of the
  // index budget this library exists to police. 50,000 is ~5 s unfixed; the
  // 200 ms bound leaves a 25x margin for a slow CI runner.
  const t = Date.now();
  assert.deepEqual(extractToolReferences("-".repeat(50_000)), []);
  assert.ok(Date.now() - t < 200, `took ${Date.now() - t} ms`);
});

test("an async toolResolver throws instead of silently disabling the check", () => {
  // Was: 0 findings, no error — a check that looked enabled and could not fire.
  assert.throws(
    () => lintMemoryIntegrity({ indexText: "run scripts/ghost.mjs", files: FILES, toolResolver: async () => false }),
    TypeError,
  );
});

test("classifyMemoryIndexSizes: an impossible byte count is unmeasured, zero is measured", () => {
  // Was: -1 → OK with 24,401 bytes of headroom; 1.5 and NaN → OK / clean.
  const r = classifyMemoryIndexSizes({
    rows: [
      { agent: "neg", bytes: -1 },
      { agent: "frac", bytes: 1.5 },
      { agent: "nan", bytes: NaN },
      { agent: "empty", bytes: 0 },
    ],
  });
  assert.deepEqual(r.rows.map((x) => x.state), [
    MEMORY_SIZE_STATES.MISSING,
    MEMORY_SIZE_STATES.MISSING,
    MEMORY_SIZE_STATES.MISSING,
    MEMORY_SIZE_STATES.OK,
  ]);
  assert.equal(r.sweptCount, 1);
  assert.equal(r.verdict, "findings");
});

test("classifyMemoryIndexSizes: a measurement beats a contradicting dirExists:false", () => {
  // Was: the row went NO_MEMORY_DIR, bytes → null, an over-budget index hidden.
  const r = classifyMemoryIndexSizes({ rows: [{ agent: "hidden", dirExists: false, bytes: 24_401 }] });
  assert.equal(r.rows[0].state, MEMORY_SIZE_STATES.OVER);
  assert.equal(r.verdict, "findings");
});

test("classifyMemoryIndexSizes: rows with no identity are malformed, not measured and not findings", () => {
  // Was: a duplicate agent counted twice (sweptCount 2); an empty name became a
  // clean "(unnamed agent)"; a null row manufactured a MISSING finding whose
  // message asserted a dir exists — about a row nothing is known about.
  const r = classifyMemoryIndexSizes({
    rows: [{ agent: "a", bytes: 1 }, { agent: "a", bytes: 2 }, { agent: "", bytes: 5 }, null, "str", { bytes: 7 }],
  });
  assert.equal(r.sweptCount, 1);
  assert.equal(r.malformedCount, 5);
  assert.equal(r.findings.length, 0);
  assert.equal(r.verdict, "clean");
  // All malformed → nothing swept, never clean.
  assert.equal(classifyMemoryIndexSizes({ rows: [null, { agent: "" }] }).verdict, "nothing-swept");
});
