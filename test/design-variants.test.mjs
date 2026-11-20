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
  .filter((tag) => /(?:^|\s)rel\s*=\s*["']?stylesheet(?=["'\s>]|$)/i.test(tag))
  .map((tag) => (tag.match(/(?:^|\s)href\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || "")
  .filter((href) => /(^|\/)design\//.test(href) || /plan-[abc]\.css/.test(href))
  .map((href) => href.replace(/^(\.\.?\/)+/, ""));
// CSS comments are removed first; the property name is matched in any case; the WHOLE value up
// to the next ";" or "}" is returned, so anything after an empty string is seen too.
const contentValues = (css) => [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/content\s*:\s*([^;}]*)/gi)].map((m) => m[1].trim());
const FRONT_LINK = '</style>\n<link rel="stylesheet" href="./design/plan-c.css">\n</head>';
const CARD_LINK = '</style>\n<link rel="stylesheet" href="../../design/card.css">\n</head>';
const GALLERY_LINK = '</style>\n<link rel="stylesheet" href="../design/gallery.css">\n</head>';
// Map pages: their builders write </head> straight after the link (gallery/<slug>/) or on the next
// line (edition 1, written once on 2026-10-13); both are "right after </style>, before </head>".
const mapLink = (prefix) => new RegExp(`</style>\\n<link rel="stylesheet" href="${prefix.replace(/\./g, "\\.")}design/map\\.css">\\n?</head>`);
const MAP_PAGES = ["agno", "anythingllm", "browser-use", "cline", "codex", "deer-flow", "goose", "hermes", "langchain", "opencode", "openhands", "pi"];

describe("design-pass stylesheets", () => {
  it("only the front page, the gallery page, the card pages and the map pages link a layout, each exactly once, after the page's own style", () => {
    const pages = htmlPages();
    assert.ok(pages.length >= 14, `found ${pages.length} pages (if fewer, the walk stopped matching)`);
    let cards = 0, maps = 0;
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
      } else if (MAP_PAGES.some((s) => rel === `gallery/${s}/index.html`) || rel === "gallery/openhands/edition-1/index.html") {
        maps++;
        assert.deepEqual(links, ["design/map.css"], `${rel} links map.css once`);
        const prefix = rel.endsWith("edition-1/index.html") ? "../../../" : "../../";
        assert.match(html.replace(/<!--[\s\S]*?-->/g, ""), mapLink(prefix), `${rel}: the link sits right after </style>, before </head> (comments removed first)`);
      } else {
        assert.deepEqual(links, [], `${rel} links a design stylesheet`);
      }
    }
    assert.equal(cards, fs.readdirSync(path.join(root, "gallery", "cards")).filter((f) => f.endsWith(".json")).length, "one linked card page per card JSON");
    assert.equal(maps, 13, "twelve map pages and OpenHands edition 1 link map.css");
  });

  it("every index.html under gallery/, at any depth, is the gallery page or one of the 13 listed map pages", () => {
    const found = htmlPages(path.join(root, "gallery"))
      .map((p) => path.relative(root, p).split(path.sep).join("/"))
      .filter((rel) => rel.endsWith("/index.html") && rel !== "gallery/index.html").sort();
    assert.deepEqual(found, [...MAP_PAGES.map((s) => `gallery/${s}/index.html`), "gallery/openhands/edition-1/index.html"].sort());
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
    assert.deepEqual(designLinks('<link rel="stylesheet-disabled" href="./design/plan-c.css">'), [], "a longer rel word is not stylesheet");
  });

  it("LIMIT: a rel value with spaces inside its quotes is valid HTML but is not read as a stylesheet link here", () => {
    // So a stray link written that way on another page would not be caught by the link test above.
    assert.deepEqual(designLinks('<link rel=" stylesheet " href="./design/plan-c.css">'), []);
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
    // Bytes that are zero apart from those two fields are accepted and embedded. A bad font
    // shows in a browser as the next font in the stack, not in this test.
    const fake = Buffer.alloc(2000); fake.write("wOF2", 0, "latin1"); fake.writeUInt32BE(fake.length, 8);
    assert.doesNotThrow(() => buildFrom(read("index.html"), fake.toString("base64")));
  });

  it("the two layouts not picked are gone: design/ holds only what is served", () => {
    const files = fs.readdirSync(path.join(root, "design")).sort();
    assert.deepEqual(files, ["OFL.txt", "bitter-700-latin.woff2.b64.txt", "card.css", "gallery.css", "map.css", "plan-c.css"]);
  });

  it("each file under design/ is exactly what the builder writes from index.html today", () => {
    const files = build();
    assert.deepEqual(Object.keys(files).sort(), ["card.css", "gallery.css", "map.css", "plan-c.css"]);
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
      assert.deepEqual(mins, name === "card.css" || name === "map.css" ? [] : ["901"], `${name}: its min-width queries`);
    }
  });

  // The map rules may use only these selectors and properties. The rule is a list, not a pattern:
  // anything not listed is refused, so a positional selector, a hiding property or a re-ordering one
  // cannot pass by being spelled in a way a pattern did not foresee. Adding to a list is a decision.
  const MAP_SELECTORS = new Set([":root", ':root:not([data-theme="light"])', ':root[data-theme="dark"]', "h1", "h2", "h3", "a",
    ".banner", ".box", "details.seat", "details.fold", "pre", ".q", ".flow span.node", "nav.sticky a", "nav.sticky button", "#dl",
    "details.seat>summary", "nav.sticky", "th"]);
  const MAP_PROPERTIES = new Set(["--chip", "font", "font-family", "font-weight", "text-wrap", "margin", "padding", "color",
    "border-radius", "border-top", "border-right", "border-bottom", "background"]);
  const mapRules = (css) => {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{([^{}]*\{[^{}]*\})\s*\}/g, "$1");
    return [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
      selectors: m[1].split(",").map((s) => s.trim()),
      properties: m[2].split(";").map((d) => d.split(":")[0].trim().toLowerCase()).filter(Boolean),
    }));
  };
  const mapViolations = (css) => mapRules(css).flatMap((r) => [
    ...r.selectors.filter((s) => !MAP_SELECTORS.has(s)).map((s) => `selector ${s}`),
    ...r.properties.filter((p) => !MAP_PROPERTIES.has(p)).map((p) => `property ${p}`),
  ]);
  const mapPart = (css) => css.split("/* map: a full decision map in the register */")[1];

  it("the map stylesheet uses only the listed selectors and properties", () => {
    const css = mapPart(build()["map.css"]);
    assert.ok(css && mapRules(css).length >= 10, "found the map rules (if not, the marker comment changed)");
    assert.deepEqual(mapViolations(css), []);
  });

  it("the selector and property lists refuse what they should", () => {
    for (const bad of ["details:last-of-type{margin:0}", "div:only-child{margin:0}", "main{DISPLAY:none}", "main{flex-direction:column-reverse}",
      "h2+p{margin:0}", "main{order:2}", "h1::before{content:\"x\"}", ":root{--mr:#000}", "@media (min-width:1px){main{visibility:hidden}}"]) {
      assert.notDeepEqual(mapViolations(bad), [], bad);
    }
    assert.deepEqual(mapViolations("h2{margin:calc(1rem + 2px)}"), [], "a value with + is not a selector");
    assert.deepEqual(mapViolations("details.seat>summary{padding:0}"), [], "the child combinator in a listed selector");
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
    assert.throws(() => buildFrom(html, "!".repeat(2000)), /is not base64 font data/, "long text that is not base64");
    assert.throws(() => buildFrom(html, font.replace(/\s+/g, "") + "="), /is not base64 font data/, "one stray padding character");
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
