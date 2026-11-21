// render-pattern-pages.mjs — serves chosen patterns/*.md as HTML pages on the GitHub Pages site
// (2026-11-21, search day, item TM-1). Without this the site serves each pattern as raw text/markdown.
//
//   node scripts/render-pattern-pages.mjs            write patterns/<slug>.html for each slug in PAGES
//   node scripts/render-pattern-pages.mjs --check    exit 1 if any page differs from its .md
//
// The words are the .md's words: no text is added, cut or reworded. The page title is the file's own H1,
// word for word. Links are rewritten only in their target: a relative link to a file the site does not
// serve as a page goes to that file on github.com.
//
// Failure posture: FAIL-CLOSED for a NAMED list only, not for Markdown in general. This is not a Markdown
// parser: it renders the subset the three committed files use (headings #-###, paragraphs, bulleted and
// numbered lists, one-level tables, **bold**, *italic*, `code`, [links](url)). It refuses, with the file and
// line number: ``` fences, > quotes, indented lines, HTML tags, images, #### headings, empty `- `/`1. ` items,
// `+ `/`* ` lines, numbered lists not starting at `1.`, link targets containing `(`, fragment links into a
// served page or `#` alone, and markup in the H1. Any OTHER construct (a setext heading, a ~~~ fence, a
// reference-link definition, `7)` numbering, table alignment) may print as plain text instead of being
// refused (four Codex rounds found such cases; the claim was narrowed rather than the parser grown).
// The real guard for what ships is test/pattern-pages.test.mjs: each committed page equals the render of
// its committed .md and carries the .md's words word for word. Every page is rendered before any is
// written, so a REFUSED source changes nothing; a write that fails part way can still leave earlier
// outputs changed.
//
// Limits, on purpose (pinned as LIMIT tests in test/pattern-pages.test.mjs):
// - Constructs outside the subset and outside the refusal list print as text (see above).
// - Underscore emphasis (_x_) is not emphasis here; it is printed as written.
// - Only the patterns named in PAGES get a page. The others stay on github.com.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SITE = "https://u00dxk2.github.io/agent-ops-patterns/";
export const REPO = "https://github.com/u00dxk2/agent-ops-patterns/blob/main/";
// Patterns that point at tested code in lib/. The other four wait until each carries its own evidence.
export const PAGES = ["fail-soft-detectors", "shadow-screen-states", "durability-tiered-write-governance"];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function linkTarget(href) {
  if (/^https?:\/\//.test(href)) return href;
  // The pages give headings no ids, so a fragment into a served page (or a fragment-only link) would land nowhere.
  if (href.startsWith("#")) throw new Error(`fragment-only link: ${href}`);
  const [file, hash] = href.split("#");
  const resolved = path.posix.normalize(path.posix.join("patterns", file));
  if (resolved.startsWith("..")) throw new Error(`link leaves the repo: ${href}`);
  const slug = resolved.startsWith("patterns/") && resolved.endsWith(".md") ? resolved.slice(9, -3) : null;
  if (slug && PAGES.includes(slug)) {
    if (hash) throw new Error(`fragment into a served pattern page: ${href}`);
    return `./${slug}.html`;
  }
  return REPO + resolved + (hash ? "#" + hash : "");
}

export function inline(src) {
  const codes = [];
  let s = src.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  if (s.includes("`")) throw new Error("unmatched backtick");
  if (/<[a-zA-Z/!]/.test(s)) throw new Error("raw HTML in text");
  if (/!\[/.test(s)) throw new Error("image");
  const links = [];
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, h) => {
    if (h.includes("(")) throw new Error(`link target with a parenthesis: ${h}`);
    links.push([t, h]); return `\u0001${links.length - 1}\u0001`;
  });
  if (/\]\(/.test(s)) throw new Error("link that did not parse");
  const fmt = (t) => esc(t)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\s][^*]*)\*/g, "<em>$1</em>");
  let out = fmt(s);
  out = out.replace(/\u0001(\d+)\u0001/g, (_, i) => `<a href="${esc(linkTarget(links[i][1]))}">${fmt(links[i][0]).replace(/\u0000(\d+)\u0000/g, (_, j) => `<code>${esc(codes[j])}</code>`)}</a>`);
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`);
  if (out.includes("*")) throw new Error("unmatched emphasis marker");
  return out;
}

const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function renderBody(md, name = "input") {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let h1 = null;
  let i = 0;
  const fail = (msg) => { throw new Error(`${name}:${i + 1}: ${msg}`); };
  while (i < lines.length) {
    const line = lines[i];
    try {
      if (line.trim() === "") { i++; continue; }
      let m;
      if (/^#/.test(line) && !/^#{1,3} \S/.test(line)) fail("heading deeper than ### or without text");
      if ((m = line.match(/^(#{1,3}) (.+)$/))) {
        const level = m[1].length;
        if (level === 1) {
          if (h1 !== null) fail("second H1");
          if (/[*`\[\]]/.test(m[2])) fail("markup in the H1 (it becomes the page title as written)");
          h1 = m[2];
        }
        out.push(`<h${level}>${inline(m[2])}</h${level}>`);
        i++; continue;
      }
      if (/^- /.test(line) || /^\d+\. /.test(line)) {
        const ordered = /^\d+\. /.test(line);
        if (ordered && !/^1\. /.test(line)) fail("numbered list that does not start at 1");
        const re = ordered ? /^\d+\. (\S.*)$/ : /^- (\S.*)$/;
        if (!re.test(line)) fail("empty list item");
        const items = [];
        while (i < lines.length && re.test(lines[i])) { items.push(`<li>${inline(lines[i].match(re)[1])}</li>`); i++; }
        if (i < lines.length && /^(- |\d+\. )/.test(lines[i])) fail("empty or mixed list item");
        if (i < lines.length && /^\s+\S/.test(lines[i])) fail("nested or continued list item");
        out.push(`<${ordered ? "ol" : "ul"}>\n${items.join("\n")}\n</${ordered ? "ol" : "ul"}>`);
        continue;
      }
      if (line.startsWith("|")) {
        const head = cells(line);
        if (!/^\|[\s|:-]+\|$/.test((lines[i + 1] ?? "").trim())) fail("table without a separator row");
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].startsWith("|")) {
          const r = cells(lines[i]);
          if (r.length !== head.length) fail("table row has the wrong number of cells");
          rows.push(`<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`); i++;
        }
        out.push(`<table>\n<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>\n<tbody>\n${rows.join("\n")}\n</tbody>\n</table>`);
        continue;
      }
      if (/^(```|>|\s|<|!\[|\* |\+ )/.test(line)) fail("unsupported Markdown");
      const para = [];
      while (i < lines.length && lines[i].trim() !== "" && !/^(#|- |\d+\. |\||```|>)/.test(lines[i])) {
        if (/^\s/.test(lines[i])) fail("indented line");
        if (/^(\* |\+ |<|!\[)/.test(lines[i])) fail("unsupported Markdown inside a paragraph");
        para.push(lines[i]); i++;
      }
      if (para.length === 0) fail("line the renderer cannot place");
      out.push(`<p>${inline(para.join(" "))}</p>`);
    } catch (e) {
      if (e.message.startsWith(`${name}:`)) throw e;
      throw new Error(`${name}:${i + 1}: ${e.message}`);
    }
  }
  if (h1 === null) throw new Error(`${name}: no H1`);
  return { h1, body: out.join("\n") };
}

export function renderPage(md, slug) {
  const { h1, body } = renderBody(md, `patterns/${slug}.md`);
  const url = `${SITE}patterns/${slug}.html`;
  const title = esc(h1);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta property="og:type" content="article">
<meta property="og:site_name" content="agent-ops-patterns">
<meta property="og:title" content="${title}">
<meta property="og:url" content="${url}">
<link rel="canonical" href="${url}">
<style>
:root{--bg:#fbfaf7;--fg:#1d1d1b;--muted:#5d5b55;--line:#dedad0;--code:#f2efe8;--link:#2f6f8f}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#151513;--fg:#ebe8e0;--muted:#a8a498;--line:#34322d;--code:#262520;--link:#6fb3d4}}
:root[data-theme="dark"]{--bg:#151513;--fg:#ebe8e0;--muted:#a8a498;--line:#34322d;--code:#262520;--link:#6fb3d4}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.6 Georgia,"Times New Roman",serif}
main{max-width:72ch;margin:0 auto;padding:0 16px 80px}
h1{font-size:1.75rem;line-height:1.2;margin:24px 0 16px}
h2{font-size:1.3rem;margin:36px 0 10px;padding-top:10px;border-top:1px solid var(--line)}
h3{font-size:1.08rem;margin:24px 0 8px}
a{color:var(--link)}
code{background:var(--code);padding:1px 4px;border-radius:4px;font-size:.86em;overflow-wrap:anywhere}
table{border-collapse:collapse;display:block;overflow-x:auto;font-size:.95rem}
th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}
.meta{color:var(--muted);font:.92rem/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;margin:20px 0 0}
</style>
</head>
<body>
<main>
<p class="meta"><a href="../">agent-ops-patterns</a></p>
${body}
</main>
</body>
</html>
`;
}

function main(argv) {
  const check = argv.includes("--check");
  let bad = 0;
  // Render every page before writing any, so one refused source leaves every output untouched.
  const rendered = [];
  for (const slug of PAGES) {
    try { rendered.push([slug, renderPage(fs.readFileSync(path.join(ROOT, "patterns", `${slug}.md`), "utf8"), slug)]); }
    catch (e) { process.stderr.write(`render-pattern-pages: ${e.message}\n`); return 1; }
  }
  for (const [slug, html] of rendered) {
    const out = path.join(ROOT, "patterns", `${slug}.html`);
    if (check) {
      const same = fs.existsSync(out) && fs.readFileSync(out, "utf8").replace(/\r\n/g, "\n") === html;
      process.stdout.write(same ? `up to date: patterns/${slug}.html\n` : `differs from its .md: patterns/${slug}.html\n`);
      if (!same) bad++;
    } else {
      fs.writeFileSync(out, html);
      process.stdout.write(`wrote patterns/${slug}.html\n`);
    }
  }
  return bad ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
