#!/usr/bin/env node
// build-design-variants — writes the site's two layout stylesheets under design/.
//
// Design pass 2026-11-17: layout C ("the register") for the front page and the matching
// card layout. Each file restyles ONE page type on top of that page's own inline <style>.
// A page uses it only if a <link rel="stylesheet"> names it; at this commit the front page
// and the twelve cards (written by scripts/render-decides-card.mjs) link their stylesheet
// immediately after their inline style. Rolling back is deleting that line.
// The two layouts not picked (A and B) are not part of this site.
//
// The stylesheets add no words. Seat marks are background images on empty pseudo-elements,
// drawn from the seat counts index.html already prints ("171 seats …"), so a count that
// changes on the page changes the drawing on the next build, and --check goes red until then.
//
// Failure posture: fail-closed on its inputs, as far as the stated rules below reach. It
// rejects unequal totals of literal `<div class="facts">N seats` matches and parsed
// `<div class="map">` entries, a parsed entry with no matching facts line, a missing font
// file, and font bytes lacking the WOFF2 signature and length field, each with exit 1 before
// any file is written. An entry whose map AND facts lines are both spelled another way is in
// neither total, so it is skipped, not refused (a LIMIT test says so). The font is not parsed: a file
// that is well formed on those two points but not a usable font would still be embedded,
// and shows up only as the fallback face in a frame. (A write that fails part way, say a
// full disk, can leave one file new and one old; --check then reports it.)
//
// Usage: node scripts/build-design-variants.mjs [--check]
//   exit 0 written / up to date · 1 failed or (with --check) a file differs · 2 usage
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "design");
const FONT = path.join(OUT, "bitter-700-latin.woff2.b64.txt");

// Seat counts, in page order, read from the front page's own "facts" lines.
// The rule: a map entry is written exactly `<div class="map">` on its own line, closed by a
// `</div>` on its own line, and holds one `<div class="facts">N seats` line. The reader does
// not try to recognise any other spelling. Instead it counts the "N seats" facts lines on the
// whole page separately; if that count differs from the entries it parsed, some entry is
// spelled another way, and the build refuses rather than shift strips onto the wrong rows.
export function seatCounts(html) {
  const text = html.replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->/g, "");
  const cards = [...text.matchAll(/<div class="map">\n([\s\S]*?)\n<\/div>/g)].map((m) => m[1]);
  const factsLines = [...text.matchAll(/<div class="facts">\d+ seats\b/g)].length;
  if (factsLines !== cards.length) throw new Error(`index.html has ${factsLines} "<N> seats" facts lines but ${cards.length} map entries written as <div class="map">; write every entry that way`);
  return cards.map((c, i) => {
    const facts = c.match(/<div class="facts">(\d+) seats\b/);
    if (!facts) throw new Error(`map entry ${i + 1} on index.html has no "<N> seats" facts line`);
    return Number(facts[1]);
  });
}

const enc = (svg) => `url("data:image/svg+xml,${svg.replace(/#/g, "%23").replace(/</g, "%3C").replace(/>/g, "%3E").replace(/"/g, "'")}")`;

// One block of n marks, `cols` wide, filled in reading order. Returns {w, h, body}.
function block(n, cols, pitch, mark, id) {
  const full = Math.floor(n / cols), rem = n % cols;
  const h = (full + (rem ? 1 : 0)) * pitch, w = cols * pitch;
  const body = `<rect width="${w}" height="${full * pitch}" fill="url(#${id})"/>` + (rem ? `<rect y="${full * pitch}" width="${rem * pitch}" height="${pitch}" fill="url(#${id})"/>` : "");
  return { w, h, body };
}
const pattern = (id, pitch, mark, fill) => `<pattern id="${id}" width="${pitch}" height="${pitch}" patternUnits="userSpaceOnUse"><rect width="${mark}" height="${mark}" fill="${fill}"/></pattern>`;

function strip(n, cols, pitch, mark, fill) {
  const b = block(n, cols, pitch, mark, "s");
  return { w: b.w, h: b.h, url: enc(`<svg xmlns="http://www.w3.org/2000/svg" width="${b.w}" height="${b.h}"><defs>${pattern("s", pitch, mark, fill)}</defs>${b.body}</svg>`) };
}

const LIGHT = "--bg:#ffffff;--fg:#141c20;--muted:#52616a;--line:#cfd8dc;--card:#ffffff;--code:#e8eef0;--link:#2f6f8f;";
const DARK = "--bg:#11171a;--fg:#e6ecee;--muted:#9aa8af;--line:#2b363b;--card:#182024;--code:#202a2f;--link:#6fb3d4;";
const INK_LIGHT = "#141c20", INK_DARK = "#e6ecee";

function base(fontB64) {
  return `@font-face{font-family:"Bitter";font-weight:700;font-style:normal;font-display:block;src:url(data:font/woff2;base64,${fontB64}) format("woff2")}
:root{${LIGHT}--display:"Bitter",Rockwell,"Roboto Slab",Georgia,serif}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${DARK}}}
:root[data-theme="dark"]{${DARK}}
code,pre,.map{border-radius:0}
a{text-underline-offset:2px}
:focus-visible{outline:2px solid var(--link);outline-offset:2px}
h2{font-family:var(--display);font-weight:700;font-size:1.35rem;border-top:2px solid var(--fg);padding-top:12px;margin:56px 0 12px}
.map{background:none;border:0;border-top:1px solid var(--line);margin:0}
.map:hover,.map:focus-within{border-color:var(--line);box-shadow:0 1px 0 0 var(--line)}
.map .name{font-family:var(--display);font-weight:700;color:var(--fg);text-decoration-color:var(--link)}
.map .facts::before{content:"";display:block;background-repeat:no-repeat;background-position:0 0;margin:0 0 8px}
@media (prefers-reduced-motion: no-preference){
  .map .facts::before{animation:taking-seats .48s steps(12,end) both}
  @keyframes taking-seats{from{clip-path:inset(0 0 100% 0)}to{clip-path:inset(0 0 0 0)}}
}
`;
}

// Per-entry strips: light ink by default, light-on-dark in the dark scheme.
function strips(counts, cols, pitch, mark) {
  const rule = (ink) => counts.map((n, i) => {
    const s = strip(n, cols, pitch, mark, ink);
    return `.map:nth-of-type(${i + 1}) .facts::before{width:${s.w}px;max-width:100%;height:${s.h}px;background-image:${s.url}}`;
  }).join("\n");
  return `${rule(INK_LIGHT)}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) ${rule(INK_DARK).split("\n").join("\n:root:not([data-theme=\"light\"]) ")}}
${rule(INK_DARK).split("\n").map((l) => `:root[data-theme="dark"] ${l}`).join("\n")}
`;
}

const HERO = "main>h1,main>.lede,main>.lede+p,main>.lede+p+p";

// C: the register. The list of systems is the first screen; the introduction is a side column.
function planC(counts) {
  return `/* plan-c: the register */
main{max-width:1240px;padding:0 24px 88px;display:flow-root}
main>h1{font:700 .95rem/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;margin:24px 0 12px}
main>.lede{font:700 1.75rem/1.15 var(--display);text-wrap:balance;margin:0 0 16px}
main>h2{font-size:1.2rem}
.map{display:grid;grid-template-columns:150px minmax(0,1fr) 196px;column-gap:20px;padding:12px 0 14px}
.map .name{font-size:1.2rem;line-height:1.2;align-self:start}
.map .finding{margin:0}
.map .facts{margin:0;font-size:.88rem}
@media (min-width:901px){
  main>*,main>.map{margin-left:356px}
  ${HERO}{float:left;clear:left;width:300px;margin-left:0}
  main>h1{border-top:2px solid var(--fg);padding-top:12px}
  main>h1+.lede+p+p+h2{margin-top:24px}
}
@media (max-width:900px){
  main{padding:0 16px 88px}
  .map{display:block}
  .map .name{display:inline-block;margin-bottom:4px}
  .map .facts{margin-top:8px}
}
${strips(counts, 28, 7, 5)}`;
}

// The short card. Holders are told apart by the SHAPE of a mark; only "a person" takes the accent.
function card() {
  return `/* card: the key to the plan */
main{max-width:720px;padding:0 16px 88px}
h1{font:700 clamp(1.9rem,4.6vw,2.6rem)/1.1 var(--display);margin:16px 0 16px}
.summary{font-size:1.15rem;line-height:1.5}
main p{max-width:64ch}
.j,.p{background:none;border:0;border-top:1px solid var(--line);border-radius:0;padding:16px 0 12px;margin:0}
.q{font-weight:700;font-size:1.05rem}
.p h3{font-family:var(--display);font-size:1.15rem}
.holder,.holder-model,.holder-code,.holder-human,.holder-nobody{color:var(--fg);border:0;border-radius:0;padding:0;margin-right:6px;font-weight:700;font-size:.85rem}
.holder::before{content:"";display:inline-block;width:10px;height:10px;margin-right:6px;box-sizing:border-box;border:2px solid var(--fg);vertical-align:-1px}
.holder-code::before{background:var(--fg)}
.holder-human::before{background:var(--link);border-color:var(--link)}
.holder-nobody::before{border-style:dashed}
.full{border-radius:0;background:var(--link);color:var(--bg);border-color:var(--link)}
`;
}

export function build() {
  const counts = seatCounts(fs.readFileSync(path.join(root, "index.html"), "utf8"));
  if (counts.length === 0) throw new Error("index.html has no map entries");
  const fontB64 = fs.readFileSync(FONT, "utf8").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+=*$/.test(fontB64) || fontB64.length < 1000) throw new Error(`${FONT} is not base64 font data`);
  const bytes = Buffer.from(fontB64, "base64");
  // A WOFF2 file starts with the signature "wOF2" and records its own total length at byte 8.
  // Only those two points are checked (see the failure posture above).
  if (bytes.subarray(0, 4).toString("latin1") !== "wOF2" || bytes.readUInt32BE(8) !== bytes.length) throw new Error(`${FONT} does not decode to a WOFF2 font`);
  const b = base(fontB64);
  return {
    "plan-c.css": b + planC(counts),
    "card.css": b + card(),
  };
}

function main(argv) {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--check")) {
    process.stderr.write("usage: build-design-variants.mjs [--check]\n");
    return 2;
  }
  let files;
  try { files = build(); } catch (e) { process.stderr.write(`${e.message}\n`); return 1; }
  let differs = 0;
  for (const [name, css] of Object.entries(files)) {
    const out = path.join(OUT, name);
    if (argv[0] === "--check") {
      const same = fs.existsSync(out) && fs.readFileSync(out, "utf8").replace(/\r\n/g, "\n") === css;
      process.stdout.write(`${same ? "up to date" : "differs from its build"}: design/${name}\n`);
      if (!same) differs++;
    } else {
      fs.writeFileSync(out, css);
      process.stdout.write(`wrote design/${name} (${css.length} chars)\n`);
    }
  }
  return differs ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
