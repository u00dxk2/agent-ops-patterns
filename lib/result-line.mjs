// @ts-check
/**
 * result-line.mjs — a terminal, greppable verdict line so a pipe cannot eat
 * the answer.
 *
 * The incident this generalizes recurred on four independent agent lanes in
 * one day, against a correct, indexed, starred standing rule that said not to
 * do it: `cmd | tail -N; echo exit:$?` prints TAIL's exit, not the command's.
 * The same class arrives as `| head -5` printing EXIT=0 over an exit 1, as
 * `npm test > out; grep '^# tests' out` reporting FAILED over a fully passing
 * suite, as a backgrounded compound reporting 0 over a 127, and as PowerShell
 * `Select-Object -Last 4` hiding the failing lines. Documentation is not the
 * remedy; documentation is what already existed.
 *
 * The remedy: every verdict-emitting check prints ONE line as its LAST stdout
 * line, carrying the verdict in the TEXT rather than only in the exit code:
 *
 *     RESULT: PASS (exit 0)
 *     RESULT: FAIL — 3 findings (exit 3)
 *     RESULT: NOTHING-SWEPT — 0 files matched the scope (exit 2)
 *
 * A truncating `tail`, a captured file, a backgrounded compound, or a
 * PowerShell `-Last N` all still carry it, and `grep '^RESULT:'` finds it
 * anywhere. The exit code stays authoritative for CI — this is a second,
 * pipe-proof carrier of the same fact, never a replacement.
 *
 * Usage — one call near the top of the script, before any exit path:
 *
 *     import { armResultLine } from "./lib/result-line.mjs";
 *     armResultLine({ 0: "PASS", 2: "NOTHING-SWEPT", 3: "FAIL" });
 *
 * It rides `process.on("exit")` and writes with fs.writeSync, so it fires on
 * `process.exit()`, on `process.exitCode` + natural drain, and on an uncaught
 * throw — every path a check script can leave by. Call `setResultDetail()` at
 * any point to attach the count/reason the verdict is about.
 *
 * FAIL-SAFE by construction: an unmapped exit code renders the code itself
 * rather than guessing a verdict, and the emitter swallows its own errors — a
 * bug in the verdict line must never change a check's exit code or crash it.
 *
 * WHERE IT STOPS:
 *  - It cannot survive `kill -9` / abrupt process death — nothing in-process
 *    can. The exit code (or its absence) is still the contract there.
 *  - `fd: 2` is MANDATORY for a run producing machine-readable stdout
 *    (`--json`): a verdict line appended after a JSON document makes the
 *    document unparseable — caught by a downstream consumer's test the first
 *    time the origin shipped this, which is exactly the "a fix that breaks a
 *    consumer far from its cause" shape the motivating retro was about.
 *    Compute the JSON flag BEFORE arming and pass `{ fd: 2 }`.
 *  - One line per PROCESS. A nested gate's verdict line reads as the OUTER
 *    script's verdict unless the parent declares the nesting (see
 *    RESULT_LINE_NEST below); the parent must do it, because only the parent
 *    knows it is one.
 */

import { writeSync } from "node:fs";

// Controlled vocabulary. The trap this guards is LOUD on purpose: three
// origin scripts once used DELIBERATE labels outside the list, and every one
// silently rendered UNKNOWN at the moment it mattered. The vocabulary stays
// controlled, but armResultLine warns at ARM time about any mapped label
// outside it, so the next custom label fails visibly on every invocation
// instead of quietly printing UNKNOWN on the one exit that counts.
const KNOWN_VERDICTS = new Set(["PASS", "FAIL", "NOTHING-SWEPT", "ERROR", "REVIEW", "FINDINGS", "REAPED"]);

/**
 * Labels in a caller's map that the vocabulary would discard. Exported so the
 * arm-time warning is unit-testable.
 * @param {Record<number, string>} map
 * @returns {string[]}
 */
export function unknownLabelsInMap(map) {
  const m = map && typeof map === "object" ? map : {};
  return [...new Set(Object.values(m).filter((v) => typeof v !== "string" || !KNOWN_VERDICTS.has(v)).map(String))];
}

let detail = "";
let armed = false;

/**
 * Attach the count / reason the verdict is about. Last call wins. Safe to
 * call from anywhere, including after the verdict is decided.
 * @param {unknown} text
 */
export function setResultDetail(text) {
  detail = typeof text === "string" ? text : text == null ? "" : String(text);
}

/**
 * Render the line. Pure — exported for tests and for callers that want to
 * place the line themselves rather than on process exit.
 *
 * @param {{ verdict?: unknown, detail?: unknown, exitCode?: unknown }} opts
 * @returns {string}
 */
export function formatResultLine({ verdict, detail: d = "", exitCode } = {}) {
  const v = typeof verdict === "string" && KNOWN_VERDICTS.has(verdict) ? verdict : "UNKNOWN";
  const text = String(d ?? "").replace(/\s+/g, " ").trim();
  const code = Number.isInteger(exitCode) ? ` (exit ${exitCode})` : "";
  return `RESULT: ${v}${text ? ` — ${text}` : ""}${code}`;
}

/**
 * Map an exit code to a verdict. An unmapped code is NOT guessed — it renders
 * as UNKNOWN with the raw code, because a wrong verdict is worse than an
 * illegible one (this whole lib exists because a confident wrong answer
 * travelled further than a missing one).
 *
 * @param {number} code
 * @param {Record<number, string>} map
 * @returns {string}
 */
export function verdictForExitCode(code, map) {
  const m = map && typeof map === "object" ? map : {};
  const hit = m[code];
  return typeof hit === "string" && KNOWN_VERDICTS.has(hit) ? hit : "UNKNOWN";
}

/**
 * Arm the terminal RESULT line for this process. Idempotent — the first call
 * wins, so an imported helper arming again cannot double-print.
 *
 * Nesting: a gate that runs INSIDE another script prints a line that reads as
 * the outer script's verdict, with nothing saying whose it was — a line whose
 * whole job is to survive truncation, surviving and naming the wrong subject.
 * The parent declares it, because only the parent knows: spawn the child with
 * `RESULT_LINE_NEST=<label>` in its env and the child's line renders
 * `RESULT: [label] FAIL — …`. Unset (the normal, direct-run case) changes
 * nothing. Kept after the `RESULT: ` token so `grep '^RESULT:'` still finds
 * every line.
 *
 * @param {Record<number, string>} map exit code → verdict, e.g. { 0: "PASS", 3: "FAIL" }
 * @param {{ fd?: number }} [opts] 1 = stdout (default), 2 = stderr (JSON modes — see header)
 * @returns {void}
 */
export function armResultLine(map, { fd = 1 } = {}) {
  if (armed) return;
  armed = true;
  const target = fd === 2 ? 2 : 1;
  let nest = "";
  try {
    const raw = String(process.env.RESULT_LINE_NEST ?? "").trim();
    // Bounded and sanitized: this reaches a terminal line, and an env var is
    // not a trusted format string.
    if (raw) nest = `[${raw.replace(/[^\w.\-/]/g, "").slice(0, 48)}] `;
  } catch {
    // Advisory; arming must never fail on it.
  }
  try {
    const bad = unknownLabelsInMap(map);
    if (bad.length > 0) {
      writeSync(
        2,
        `result-line: label(s) ${bad.join(", ")} not in the RESULT vocabulary — they will render UNKNOWN. ` +
          `Add them to KNOWN_VERDICTS in lib/result-line.mjs (a deliberate label must never be silently discarded).\n`,
      );
    }
  } catch {
    // The warning is advisory; arming must never fail on it.
  }
  process.on("exit", (code) => {
    try {
      // writeSync, not console.log: an "exit" handler runs after stdout's
      // async machinery is torn down, and a queued console.log is silently
      // dropped.
      const line = formatResultLine({ verdict: verdictForExitCode(code, map), detail, exitCode: code });
      writeSync(target, `${nest ? line.replace(/^RESULT: /, `RESULT: ${nest}`) : line}\n`);
    } catch {
      // The verdict line is a second carrier, never the contract. If it
      // cannot be written (closed fd, EPIPE from a `head` that already
      // exited), the exit code still stands and the check's own output
      // already printed.
    }
  });
}

/** Test seam — reset module state between cases. */
export function __resetResultLineForTests() {
  detail = "";
  armed = false;
}
