import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, seatCounts, galleryOpening } from "../scripts/build-design-variants.mjs";

// The layout stylesheets under design/ (design pass 2026-11-17, layout C picked). A page uses
// one only if a <link rel="stylesheet"> names it. These tests compare source text: link tags read
// the way this repo writes them (the front page names plan-c.css right after its inline style,
// every card page names card.css there, no other page names either), the exact list of files in
// design/, the whole value of every `content` declaration the builder writes, and selected
// seat-count cases. They do not decode the drawn marks or parse the font; see the LIMIT tests.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");

function htmlPages(dir = root, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.name === "node_modules" || d.name.startsWith(".")) continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) htmlPages(p, out);
    else if (d.name.endsWith(".html")) out.push(p);
  }
  return out;
}

// Every design-folder stylesheet a page source names, in order.
// The rule: only a <link> element whose rel is stylesheet counts, and its href is what it links.
// Other mentions of a file name (text, comments, attributes of other elements) are not links.
const designLinks = (html) => [...html.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<link\b[^>]*>/gi)]
  .map((m) => m[0])
  .filter((tag) => /(?:^|\s)rel\s*=\s*["']?stylesheet\b/i.test(tag))
  .map((tag) => (tag.match(/(?:^|\s)href\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || "")
  .filter((href) => /(^|\/)design\//.test(href) || /plan-[abc]\.css/.test(href))
  .map((href) => href.replace(/^(\.\.?\/)+/, ""));
// CSS comments are removed first; the property name is matched in any case; the WHOLE value up
// to the next ";" or "}" is returned, so anything after an empty string is seen too.
const contentValues = (css) => [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/content\s*:\s*([^;}]*)/gi)].map((m) => m[1].trim());
const FRONT_LINK = '</style>\n<link rel="stylesheet" href="./design/plan-c.css">\n</head>';
const CARD_LINK = '</style>\n<link rel="stylesheet" href="../../design/card.css">\n</head>';
const GALLERY_LINK = '</style>\n<link rel="stylesheet" href="../design/gallery.css">\n</head>';

describe("design-pass stylesheets", () => {
  it("only the front page, the gallery page and the card pages link a layout, each exactly once, after the page's own style", () => {
    const pages = htmlPages();
    assert.ok(pages.length >= 14, `found ${pages.length} pages (if fewer, the walk stopped matching)`);
    let cards = 0;
    for (const p of pages) {
      const rel = path.relative(root, p).split(path.sep).join("/");
      const html = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
      const links = designLinks(html);
      if (rel === "index.html") {
        assert.deepEqual(links, ["design/plan-c.css"], "index.html links plan-c.css once");
        assert.ok(html.includes(FRONT_LINK), "index.html: the link sits right after </style>, before </head>");
      } else if (rel === "gallery/index.html") {
        assert.deepEqual(links, ["design/gallery.css"], "gallery/index.html links gallery.css once");
        assert.ok(html.includes(GALLERY_LINK), "gallery/index.html: the link sits right after </style>, before </head>");
      } else if (/^gallery\/[\w-]+\/card\.html$/.test(rel)) {
        cards++;
        assert.deepEqual(links, ["design/card.css"], `${rel} links card.css once`);
        assert.ok(html.includes(CARD_LINK), `${rel}: the link sits right after </style>, before </head>`);
      } else {
        assert.deepEqual(links, [], `${rel} links a design stylesheet`);
      }
    }
    assert.equal(cards, fs.readdirSync(path.join(root, "gallery", "cards")).filter((f) => f.endsWith(".json")).length, "one linked card page per card JSON");
  });

  it("the link check reads what it should", () => {
    assert.deepEqual(designLinks('<link rel="stylesheet" href="./design/plan-a.css">'), ["design/plan-a.css"]);
    assert.deepEqual(designLinks('<link rel="stylesheet" href="../../design/card.css">'), ["design/card.css"]);
    assert.deepEqual(designLinks("<p>the design of the plan</p>"), []);
    assert.deepEqual(designLinks('<!-- <link rel="stylesheet" href="./design/plan-c.css"> -->'), [], "a link inside a comment is not a link");
    assert.deepEqual(designLinks("<p>see design/plan-c.css</p>"), [], "a file name in text is not a link");
    assert.deepEqual(designLinks('<LINK HREF="./design/plan-c.css" REL=stylesheet>'), ["design/plan-c.css"], "attribute order and case do not hide a link");
    assert.deepEqual(contentValues('.x::before{content : "Seat key"}'), ['"Seat key"']);
    assert.deepEqual(contentValues('.x::before{CONTENT:"Seat key"}'), ['"Seat key"']);
    assert.deepEqual(contentValues('.x::before{content/**/:"Seat key"}'), ['"Seat key"']);
    assert.deepEqual(contentValues('.x::before{content:"" "Seat key"}'), ['"" "Seat key"'], "words after an empty string are part of the value");
    assert.deepEqual(designLinks('<link rel="canonical" data-rel="stylesheet" href="./design/plan-c.css">'), [], "data-rel is not rel");
  });

  it("the builder refuses a map entry written another way, and font bytes without the WOFF2 signature", () => {
    const entry = (open, n) => `${open}\n  <div class="facts">${n} seats</div>\n</div>`;
    assert.deepEqual(seatCounts(`${entry('<div class="map">', 3)}\n${entry('<div class="map">', 5)}`), [3, 5]);
    for (const open of ['<div class="map featured">', "<div class=map>", '<DIV CLASS="map">']) {
      assert.throws(() => seatCounts(`${entry(open, 3)}\n${entry('<div class="map">', 5)}`), /2 "<N> seats" facts lines but 1 map entries/, open);
    }
    assert.deepEqual(seatCounts(`<p class="map-key">x</p>\n${entry('<div class="map">', 5)}`), [5], "an unrelated class holding the word map is not an entry");
    const src = fs.readFileSync(path.join(root, "scripts", "build-design-variants.mjs"), "utf8");
    assert.match(src, /"wOF2"/, "the font check reads the WOFF2 signature");
  });

  it("LIMIT: an entry whose map AND facts lines are both spelled another way is skipped, not refused", () => {
    const ok = '<div class="map">\n  <div class="facts">5 seats</div>\n</div>';
    const odd = '<div class="map featured">\n  <div class="facts featured">3 seats</div>\n</div>';
    assert.deepEqual(seatCounts(`${odd}\n${ok}`), [5]);
  });

  it("LIMIT: the font check reads the WOFF2 signature and length field only; it does not parse the font", () => {
    // A zero-filled buffer carrying "wOF2" and the right length would be embedded. A bad font
    // shows in frames as the fallback face, not in this test.
    const src = fs.readFileSync(path.join(root, "scripts", "build-design-variants.mjs"), "utf8");
    assert.match(src, /readUInt32BE\(8\)/);
  });

  it("the two layouts not picked are gone: design/ holds only what is served", () => {
    const files = fs.readdirSync(path.join(root, "design")).sort();
    assert.deepEqual(files, ["OFL.txt", "bitter-700-latin.woff2.b64.txt", "card.css", "gallery.css", "plan-c.css"]);
  });

  it("each file under design/ is exactly what the builder writes from index.html and gallery/index.html today", () => {
    const files = build();
    assert.deepEqual(Object.keys(files).sort(), ["card.css", "gallery.css", "plan-c.css"]);
    for (const [name, css] of Object.entries(files)) assert.equal(read(`design/${name}`), css, `design/${name} is stale: run node scripts/build-design-variants.mjs`);
  });

  it("the seat counts drawn are the ones the front page prints, one per map entry", () => {
    const html = read("index.html");
    const counts = seatCounts(html);
    assert.equal(counts.length, [...html.matchAll(/<div class="map">/g)].length);
    assert.equal(counts[0], 171, "OpenHands, the first entry (if the page changed, change this number with it)");
    assert.throws(() => seatCounts('<div class="map">\n  <div class="facts">many seats</div>\n</div>'), /"<N> seats" facts line/);
  });

  it("the gallery's side column is written for its opening, and any other opening is refused", () => {
    assert.equal(galleryOpening(read("gallery/index.html")), true);
    const open = (lines) => `<main>\n${lines.join("\n\n")}\n\n<h2>The maps</h2>`;
    const ok = ['<p class="crumbs">x</p>', "<h1>T</h1>", "<p>a</p>", "<p>b</p>", "<p>c</p>", "<p>d</p>"];
    assert.equal(galleryOpening(open(ok)), true);
    assert.throws(() => galleryOpening(open([...ok, "<p>e</p>"])), /side column is written for/, "a fifth paragraph");
    assert.throws(() => galleryOpening(open(ok.slice(0, -1))), /side column is written for/, "three paragraphs");
    assert.throws(() => galleryOpening(open(ok.slice(1))), /side column is written for/, "no breadcrumb");
    assert.throws(() => galleryOpening(open([ok[0], ok[1], '<p class="lede">a</p>', ...ok.slice(3)])), /side column is written for/, "a classed paragraph");
    assert.throws(() => galleryOpening("<main>\n<h1>T</h1>\n</main>"), /no <main> followed by an <h2>/);
  });

  it("the gallery's seat strips are drawn from the gallery's own counts", () => {
    const counts = seatCounts(read("gallery/index.html"), "gallery/index.html");
    assert.equal(counts.length, 12, "twelve maps on the gallery page (if the page changed, change this number with it)");
    assert.equal(counts[0], 171, "OpenHands, the gallery's first entry");
    const css = build()["gallery.css"];
    assert.equal([...css.matchAll(/^\.map:nth-of-type\(\d+\) \.facts::before/gm)].length, counts.length, "one light-scheme strip per gallery entry");
  });

  it("the phone-shift fallback face is in every stylesheet and sits right after Bitter in the display stack", () => {
    for (const [name, css] of Object.entries(build())) {
      assert.match(css, /@font-face\{font-family:"Bitter Fallback";font-weight:700;[^}]*src:local\("Georgia Bold"\)[^}]*size-adjust:/, `${name} declares the fallback face`);
      assert.match(css, /--display:"Bitter","Bitter Fallback",/, `${name}: the fallback face is next after Bitter`);
    }
  });

  it("LIMIT: the fallback face's numbers are measured once from the font tables; this test does not re-measure them or the shift", () => {
    // The shift itself is measured in a browser (layout-shift sources at 390 wide), not here.
    assert.match(build()["card.css"], /size-adjust:92\.32%/);
  });

  it("the stylesheets add no words: no content string other than the empty one", () => {
    for (const css of Object.values(build())) {
      const contents = contentValues(css);
      assert.ok(contents.length > 0, "found content declarations (if none, the pattern stopped matching)");
      for (const c of contents) assert.equal(c, '""', `a pseudo-element carries content ${c}`);
    }
  });

  it("LIMIT: the no-words check reads content declarations only; text drawn inside a background image is not seen", () => {
    const css = '.x::before{content:"";background:url("data:image/svg+xml,%3Csvg%3E%3Ctext%3Ehello%3C/text%3E%3C/svg%3E")}';
    assert.deepEqual(contentValues(css), ['""']);
  });

  it("LIMIT: the drawn marks are not decoded; a builder that drew one mark too many would still match its own output", () => {
    // The file-equals-build test pins design/ to the builder, and the seat-count test pins what
    // the builder READS; neither counts the squares in the SVG it writes. (Codex counted all
    // strips against the printed counts by hand on 2026-11-17; that is not a standing check.)
    const css = fs.readFileSync(path.join(root, "design", "plan-c.css"), "utf8");
    assert.match(css, /data:image\/svg\+xml/);
  });

  it("LIMIT: this reads files on disk; whether a browser renders a variant as drawn is checked by frames, not here", () => {
    assert.ok(fs.existsSync(path.join(root, "design", "plan-c.css")));
  });
});
