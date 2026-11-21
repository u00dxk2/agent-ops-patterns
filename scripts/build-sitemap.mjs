// build-sitemap.mjs — writes sitemap.xml for the GitHub Pages site (2026-11-21, search day, item TM-1).
//
//   node scripts/build-sitemap.mjs            write sitemap.xml at the repo root
//   node scripts/build-sitemap.mjs --check    exit 1 if sitemap.xml differs from what it would write
//
// Failure posture: FAIL-CLOSED. A shallow clone, an uncommitted .html change, any git error, a listed page
// with no history, a page missing on disk, a page carrying a noindex-shaped token anywhere, or a path that is
// not a plain URL path stops the run with a message and exit 1; nothing is written on a failed run.
//
// What it lists: every committed .html page the site serves, minus EXCLUDED (each with its reason).
// lastmod is the committer date (YYYY-MM-DD) of the newest commit that changed the page's READABLE TEXT:
// the body with <head>, comments, <script>, <style> and every tag removed, whitespace collapsed. So a commit
// that only adds a head tag or a stylesheet link (the canonical-tag commit, the design round) does not move
// lastmod; a commit that changes a word does.
//
// Limits, on purpose (pinned as LIMIT tests in test/site-floor.test.mjs):
// - It reads full git history and refuses a shallow clone (where the first visible commit would look like
//   the page's creation). CI checks out at depth 1, so the test checks the file's shape and URL set, never
//   its dates; --check is a local check.
// - A change to an href, an alt text or a title attribute is not "readable text" and does not move lastmod.
// - Markup that splits a word (alpha<span>bet</span>) reads as two words, so it moves lastmod.
// - History follows the path, not the content: a rename dates the page from the rename.
// - Whitespace is collapsed, so re-indenting a <pre> excerpt does not move lastmod.
// - It lists any committed page that passes the token rule; it does not judge whether a page is worth
//   indexing (an empty page with a correct canonical is listed).
// - The noindex rule reads the files only; an X-Robots-Tag HTTP header is outside it (Pages sends none).
// - lastmod is a date, not a time: two changes on one day read the same.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const SITE = "https://u00dxk2.github.io/agent-ops-patterns/";
// Served but not listed. Reason required.
export const EXCLUDED = new Map([
  ["gallery/openhands/edition-1/index.html",
    "superseded first edition of the OpenHands map; it keeps its own canonical, but the sitemap points crawlers at the current map"],
]);
// Served .html files that are NOT pages: vendor-issued files that must be served byte for byte, so they carry
// no canonical tag and are never listed. Each must match its stated content exactly (pinned by the test).
export const NOT_PAGES = new Map([
  ["google45610b69cae7202a.html", "google-site-verification: google45610b69cae7202a.html"],
]);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function urlFor(rel) {
  if (!/^[a-z0-9][a-z0-9/._-]*\.html$/.test(rel) || rel.includes("..")) throw new Error(`not a plain URL path: ${rel}`);
  if (rel === "index.html") return SITE;
  if (rel.endsWith("/index.html")) return SITE + rel.slice(0, -"index.html".length);
  return SITE + rel;
}

// Whole-file token rules, not HTML parsing (round 2 found a second class of head-parsing gaps, so the
// check claims less): a page that carries ANY of these tokens anywhere, in any tag, comment or script,
// is refused from the sitemap. A page whose text legitimately needs one goes in EXCLUDED with a reason.
export const NOINDEX_TOKENS = /noindex|googlebot|content\s*=\s*["']?none\b/i;
// Numeric character references are decoded first, so `no&#105;ndex` cannot hide the token (round 3).
const decodeNumeric = (s) => s
  .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d)));
export function isNoindex(html) {
  return NOINDEX_TOKENS.test(html) || NOINDEX_TOKENS.test(decodeNumeric(html));
}

export function readableText(html) {
  return html
    .replace(/\r\n/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<head[\s>][\s\S]*?<\/head>/i, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const git = (root, args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

export function servedPages(root = ROOT) {
  return git(root, ["ls-files", "*.html"]).split("\n").map((s) => s.replace(/\r$/, "")).filter((s) => s !== "" && !NOT_PAGES.has(s)).sort();
}

// --first-parent: dates follow main's own line, so a merge that brought a changed page in is dated at the
// merge, and a side branch's commits are never compared with each other.
export function lastReadableChange(root, rel) {
  const log = git(root, ["log", "--first-parent", "--format=%H %cs", "--", rel]).trim();
  if (!log) throw new Error(`no git history for ${rel}`);
  const versions = log.split("\n").map((l) => { const [sha, date] = l.split(" "); return { sha, date }; });
  // A commit that deleted the path has no blob there: its text is null (absent), never a git error.
  const exists = (sha) => git(root, ["ls-tree", "--name-only", sha, "--", rel]).trim() === rel;
  const textAt = (sha) => (exists(sha) ? readableText(git(root, ["show", `${sha}:${rel}`])) : null);
  for (let i = 0; i < versions.length; i++) {
    const now = textAt(versions[i].sha);
    if (now === null) continue;
    const before = i + 1 < versions.length ? textAt(versions[i + 1].sha) : null;
    if (now !== before) return versions[i].date;
  }
  throw new Error(`could not date ${rel}`);
}

const xmlEsc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildSitemap(root = ROOT) {
  if (git(root, ["rev-parse", "--is-shallow-repository"]).trim() !== "false") {
    throw new Error("shallow clone: history is cut off, so lastmod cannot be derived (run in a full clone)");
  }
  // Dates come from commits, so a page edited on disk but not committed would be listed with its OLD date.
  const dirty = git(root, ["status", "--porcelain", "--", "*.html"]).trim();
  if (dirty) throw new Error(`commit the page changes first; uncommitted: ${dirty.split("\n").join(", ")}`);
  const rows = [];
  for (const rel of servedPages(root)) {
    if (EXCLUDED.has(rel)) continue;
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) throw new Error(`listed page missing on disk: ${rel}`);
    if (isNoindex(fs.readFileSync(file, "utf8"))) throw new Error(`${rel} is marked noindex: add it to EXCLUDED with a reason, or drop the noindex`);
    rows.push(`  <url><loc>${xmlEsc(urlFor(rel))}</loc><lastmod>${lastReadableChange(root, rel)}</lastmod></url>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</urlset>\n`;
}

function main(argv) {
  const check = argv.includes("--check");
  let xml;
  try { xml = buildSitemap(); } catch (e) { process.stderr.write(`build-sitemap: ${e.message}\n`); return 1; }
  const out = path.join(ROOT, "sitemap.xml");
  if (check) {
    const same = fs.existsSync(out) && fs.readFileSync(out, "utf8").replace(/\r\n/g, "\n") === xml;
    process.stdout.write(same ? "sitemap.xml up to date\n" : "sitemap.xml differs from what build-sitemap.mjs would write\n");
    return same ? 0 : 1;
  }
  fs.writeFileSync(out, xml);
  process.stdout.write(`wrote sitemap.xml (${xml.split("<url>").length - 1} URLs)\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
