import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, buildFrom, seatCounts } from "../scripts/build-design-variants.mjs";

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

  it("LIMIT: the front page's strips are placed by :nth-of-type, so an ordinary <div> among the maps is not refused and would shift the strips after it", () => {
    const ok = '<div class="map">\n  <div class="facts">5 seats</div>\n</div>';
    assert.deepEqual(seatCounts(`<div class="note">x</div>\n${ok}`), [5]);
    assert.match(build()["plan-c.css"], /\.map:nth-of-type\(1\) \.facts::before/);
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

  it("each file under design/ is exactly what the builder writes from index.html today", () => {
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

  it("the gallery stylesheet has no seat strips, no float and no nth- selector, and build() passes it nothing from the page", () => {
    const css = build()["gallery.css"];
    assert.doesNotMatch(css, /nth-of-type|nth-child/, "no rule places anything by position");
    assert.doesNotMatch(css, /float\s*:/, "no side column");
    assert.match(css, /\.map \.facts::before\{display:none\}/, "the shared strip box is switched off");
    const src = fs.readFileSync(path.join(root, "scripts", "build-design-variants.mjs"), "utf8");
    assert.match(src, /"gallery\.css": b \+ gallery\(\)/, "gallery() takes no argument");
  });

  it("no stylesheet has a max-width query; plan-c and gallery each have exactly one, at min-width 901px", () => {
    for (const [name, css] of Object.entries(build())) {
      assert.doesNotMatch(css, /max-width\s*:\s*\d[\d.]*px\s*\)/, `${name} has no max-width media query`);
      const mins = [...css.matchAll(/@media \(min-width:(\d+)px\)/g)].map((m) => m[1]);
      assert.deepEqual(mins, name === "card.css" ? [] : ["901"], `${name}: its min-width queries`);
    }
  });

  it("the phone-shift fallback face is in every stylesheet and sits right after Bitter in the display stack", () => {
    for (const [name, css] of Object.entries(build())) {
      assert.ok(css.includes('@font-face{font-family:"Bitter Fallback";font-weight:700;font-style:normal;src:local("Georgia Bold"),local("Georgia-Bold");size-adjust:91.12%;ascent-override:102.61%;descent-override:29.08%;line-gap-override:0%}'), `${name} declares the fallback face with the measured numbers`);
      assert.match(css, /--display:"Bitter","Bitter Fallback",/, `${name}: the fallback face is next after Bitter`);
    }
  });

  it("the build refuses no map entries, text that is not base64, and bytes without the WOFF2 signature or with the wrong length", () => {
    const html = read("index.html");
    const font = read("design/bitter-700-latin.woff2.b64.txt");
    assert.ok(buildFrom(html, font)["plan-c.css"], "the real inputs build");
    assert.throws(() => buildFrom("<main></main>", font), /no map entries/);
    assert.throws(() => buildFrom(html, "not base64!"), /is not base64 font data/);
    const bytes = Buffer.from(font.replace(/\s+/g, ""), "base64");
    const sig = Buffer.from(bytes); sig.write("XXXX", 0, "latin1");
    assert.throws(() => buildFrom(html, sig.toString("base64")), /does not decode to a WOFF2 font/, "wrong signature");
    const len = Buffer.from(bytes); len.writeUInt32BE(len.length + 1, 8);
    assert.throws(() => buildFrom(html, len.toString("base64")), /does not decode to a WOFF2 font/, "wrong length field");
  });  it("LIMIT: the fallback face's numbers are measured once from the font tables; this test does not re-measure them or the shift", () => {
    // The shift itself is measured in a browser (layout-shift sources at 390 wide), not here.
    assert.match(build()["card.css"], /size-adjust:91\.12%/);
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
