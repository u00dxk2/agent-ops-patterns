// @ts-check
/**
 * rrf-fuse.mjs — reciprocal rank fusion of a recency ranking and a relevance
 * ranking, because recency-only recall buries the relevant old hit.
 *
 * The failure this guards against: every practical agent-recall path (bus
 * messages, session transcripts, memory files) is stored newest-first, so the
 * lazy implementation returns the newest N matches and stops. That ranking is
 * wrong in exactly the case recall matters most — the question whose real
 * answer was written three weeks ago. A marginal hit from an hour ago outranks
 * the on-point hit from last month every time, and the agent re-derives (or
 * re-asks) what the system already knew.
 *
 * The fix is not a better relevance model — it is refusing to pick one axis.
 * Over-collect a candidate pool, rank it twice (by recency = the pool's input
 * order, and by whatever cheap relevance score you have), and fuse the two
 * rankings with Reciprocal Rank Fusion: each item's fused score is
 * Σ 1/(k + rank_i) across the rankings, k = 60 per the original paper. RRF
 * fuses RANKS, not score magnitudes, so the two signals need no common scale —
 * a match-count works fine against a timestamp ordering.
 *
 * Zero LLM calls, zero dependencies, pure. The relevance score can be as dumb
 * as a regex match count; rank fusion forgives bad calibration because only
 * the ordering survives.
 *
 * WHAT THIS DOES NOT DO (each pinned by a test):
 * - **It fuses ranks, not magnitudes.** A score of 1000 and a score of 5 are
 *   both just "rank 1" in their ranking. If magnitude should matter, that is
 *   your relevance ranking's job before fusion.
 * - **It cannot rescue an empty relevance signal.** All-zero scores degrade to
 *   pure recency (ties break toward the input order) — fusion adds nothing
 *   when one ranking says nothing. The score's quality stays the caller's.
 * - **It ranks the pool it is given.** If the candidate collection already
 *   truncated to newest-N before fusing, the relevant old hit was buried
 *   upstream and no fusion can surface it. Over-collect (we use 3× the final
 *   limit per source) BEFORE calling this.
 *
 * Lineage: extracted from the cross-session search path of a production
 * multi-agent system (2026-08-15), where results were pure recency until an
 * evaluation of TencentCloud/TencentDB-Agent-Memory's hybrid retrieval
 * (MemoryCore/src/core/store/search-utils.ts) prompted the upgrade. RRF itself
 * is Cormack, Clarke & Buettcher, SIGIR 2009 — "Reciprocal rank fusion
 * outperforms Condorcet and individual rank learning methods".
 *
 * Tested in test/rrf-fuse.test.mjs.
 */

export const RRF_K = 60;

/**
 * Fuse recency order (the pool's input order) with score order via RRF;
 * return the top `limit` items. Pure. Stable on ties (earlier in the input —
 * i.e. more recent — wins). A non-finite or missing `score` reads as 0 rather
 * than poisoning the sort.
 *
 * @template {{score?: number}} T
 * @param {ReadonlyArray<T>} pool  candidates in recency order, each carrying a
 *   numeric relevance `score` (higher = more relevant)
 * @param {number} limit  how many to keep
 * @param {number} [k]  RRF constant (default 60, the standard)
 * @returns {T[]}
 */
export function rrfFuse(pool, limit, k = RRF_K) {
  if (!Array.isArray(pool) || pool.length === 0) return [];
  const s = (/** @type {T} */ it) => (Number.isFinite(it?.score) ? /** @type {number} */ (it.score) : 0);
  const scoreOrder = pool
    .map((item, i) => ({ item, i }))
    .sort((a, b) => s(b.item) - s(a.item) || a.i - b.i);
  const scoreRank = new Map(scoreOrder.map((e, rank) => [e.i, rank]));
  return pool
    .map((item, i) => ({ item, i, rrf: 1 / (k + i) + 1 / (k + /** @type {number} */ (scoreRank.get(i))) }))
    .sort((a, b) => b.rrf - a.rrf || a.i - b.i)
    .slice(0, Math.max(0, limit))
    .map((e) => e.item);
}
