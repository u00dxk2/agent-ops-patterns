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

function hrefs(html) {
  return [...html.matchAll(/\shref="([^"]*)"/g)].map((m) => m[1]);
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
        assert.ok(fs.existsSync(path.join(root, target)), `${page}: "${href}" -> ${target} does not exist`);
        assert.doesNotMatch(target, /\.md$/i, `${page}: "${href}" -> ${target} is served as raw Markdown`);
      }
    }
    assert.ok(followed >= 4, `followed ${followed} relative links (if fewer, the href pattern stopped matching)`);
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
