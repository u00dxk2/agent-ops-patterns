// Tests for skills/cog-ops-map.
//
// Two wiring rules, stated so that anything the checker does not understand
// is refused rather than passed:
//   1. Frontmatter: a block opened by `---` and closed by a line that is
//      exactly `---`, holding exactly `name:` then `description:`, each a
//      plain one-line scalar (no YAML flow collection or block indicator).
//   2. References: ANY text in SKILL.md that starts `references/` — in a link,
//      a titled link, a reference definition, backticks or bare prose, with or
//      without a leading ./ — must name a regular file that exists (a
//      `#fragment` and trailing punctuation or emphasis markers are cut off
//      first). And every file under references/ must be named that way outside
//      an HTML comment (an unclosed one hides the rest of the file), where a
//      rendered-Markdown reader can see it. Whitespace, a quote or an angle
//      bracket ends a token, so reference filenames must not contain them: see
//      the LIMIT test.
// Rule 2 deliberately does not parse Markdown link syntax. An earlier version
// matched link shapes, and two review rounds each found a shape it missed; a
// token rule cannot miss a link form because it does not look at one.
//
// Where this stops: it checks that the files are wired together, not that
// what they say is true. Local .md paths outside references/ are not checked,
// because SKILL.md has none; add them here if it grows one.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.join(here, "..", "skills", "cog-ops-map");
const refDir = path.join(skillDir, "references");
const read = (p) => fs.readFileSync(p, "utf8");

export function frontmatterProblems(md) {
  const fm = md.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) return ["frontmatter block missing or not closed by a line that is exactly ---"];
  const problems = [];
  const lines = fm[1].split("\n");
  const keys = lines.map((l) => l.match(/^([a-z-]+): (\S.*)$/)?.[1] ?? null);
  if (!keys.every(Boolean)) problems.push(`every frontmatter line must be "key: value" on one line; got ${JSON.stringify(lines)}`);
  if (JSON.stringify(keys) !== JSON.stringify(["name", "description"])) problems.push("keys must be exactly name, description in that order");
  for (const l of lines) {
    const v = l.replace(/^[a-z-]+: /, "");
    if (/^[\[{|>&*!%@`"']/.test(v)) problems.push(`value must be a plain scalar: ${l.slice(0, 60)}`);
  }
  if (!/^name: cog-ops-map$/m.test(fm[1])) problems.push("name must be cog-ops-map");
  if (!/^description: .{40,}$/m.test(fm[1])) problems.push("description must be at least 40 characters");
  return problems;
}

// Every `references/...` token in the text, fragment and trailing punctuation cut off.
export function referenceTokens(md, { visibleOnly = false } = {}) {
  // An unclosed <!-- hides everything after it from a reader, so it hides it here too.
  const text = visibleOnly ? md.replace(/<!--[\s\S]*?(-->|$)/g, "") : md;
  const out = new Set();
  for (const m of text.matchAll(/(?<![A-Za-z0-9_-])(?:\.\/)?references\/[^\s)`"'<>\]]+/g)) {
    out.add(m[0].replace(/^\.\//, "").split("#")[0].replace(/[.,;:!?*_]+$/, ""));
  }
  return out;
}

const isFile = (p) => fs.existsSync(p) && fs.statSync(p).isFile();

test("SKILL.md frontmatter has exactly name and description, one plain scalar per line", () => {
  assert.deepEqual(frontmatterProblems(read(path.join(skillDir, "SKILL.md"))), []);
});

test("every references/ path SKILL.md mentions exists, and every references/ file is mentioned where a reader can see it", () => {
  const md = read(path.join(skillDir, "SKILL.md"));
  const all = referenceTokens(md);
  assert.ok(all.size >= 1, "SKILL.md names no references/ file");
  for (const f of all) assert.ok(isFile(path.join(skillDir, f)), `SKILL.md names ${f} but no such file exists`);
  const visible = referenceTokens(md, { visibleOnly: true });
  const walk = (dir, prefix = "") =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
    );
  for (const f of walk(refDir)) {
    assert.ok(visible.has(`references/${f}`), `references/${f} exists but SKILL.md never names it outside a comment`);
  }
});

test("the checkers catch every shape review reproduced as passing", () => {
  const good = "---\nname: cog-ops-map\ndescription: " + "x".repeat(50) + "\n---\n# body\n";
  assert.deepEqual(frontmatterProblems(good), []);
  assert.notDeepEqual(frontmatterProblems(good.replace("\n---\n# body", "\n---oops\n# body")), []);
  assert.notDeepEqual(frontmatterProblems(good.replace("x".repeat(50), "[a collection holding a long string value here]")), []);
  const sample = [
    "[a](references/frag.md#part)",
    "`references/nested/deep.md`",
    '[t](references/titled.md "Title")',
    "[ref]: references/refdef.md",
    "`references/dotted.v2.md`",
    "`references/backfrag.md#definitions`",
    "see references/prose.md.",
    "<!-- `references/hidden.md` -->",
  ].join("\n");
  const all = referenceTokens(sample);
  for (const f of ["frag", "nested/deep", "titled", "refdef", "dotted.v2", "backfrag", "prose", "hidden"]) {
    assert.ok(all.has(`references/${f}.md`), `must catch references/${f}.md`);
  }
  const visible = referenceTokens(sample, { visibleOnly: true });
  assert.ok(!visible.has("references/hidden.md"), "a path inside an HTML comment is not visible to a reader");
  assert.ok(visible.has("references/titled.md"), "a titled link is visible");
  // Round-3 repros.
  assert.ok(referenceTokens("[x](./references/dotslash.md)").has("references/dotslash.md"), "./references/ is still references/");
  assert.ok(referenceTokens("Read **references/bold.md**.").has("references/bold.md"), "bold markers are not part of the path");
  assert.equal(referenceTokens("<!-- never closed\n`references/after.md`", { visibleOnly: true }).size, 0, "an unclosed comment hides the rest of the file");
  assert.ok(!isFile(refDir), "a directory is not a file");
});

test("LIMIT: whitespace, a quote or an angle bracket ends the token, so a filename containing one is read short", () => {
  // Reference filenames containing any of these are not supported: the token stops there, and
  // the shorter name is what gets checked. Both cases below read as references/framework.md,
  // which exists. Pinned so that supporting such names is a visible change, not a silent one.
  assert.ok(referenceTokens("[x](<references/framework.md'missing>)").has("references/framework.md"));
  assert.ok(referenceTokens("[x](<references/framework.md missing.md>)").has("references/framework.md"));
});
