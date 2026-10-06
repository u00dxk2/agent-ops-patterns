import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// SELF-AUDIT.md tells a reader to "Copy the prompt below", and the README's
// paste prompt sends an agent to "its section \"The prompt\"". GitHub gives a
// fenced code block a copy button and gives a blockquote none, so the section
// holds the prompt as ONE fenced block. These tests pin that shape and the one
// line the prompt asks the agent to print exactly as written.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8").replace(/\r\n/g, "\n");
const audit = read("SELF-AUDIT.md");
const readme = read("README.md");

const HEADING = "\n## The prompt\n";
const SCORE_LINE =
  "  `To report this score - verdicts only, no output, file paths or config: https://github.com/u00dxk2/agent-ops-patterns/issues/new?template=ran-the-audit.yml`";

// Every way the section can fail to be one copyable block, as a list of reasons.
function shapeProblems(text) {
  const start = text.indexOf(HEADING);
  if (start < 0) return ["no \"## The prompt\" section"];
  const next = text.indexOf("\n## ", start + 1);
  const section = text.slice(start + HEADING.length, next < 0 ? undefined : next);
  const problems = [];
  if (/^>/m.test(section)) problems.push("blockquote lines in the section (no copy button)");
  const open = section.indexOf("```text\n");
  if (open < 0) return [...problems, "no ```text block in the section"];
  const close = section.indexOf("\n```\n", open);
  if (close < 0) return [...problems, "the block does not close inside the section"];
  const body = section.slice(open + "```text\n".length, close);
  // Only newlines before the opener: an indented ``` line is indented code, not a fence.
  if (!/^\n*$/.test(section.slice(0, open))) problems.push("prose or indentation before the block");
  // An early close (a ``` line inside the prompt) leaves prompt text after the block.
  if (!/^\s*(---\s*)?$/.test(section.slice(close + "\n```\n".length))) problems.push("text after the block");
  if (/^\s*(```|~~~)/m.test(body)) problems.push("a fence marker inside the prompt");
  // A whole line, at its list-item indent, so an appended word is a change too.
  if (!body.split("\n").includes(SCORE_LINE)) problems.push("score-report line changed or outside the block");
  return problems;
}

describe("SELF-AUDIT prompt block", () => {
  it("is one fenced block holding the score-report line byte for byte", () => {
    assert.deepEqual(shapeProblems(audit), []);
  });

  it("is the section the README paste prompt names", () => {
    assert.match(readme, /its section "The prompt"/);
  });

  it("refuses the blockquote form it replaced", () => {
    const quoted = audit.replace(/```text\n([\s\S]*?)\n```\n/, (_, body) =>
      body.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n") + "\n");
    assert.notEqual(quoted, audit);
    assert.ok(shapeProblems(quoted).length > 0);
  });

  it("refuses a block that a ``` line inside the prompt would close early", () => {
    const broken = audit.replace("\n**Question 1", "\n```\n**Question 1");
    assert.notEqual(broken, audit);
    assert.ok(shapeProblems(broken).length > 0);
  });

  it("refuses an indented opener (Markdown reads it as indented code, not a fence)", () => {
    const indented = audit.replace("\n```text\n", "\n    ```text\n");
    assert.notEqual(indented, audit);
    assert.ok(shapeProblems(indented).length > 0);
  });

  it("refuses a score-report line with anything appended", () => {
    const changed = audit.replace("ran-the-audit.yml`", "ran-the-audit.yml` CHANGED");
    assert.notEqual(changed, audit);
    assert.ok(shapeProblems(changed).length > 0);
  });

  it("LIMIT: does not pin the prompt's wording — a reworded sentence still passes", () => {
    const reworded = audit.replace("Run the five-question", "Please run the five-question");
    assert.notEqual(reworded, audit, "the opening sentence moved; update this LIMIT");
    assert.deepEqual(shapeProblems(reworded), []);
  });
});
