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
 * Posture: FAIL-SOFT on malformed input (a value that is not an accepted date
 * form — see DATE_SHAPE — is skipped, however `Date.parse` would read it; a
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
 * The date forms that count: `YYYY-MM-DD` naming a real calendar day, optionally
 * followed by a time (`T`, `t` or a space, then `HH:MM[:SS[.fraction]]`) and a
 * `Z` or `±HH[:]MM` offset; `Date.parse` must also accept it. A time with no
 * offset is read in the host's timezone (JavaScript's rule); a bare date as UTC.
 *
 * Why a shape check at all: `Date.parse` alone is not a date check. V8 reads
 * "see PR 4821" as the year 4821 and "build 12" as December 2001, so a note typed
 * into a signal field could win the chain and hold the item fresh until that
 * date. And V8 rolls impossible days over (`2026-02-30` → March 2), so the day
 * is checked against its month too.
 */
const DATE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:[Zz]|[+-]\d{2}:?\d{2})?)?$/;

/** @param {unknown} v @returns {v is string} */
function isAcceptedDate(v) {
  if (typeof v !== "string") return false;
  const m = DATE_SHAPE.exec(v.trim());
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const day = new Date(Date.UTC(y, mo - 1, d));
  if (day.getUTCFullYear() !== y || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) return false;
  return !Number.isNaN(Date.parse(v.trim()));
}

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
export function pickStaleBasis(item, opts) {
  // Fail-soft on malformed OPTIONS too, not just malformed items: a null
  // opts bag or a non-array field falls back to the defaults instead of
  // throwing (a staleness probe that throws reads as "no findings" in most
  // harnesses — the dead-instrument zero again).
  const o = opts && typeof opts === "object" ? opts : {};
  const signalFields = Array.isArray(o.signalFields) ? o.signalFields : ["lastEvaluated", "lastChecked"];
  const createdField = typeof o.createdField === "string" && o.createdField ? o.createdField : "created";
  const externalSignals = Array.isArray(o.externalSignals) ? o.externalSignals : [];

  /** @type {Array<{date: string, basis: string}>} */
  const candidates = [];
  const push = (/** @type {unknown} */ v, /** @type {string} */ basis) => {
    if (isAcceptedDate(v)) candidates.push({ date: v.trim(), basis });
  };
  for (const field of signalFields) push(item?.[field], field);
  for (const ext of externalSignals) push(ext?.date, String(ext?.basis ?? "external"));

  if (candidates.length > 0) {
    candidates.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    return candidates[0];
  }
  const created = item?.[createdField];
  if (isAcceptedDate(created)) {
    return { date: created.trim(), basis: createdField };
  }
  return { date: null, basis: "none" };
}
