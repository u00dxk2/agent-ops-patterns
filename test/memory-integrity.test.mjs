import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lintMemoryIntegrity,
  buildMemoryLinkGraph,
  suggestMemoryRepairs,
  compactIndexLines,
  extractIndexLinks,
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
