import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, seatCounts } from "../scripts/build-design-variants.mjs";

// The layout stylesheets under design/ (design pass 2026-11-17, layout C picked). A page uses
// one only if its <head> links it. These tests pin WHICH pages link WHICH stylesheet (the front
// page links plan-c.css, every card page links card.css, nothing else links either), keep the
// two layouts not picked out of the served tree, and keep the drawn seat marks equal to the
// counts the front page prints.

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
const designLinks = (html) => [...html.matchAll(/design\/[\w-]+\.css|plan-[abc]\.css/g)].map((m) => m[0]);
const FRONT_LINK = '</style>\n<link rel="stylesheet" href="./design/plan-c.css">\n</head>';
const CARD_LINK = '</style>\n<link rel="stylesheet" href="../../design/card.css">\n</head>';

describe("design-pass stylesheets", () => {
  it("only the front page and the card pages link a layout, each exactly once, after the page's own style", () => {
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
  });

  it("the two layouts not picked are gone: design/ holds only what is served", () => {
    const files = fs.readdirSync(path.join(root, "design")).sort();
    assert.deepEqual(files, ["OFL.txt", "bitter-700-latin.woff2.b64.txt", "card.css", "plan-c.css"]);
  });

  it("each file under design/ is exactly what the builder writes from index.html today", () => {
    const files = build();
    assert.deepEqual(Object.keys(files).sort(), ["card.css", "plan-c.css"]);
    for (const [name, css] of Object.entries(files)) assert.equal(read(`design/${name}`), css, `design/${name} is stale: run node scripts/build-design-variants.mjs`);
  });

  it("the seat counts drawn are the ones the front page prints, one per map entry", () => {
    const html = read("index.html");
    const counts = seatCounts(html);
    assert.equal(counts.length, [...html.matchAll(/<div class="map">/g)].length);
    assert.equal(counts[0], 171, "OpenHands, the first entry (if the page changed, change this number with it)");
    assert.throws(() => seatCounts('<div class="map">\n  <div class="facts">many seats</div>\n</div>'), /no "<N> seats" facts line/);
  });

  it("the stylesheets add no words: no content string other than the empty one", () => {
    for (const css of Object.values(build())) {
      const contents = [...css.matchAll(/content:\s*("[^"]*"|'[^']*'|[^;}]+)/g)].map((m) => m[1].trim());
      assert.ok(contents.length > 0, "found content declarations (if none, the pattern stopped matching)");
      for (const c of contents) assert.equal(c, '""', `a pseudo-element carries content ${c}`);
    }
  });

  it("LIMIT: the no-words check reads content declarations only; text drawn inside a background image is not seen", () => {
    const css = '.x::before{content:"";background:url("data:image/svg+xml,%3Csvg%3E%3Ctext%3Ehello%3C/text%3E%3C/svg%3E")}';
    const contents = [...css.matchAll(/content:\s*("[^"]*"|'[^']*'|[^;}]+)/g)].map((m) => m[1].trim());
    assert.deepEqual(contents, ['""']);
  });

  it("LIMIT: this reads files on disk; whether a browser renders a variant as drawn is checked by frames, not here", () => {
    assert.ok(fs.existsSync(path.join(root, "design", "plan-c.css")));
  });
});
