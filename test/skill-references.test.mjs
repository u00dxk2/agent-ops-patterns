// Tests for skills/cs329a-self-improving-agents.
//
// A skill whose whole argument is "verify the citation" cannot ship a dead
// citation. Two layers:
//   1. Static (always runs): the SKILL.md frontmatter is well-formed; every
//      reference file SKILL.md names exists; every paper row in papers.md
//      carries exactly one https URL and no URL repeats; the disposition
//      template carries all ten idea rows; ideas.md has all ten headings.
//   2. Network (CHECK_LINKS=1 only — the CI `links` job sets it): every URL in
//      papers.md and lectures.md answers 2xx/3xx to a GET. Split out so an
//      arXiv outage reds one legible job, not the unit suite.
//
// Where this stops: a 200 proves the URL resolves, not that the page is the
// paper the row claims. That half was done by hand when papers.md was written
// (each URL loaded and matched to the title) and is re-done by whoever edits a row.

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

test("SKILL.md frontmatter has name and description", () => {
  const md = read(path.join(skillDir, "SKILL.md"));
  const fm = md.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(fm, "frontmatter block missing");
  assert.match(fm[1], /^name: cs329a-self-improving-agents$/m);
  assert.match(fm[1], /^description: .{40,}/m);
});

test("every reference file SKILL.md names exists", () => {
  const md = read(path.join(skillDir, "SKILL.md"));
  const named = [...md.matchAll(/`([a-z-]+\.md)`/g)].map((m) => m[1]).filter((f) => f !== "SKILL.md");
  assert.ok(named.length >= 5, `expected ≥5 named reference files, found ${named.length}`);
  for (const f of new Set(named)) {
    assert.ok(fs.existsSync(path.join(refDir, f)), `SKILL.md names references/${f} but it does not exist`);
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

test("ideas.md has the ten numbered ideas and the template has ten rows", () => {
  const ideas = read(path.join(refDir, "ideas.md"));
  for (let i = 1; i <= 10; i++) assert.match(ideas, new RegExp(`^## ${i}\\. `, "m"), `ideas.md missing heading ${i}`);
  const tpl = read(path.join(refDir, "disposition-template.md"));
  for (let i = 1; i <= 10; i++) assert.match(tpl, new RegExp(`^\\| ${i} \\|`, "m"), `template missing row ${i}`);
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
