// @ts-check
// known-flags.mjs — an unrecognized option is a usage error, not a default.
//
// The incident this generalizes: four CLI writers parsed argv permissively —
// an unknown `--flag` landed in the args bag and was never read, so the call
// ran with the flag silently dropped and returned `{ok:true}`. One documented
// flag was never implemented at all and "worked" three times (the CLI fell
// through to its default action and returned that action's shape); a typo'd
// scope flag made a fleet-wide scan cover 2 files instead of 1,192 and print
// PASS. A typo'd or aspirational flag must FAIL, not be ignored.
//
// Deliberately not a parser: callers keep their own parseArgs (they differ —
// repeated flags, stray positional collection). This asserts over raw argv,
// so adoption is one call and no parsing behavior moves.
//
// FAIL-CLOSED at the gate: any unknown `--flag` refuses the whole run, before
// anything is written. The refusal prints EVERY offender, so one re-run fixes
// the whole command line.
//
// WHERE IT STOPS:
//  - Only `--long` flags are checked. Single-dash short options, bare
//    positionals, and anything after a literal `--` pass untouched — those
//    are the caller's to validate.
//  - It cannot know a KNOWN flag is unimplemented. The incident's worst case
//    (a documented flag that fell through to the default action) is only
//    caught here once the flag is removed from the known set; keeping the
//    known set equal to the IMPLEMENTED set is the caller's contract.
//  - `entry` gating compares resolved file URLs; on exotic loaders where
//    `import.meta.url` is not a file URL, the comparison fails closed to
//    "not the entry" and the guard becomes a no-op for that module.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Is `moduleUrl` (a caller's import.meta.url) the process entry script? */
function isEntryModule(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try { return pathToFileURL(resolve(entry)).href === moduleUrl; } catch { return false; }
}

/** Levenshtein distance, capped work — flag names are short. */
function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Nearest known flag for a bad token, or null. Distance ≤ 3 and ≤ ~⅓ of the
 * flag's length, so an unrelated token gets no misleading suggestion. */
function suggest(bad, known) {
  const lower = bad.toLowerCase();
  let best = null;
  let bestD = Infinity;
  for (const k of known) {
    const d = editDistance(lower, k.toLowerCase());
    if (d < bestD) { bestD = d; best = k; }
  }
  if (best === null) return null;
  return bestD <= Math.min(3, Math.max(1, Math.ceil(best.length / 3))) ? best : null;
}

/**
 * Collect unknown `--flags` from raw argv.
 * @param {string[]} argv - process.argv.slice(2)
 * @param {Iterable<string>} knownFlags - flag names WITHOUT the leading `--`
 * @returns {string[]} human-readable messages, one per unknown flag (empty = clean)
 */
export function findUnknownFlags(argv, knownFlags) {
  const known = new Set(knownFlags);
  const msgs = [];
  for (const tok of Array.isArray(argv) ? argv : []) {
    if (typeof tok !== "string" || !tok.startsWith("--")) continue;
    if (tok === "--") break; // conventional end-of-flags
    const key = tok.slice(2).split("=")[0];
    if (key === "" || known.has(key)) continue;
    const near = suggest(key, known);
    msgs.push(`unknown flag --${key}${near ? ` (did you mean --${near}?)` : ""}`);
  }
  return msgs;
}

/**
 * Hard-error on any unknown flag. Prints every offender (not just the first)
 * so one re-run fixes the whole command line.
 * @param {string[]} argv
 * @param {Iterable<string>} knownFlags
 * @param {string} scriptName - prefix for the error lines
 * @param {{ exit?: ((code: number) => void) | number, log?: (msg: string) => void, entry?: string }} [io]
 *   `entry: import.meta.url` — enforce ONLY when the calling module is the
 *   process entry script. REQUIRED for any script that is also IMPORTED: a
 *   module-scope call without it scans the IMPORTER's argv, and the importer's
 *   perfectly valid flags get refused by a library it never called.
 *
 *   `exit` accepts EITHER a function OR a plain exit-code NUMBER. The number
 *   form exists because prose documentation described this option as "the
 *   exit override carries a non-2 usage code," and two independent authors
 *   read that as a number and passed one. Under the old function-only
 *   contract that crashed with `exit is not a function` — a TypeError stack
 *   trace on the ONE path whose whole job is turning a typo into a clean
 *   refusal. Found by an adversarial review. The doc was not wrong about
 *   intent; the lib was too narrow: accept both rather than fix two call
 *   sites and leave the next author the same trap.
 * @returns {boolean} true when clean (only reachable if `exit` does not exit)
 */
export function assertKnownFlags(argv, knownFlags, scriptName, io = {}) {
  if (typeof io.entry === "string" && !isEntryModule(io.entry)) return true;
  const msgs = findUnknownFlags(argv, knownFlags);
  if (msgs.length === 0) return true;
  const log = io.log ?? ((m) => console.error(m));
  const exit =
    typeof io.exit === "function"
      ? io.exit
      : Number.isInteger(io.exit)
        ? () => process.exit(io.exit)
        : (c) => process.exit(c);
  for (const m of msgs) log(`${scriptName}: ${m}`);
  log(
    `${scriptName}: ${msgs.length} unknown flag(s) — nothing was written. ` +
      `A dropped flag returns ok:true with the flag ignored, which is how a ` +
      `documented-but-unimplemented flag can "work" repeatedly without existing. ` +
      `Run --help for the flag list.`,
  );
  exit(2);
  return false;
}
