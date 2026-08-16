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

describe("rrfFuse — it is actually FUSING (a single-signal sorter must fail here)", () => {
  // The tests above are all satisfied by a plain relevance-only sort, which an
  // adversarial reviewer pointed out — so they prove the fixture, not the lib.
  // This fixture separates all three candidate implementations:
  //   pure recency → a,b,c,d
  //   pure relevance → b,c,d,a
  //   true RRF → b,a,c,d   (a is worst-scored but newest, so fusion lifts it
  //                          above two mid-ranked items; b wins both rankings)
  const pool = [
    { id: "a", score: 0 },
    { id: "b", score: 9 },
    { id: "c", score: 8 },
    { id: "d", score: 7 },
  ];

  it("produces the fused order, which is neither ranking on its own", () => {
    const got = rrfFuse(pool, 4).map((h) => h.id);
    assert.deepEqual(got, ["b", "a", "c", "d"]);
    assert.notDeepEqual(got, ["a", "b", "c", "d"], "that is pure recency");
    assert.notDeepEqual(got, ["b", "c", "d", "a"], "that is pure relevance");
  });

  it("fuses RANKS, not magnitudes — scaling a score without moving its rank changes nothing", () => {
    // The README claims rank fusion specifically, which is what lets a dumb
    // regex match-count work as the second signal. Any implementation that
    // reaches for score VALUES fails this.
    const scaled = pool.map((it) => (it.id === "b" ? { ...it, score: 900_000 } : it));
    assert.deepEqual(rrfFuse(scaled, 4).map((h) => h.id), rrfFuse(pool, 4).map((h) => h.id));
  });

  it("the k constant is applied, not decorative", () => {
    // k damps how much a top rank is worth. A fixture where the newest item is
    // also the worst-scored separates them: at k=60 it stays buried, at k=1 the
    // recency term dominates and it surfaces to second.
    const ids = "abcdefghij".split("");
    const scores = [0, 8, 7, 9, 6, 5, 4, 3, 2, 1];
    const wide = ids.map((id, i) => ({ id, score: scores[i] }));
    assert.deepEqual(rrfFuse(wide, 4, 60).map((h) => h.id), ["b", "d", "c", "e"]);
    assert.deepEqual(rrfFuse(wide, 4, 1).map((h) => h.id), ["d", "b", "a", "c"]);
  });

  it("equal scores fall back to recency order, not to arbitrary sort order", () => {
    const flat = [{ id: "x", score: 3 }, { id: "y", score: 3 }, { id: "z", score: 3 }];
    assert.deepEqual(rrfFuse(flat, 3).map((h) => h.id), ["x", "y", "z"]);
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
