// Search floor for the GitHub Pages site (2026-11-21, item TM-1): every served page names its own canonical
// URL, and sitemap.xml lists exactly the served pages minus the declared exclusions.
// Dates in sitemap.xml are NOT re-derived here: CI checks out at depth 1, so history is not there.
// `node scripts/build-sitemap.mjs --check` is the local check of the dates (it refuses a shallow clone).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE, EXCLUDED, urlFor, readableText, servedPages, activeHead, isNoindex } from "../scripts/build-sitemap.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pages = servedPages(root);
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const canonicalTags = (html) => activeHead(html).match(/<link\b[^>]*\brel=["']canonical["'][^>]*>/gi) ?? [];

test("the site serves the pages this test expects to cover", () => {
  assert.ok(pages.includes("index.html") && pages.includes("gallery/index.html"), "home and gallery are listed");
  assert.ok(pages.length >= 27, `at least 27 served pages, found ${pages.length}`);
});

test("every served page has exactly one canonical tag in its <head>, naming its own URL", () => {
  for (const rel of pages) {
    const html = read(rel);
    const tags = canonicalTags(html);
    assert.equal(tags.length, 1, `${rel}: expected 1 canonical tag in the active <head>, found ${tags.length}`);
    assert.equal(tags[0], `<link rel="canonical" href="${urlFor(rel)}">`, `${rel}: canonical names ${urlFor(rel)}`);
    const og = activeHead(html).match(/<meta property="og:url" content="([^"]*)">/);
    if (og) assert.equal(og[1], urlFor(rel), `${rel}: og:url and canonical agree`);
  }
});

test("a canonical inside a comment, or outside <head>, does not count", () => {
  const tag = '<link rel="canonical" href="https://x/">';
  assert.equal(canonicalTags(`<html><head><!-- ${tag} --></head><body></body></html>`).length, 0);
  assert.equal(canonicalTags(`<html><head></head><body>${tag}</body></html>`).length, 0);
  assert.equal(canonicalTags(`<html><head><link href="https://y/" rel="canonical"></head></html>`).length, 1, "attribute order does not hide a second canonical");
});

test("sitemap.xml lists exactly the served pages minus the exclusions, with real dates", () => {
  const xml = read("sitemap.xml").replace(/\r\n/g, "\n");
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'), "XML declaration and urlset open");
  assert.ok(xml.endsWith("</urlset>\n"), "urlset closes");
  const rows = [...xml.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod><\/url>/g)];
  assert.equal(rows.length, xml.split("<url>").length - 1, "every <url> row has the loc + lastmod shape");
  const listed = rows.map((r) => r[1]).sort();
  const expected = pages.filter((p) => !EXCLUDED.has(p)).map(urlFor).sort();
  assert.deepEqual(listed, expected);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  for (const [, loc, date] of rows) {
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/, `${loc}: lastmod is a date`);
    assert.equal(new Date(date + "T00:00:00Z").toISOString().slice(0, 10), date, `${loc}: ${date} is a real calendar date`);
    assert.ok(date <= tomorrow, `${loc}: lastmod ${date} is not in the future`);
    assert.ok(loc.startsWith(SITE), `${loc}: on the canonical host`);
  }
});

test("no page listed in the sitemap is marked noindex, and the check can see a noindex", () => {
  for (const rel of pages.filter((p) => !EXCLUDED.has(p))) assert.equal(isNoindex(read(rel)), false, `${rel} is noindex but listed`);
  assert.equal(isNoindex('<html><head><meta name="robots" content="noindex, follow"></head></html>'), true);
  assert.equal(isNoindex('<html><head><!-- <meta name="robots" content="noindex"> --></head></html>'), false);
});

test("each exclusion is a served page and carries a reason", () => {
  for (const [rel, why] of EXCLUDED) {
    assert.ok(pages.includes(rel), `${rel} is served`);
    assert.ok(why.length > 20, `${rel} says why it is left out`);
  }
});

test("urlFor refuses a path that is not a plain URL path", () => {
  for (const bad of ["r&d.html", "a#b.html", "a?b.html", "../x.html", "a b.html"]) assert.throws(() => urlFor(bad), /not a plain URL path/, bad);
  assert.equal(urlFor("gallery/pi/card.html"), SITE + "gallery/pi/card.html");
  assert.equal(urlFor("gallery/pi/index.html"), SITE + "gallery/pi/");
});

test("readable text ignores head tags, comments and stylesheet links, and sees a changed word", () => {
  const base = "<html><head><title>T</title></head><body><p>One two.</p></body></html>";
  const headOnly = base.replace("</title>", '</title><link rel="canonical" href="x"><link rel="stylesheet" href="y.css">');
  assert.equal(readableText(headOnly), readableText(base));
  assert.equal(readableText(base.replace("<p>", "<!-- note --><p>")), readableText(base));
  assert.equal(readableText('<html><head></head><body><a title="a > b">x</a></body></html>'), "x", "a > inside a quoted attribute stays in the tag");
  assert.notEqual(readableText(base.replace("two", "three")), readableText(base));
});

test("LIMIT: a changed href or alt text does not count as a readable change", () => {
  const a = '<html><head></head><body><a href="one">Link</a><img alt="first"></body></html>';
  const b = '<html><head></head><body><a href="two">Link</a><img alt="second"></body></html>';
  assert.equal(readableText(a), readableText(b));
});

test("LIMIT: markup that splits a word reads as a change", () => {
  const a = "<html><head></head><body><p>alphabet</p></body></html>";
  const b = "<html><head></head><body><p>alpha<span>bet</span></p></body></html>";
  assert.notEqual(readableText(a), readableText(b));
});

test("LIMIT: entities are compared as written, not decoded", () => {
  const a = "<html><head></head><body><p>a &amp; b</p></body></html>";
  const b = "<html><head></head><body><p>a &#38; b</p></body></html>";
  assert.notEqual(readableText(a), readableText(b));
});
