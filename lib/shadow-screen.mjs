// @ts-check
/**
 * shadow-screen.mjs — the four-state gate vocabulary, plus the fifth verdict
 * that keeps it honest: a check that never ran must never read as a pass.
 *
 * Any screen you put in front of agent actions (a security classifier, a
 * policy regex, a quality gate) should ship watching before it ships
 * enforcing — enforcement gates over-fire on day one, and the only way to
 * learn a gate's false-positive rate without burning operator trust is to
 * run it in shadow: record what it WOULD have done while the action
 * proceeds. That needs vocabulary. A boolean "blocked?" collapses four
 * different facts into two, and the collapsed log is unreadable when you
 * later ask "is this gate ready to enforce?"
 *
 * The four states (credit: yc-software/qm's security screen,
 * src/core/orchestrator/security-screen.ts, which ships exactly this
 * vocabulary):
 *
 *   watching:   would_block  — the gate fired; the action proceeded anyway
 *               shadow_allow — the gate stayed quiet; the action proceeded
 *   enforcing:  block        — the gate fired; the action was stopped
 *               allow        — the gate stayed quiet; the action proceeded
 *
 * And the fifth, the one most implementations silently lack: `unscreened` —
 * the screener never ran (unavailable, timed out, threw, returned garbage).
 * qm makes this an explicit verdict rather than defaulting to allow, and
 * that choice is the entire reason to copy them: a screen that is down looks
 * EXACTLY like a screen with nothing to report unless you engineer the
 * difference in. This is the same failure family as this repo's
 * patterns/checks-that-cant-fail.md (the dead-instrument zero, the
 * config-absent silent disable) arriving from an independent codebase —
 * convergence is the evidence the pattern is real.
 *
 * Posture: FAIL-CLOSED at the gate, per this repo's design rules. In enforce
 * mode an unscreened action does NOT proceed unless the caller explicitly
 * declares `unscreenedProceeds: true` — fail-open becomes an edit visible in
 * code review, never a default. In shadow mode the action always proceeds
 * (a watching gate never gates), including when unscreened. An unknown
 * `mode` string is treated as the enforce branch: a typo\'d deployment gets
 * safe-and-noisy, not silently-watching.
 *
 * WHAT THIS DOES NOT DO (each pinned by a test or labeled operational):
 * - **It classifies one decision; it does not log, aggregate, or enforce.**
 *   Wiring `proceed` to actual enforcement — and writing every verdict
 *   somewhere a human reviews — is the caller's. A caller that ignores
 *   `proceed` has a shadow screen wearing an enforce label (operational
 *   limit; no pure function can detect its caller).
 * - **`isPass` refuses to count `unscreened` or `would_block` as passes** —
 *   so a dashboard tallying pass rates cannot absorb a dark screener into
 *   its green number.
 * - **It cannot judge the screener's quality.** Garbage-in: a screener that
 *   confidently returns `flagged: false` on everything yields wall-to-wall
 *   allows. Prove the screener can fire (see checks-that-cant-fail) before
 *   trusting its quiet.
 *
 * Zero dependencies, pure. Tested in test/shadow-screen.test.mjs.
 */

/** @typedef {"allow"|"block"|"shadow_allow"|"would_block"|"unscreened"} ScreenVerdict */

export const VERDICTS = Object.freeze(
  /** @type {const} */ (["allow", "block", "shadow_allow", "would_block", "unscreened"]),
);

/**
 * Classify one screened action.
 *
 * @param {{
 *   mode: "shadow"|"enforce"|string,
 *   ran?: boolean,
 *   flagged?: boolean,
 *   unscreenedProceeds?: boolean,
 * }} input
 *   mode — "shadow" (watching: never gates) or "enforce" (gating). Anything
 *     else is treated as enforce (fail-closed on a typo'd deployment).
 *   ran — did the screener actually run to completion? Defaults false.
 *   flagged — the screener's finding. A non-boolean `flagged` with ran=true
 *     means the screener returned garbage → counts as not-run.
 *   unscreenedProceeds — enforce-mode-only escape hatch: declared fail-open
 *     for unscreened actions. Default false (fail-closed).
 * @returns {{verdict: ScreenVerdict, proceed: boolean}}
 */
export function screenDecision(input) {
  const o = input && typeof input === "object" ? input : {};
  const shadow = o.mode === "shadow";
  const ran = o.ran === true && typeof o.flagged === "boolean";

  if (!ran) {
    return { verdict: "unscreened", proceed: shadow ? true : o.unscreenedProceeds === true };
  }
  if (shadow) {
    return o.flagged ? { verdict: "would_block", proceed: true } : { verdict: "shadow_allow", proceed: true };
  }
  return o.flagged ? { verdict: "block", proceed: false } : { verdict: "allow", proceed: true };
}

/**
 * Is this verdict a PASS — evidence the screener looked and found nothing?
 * True only for "allow" and "shadow_allow". `unscreened` is not a pass (the
 * screener never looked) and `would_block` is not a pass (it looked and
 * found something, whatever the mode let through).
 * @param {string} verdict
 * @returns {boolean}
 */
export function isPass(verdict) {
  return verdict === "allow" || verdict === "shadow_allow";
}
