import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCard, renderCard, evidenceUrl } from "../scripts/render-decides-card.mjs";

// A "How it decides" card is a JSON file in gallery/cards/ (contract: aop-decides-card/v1) and a page
// generated from it at gallery/<slug>/card.html. Another site vendors the JSON, so its shape is a
// contract; the page is never hand-edited.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cardsDir = path.join(root, "gallery", "cards");
const cardFiles = () => fs.readdirSync(cardsDir).filter((f) => f.endsWith(".json"));
const load = (f) => JSON.parse(fs.readFileSync(path.join(cardsDir, f), "utf8"));
const clone = (x) => JSON.parse(JSON.stringify(x));

describe("How-it-decides cards", () => {
  it("there is at least one card (if none, this test is stale)", () => {
    assert.ok(cardFiles().length > 0);
  });

  it("every card meets the contract's shape", () => {
    for (const f of cardFiles()) assert.deepEqual(validateCard(load(f)), [], f);
  });

  it("every card's file name is its slug, and its page is exactly what the JSON renders to", () => {
    for (const f of cardFiles()) {
      const card = load(f);
      assert.equal(f, `${card.agent.slug}.json`);
      const page = path.join(root, "gallery", card.agent.slug, "card.html");
      assert.ok(fs.existsSync(page), `gallery/${card.agent.slug}/card.html exists`);
      assert.equal(fs.readFileSync(page, "utf8").replace(/\r\n/g, "\n"), renderCard(card),
        `gallery/${card.agent.slug}/card.html is stale or hand-edited: re-run scripts/render-decides-card.mjs`);
    }
  });

  it("no published card carries a pending claims pass", () => {
    for (const f of cardFiles()) {
      for (const p of load(f).problems) assert.notEqual(p.verified.claimsPass, "pending", `${f}: ${p.title}`);
    }
  });

  it("every relative link on a card page lands on a file in the repo", () => {
    for (const f of cardFiles()) {
      const slug = load(f).agent.slug;
      const html = fs.readFileSync(path.join(root, "gallery", slug, "card.html"), "utf8");
      const rel = [...html.matchAll(/\shref="([^"]*)"/g)].map((m) => m[1]).filter((h) => !/^[a-z]+:/i.test(h) && !h.startsWith("#"));
      assert.ok(rel.length >= 3, "found the breadcrumb links");
      for (const h of rel) {
        let t = path.posix.normalize(path.posix.join(`gallery/${slug}`, h));
        if (h.endsWith("/")) t = path.posix.join(t, "index.html");
        assert.ok(!t.startsWith(".."), `${h} leaves the site`);
        assert.ok(fs.existsSync(path.join(root, t)), `${h} -> ${t}`);
      }
    }
  });

  it("every evidence link points at the card's own pinned commit", () => {
    for (const f of cardFiles()) {
      const card = load(f);
      const all = [...card.judgments.map((j) => j.evidence), ...card.problems.flatMap((p) => p.evidence)];
      for (const e of all) assert.ok(evidenceUrl(card, e).startsWith(`${card.agent.repo}/blob/${card.agent.commit}/`), e);
    }
    const card = load(cardFiles()[0]);
    assert.equal(evidenceUrl(card, "a/b.py:3-9"), `${card.agent.repo}/blob/${card.agent.commit}/a/b.py#L3-L9`);
    assert.equal(evidenceUrl(card, "a/b.py:3"), `${card.agent.repo}/blob/${card.agent.commit}/a/b.py#L3`);
  });

  it("the validator goes red on each shape it exists to refuse, and the renderer refuses what it refuses", () => {
    const good = load(cardFiles()[0]);
    const broken = (mutate) => { const c = clone(good); mutate(c); return validateCard(c); };
    assert.notDeepEqual(broken((c) => c.problems.pop()), [], "two problems");
    assert.notDeepEqual(broken((c) => c.problems.push(clone(c.problems[0]))), [], "four problems");
    assert.notDeepEqual(broken((c) => { c.judgments = c.judgments.slice(0, 7); }), [], "seven judgments");
    assert.notDeepEqual(broken((c) => { while (c.judgments.length < 13) c.judgments.push({ ...clone(c.judgments[0]), id: `X${c.judgments.length}` }); }), [], "thirteen judgments");
    assert.notDeepEqual(broken((c) => { c.judgments[1].id = c.judgments[0].id; }), [], "repeated seat id");
    assert.notDeepEqual(broken((c) => { c.judgments[0].holder = "the model"; }), [], "holder outside the enum");
    assert.notDeepEqual(broken((c) => { c.judgments[0].stage = "safety"; }), [], "stage outside the enum");
    assert.notDeepEqual(broken((c) => { c.judgments[0].evidence = "agent.py"; }), [], "evidence with no line");
    assert.notDeepEqual(broken((c) => { c.judgments[0].evidence = "agent.py:30-12"; }), [], "reversed range");
    assert.notDeepEqual(broken((c) => { c.agent.commit = c.agent.commit.slice(0, 8); }), [], "short commit");
    assert.notDeepEqual(broken((c) => { c.problems[0].upstream.status = "open"; }), [], "status outside the enum");
    assert.notDeepEqual(broken((c) => { c.problems[0].upstream.url = null; }), [], "null url on a filed problem");
    assert.notDeepEqual(broken((c) => { c.problems[0].verified.how = "looked"; }), [], "how outside the enum");
    assert.notDeepEqual(broken((c) => { c.judgments[0].score = 0.9; }), [], "a score on a judgment");
    assert.notDeepEqual(broken((c) => { c.total = 7; }), [], "a total on the card");
    assert.throws(() => renderCard({ ...clone(good), problems: [] }), /card refused/);
  });

  it("the renderer escapes the card's text", () => {
    const c = clone(load(cardFiles()[0]));
    c.summary = `<script>alert("x")</script>`;
    const html = renderCard(c);
    assert.ok(!html.includes("<script>alert"), "raw tag not emitted");
    assert.ok(html.includes("&lt;script&gt;"), "escaped form emitted");
  });

  it("LIMIT: the checks are on shape, not truth: a wrong answer with a well-formed evidence pointer passes", () => {
    const c = clone(load(cardFiles()[0]));
    c.judgments[0].answer = "It always asks you first.";
    assert.deepEqual(validateCard(c), []);
  });

  it("LIMIT: the score check reads key names only; a score written into prose passes", () => {
    const c = clone(load(cardFiles()[0]));
    c.summary = "Overall score: 7 out of 10.";
    assert.deepEqual(validateCard(c), []);
  });
});
