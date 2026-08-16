// @ts-check
/**
 * memory-usage-ledger.mjs — usage evidence for agent-memory eviction: the
 * tally is EVIDENCE for a human/agent eviction pass, never a verdict.
 *
 * The failure this guards against: agent memory directories only grow, and
 * the pruning pass (ours runs monthly) works from judgment alone — "does this
 * fact still look useful?" — with zero evidence about which memories actually
 * carried load. Judgment-only pruning fails in both directions: it keeps
 * plausible-looking facts nothing has read in months, and it deletes an
 * ugly-looking fact that quietly settles a recurring decision every week.
 *
 * The fix is a usage ledger. At session close, the agent records which memory
 * files were load-bearing THIS session (a "touch": {ts, name, session} — one
 * append-only JSONL row each). The eviction pass then reads a tally: per-file
 * touch counts, last-touch date, and the never-touched list over a window.
 * The ledger only RECORDS — eviction stays a judgment, now evidence-based.
 *
 * Two systems arrived at usage-scored memory independently, which is why we
 * trust the shape: PEEK's evictor (arXiv:2605.19932 — per-run helpful/harmful/
 * stale tags accumulated into a score, deterministic lowest-first eviction
 * under a token budget) and yc-software/qm's memory-strategy bench
 * (src/memory/bench.ts — strategies scored on signal-to-noise and staleness).
 * Both score memory by USE; both keep the scoring deterministic and the
 * policy separate. This lib is the minimal convergent core: record use,
 * report use, decide elsewhere. PEEK's litmus question is the right lens for
 * the pass that consumes the tally: "would a DIFFERENT future question
 * benefit from this item?"
 *
 * Pure — the caller does all I/O (read the JSONL, append rows, list the
 * fact files), same contract as memory-integrity.mjs.
 *
 * WHAT THIS DOES NOT CATCH:
 * - **An empty ledger is absence of evidence, not evidence of rot** (pinned
 *   by a test). With zero rows read, EVERY file lands in `neverTouched`; the
 *   tally reports `rowsRead` exactly so a consumer can refuse to treat that
 *   as an eviction signal. A never-touched list only means something once
 *   sessions have been recording for a meaningful fraction of the window.
 * - **Touches are self-reported** (operational limit — it lives in your
 *   session-close discipline, not in this code). A session that forgets to
 *   record under-counts; a session that touches everything it merely LOADED
 *   (rather than what changed a decision) over-counts. The convention —
 *   touch = load-bearing, not merely present in context — lives in the
 *   prompt/skill that calls this.
 * - **A future-dated touch counts, unclamped** (pinned by a test) — clamping
 *   would hide the writer bug that produced it, same doctrine as
 *   stale-basis.mjs.
 * - **It counts, it does not judge.** No score threshold, no auto-evict, no
 *   token budget. Those are policy; PEEK shows one way to make them
 *   deterministic once you have this evidence base.
 *
 * Tested in test/memory-usage-ledger.test.mjs.
 */

/**
 * Parse ledger JSONL text into rows. Fail-soft: blank lines and unparseable
 * lines are dropped, CRLF tolerated.
 * @param {string|null|undefined} text
 * @returns {Array<Record<string, unknown>>}
 */
export function parseLedgerText(text) {
  if (typeof text !== "string" || !text) return [];
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      try {
        const v = JSON.parse(l);
        return v && typeof v === "object" && !Array.isArray(v) ? v : null;
      } catch {
        return null;
      }
    })
    .filter((v) => v !== null);
}

/**
 * Build the rows a session-close touch should append. Names are bare fact
 * slugs (the file basename without .md) — path-shaped or .md-suffixed names
 * are REJECTED, not silently normalized, so a caller bug surfaces at write
 * time instead of corrupting the tally. Names absent from `knownNames` are
 * still recorded (the file may be written later this same close-out) but
 * reported in `unknown` so the caller can warn on a likely typo.
 *
 * @param {ReadonlyArray<string>} names
 * @param {{session?: string|null, now?: number, knownNames?: Iterable<string>}} [opts]
 * @returns {{rows: Array<{ts: string, name: string, session: string|null}>, rejected: string[], unknown: string[]}}
 */
export function makeTouchRows(names, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const now = Number.isFinite(o.now) ? /** @type {number} */ (o.now) : Date.now();
  const known = o.knownNames ? new Set(o.knownNames) : null;
  const list = Array.isArray(names) ? names : [];
  /** @type {{rows: Array<{ts: string, name: string, session: string|null}>, rejected: string[], unknown: string[]}} */
  const out = { rows: [], rejected: [], unknown: [] };
  const ts = new Date(now).toISOString();
  for (const raw of list) {
    const name = typeof raw === "string" ? raw.trim() : "";
    if (!name || /[\\/]/.test(name) || name.endsWith(".md")) {
      out.rejected.push(String(raw));
      continue;
    }
    out.rows.push({ ts, name, session: typeof o.session === "string" ? o.session : null });
    if (known && !known.has(name)) out.unknown.push(name);
  }
  return out;
}

/**
 * Tally ledger rows over a window against the current fact-file names.
 * Malformed rows (missing/at-wrong-type name or ts, unparseable ts) are
 * dropped fail-soft. `rowsRead` counts well-formed rows BEFORE the window
 * filter — a consumer must check it before reading `neverTouched` as
 * evidence (rowsRead === 0 means the instrument has no data, not that the
 * memories are dead — the dead-instrument zero from
 * patterns/checks-that-cant-fail.md).
 *
 * @param {ReadonlyArray<Record<string, unknown>>} rows
 * @param {ReadonlyArray<string>} factNames  current fact slugs (no index file, no .md)
 * @param {{days?: number, now?: number}} [opts]
 * @returns {{
 *   touched: Array<{name: string, count: number, lastTouch: string}>,
 *   neverTouched: string[],
 *   windowDays: number,
 *   rowsRead: number,
 * }}
 */
export function tallyUsage(rows, factNames, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const days = Number.isFinite(o.days) && /** @type {number} */ (o.days) > 0 ? /** @type {number} */ (o.days) : 90;
  const now = Number.isFinite(o.now) ? /** @type {number} */ (o.now) : Date.now();
  const cutoff = now - days * 24 * 60 * 60 * 1000;

  let rowsRead = 0;
  /** @type {Map<string, {count: number, lastTouch: string}>} */
  const counts = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r.name !== "string" || typeof r.ts !== "string") continue;
    const t = Date.parse(r.ts);
    if (!Number.isFinite(t)) continue;
    rowsRead++;
    if (t < cutoff) continue; // future-dated rows pass, deliberately — see header
    const e = counts.get(r.name) ?? { count: 0, lastTouch: r.ts };
    e.count++;
    if (r.ts > e.lastTouch) e.lastTouch = r.ts;
    counts.set(r.name, e);
  }

  const touched = [...counts.entries()]
    .map(([name, e]) => ({ name, ...e }))
    .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
  const names = Array.isArray(factNames) ? factNames.filter((f) => typeof f === "string") : [];
  const neverTouched = names.filter((f) => !counts.has(f)).sort();
  return { touched, neverTouched, windowDays: days, rowsRead };
}
