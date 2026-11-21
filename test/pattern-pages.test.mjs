// Pattern pages (2026-11-21, item TM-1): patterns/<slug>.html is generated from patterns/<slug>.md by
// scripts/render-pattern-pages.mjs, never hand-edited, and carries the .md's words and nothing else.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PAGES, REPO, renderPage, renderBody, inline, linkTarget } from "../scripts/render-pattern-pages.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const md = (slug) => fs.readFileSync(path.join(root, "patterns", `${slug}.md`), "utf8");

// The words a reader reads, from each side, by code that shares nothing with the renderer.
export function mdWords(src) {
  return src.replace(/\r\n/g, "\n").split("\n")
    .filter((l) => !/^\|[\s|:-]+\|$/.test(l.trim()))
    .map((l) => /^#{1,3} /.test(l) ? l.replace(/^#{1,3} /, "") : l.replace(/^- /, "").replace(/^\d+\. /, "").replace(/\|/g, " "))
    .join(" ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*`]/g, "")
    .split(/\s+/).filter(Boolean);
}
export function htmlWords(html) {
  const body = html.slice(html.indexOf("<main>"), html.indexOf("</main>"));
  return body.replace(/<p class="meta">[\s\S]*?<\/p>/, " ")
    .replace(/<\/?(a|strong|em|code)\b[^>]*>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
    .split(/\s+/).filter(Boolean);
}

test("every page in PAGES is generated from its .md and up to date", () => {
  for (const slug of PAGES) {
    const page = path.join(root, "patterns", `${slug}.html`);
    assert.ok(fs.existsSync(page), `patterns/${slug}.html exists`);
    assert.equal(fs.readFileSync(page, "utf8").replace(/\r\n/g, "\n"), renderPage(md(slug), slug),
      `patterns/${slug}.html is stale or hand-edited: re-run scripts/render-pattern-pages.mjs`);
  }
});

test("each page carries the .md's words word for word, in order, and no others", () => {
  for (const slug of PAGES) {
    assert.deepEqual(htmlWords(renderPage(md(slug), slug)), mdWords(md(slug)), `patterns/${slug}`);
  }
});

test("the page title is the file's own H1", () => {
  for (const slug of PAGES) {
    const h1 = md(slug).split("\n")[0].replace(/^# /, "").trim();
    const html = renderPage(md(slug), slug);
    assert.ok(html.includes(`<title>${h1.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}</title>`), `${slug} title`);
  }
});

test("relative links go to a served page or to the file on github.com", () => {
  assert.equal(linkTarget("../lib/shadow-screen.mjs"), REPO + "lib/shadow-screen.mjs");
  assert.equal(linkTarget("./checks-that-cant-fail.md"), REPO + "patterns/checks-that-cant-fail.md");
  assert.equal(linkTarget("../LIMITS.md#capability-grant"), REPO + "LIMITS.md#capability-grant");
  assert.equal(linkTarget("./fail-soft-detectors.md"), "./fail-soft-detectors.html");
  assert.equal(linkTarget("https://example.com/x"), "https://example.com/x");
  assert.throws(() => linkTarget("../../outside.md"), /leaves the repo/);
});

test("every link target on the pages resolves to a file in this repo or an absolute URL", () => {
  for (const slug of PAGES) {
    for (const [, href] of renderPage(md(slug), slug).matchAll(/<a href="([^"]+)"/g)) {
      if (href === "../" || /^https?:\/\//.test(href) && !href.startsWith(REPO)) continue;
      const rel = href.startsWith(REPO) ? href.slice(REPO.length).split("#")[0] : path.posix.join("patterns", href.split("#")[0]);
      assert.ok(fs.existsSync(path.join(root, rel)), `${slug}: link target ${rel} exists`);
    }
  }
});

test("FAIL-CLOSED: unsupported Markdown is refused with its line number, never approximated", () => {
  for (const bad of ["# T\n\n```\ncode\n```", "# T\n\n> quote", "# T\n\n- a\n  - nested", "# T\n\n<div>x</div>", "# T\n\n![alt](x.png)", "# T\n\nan `open code span",
    "# T\n\n#### deep", "# T\n\n- ", "# T\n\n1. ", "# T\n\n- a\n- ", "# T\n\nprose\n+ item", "# T\n\n7. seven", "# T\n\n[guide](https://example.com/a(b)c)",
    "# T\n\n[x](#limits)", "# T\n\n[x](./shadow-screen-states.md#the-helper)", "# **Bold title**"]) {
    assert.throws(() => renderBody(bad, "t.md"), /t\.md:\d+:/, JSON.stringify(bad));
  }
  assert.throws(() => renderBody("no heading here", "t.md"), /no H1/);
  assert.throws(() => renderBody("# A\n\n# B", "t.md"), /second H1/);
});

test("inline formatting escapes HTML-significant characters in text and code", () => {
  assert.equal(inline("a & b"), "a &amp; b");
  assert.equal(inline("`x < y`"), "<code>x &lt; y</code>");
  assert.equal(inline("**bold** and *it*"), "<strong>bold</strong> and <em>it</em>");
});

test("LIMIT: underscore emphasis is printed as written, not as emphasis", () => {
  assert.equal(inline("_not emphasis_"), "_not emphasis_");
});

test("LIMIT: only the three patterns with tested code in lib/ get a page", () => {
  assert.deepEqual(PAGES, ["fail-soft-detectors", "shadow-screen-states", "durability-tiered-write-governance"]);
});
