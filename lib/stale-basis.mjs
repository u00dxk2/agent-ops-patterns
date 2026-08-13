// @ts-check
/**
 * stale-basis.mjs — one staleness chain, imported everywhere, with bulk-write
 * timestamps deliberately excluded.
 *
 * The failure this guards against has two halves, and we shipped both:
 *
 * 1. TWO READERS, TWO VERDICTS. Two consumers of the same tracker file aged
 *    items with *different* freshness chains — an API surface used
 *    newest-of(lastEvaluated, lastChecked, linked-commit date) while a local
 *    check used lastEvaluated-else-updated-else-created. Same file, same item,
 *    one surface said "stale", the other said "fresh" — and dozens of items
 *    were invisible to one reader entirely. The fix was not better
 *    discipline; it was making divergence structurally impossible: ONE
 *    exported function, and every reader imports it. If you hand-roll a
 *    staleness chain at a second call site, you have already lost — the two
 *    copies will drift the first time someone edits one of them.
 *
 * 2. THE BULK WRITE THAT RESET EVERY CLOCK. A generic `updated` timestamp is
 *    stamped by every write — including a mass migration, a formatting pass,
 *    a script that touches 200 rows in one commit. If `updated` participates
 *    in the staleness basis, one bulk edit silently re-dates the entire
 *    tracker and every stale item hides for another cycle. So the chain here
 *    takes an explicit list of SIGNAL fields — timestamps a writer stamps
 *    only when the item was actually looked at with the possibility of
 *    changing its disposition — and `updated`-style fields are deliberately
 *    not in it. This is a convention the function can enforce but not verify
 *    (see limits below).
 *
 * The returned verdict names WHICH basis won, so a consumer can render
 * "stale per lastChecked" vs "stale per linked-commit" instead of a bare
 * date — when a staleness call surprises someone, the label is the
 * difference between a two-minute answer and an argument.
 *
 * Posture: FAIL-SOFT on malformed input (an unparseable date is skipped, a
 * garbage item yields {date: null, basis: "none"}) — but "none" is a
 * DISTINCT verdict, not "fresh". A caller that treats no-basis as fresh has
 * rebuilt the dead-instrument zero from patterns/checks-that-cant-fail.md;
 * treat "none" as maximally stale or surface it as its own finding.
 *
 * WHAT THIS DOES NOT CATCH (each pinned by a test):
 * - **A dishonest signal.** If a writer stamps a signal field during a bulk
 *   write, the clock resets and this function cannot tell. The convention —
 *   signal fields are stamped by disposition-changing reads only — lives in
 *   your writers; this function only enforces the chain.
 * - **A future-dated signal wins.** No clamping, deliberately: clamping to
 *   now() would silently hide the writer bug that produced the future date.
 *   Pair with a lint that flags future-dated signals if your writers might
 *   produce them.
 * - **It answers "when", not "how stale is too stale".** Thresholds are
 *   policy and stay in the caller.
 *
 * Zero dependencies, pure. Tested in test/stale-basis.test.mjs.
 */

/**
 * @typedef {{date: string|null, basis: string}} StaleBasis
 */

/**
 * Pick the staleness basis for an item: the NEWEST valid date among the
 * declared signal fields and any caller-resolved external signals, else the
 * created date, else {date: null, basis: "none"}.
 *
 * @param {Record<string, unknown>|null|undefined} item
 * @param {{
 *   signalFields?: readonly string[],
 *   createdField?: string,
 *   externalSignals?: ReadonlyArray<{date: string|null|undefined, basis: string}>,
 * }} [opts]
 *   signalFields — the item's own signal-date fields, in your schema's names
 *     (default ["lastEvaluated", "lastChecked"]). Put ONLY fields stamped by
 *     disposition-changing reads here — never a bulk-write `updated`.
 *   externalSignals — signals the caller resolves outside the item, e.g. the
 *     newest linked-commit date from `git show`, labeled with their basis.
 *   createdField — the fallback when no signal exists (default "created").
 * @returns {StaleBasis}
 */
export function pickStaleBasis(item, opts = {}) {
  const {
    signalFields = ["lastEvaluated", "lastChecked"],
    createdField = "created",
    externalSignals = [],
  } = opts;

  /** @type {Array<{date: string, basis: string}>} */
  const candidates = [];
  const push = (/** @type {unknown} */ v, /** @type {string} */ basis) => {
    if (typeof v === "string" && v.trim() && !Number.isNaN(Date.parse(v.trim()))) {
      candidates.push({ date: v.trim(), basis });
    }
  };
  for (const field of signalFields) push(item?.[field], field);
  for (const ext of externalSignals) push(ext?.date, String(ext?.basis ?? "external"));

  if (candidates.length > 0) {
    candidates.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    return candidates[0];
  }
  const created = item?.[createdField];
  if (typeof created === "string" && !Number.isNaN(Date.parse(created))) {
    return { date: created, basis: createdField };
  }
  return { date: null, basis: "none" };
}
