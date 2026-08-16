import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rrfFuse, RRF_K } from "../lib/rrf-fuse.mjs";

describe("rrfFuse — the relevant old hit surfaces (the point of the lib)", () => {
  // Fixture: recency order r0..r5; r4 is an old, highly relevant hit that pure
  // recency-with-limit-3 would have dropped entirely.
  const pool = [
    { id: "r0", score: 1 },
    { id: "r1", score: 0 },
    { id: "r2", score: 0 },
    { id: "r3", score: 0 },
    { id: "r4", score: 5 },
    { id: "r5", score: 0 },
  ];

  it("surfaces the high-score old hit into the top N", () => {
    const top3 = rrfFuse(pool, 3).map((h) => h.id);
    assert.ok(top3.includes("r4"), `r4 must surface, got ${JSON.stringify(top3)}`);
  });

  it("does not let relevance erase recency: the top slot is newest-scored or highest-scored", () => {
    const top3 = rrfFuse(pool, 3).map((h) => h.id);
    assert.ok(top3[0] === "r0" || top3[0] === "r4");
  });

  it("a zero-score oldest hit never beats scored or newer hits", () => {
    assert.ok(!rrfFuse(pool, 3).map((h) => h.id).includes("r5"));
  });

  it("is deterministic and pure — same input, same output, input untouched", () => {
    const before = JSON.stringify(pool);
    const a = rrfFuse(pool, 4).map((h) => h.id);
    const b = rrfFuse(pool, 4).map((h) => h.id);
    assert.deepEqual(a, b);
    assert.equal(JSON.stringify(pool), before);
  });
});

describe("rrfFuse — edges", () => {
  it("empty pool → empty result; limit beyond pool length → whole pool", () => {
    assert.deepEqual(rrfFuse([], 5), []);
    assert.equal(rrfFuse([{ score: 1 }, { score: 0 }], 99).length, 2);
    assert.deepEqual(rrfFuse([{ score: 1 }], 0), []);
  });

  it("tolerates non-array input and missing/NaN scores (read as 0, never poison the sort)", () => {
    assert.deepEqual(rrfFuse(null, 3), []);
    assert.deepEqual(rrfFuse(undefined, 3), []);
    const messy = [{ id: "a" }, { id: "b", score: NaN }, { id: "c", score: 2 }];
    const out = rrfFuse(messy, 3).map((h) => h.id);
    assert.equal(out.length, 3);
    assert.ok(out.indexOf("c") <= 1, "the only real score must not lose to NaN neighbors");
  });

  it("k defaults to 60, the standard constant", () => {
    assert.equal(RRF_K, 60);
  });
});

describe("rrfFuse — limits, pinned as tested expectations", () => {
  it("LIMIT: fuses RANKS, not magnitudes — score 1000 and score 5 are the same rank-1", () => {
    const modest = [{ id: "new", score: 0 }, { id: "old", score: 5 }];
    const huge = [{ id: "new", score: 0 }, { id: "old", score: 1000 }];
    assert.deepEqual(
      rrfFuse(modest, 2).map((h) => h.id),
      rrfFuse(huge, 2).map((h) => h.id),
    );
  });

  it("LIMIT: an all-zero relevance signal degrades to pure recency — fusion cannot invent a signal", () => {
    const flat = [{ id: "n0", score: 0 }, { id: "n1", score: 0 }, { id: "n2", score: 0 }];
    assert.deepEqual(rrfFuse(flat, 2).map((h) => h.id), ["n0", "n1"]);
  });

  it("LIMIT: it ranks the pool it is given — a hit truncated away upstream cannot surface", () => {
    // The relevant old hit was cut before fusion; no k value brings it back.
    const truncated = [{ id: "r0", score: 1 }, { id: "r1", score: 0 }]; // r4 never collected
    assert.ok(!rrfFuse(truncated, 2).map((h) => h.id).includes("r4"));
  });
});
