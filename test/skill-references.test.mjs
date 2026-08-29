// Tests for skills/cs329a-self-improving-agents.
//
// A skill whose whole argument is "verify the citation" cannot ship a dead
// citation. Two layers:
//   1. Static (always runs): the SKILL.md frontmatter has exactly the two keys
//      the Agent Skills format needs, one per line; every local markdown file
//      SKILL.md references (backticked or linked) exists; every paper row in
//      papers.md carries exactly one https URL and no URL repeats; the
//      disposition template carries all twelve verdict rows and states the
//      count it sums to; ideas.md has all ten headings; the worked example -
//      an answer key for one real system - is first mentioned in SKILL.md only
//      AFTER the acting step, so no earlier instruction can send an agent to it.
//   2. Network (CHECK_LINKS=1 only — the CI `links` job sets it): every URL in
//      papers.md and lectures.md answers 2xx/3xx to a GET. Split out so an
//      arXiv outage reds one legible job, not the unit suite.
//
// Where this stops: a 200 proves the URL resolves, not that the page is the
// paper the row claims. That half was done by hand when papers.md was written
// (each URL loaded and matched to the title) and is re-done by whoever edits a
// row. The frontmatter check is a line-shape check, not a YAML parser; the
// format has two scalar keys and the check pins exactly those.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.join(here, "..", "skills", "cs329a-self-improving-agents");
const refDir = path.join(skillDir, "references");
const read = (p) => fs.readFileSync(p, "utf8");

const URL_RE = /https?:\/\/[^\s|)>\]]+/g;

function tableRows(md) {
  // Markdown table body rows: start with "|", not the header separator.
  return md
    .split("\n")
    .filter((l) => l.startsWith("|") && !/^\|\s*-+/.test(l) && !/^\|\s*(Part|#|File)\s*\|/.test(l));
}

test("SKILL.md frontmatter has exactly name and description, one scalar per line", () => {
  const md = read(path.join(skillDir, "SKILL.md"));
  const fm = md.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(fm, "frontmatter block missing");
  const lines = fm[1].split("\n");
  const keys = lines.map((l) => l.match(/^([a-z-]+): \S/)?.[1] ?? null);
  assert.ok(keys.every(Boolean), `every frontmatter line must be "key: value" on one line; got: ${JSON.stringify(lines)}`);
  assert.deepEqual(keys, ["name", "description"], "frontmatter keys must be exactly name, description in that order");
  assert.match(fm[1], /^name: cs329a-self-improving-agents$/m);
  assert.match(fm[1], /^description: .{40,}$/m);
});

test("every local markdown file SKILL.md references (backticked or linked) exists", () => {
  const md = read(path.join(skillDir, "SKILL.md"));
  const named = new Set();
  for (const m of md.matchAll(/`(?:\.\/)?(?:references\/)?((?:answer-keys\/)?[A-Za-z0-9_-]+\.md)`/g)) named.add(m[1]);
  for (const m of md.matchAll(/\]\((?:\.\/)?references\/((?:answer-keys\/)?[A-Za-z0-9_-]+\.md)\)/g)) named.add(m[1]);
  named.delete("SKILL.md");
  assert.ok(named.size >= 5, `expected ≥5 named reference files, found ${named.size}`);
  for (const f of named) {
    assert.ok(fs.existsSync(path.join(refDir, f)), `SKILL.md names references/${f} but it does not exist`);
  }
  // And the inverse: every file under references/ (answer-keys included) is
  // named somewhere in SKILL.md — an unnamed file is unreachable by a reader
  // following the skill, which is how a stale artifact hides.
  const walk = (dir, prefix = "") =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
    );
  for (const f of walk(refDir)) {
    assert.ok(named.has(f), `references/${f} exists but SKILL.md never names it`);
  }
});

test("papers.md: every row has exactly one https URL, none repeat", () => {
  const rows = tableRows(read(path.join(refDir, "papers.md")));
  assert.ok(rows.length >= 20, `expected ≥20 paper rows, found ${rows.length}`);
  const seen = new Map();
  for (const row of rows) {
    const urls = row.match(URL_RE) ?? [];
    assert.equal(urls.length, 1, `row has ${urls.length} URLs (want 1): ${row.slice(0, 80)}`);
    assert.match(urls[0], /^https:\/\//, `non-https URL: ${urls[0]}`);
    assert.ok(!seen.has(urls[0]), `duplicate URL ${urls[0]} (also in: ${seen.get(urls[0])?.slice(0, 60)})`);
    seen.set(urls[0], row);
  }
});

test("papers.md: no row is marked UNCONFIRMED", () => {
  const md = read(path.join(refDir, "papers.md"));
  assert.ok(!/UNCONFIRMED/.test(md), "papers.md still carries an UNCONFIRMED marker — resolve or drop the row");
});

test("ideas.md has the ten numbered ideas; the template has the twelve rows (5 and 9 split)", () => {
  const ideas = read(path.join(refDir, "ideas.md"));
  for (let i = 1; i <= 10; i++) assert.match(ideas, new RegExp(`^## ${i}\\. `, "m"), `ideas.md missing heading ${i}`);
  const tpl = read(path.join(refDir, "disposition-template.md"));
  const rows = ["1", "2", "3", "4", "5a", "5b", "6", "7", "8", "9a", "9b", "10"];
  for (const r of rows) assert.match(tpl, new RegExp(`^\\| ${r} \\|`, "m"), `template missing row ${r}`);
  assert.match(tpl, /must sum to 12/, "template summary must state the row count it sums to");
  for (const v of ["APPLIES", "DOES NOT APPLY", "ALREADY IN PLACE (code)", "ALREADY IN PLACE (running)", "NOT DECIDABLE", "UNREADABLE"]) {
    assert.ok(tpl.includes(`**${v}:**`), `template summary missing the ${v} count line`);
  }
});

test("SKILL.md first mentions each answer key only after the acting step; the folder carries its door sign", () => {
  const md = read(path.join(skillDir, "SKILL.md"));
  const body = md.replace(/^---\n[\s\S]*?\n---/, "");
  const actStep = body.indexOf("**5. Act only");
  assert.ok(actStep > 0, "step 5 heading not found");
  for (const key of ["worked-example.md", "worked-example-2.md"]) {
    const first = body.indexOf(key);
    assert.ok(first > actStep, `${key} is first mentioned at offset ${first}, before step 5 at ${actStep} — the answer key must be gated after the table is filled`);
    const gate = body.slice(Math.max(0, first - 160), first + 200);
    assert.match(gate, /Only now open/i, `the first mention of ${key} must be inside the gated instruction`);
    // The structural half of the gate: the key lives in the quarantined folder.
    assert.ok(
      fs.existsSync(path.join(refDir, "answer-keys", key)),
      `${key} must live under references/answer-keys/ — the prose gate alone failed on two runs in a row`,
    );
  }
  const door = read(path.join(refDir, "answer-keys", "README.md"));
  assert.match(door, /table is filled/i, "the answer-keys README must carry the do-not-open-early warning");
});

test("lectures.md lists nine YouTube links", () => {
  const md = read(path.join(refDir, "lectures.md"));
  const links = [...md.matchAll(/https:\/\/www\.youtube\.com\/watch\?v=[\w-]+/g)].map((m) => m[0]);
  assert.equal(new Set(links).size, 9, `expected 9 distinct lecture links, found ${new Set(links).size}`);
});

test(
  "every URL in papers.md and lectures.md resolves (CHECK_LINKS=1)",
  { skip: process.env.CHECK_LINKS !== "1" ? "set CHECK_LINKS=1 to run the network check" : false },
  async () => {
    const urls = new Set();
    for (const f of ["papers.md", "lectures.md"]) {
      for (const m of read(path.join(refDir, f)).matchAll(URL_RE)) urls.add(m[0]);
    }
    const failures = [];
    for (const url of urls) {
      try {
        const res = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(20000) });
        if (!(res.status >= 200 && res.status < 400)) failures.push(`${res.status} ${url}`);
      } catch (e) {
        failures.push(`${e?.name ?? "error"} ${url}`);
      }
    }
    assert.deepEqual(failures, [], `unresolved URLs:\n${failures.join("\n")}`);
  },
);
