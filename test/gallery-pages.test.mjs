import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// GitHub Pages serves this repo's main branch at u00dxk2.github.io/agent-ops-patterns/
// (.nojekyll, so files are served as they are). A folder URL is served only if the
// folder has an index.html, and a .md file is served as raw text, not rendered. So a
// gallery reader can reach a page only if (1) the site root and gallery/ have an
// index.html, (2) every map folder is listed on the gallery page, and (3) every
// relative link on these pages lands on a file that exists and is not Markdown.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

function mapFolders() {
  return fs
    .readdirSync(path.join(root, "gallery"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, "gallery", d.name, "index.html")))
    .map((d) => d.name);
}

const pages = () => ["index.html", "gallery/index.html", ...mapFolders().map((m) => `gallery/${m}/index.html`)];

// Double- and single-quoted attributes both count; an unquoted href fails the
// test outright rather than slipping past it.
function hrefs(html) {
  assert.doesNotMatch(html, /\shref=[^"'\s>]/, "every href is quoted");
  return [...html.matchAll(/\shref=(["'])(.*?)\1/g)].map((m) => m[2]);
}

// Pages serves a folder only through its index.html, so a link to an existing
// folder without one is as broken as a link to a missing file.
function servable(target) {
  const abs = path.join(root, target);
  if (!fs.existsSync(abs)) return false;
  if (fs.statSync(abs).isDirectory()) return fs.existsSync(path.join(abs, "index.html"));
  return true;
}

// Resolve a relative href the way the browser does from the page's served URL,
// then map it to the repo file Pages would serve. Returns null for links this
// check does not follow (other sites, in-page anchors).
function servedFile(pageRel, href) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//") || href.startsWith("#")) return null;
  const clean = href.split("#")[0].split("?")[0];
  if (clean.startsWith("/")) throw new Error(`site-absolute href "${href}" breaks under the /agent-ops-patterns/ base path`);
  let target = path.posix.normalize(path.posix.join(path.posix.dirname(pageRel), clean));
  if (clean === "" || clean.endsWith("/")) target = path.posix.join(target, "index.html");
  return target;
}

// CRLF is folded to LF first: a Windows checkout may carry CRLF in .html files.
const uncommented = (html) => html.replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->/g, "");

// Anchors only, not a parser: walk every <a …> and </a> in order and refuse a
// second opening before the first one closes.
function anchorsFlat(html) {
  let depth = 0;
  for (const m of uncommented(html).matchAll(/<a\b|<\/a>/gi)) {
    depth += m[0] === "</a>" || m[0] === "</A>" ? -1 : 1;
    if (depth > 1 || depth < 0) return false;
  }
  return depth === 0;
}

// The card format rule (see the card test). Throws on any card that breaks it,
// so a card this cannot bound is a failure, never a silent pass.
function mapCards(html) {
  const src = uncommented(html);
  const opens = [...src.matchAll(/<div class="map">/g)];
  return opens.map((o) => {
    if (o.index !== 0 && src[o.index - 1] !== "\n") throw new Error("card format rule: <div class=\"map\"> not at column 0");
    const rest = src.slice(o.index + o[0].length);
    const close = rest.indexOf("\n</div>");
    if (!rest.startsWith("\n") || close < 0) throw new Error("card format rule: card does not open on its own line and close with </div> at column 0");
    const body = rest.slice(1, close);
    if (body.split("\n").some((line) => !/^\s/.test(line))) throw new Error("card format rule: a line inside the card is not indented");
    return body;
  });
}

const UPSTREAM_LINK = /<a href="https:\/\/github\.com\/OpenHands\/software-agent-sdk\/(?:issues|pull)\/(\d+)">([\s\S]*?)<\/a>/g;

// Source characters outside tags; entities are not decoded (see the LIMIT test).
const findingSourceLength = (inner) => inner.replace(/<[^>]*>/g, "").trim().length;

describe("gallery pages on GitHub Pages", () => {
  it("the site root and gallery/ each have an index.html", () => {
    assert.ok(fs.existsSync(path.join(root, "index.html")), "index.html at the repo root");
    assert.ok(fs.existsSync(path.join(root, "gallery", "index.html")), "gallery/index.html");
  });

  it("every map folder is linked from the gallery page and from gallery/README.md", () => {
    const gallery = read("gallery/index.html");
    const readme = read("gallery/README.md");
    const maps = mapFolders();
    assert.ok(maps.length > 0, "at least one map folder (if not, this test is stale)");
    for (const m of maps) {
      assert.ok(hrefs(gallery).includes(`./${m}/`), `gallery/index.html links ./${m}/`);
      assert.ok(readme.includes(`/agent-ops-patterns/gallery/${m}/`), `gallery/README.md links the live ${m} map`);
    }
  });

  it("every map links back to the gallery", () => {
    for (const m of mapFolders()) {
      assert.ok(hrefs(read(`gallery/${m}/index.html`)).includes("../"), `gallery/${m}/index.html links ../`);
    }
  });

  it("every relative link on these pages lands on a file that exists and is not Markdown", () => {
    let followed = 0;
    for (const page of pages()) {
      for (const href of hrefs(read(page))) {
        const target = servedFile(page, href);
        if (target === null) continue;
        followed++;
        assert.ok(!target.startsWith(".."), `${page}: "${href}" leaves the site`);
        assert.ok(servable(target), `${page}: "${href}" -> ${target} is not a file Pages can serve`);
        assert.doesNotMatch(target, /\.md$/i, `${page}: "${href}" -> ${target} is served as raw Markdown`);
      }
    }
    assert.ok(followed >= 4, `followed ${followed} relative links (if fewer, the href pattern stopped matching)`);
  });

  // A card's finding line holds its own links, so the card cannot itself be an
  // <a> (a link inside a link is invalid HTML and browsers split it apart).
  // Card format rule, refused rather than parsed: a card opens with
  // `<div class="map">` at column 0, closes with `</div>` at column 0, and every
  // line between is indented. A card that breaks the rule fails the test.
  it("there are as many card blocks (by the format rule) as maps, and for each map some block links it and its gap report and has a finding paragraph", () => {
    for (const [page, prefix] of [["index.html", "./gallery/"], ["gallery/index.html", "./"]]) {
      const cards = mapCards(read(page));
      assert.equal(cards.length, mapFolders().length, `${page}: one card per map folder`);
      for (const m of mapFolders()) {
        const card = cards.find((c) => hrefs(c).includes(`${prefix}${m}/`));
        assert.ok(card, `${page}: a card links ${prefix}${m}/`);
        const finding = card.match(/<p class="finding">([\s\S]*?)<\/p>/);
        assert.ok(finding, `${page}: the ${m} card has a finding line`);
        assert.ok(findingSourceLength(finding[1]) >= 40, `${page}: the ${m} finding paragraph has at least 40 characters of source text outside tags`);
        assert.ok(hrefs(card).includes(`${prefix}${m}/#gaps`), `${page}: the ${m} card links its gap report`);
      }
    }
  });

  it("on every page, <a and </a> tokens balance and never go two deep", () => {
    for (const page of pages()) assert.ok(anchorsFlat(read(page)), `${page}: <a / </a> tokens nest, close unopened, or stay open`);
  });

  // One rule, one pattern: UPSTREAM_LINK. Every link it matches shows exactly its
  // own number as text, and the four numbers the gap report cites appear only as
  // the text of a link it matches. Spellings it does not match (extra attributes,
  // single quotes) are outside the rule, and an occurrence in one of them fails.
  it("in the OpenHands map, every matched upstream issue/PR link's text is its own number, and the four cited numbers appear only as such text", () => {
    const html = uncommented(read("gallery/openhands/index.html"));
    assert.match(html, /<h2 id="gaps">/);
    const links = [...html.matchAll(UPSTREAM_LINK)];
    for (const [, n, text] of links) assert.equal(text, `#${n}`, `the link to ${n} reads "${text}"`);
    const linked = new Set(links.map((l) => l[1]));
    for (const n of ["5092", "5110", "5492", "5525"]) assert.ok(linked.has(n), `#${n} is linked`);
    // Other "#NNNN" text in the map (fix commits, another repo's agent-canvas#1900)
    // is out of scope; only these four numbers are held to the rule.
    const plain = html.replace(UPSTREAM_LINK, "").match(/#(5092|5110|5492|5525)\b/g) ?? [];
    assert.deepEqual(plain, [], "one of the four upstream numbers appears outside a matched upstream link");
  });

  it("the card and link checks go red on the shapes they exist to catch", () => {
    assert.equal(anchorsFlat(`<a href="x">a</a> <a href="y">b</a>`), true);
    assert.equal(anchorsFlat(`<a href="x"><p>a <a href="y">b</a></p></a>`), false);
    assert.equal(anchorsFlat(`<!-- <a href="x"> --><a href="y">b</a>`), true);
    const card = `<div class="map">\n  <a class="name" href="./x/">X</a>\n</div>`;
    assert.equal(mapCards(card).length, 1);
    assert.throws(() => mapCards(`<div class="map"><a href="./x/">X</a></div>\n<div>\n<p class="finding">outside</p>\n</div>`), /format rule/);
    assert.throws(() => mapCards(`<div class="map">\n  <a href="./x/">X</a>\n<p class="finding">outside</p>\n</div>`), /format rule/);
  });

  it("each page sets a title, a viewport, and an explicit body background", () => {
    for (const page of pages()) {
      const html = read(page);
      assert.match(html, /<title>[^<]+<\/title>/, `${page}: title`);
      assert.match(html, /name="viewport"/, `${page}: viewport`);
      assert.match(html, /body\{[^}]*background:/, `${page}: body background`);
    }
  });

  it("servedFile resolves folder links to index.html and refuses site-absolute paths", () => {
    assert.equal(servedFile("index.html", "./gallery/"), "gallery/index.html");
    assert.equal(servedFile("gallery/openhands/index.html", "../"), "gallery/index.html");
    assert.equal(servedFile("gallery/index.html", "../"), "index.html");
    assert.equal(servedFile("gallery/index.html", "#x"), null);
    assert.throws(() => servedFile("index.html", "/gallery/"), /site-absolute/);
  });

  it("hrefs reads single-quoted links and refuses unquoted ones; servable refuses a folder with no index.html", () => {
    assert.deepEqual(hrefs(`<a href='./README.md'>x</a> <a href="../">y</a>`), ["./README.md", "../"]);
    assert.throws(() => hrefs(`<a href=./x/>z</a>`), /quoted/);
    assert.equal(servable("skills"), false, "skills/ has no index.html (if it gains one, pick another folder)");
    assert.equal(servable("gallery"), true);
    assert.equal(servable("gallery/index.html"), true);
  });

  it("LIMIT: the card bound is a source-format rule; a card closed early on an indented line still reads as one block", () => {
    const early = `<div class="map">\n  <a href="./x/">X</a></div><div>\n  <p class="finding">outside the box</p>\n</div>`;
    assert.equal(mapCards(early).length, 1);
    assert.match(mapCards(early)[0], /outside the box/);
  });

  it("LIMIT: the finding check counts source characters, so HTML entities that render as blank still count", () => {
    assert.ok(findingSourceLength("&#32;".repeat(8)) >= 40);
  });

  it("LIMIT: anchorsFlat reads <a and </a> tokens, including ones inside attribute values", () => {
    assert.equal(anchorsFlat(`<a title="</a>"><a>x</a><i title="<a">y</i></a>`), true);
  });

  it("LIMIT: links to other sites (github.com, substack) are not fetched", () => {
    assert.equal(servedFile("index.html", "https://github.com/u00dxk2/agent-ops-patterns/tree/main/skills/x"), null);
  });

  it("LIMIT: only .md is refused; any other existing file type passes, rendered or not", () => {
    assert.equal(servedFile("index.html", "./package.json"), "package.json");
  });

  it("LIMIT: this reads the files on disk, not the deployed site; a failed Pages build is not seen here", () => {
    assert.equal(typeof servedFile, "function");
  });
});
