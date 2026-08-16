// @ts-check
/**
 * scannable-command.mjs — de-obfuscate command text BEFORE your policy
 * regexes see it, so a deny rule can't be dodged by quoting.
 *
 * The failure this guards against: any policy layer that pattern-matches
 * command text (a PreToolUse hook, a deny-list, a "this flag is banned in
 * this context" rule) judges the LITERAL string — but the shell does not
 * execute the literal string. `--bo"dy"`, `agent-'status'.mjs`, `--bo\dy`,
 * and `$'--body'` all execute identically to the un-quoted spelling, and
 * every one of them sails past a regex written against the plain form. An
 * agent does not even need to be adversarial to hit this: models emit
 * quote-split tokens naturally when escaping gets hairy.
 *
 * The fix (credit where due: this is a port of the normalization idea in
 * yc-software/qm's command policy, src/policy/command-policy.ts — their
 * `scannableCommand()`): normalize the command to what the shell will
 * actually see, then scan. Three passes, iterated to a fixpoint (depth ≤ 8):
 *   1. ANSI-C $'…' wrappers unwrapped (common escapes decoded);
 *   2. bare ' and " characters dropped, their CONTENT kept
 *      (`agent-'status'` scans as `agent-status`);
 *   3. a backslash escaping an ordinary word char or dash dropped
 *      (`--bo\dy` scans as `--body`) — but preserved after a drive-colon or
 *      another backslash, so C:\ and \\server path shapes survive.
 *
 * THE DOCTRINE — raw OR normalized, detection-widening ONLY: every policy
 * regex runs against the raw text AND the normalized text, and a hit on
 * either counts. Normalization can add a hit, never remove one — so a
 * command that was clean raw can never become blocked-by-normalization-bug,
 * and a command that matched raw still matches when normalization mangles
 * it. `matchesRawOrScannable()` is that doctrine as a function; use it
 * instead of hand-wiring the two `.test()` calls, because the version with
 * one call is the version someone will ship.
 *
 * HONEST FRAMING (qm's, and it is exactly right): this is "a speed bump
 * against mistakes and injection, not a sandbox boundary." A determined
 * adversary defeats any text-level normalizer; the real boundary is your
 * sandbox/permission layer. What this buys is that the 95% of evasions that
 * are accidents of quoting — plus the lazy tier of deliberate ones — hit
 * the policy they were supposed to hit.
 *
 * WHAT THIS DOES NOT CATCH (each pinned by a test):
 * - **Space-separated tokens.** `--bo dy` stays two tokens; joining
 *   arbitrary adjacent words would turn prose MENTIONS of a flag into
 *   matches and train operators to dismiss the alarm. Deliberate.
 * - **Variable/parameter expansion.** `X=--body; cmd $X` is opaque without
 *   executing the shell. Not modeled.
 * - **Encoded payloads.** `echo LS1ib2R5 | base64 -d | sh` — the payload is
 *   data until an interpreter runs it. qm re-scans payloads fed to
 *   interpreters; this port does not (that needs an execution model, not a
 *   regex pass).
 * - **Heredoc semantics.** `<<'EOF'` (no expansion) and `<<EOF` (expansion)
 *   normalize identically — the quote-strip treats heredoc-delimiter quotes
 *   like any others. Heredoc BODIES stay visible to your regexes (they are
 *   part of the text), but a policy that depends on whether a heredoc
 *   expands cannot use this pass to tell.
 *
 * Zero dependencies, pure. Tested in test/scannable-command.test.mjs.
 */

/**
 * Normalize command text to the form the shell will execute, for scanning
 * purposes only — never execute or store the normalized form.
 * @param {string|undefined|null} text
 * @returns {string}
 */
export function scannableCommand(text) {
  if (typeof text !== "string" || text.length === 0) return "";
  let cur = text;
  for (let depth = 0; depth < 8; depth++) {
    const next = cur
      .replace(/\$'((?:[^'\\]|\\.)*)'/g, (_, inner) =>
        inner.replace(/\\(n|t|r|\\|')/g, (_m, /** @type {"n"|"t"|"r"|"\\"|"'"} */ c) => ({ n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'" }[c])),
      )
      .replace(/['"]/g, "")
      .replace(/([^\\:])\\([A-Za-z0-9-])/g, "$1$2")
      .replace(/^\\([A-Za-z0-9-])/g, "$1");
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

/**
 * The raw-OR-normalized doctrine as a function: does `re` match the raw
 * command OR its scannable form? Widening only — a raw match always counts,
 * whatever normalization does to it. The regex is re-created without the /g
 * flag so a caller's global regex can't skip matches via lastIndex state.
 * @param {RegExp} re
 * @param {string|undefined|null} command
 * @returns {boolean}
 */
export function matchesRawOrScannable(re, command) {
  if (!(re instanceof RegExp) || typeof command !== "string" || command.length === 0) return false;
  const r = new RegExp(re.source, re.flags.replace(/g/g, ""));
  return r.test(command) || r.test(scannableCommand(command));
}
