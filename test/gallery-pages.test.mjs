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

// Each excerpt's label paragraph (the one immediately before it). A <pre> opening tag whose class attribute
// this pattern reads as holding "excerpt", but in another shape than the builder writes (extra attributes,
// other classes), comes back as a failing entry, and so does an excerpt with no label directly before it.
// This is a pattern over generated source, not an HTML parser: see the LIMIT test for what it cannot see.
const EXCERPT_OPEN = '<pre class="excerpt">';
const excerpts = (html) => {
  const opens = [...html.matchAll(/<pre\b[^>]*>/gi)].map((m) => m[0]).filter((t) => /\bclass\s*=\s*["']?[^"'>]*\bexcerpt\b/i.test(t));
  const labelled = [...html.matchAll(/<p class="meta">((?:(?!<p[ >]).)*?)<\/p><pre class="excerpt">/gs)].map((x) => x[1]);
  const odd = opens.filter((t) => t !== EXCERPT_OPEN).map((t) => `(an excerpt opened as ${t}, not ${EXCERPT_OPEN})`);
  const unlabelled = opens.length - odd.length > labelled.length ? ["(an excerpt with no label paragraph directly before it)"] : [];
  return [...labelled, ...odd, ...unlabelled];
};
const excerptLabelled = (label) => /^Source as written \((?:Python|Jinja template)\), from <a href="https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/blob\/[0-9a-f]{40}\/[^"#]+#L\d+-L\d+">/.test(label);

// Each <table> not opened directly after <div class="tablewrap"> (the shape the map builder writes),
// returned with a little of what precedes it.
const bareTables = (html) => [...html.matchAll(/<table\b/gi)]
  .filter((m) => !html.slice(Math.max(0, m.index - 23), m.index).toLowerCase().endsWith('<div class="tablewrap">'))
  .map((m) => html.slice(Math.max(0, m.index - 60), m.index + 40).replace(/\s+/g, " "));

// Where a gallery card's gap link points. A map with a gap report (<h2 id="gaps">) is linked there; an edition
// published without one (the Cline map, 2026-10-23) must say so inside its <h2 id="edition"> section, and the card
// links that section instead. Anything else returns null, which fails the card test.
function gapLinkTarget(html) {
  const src = uncommented(html);
  if (/<h2 id="gaps">/.test(src)) return "gaps";
  // A gap report under any other heading or id refuses the #edition fallback (Codex review 2026-10-23, F1).
  if (/\bid=["'][^"']*\bgaps?\b/i.test(src) || /<h[1-6]\b[^>]*>[^<]*\bgaps?\b/i.test(src)) return null;
  const m = src.match(/<h2 id="edition">([\s\S]*?)(?=<h2\b|$)/);
  return m && /There is no list of gaps/.test(m[1]) ? "edition" : null;
}

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

  // A quoted prompt on a map is the source as written, never a rendered prompt: the line before each
  // <pre class="excerpt"> names that and links the quoted lines at a full commit, so the quote can be checked.
  it("every prompt excerpt on a map is labelled source-as-written and links its lines at a full commit", () => {
    let seen = 0;
    for (const m of mapFolders()) {
      for (const block of excerpts(read(`gallery/${m}/index.html`))) {
        seen++;
        assert.ok(excerptLabelled(block), `gallery/${m}: excerpt without a source-as-written label and pinned line link: ${block.slice(0, 160)}`);
      }
    }
    assert.ok(seen > 0, "found at least one excerpt (if none, the pattern stopped matching or the quotes were removed)");
  });

  it("LIMIT: the excerpt check reads the label and the link, not the quoted text (comparing quotes with upstream needs the network, so it runs outside npm test)", () => {
    const fake = '<p class="meta">Source as written (Python), from <a href="https://github.com/OpenHands/software-agent-sdk/blob/' + "a".repeat(40) + '/x.py#L1-L2"><code>x.py</code> lines 1–2 at commit aaaaaaaa</a>.</p><pre class="excerpt"><code>not what x.py says</code></pre>';
    assert.equal(excerpts(fake).length, 1);
    assert.ok(excerptLabelled(excerpts(fake)[0]), "a wrong quote with a well-formed label passes this test");
    assert.ok(!excerptLabelled(excerpts(fake.replace("a".repeat(40), "a".repeat(8)))[0]), "a short commit in the link fails it");
  });

  it("LIMIT: excerpt discovery is a pattern, so a quoted '>' before the class, or an entity-encoded class name, hides a <pre> from it", () => {
    assert.deepEqual(excerpts('<pre title=">" class="excerpt"><code>y</code></pre>'), []);
    assert.deepEqual(excerpts('<pre class="ex&#99;erpt"><code>y</code></pre>'), []);
  });

  it("an excerpt in these other tag shapes, or with no label before it, is reported rather than skipped", () => {
    const good = '<p class="meta">Source as written (Python), from <a href="https://github.com/o/r/blob/' + "b".repeat(40) + '/x.py#L1-L2">x</a>.</p><pre class="excerpt"><code>x</code></pre>';
    for (const bad of ['<pre class="excerpt" id="extra"><code>y</code></pre>', '<pre id="z" class="note excerpt"><code>y</code></pre>', '<p>no label</p><pre class="excerpt"><code>y</code></pre>']) {
      const found = excerpts(good + bad);
      assert.equal(found.length, 2, `two entries for: ${bad}`);
      assert.ok(!excerptLabelled(found[1]), `the second entry fails the label check: ${bad}`);
    }
  });

  // A bare <table> wider than the screen makes the whole page scroll sideways on a phone; inside
  // .tablewrap it scrolls in its own box. Measured 2026-10-13: the OpenHands map was 679px wide at 390.
  it("every table on a map page sits directly inside a .tablewrap box", () => {
    let seen = 0;
    for (const m of mapFolders()) {
      const html = read(`gallery/${m}/index.html`);
      for (const t of bareTables(html)) assert.fail(`gallery/${m}: a <table> not directly inside <div class="tablewrap">: ${t}`);
      seen += [...html.matchAll(/<table\b/gi)].length;
    }
    assert.ok(seen > 0, "found at least one table (if none, the pattern stopped matching)");
  });

  it("LIMIT: the table check reads the tag directly before each <table>, so a wrapper with other classes or attributes reads as bare", () => {
    assert.deepEqual(bareTables('<div class="tablewrap"><table></table></div>'), []);
    assert.equal(bareTables('<h3>x</h3><table></table>').length, 1);
    assert.equal(bareTables('<div class="tablewrap wide"><table></table></div>').length, 1);
  });

  it("a bare table is found whatever the tag's case", () => {
    assert.equal(bareTables('<h3>x</h3><TABLE></TABLE>').length, 1);
    assert.deepEqual(bareTables('<DIV CLASS="tablewrap"><Table></Table></DIV>'), []);
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
      assert.equal(cards.length, mapFolders().length, `${page}: card block count equals map-folder count`);
      for (const m of mapFolders()) {
        const card = cards.find((c) => hrefs(c).includes(`${prefix}${m}/`));
        assert.ok(card, `${page}: a card links ${prefix}${m}/`);
        const finding = card.match(/<p class="finding">([\s\S]*?)<\/p>/);
        assert.ok(finding, `${page}: the ${m} card has a finding line`);
        assert.ok(findingSourceLength(finding[1]) >= 40, `${page}: the ${m} finding paragraph has at least 40 characters of source text outside tags`);
        const target = gapLinkTarget(read(`gallery/${m}/index.html`));
        assert.ok(target, `gallery/${m}/index.html has neither <h2 id="gaps"> nor an <h2 id="edition"> section saying "There is no list of gaps"`);
        assert.ok(hrefs(card).includes(`${prefix}${m}/#${target}`), `${page}: the ${m} card links its gap report (or, with none, its edition note) at #${target}`);
      }
    }
  });

  it("gapLinkTarget: a gap report wins; a map with none must say so in its edition section, else no target", () => {
    assert.equal(gapLinkTarget('<h2 id="gaps">Gaps</h2>'), "gaps");
    assert.equal(gapLinkTarget('<h2 id="edition">Left out</h2>\n<p>x.</p>\n<p>There is no list of gaps here.</p>\n<h2 id="a">A</h2>'), "edition");
    assert.equal(gapLinkTarget('<h2 id="edition">Left out</h2>\n<p>x.</p>\n<h2 id="a">A</h2><p>There is no list of gaps.</p>'), null, "the sentence outside the edition section does not count");
    assert.equal(gapLinkTarget('<h2 id="a">A</h2>'), null);
    const stale = '<h2 id="edition">Left out</h2>\n<p>There is no list of gaps.</p>\n';
    assert.equal(gapLinkTarget(stale + '<h2 id="known-gaps">Known gaps</h2>'), null, "a gap report under another id refuses the fallback");
    assert.equal(gapLinkTarget(stale + '<h3>Gaps found</h3>'), null, "a gap heading of another level refuses the fallback");
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
