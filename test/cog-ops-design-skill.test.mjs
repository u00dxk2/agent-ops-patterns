// Tests for skills/cog-ops-design.
//
// The skill's value is what it refuses and what it cites, and most of what it cites sits in other
// folders of this repository, so a move elsewhere would silently leave it pointing at nothing. Two
// rules: every relative link resolves to a file, and every section number or quoted line it leans on
// is still in the file it names.
//
// Where this stops: it checks that the citations resolve, not that the advice is right. Its URLs are
// not checked, and neither is the one hand-run it reports.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillDir = path.join(root, "skills", "cog-ops-design");
const md = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");

export function relativeLinks(text) {
  return [...text.matchAll(/\]\((\.\.?\/[^)\s#]+)(?:#[^)]*)?\)/g)].map((m) => m[1]);
}

export function brokenLinks(text, from) {
  return relativeLinks(text).filter((l) => {
    const p = path.resolve(from, l);
    return !(fs.existsSync(p) && fs.statSync(p).isFile());
  });
}

// [file, text that must still be there] for each thing the skill says that file says.
const CITED = [
  ["skills/cog-ops-map/SKILL.md", "A proposed seat without a control is a wish."],
  ["skills/cog-ops-map/SKILL.md", "## Phase 4.5"],
  ["skills/cog-ops-map/references/shared-schema.md", "## S3."],
  ["skills/cog-ops-map/references/shared-schema.md", "## S4."],
  ["skills/cog-ops-map/references/shared-schema.md", "## S5."],
  ["skills/cog-ops-map/references/framework.md", "3. **Human seats generating no training signal**"],
  ["skills/cs329a-self-improving-agents/references/ideas.md", "## 1. Coverage vs. selection"],
  ["skills/cs329a-self-improving-agents/references/ideas.md", "## 2. Filter verifiers"],
  ["skills/cs329a-self-improving-agents/references/ideas.md", "## 3. Meta-verification"],
  ["skills/cs329a-self-improving-agents/references/ideas.md", "## 8. Diversity"],
  ["skills/cs329a-self-improving-agents/SKILL.md", "**3. Pre-commit the bars.**"],
  ["skills/cs329a-self-improving-agents/SKILL.md", "## What the course argues against"],
  ["patterns/claims-are-hypotheses.md", "## 1. Check the change against the code it cites"],
  ["patterns/claims-are-hypotheses.md", "## 3. A remembered rule"],
  ["patterns/checks-that-cant-fail.md", "NOTHING SWEPT"],
  ["patterns/shadow-screen-states.md", "`unscreened`"],
];

const REFUSALS = [
  "no label record and no pre-committed bar",
  "an ensemble of judges with no labelled set",
  "a human seat with no stated reason",
  "an irreversible action with no human-direct gate",
  'a validator that is a log, an audit trail or "we will review it"',
  "a RULING seat with no control",
  "on-error posture is unstated",
  "outcome metric no seat produces",
];

describe("cog-ops-design skill", () => {
  it("has frontmatter with exactly name and description, one plain line each", () => {
    const fm = md.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(fm, "frontmatter block");
    const lines = fm[1].split("\n");
    assert.deepEqual(lines.map((l) => l.split(":")[0]), ["name", "description"]);
    assert.equal(lines[0], "name: cog-ops-design");
    assert.ok(lines[1].length > 100, "description is substantive");
    assert.ok(!/^description: [\[{|>&*!%@`"']/.test(lines[1]), "description is a plain scalar");
  });

  it("every relative link names a file that exists", () => {
    assert.ok(relativeLinks(md).length >= 8, "the skill still links its sources");
    assert.deepEqual(brokenLinks(md, skillDir), []);
  });

  it("everything it cites is still in the file it names", () => {
    for (const [file, text] of CITED) assert.ok(read(file).includes(text), `${file} no longer has: ${text}`);
  });

  it("keeps every refusal and states where it stops working", () => {
    for (const r of REFUSALS) assert.ok(md.includes(r), `refusal missing: ${r}`);
    assert.ok(md.includes("## Where this skill stops working"));
  });

  it("the link checker can go red", () => {
    assert.deepEqual(brokenLinks("[a](../no-such-file.md) [b](https://example.com/x.md)", skillDir), ["../no-such-file.md"]);
    assert.deepEqual(relativeLinks("[a](./x.md#part)"), ["./x.md"]);
  });
});
