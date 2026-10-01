#!/usr/bin/env node
/**
 * Self-contained secret scanner — no dependencies, no external binary, no network.
 * ONE `PATTERNS` list, THREE callers (two secret matchers drift apart, and the one
 * you are not looking at is the one that goes quiet):
 *
 *   (default)                 STAGED, ADDED lines only (`git diff --cached`), so it
 *                             blocks NEW leaks without tripping on pre-existing
 *                             content.                      exit 0 clean · 1 hits
 *   --message-file <path>     a COMMIT MESSAGE (the commit-msg hook's $1). A
 *                             remediation write-up must never quote the value it
 *                             removed.                      exit 0 clean · 1 hits
 *   --history <days>          every ADDED line of every hunk in REACHABLE history
 *                             for the window (`git log -p --all --since=<ISO>`).
 *                             exit 0 CLEAN · 2 ERROR or NOTHING SWEPT · 3 HITS
 *   --range <a>..<b>          the same sweep over exactly the commits in a revision
 *                             range (`git log -p <a>..<b>`) — what CI runs on a push
 *                             or PR, commit by commit, so a value added and deleted
 *                             inside one PR still fires.    exit ladder as --history
 *
 * ⚠ HISTORY HITS EXIT 3, NOT 1 — deliberately DISTINCT from the staged/message
 * ladder above (0/1), so a caller can never confuse "history is dirty" with "your
 * commit is blocked".
 *
 * History output is REDACTED: pattern name · short sha · path:line only. The matched
 * value and the line text are NEVER printed — this mode runs over real history and
 * its output lands in transcripts. A run with 0 commits in the window prints NOTHING
 * SWEPT and exits 2: a clean verdict over nothing is not clean. Every outcome prints
 * the denominator first.
 *
 * Bypass a genuine false positive with a trailing comment (every mode, same
 * semantics): `pragma: allowlist secret` (or `gitleaks:allow` / `secret-scan:ignore`).
 *
 * WHERE IT STOPS. This is a shape matcher, not a credential validator.
 *   - A hit does NOT prove the value is live, and a clean scan does NOT prove you
 *     have no exposure: it knows the eleven shapes in PATTERNS and nothing else. A
 *     bare high-entropy string, a vendor format not listed, or a secret split across
 *     lines all read clean.
 *   - FAIL-SOFT on the staged path, deliberately: no staged changes, or git
 *     unavailable, exits 0 rather than blocking a commit it could not read. It is a
 *     guard against accidents, not an adversary who controls the hook.
 *   - "Reachable" history = reachable from ANY ref (branches, tags, remote-tracking
 *     refs, stash). Dangling objects are NOT scanned, and `git log -p` does not show
 *     a merge commit's own resolution diff. The stronger sweep is
 *     `git cat-file --batch-all-objects`.
 *   - A binary file, or one marked -diff in .gitattributes, shows no hunk in `git log -p`,
 *     so its content is NOT scanned. The history denominator counts those diffs ("binary
 *     file diffs not read") so a clean verdict says what it did not read.
 *   - Removing a value from the tip does not remove it from history. Rotate first.
 *
 * `--history <days> --selftest` builds throwaway repos and runs this file as a child
 * process against them: every pattern must fire RED, realistic content must stay
 * GREEN, and an empty window must read NOTHING SWEPT. A green that has never been
 * seen red is not evidence.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// No imports from ../lib in this file, on purpose — it is vendored into other repos'
// pre-commit hooks, where a relative import would throw ERR_MODULE_NOT_FOUND and the
// hook would BLOCK the commit instead of scanning it. The two helpers below are
// inlined with the same contracts as their library versions: unknown flag → exit 2,
// nothing scanned; RESULT line in result-line.mjs's format, kept in step by hand.
const KNOWN_FLAGS = new Set(["help", "message-file", "history", "range", "repo", "selftest"]);
function refuseUnknownFlags(args) {
  const unknown = args.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")[0]).filter((f) => !KNOWN_FLAGS.has(f));
  if (unknown.length === 0) return;
  console.error(
    `${SCRIPT}: unknown flag(s) ${unknown.map((f) => `--${f}`).join(", ")} — nothing was scanned. ` +
      `A dropped flag would return a clean verdict over the wrong scope. Run --help for the flag list.`,
  );
  process.exit(2);
}
let resultDetail = "";
let resultArmed = false;
function setResultDetail(text) {
  resultDetail = text == null ? "" : String(text);
}
function armResultLine(map) {
  if (resultArmed) return;
  resultArmed = true;
  process.on("exit", (code) => {
    try {
      const verdict = typeof map?.[code] === "string" ? map[code] : "UNKNOWN";
      const text = resultDetail.replace(/\s+/g, " ").trim();
      writeSync(1, `RESULT: ${verdict}${text ? ` — ${text}` : ""} (exit ${code})\n`);
    } catch {
      // Second carrier only; the exit code stands.
    }
  });
}

const PATTERNS = [
  { name: "private-key-block", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: "mongodb-uri-with-creds", re: /mongodb(?:\+srv)?:\/\/[^\s:/@]+:[^\s@]+@/ },
  { name: "postgres-uri-with-creds", re: /postgres(?:ql)?:\/\/[^\s:/@]+:[^\s@]+@/ },
  { name: "mysql-uri-with-creds", re: /mysql:\/\/[^\s:/@]+:[^\s@]+@/ },
  { name: "redis-uri-with-creds", re: /redis:\/\/[^\s:/@]*:[^\s@]+@/ },
  { name: "amqp-uri-with-creds", re: /amqps?:\/\/[^\s:/@]+:[^\s@]+@/ },
  { name: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "stripe-live-secret", re: /\bsk_live_[0-9a-zA-Z]{16,}\b/ },
  { name: "github-pat", re: /\b(?:ghp_[0-9A-Za-z]{36}|github_pat_[0-9A-Za-z_]{40,})\b/ },
  { name: "google-api-key", re: /\bAIza[0-9A-Za-z\-_]{35}\b/ },
  { name: "slack-token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
];

// Markers that void a connection-string match (placeholders, not real secrets).
const PLACEHOLDER =
  /(localhost|127\.0\.0\.1|example\.com|<[^>]*>|:password@|:pass@|:changeme@|:your[-_]|:xxx+@|REDACTED|\*\*\*)/i;
const ALLOW = /(pragma:\s*allowlist secret|gitleaks:allow|secret-scan:ignore)/i;

/**
 * The one judgement every caller makes about one line: the FIRST pattern that fires,
 * or null. An allowlisted line never fires; a connection-string match on a
 * placeholder voids the line.
 */
function firstPatternHit(content) {
  if (ALLOW.test(content)) return null;
  for (const p of PATTERNS) {
    if (!p.re.test(content)) continue;
    if (p.name.endsWith("uri-with-creds") && PLACEHOLDER.test(content)) return null;
    return p.name;
  }
  return null;
}

const argv = process.argv.slice(2);
const SCRIPT = "check-staged-secrets";

if (argv.includes("--help")) {
  console.log(`${SCRIPT}.mjs — self-contained secret scanner (one PATTERNS list, three callers)

  node scripts/${SCRIPT}.mjs                        staged ADDED lines (pre-commit hook)    exit 0 clean · 1 hits
  node scripts/${SCRIPT}.mjs --message-file <path>  a commit message (commit-msg hook's $1) exit 0 clean · 1 hits
  node scripts/${SCRIPT}.mjs --history <days> [--repo <path>]
        every ADDED line of every hunk in REACHABLE history for the window
        (git log -p --all --since=<ISO>; --repo defaults to the current directory)
        exit 0 CLEAN · 2 ERROR (git unreadable / bad args) or NOTHING SWEPT (0 commits in window) · 3 HITS
        ⚠ HITS exit 3, NOT 1 — deliberately distinct from the staged/message ladder above, so
          "history is dirty" can never be read as "your commit is blocked".
        "reachable" = reachable from ANY ref (branches, tags, remote-tracking refs, stash);
          dangling / unreachable objects are NOT scanned.
        Output is REDACTED: pattern · short sha · path:line only — the matched value is never printed.
        Every outcome prints the denominator first:
          history: <N> commits scanned · <M> hunks · <K> added lines · <B> binary file diffs not read · window <days>d since <ISO>
        A binary file, or one marked -diff in .gitattributes, has no hunk: its content is NOT
          read, and B counts those diffs. Merge commits count toward N, but their own
          resolution diff is not shown by git log -p.
  node scripts/${SCRIPT}.mjs --range <a>..<b> [--repo <path>]
        the same sweep, same exits and redaction, over exactly the commits in the range
        (git log -p <a>..<b>) — the CI form: per commit, so a value added then deleted inside
        one PR still fires. An empty range is NOTHING SWEPT (exit 2); an unknown rev is ERROR (2).
  node scripts/${SCRIPT}.mjs --history <days> --selftest
        throwaway-repo arms, each run as a real child process of this script:
          coverage every pattern has exactly one fixture
          RED    a commit tripping EVERY pattern → exit 3, every pattern named, no value printed
          GREEN  realistic content + an allowlisted line → exit 0
          EMPTY  the only commit is outside the window → NOTHING SWEPT, exit 2
          RANGE  a hit inside --range fires; a hit before it stays out; an empty range is NOTHING SWEPT
          USAGE  non-numeric days and an unknown flag → exit 2, nothing scanned
          LONE CR a value after a bare CR inside an added line still fires (lines split on \\n only)
          CONTENT-AS-STRUCTURE an added line whose text starts "++ " is scanned, not taken for a file header
          ROOT   log.showRoot=false in the environment does not hide the root commit
          BINARY a -diff file is counted in the denominator as not read
          SECRET-SHAPED PATH a value in a file name is withheld from the printed path
          RELATIVE diff.relative=true with --repo at a subdirectory still sweeps the whole repo
          GIT FAILS an unknown revision → ERROR, not NOTHING SWEPT
          plus staged / --message-file regression arms (exit 1 on a fixture, 0 on clean).
        15 arms; a run where a different number ran is a FAIL.
        exit 0 all arms pass · 1 an arm failed
  --help  this text

Allowlist (all modes, same semantics): a trailing \`pragma: allowlist secret\`
(or gitleaks:allow / secret-scan:ignore) on the line.`);
  process.exit(0);
}

refuseUnknownFlags(argv);

// --message-file <path>: scan a COMMIT MESSAGE instead of the staged diff, with the
// SAME pattern list. A commit body is a surface the staged-files scan structurally
// cannot see, and a "rotated this key" write-up is exactly where the removed value
// gets quoted back in.
const msgFlagIdx = argv.indexOf("--message-file");
if (msgFlagIdx !== -1) {
  const msgPath = argv[msgFlagIdx + 1];
  if (!msgPath) {
    console.error(`${SCRIPT}: --message-file requires a path`);
    process.exit(1);
  }
  let msg = "";
  try {
    msg = readFileSync(msgPath, "utf8");
  } catch {
    process.exit(0); // unreadable message file → never block (the diff hook already ran)
  }
  const msgFindings = [];
  for (const line of msg.split("\n")) {
    if (line.startsWith("#")) continue; // comment lines are stripped by git anyway
    const pattern = firstPatternHit(line);
    if (pattern) msgFindings.push({ pattern, line: line.slice(0, 60) });
  }
  if (msgFindings.length) {
    console.error("\n✗ commit-msg: possible secret(s) in the COMMIT MESSAGE itself:\n");
    for (const f of msgFindings) console.error(`  [${f.pattern}]  ${f.line}…`);
    console.error("\n  A remediation write-up must never quote the removed value.");
    console.error("  Reword the message; false positive? append `pragma: allowlist secret` to the line.\n");
    process.exit(1);
  }
  process.exit(0);
}

// ---------------------------------------------------------------- --history

const historyIdx = argv.indexOf("--history");
const rangeIdx = argv.indexOf("--range");
if (historyIdx !== -1 || rangeIdx !== -1) {
  // The RESULT line is armed at the moment the verdict is known, so the label matches
  // the outcome (exit 2 is ERROR on a git failure but NOTHING-SWEPT on an empty
  // window — one code, two honest labels).
  const finish = (code, label, detail) => {
    armResultLine({ [code]: label });
    setResultDetail(detail);
    process.exit(code);
  };
  if (historyIdx !== -1 && rangeIdx !== -1) {
    console.error(`${SCRIPT}: --history and --range are exclusive — pick the scope you mean`);
    finish(2, "ERROR", "both --history and --range");
  }
  const repoIdx = argv.indexOf("--repo");
  const repo = repoIdx !== -1 ? argv[repoIdx + 1] : process.cwd();
  if (repoIdx !== -1 && (!repo || repo.startsWith("--"))) {
    console.error(`${SCRIPT}: --repo requires a path`);
    finish(2, "ERROR", "bad --repo argument");
  }

  let scope;
  if (rangeIdx !== -1) {
    const range = argv[rangeIdx + 1];
    // An option-shaped value would be read by git as an option, not a revision.
    if (!range || range.startsWith("-")) {
      console.error(`${SCRIPT}: --range requires a revision range such as <a>..<b> (got ${JSON.stringify(range ?? "")})`);
      finish(2, "ERROR", "bad --range argument");
    }
    scope = { revArgs: ["--end-of-options", range], label: `range ${range}` };
  } else {
    const daysRaw = argv[historyIdx + 1];
    if (!/^\d+$/.test(daysRaw ?? "") || Number(daysRaw) < 1) {
      console.error(`${SCRIPT}: --history requires a positive whole number of days (got ${JSON.stringify(daysRaw ?? "")})`);
      finish(2, "ERROR", "bad --history argument");
    }
    const days = Number(daysRaw);
    if (argv.includes("--selftest")) {
      const code = selftestHistory(days);
      finish(code, code === 0 ? "PASS" : "FAIL", code === 0 ? "selftest: every arm passed" : "selftest: an arm failed");
    }
    const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
    scope = { revArgs: ["--all", `--since=${sinceIso}`], label: `window ${days}d since ${sinceIso}` };
  }

  const r = await sweepHistory({ repo, ...scope });
  if (r.error) {
    console.error(`${SCRIPT}: ${r.error}`);
    finish(2, "ERROR", r.error);
  }
  console.log(r.summary);
  if (r.nothingSwept) {
    console.log("NOTHING SWEPT — 0 commits in scope; a clean verdict over nothing is not clean.");
    finish(2, "NOTHING-SWEPT", r.summary);
  }
  if (r.hits.length) {
    console.log(`\n✗ history: ${r.hits.length} possible secret(s) in reachable history (REDACTED — pattern · commit · path:line; the value is never printed):\n`);
    for (const h of r.hits) console.log(`  [${h.pattern}]  ${h.sha}  ${h.file}:${h.line}`);
    console.log("\n  A value in history stays in history — removing it from the tip does not remove it.");
    console.log("  Rotate the credential first; then decide whether the history itself must be rewritten.");
    console.log("  False positive? the line needs a trailing `pragma: allowlist secret` in the commit that added it.\n");
    finish(3, "FINDINGS", `${r.hits.length} hit(s) · ${r.summary}`);
  }
  console.log("CLEAN — no secret-shaped ADDED line in scope.");
  finish(0, "PASS", r.summary);
}

/**
 * Walk `git log -p` over the given revisions (a window of reachable history, or a range)
 * and classify every ADDED line. Returns the denominator on every outcome; never prints.
 *
 * The log is STREAMED, never held whole: a busy repo's 90-day `git log -p` runs past
 * V8's ~512 MB string ceiling, and reading it into one string made the scan refuse
 * exactly the repos with the most history to check. Memory now grows with the hit list
 * (and the longest single line), not with the size of the log.
 *
 * Lines are split on "\n" ONLY, by hand, exactly as the whole-string split did. Not
 * readline: it also breaks on a lone "\r", which cuts an added line in two, and the
 * second half (no "+" prefix) is never classified — a key after a bare CR read CLEAN.
 * @returns {Promise<{ summary: string, hits: Array<{pattern: string, sha: string, file: string, line: number}>, nothingSwept: boolean, error?: string }>}
 */
async function sweepHistory({ repo, revArgs, label }) {
  const child = spawn(
    "git",
    [
      // The output FORMAT is pinned here, not inherited: a user's or CI's git config can
      // hide the root commit's diff (log.showRoot), rename the a/ b/ prefixes, quote
      // non-ASCII paths, or emit blank context lines (interHunkContext + suppressBlankEmpty),
      // and each of those made this parser miss content or misread a valid log.
      "-C", repo,
      "-c", "core.quotePath=false", "-c", "diff.interHunkContext=0", "-c", "diff.suppressBlankEmpty=false",
      "log", "-p", "--root", "--no-color", "--unified=0", "--no-ext-diff", "--no-textconv",
      "--src-prefix=a/", "--dst-prefix=b/",
      // diff.relative would drop every file outside a --repo subdirectory (CLEAN over them);
      // diff.submodule=log emits indented summaries the strict header grammar rejects.
      "--no-relative", "--submodule=short",
      // One marker line per commit (0x01 never starts a diff line); the body is not printed.
      "--format=%x01commit %h",
      ...revArgs,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  // stderr: the first fatal/error line is kept as it streams (it can be followed by more
  // than any buffer of warnings), plus the last 4 KB for anything else. Neither can grow.
  let stderr = "";
  let stderrFatal = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (s) => {
    if (!stderrFatal) stderrFatal = (/^\s*(?:fatal|error):.*$/m.exec(s)?.[0] ?? "").trim();
    stderr = (stderr + s).slice(-4096);
  });

  let commits = 0;
  let hunks = 0;
  let added = 0;
  let sha = "?";
  let file = "?";
  let newLine = 0;
  let oldLeft = 0; // lines of the current hunk body still to come, from its @@ header
  let newLeft = 0;
  let sawMinusHeader = false;
  let binaryUnread = 0;
  const hits = [];
  // A line is read as STRUCTURE (commit marker, file header, hunk header) only outside a
  // hunk body; inside one, the @@ header's counts say what every line is. Telling them
  // apart by prefix alone let an added line whose TEXT began "++ " arrive as "+++ …" and be
  // taken for a file header, never scanned. Counts disagreeing with the stream throw, and
  // the throw is reported as ERROR below: a parse that lost its place is not a verdict.
  const classify = (raw) => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (oldLeft > 0 || newLeft > 0) {
      if (line.startsWith("\\")) return; // "\ No newline at end of file"
      if (line.startsWith("-") && oldLeft > 0) { oldLeft--; return; }
      if (line.startsWith("+") && newLeft > 0) {
        newLeft--;
        added++;
        const n = newLine++;
        const pattern = firstPatternHit(line.slice(1));
        if (pattern) hits.push({ pattern, sha, file, line: n });
        return;
      }
      if (line.startsWith(" ") && oldLeft > 0 && newLeft > 0) { oldLeft--; newLeft--; newLine++; return; } // context (none under --unified=0)
      throw new Error(`hunk in ${sha} ${file} ended before its @@ counts (${oldLeft} removed, ${newLeft} added still expected)`);
    }
    // Outside a hunk the header GRAMMAR is strict: "+++ " is a file header only directly
    // after its "--- " line, and any other line starting "+", "-" or " " here means the
    // counts and the stream have parted — content that would be skipped, or a value that
    // would be printed as a path. That throws (ERROR) rather than being read as header text.
    const afterMinus = sawMinusHeader;
    sawMinusHeader = false;
    if (line.startsWith("\x01commit ")) { commits++; sha = line.slice(8).trim(); file = "?"; return; }
    if (line.startsWith("--- ")) { sawMinusHeader = true; return; }
    if (line.startsWith("+++ ")) {
      if (!afterMinus) throw new Error(`"+++ " outside a file header in ${sha} ${file}`);
      // A real file NAME can hold a secret too, and the path is printed beside every hit and
      // in every diagnostic. Testing it with the LINE matcher leaked twice in review (the
      // content allowlist exempted it; git's \t escape defeated a \b), so a path is printed
      // only under a stated rule, and anything else is withheld where it is read.
      const p = diffPath(line.slice(4));
      file = pathIsPrintable(p) ? p : "<path withheld: not printable under the path rule>";
      return;
    }
    if (line.startsWith("@@")) {
      const m = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!m) throw new Error(`unreadable hunk header in ${sha} ${file}`);
      hunks++;
      oldLeft = m[1] === undefined ? 1 : Number(m[1]);
      newLine = Number(m[2]);
      newLeft = m[3] === undefined ? 1 : Number(m[3]);
      return;
    }
    if (/^[-+ ]/.test(line)) throw new Error(`diff content outside a hunk in ${sha} ${file}`);
    // A binary file (or one marked -diff in .gitattributes) shows no hunk, so its content
    // is NOT read. It is counted and printed in the denominator, never silently clean.
    if (line.startsWith("Binary files ")) { binaryUnread++; return; }
    // Everything else is header text (diff --git, index, mode, rename, similarity …).
  };

  // Any failure inside the stream — a classify throw, a pipe error — is kept and reported as
  // ERROR (exit 2) below, never left to reject unhandled and exit 1. (setEncoding never
  // throws: a byte that is not UTF-8 becomes U+FFFD and is scanned as that character.)
  // A partial line is kept as a list of pieces and joined once, so a single very long line
  // costs time in proportion to its length, not its square.
  let pending = [];
  let streamErr = null;
  child.stdout.setEncoding("utf8"); // decodes a multi-byte character split across chunks
  child.stdout.on("data", (chunk) => {
    if (streamErr) return;
    try {
      let start = 0;
      let i;
      while ((i = chunk.indexOf("\n", start)) !== -1) {
        const piece = chunk.slice(start, i);
        const raw = pending.length ? pending.join("") + piece : piece;
        pending = [];
        classify(raw);
        start = i + 1;
      }
      if (start < chunk.length) pending.push(chunk.slice(start));
    } catch (e) {
      streamErr = e;
      child.kill();
    }
  });
  child.stdout.on("error", (e) => { streamErr ??= e; });
  const { code, signal, err } = await new Promise((resolve) => {
    child.on("error", (e) => resolve({ code: null, signal: null, err: e }));
    child.on("close", (c, s) => resolve({ code: c, signal: s, err: null }));
  });
  // The end-of-log checks only mean something when git finished on its own; a killed or
  // failed git is reported as that, not as the truncation it caused.
  if (!err && !streamErr && code === 0 && !signal) {
    try {
      if (pending.length) classify(pending.join(""));
      if (oldLeft > 0 || newLeft > 0) throw new Error(`log ended inside a hunk in ${sha} ${file}`);
    } catch (e) { streamErr = e; }
  }

  // A git that failed part-way has already streamed a PARTIAL log: its counts and hits
  // are a sample, not the window, so the whole result is an error and none of it is used.
  // (A streamErr raised while git was still running is why WE killed it, so it outranks
  // the resulting signal.)
  if (err || streamErr || code !== 0) {
    const tail = stderr.split("\n").map((l) => l.trim()).filter(Boolean);
    const detail = err ? err.message
      : streamErr ? `reading git log failed: ${streamErr.message}`
      : signal ? `git log killed by ${signal}`
      : stderrFatal || tail.at(-1) || `git log exited ${code}`;
    return { summary: "", hits: [], nothingSwept: false, error: `git unreadable (${repo}): ${String(detail).split("\n")[0]}` };
  }

  const summary = `history: ${commits} commits scanned · ${hunks} hunks · ${added} added lines · ${binaryUnread} binary file diffs not read · ${label}`;
  return { summary, hits, nothingSwept: commits === 0 };
}

/**
 * The PATH RULE: a path is printed only when every character is in a plain set (letters,
 * digits, space and `. _ / @ + -`) AND it contains none of the secret prefixes anywhere —
 * no word boundary, no allowlist, no placeholder exemption. A quoted or escaped name
 * (git's "\t"), a ":" or "=" and an embedded prefix all fail it. Its failure mode is
 * withholding a harmless path, never printing a secret one.
 */
function pathIsPrintable(p) {
  // Inside the function on purpose: the history sweep runs at module top level, BEFORE a
  // module-scope const below this point would be initialised.
  const PRINTABLE = /^[A-Za-z0-9 ._/@+-]{1,240}$/;
  const SECRET_PREFIX = /AKIA|sk_live_|ghp_|github_pat_|AIza|xox[baprs]-|PRIVATE KEY/;
  return PRINTABLE.test(p) && !SECRET_PREFIX.test(p);
}

/** `b/path`, `"b/path with spaces"` or `/dev/null` → the path as git names it. */
function diffPath(s) {
  let p = s.trim();
  if (p.startsWith("\"") && p.endsWith("\"")) p = p.slice(1, -1);
  if (p.startsWith("b/")) p = p.slice(2);
  return p;
}

// ---------------------------------------------------------------- --selftest
// A green never seen red is not evidence. Each arm builds a throwaway git repo and
// runs THIS script as a child process — the whole scan, exit code and printed output
// included — never the predicate alone.
function selftestHistory(days) {
  // One obviously-fake value per pattern. The trailing comment on each SOURCE line is
  // what lets this file commit through its own staged scan; the STRING carries no
  // allowlist marker, so it fires when committed to the fixture repo. Values a hosted
  // scanner recognises (Atlas URI, Google key) are split at the prefix and joined at
  // runtime, so this public file's own text raises no provider "leak" alert.
  const FIRE = [
    ["private-key-block", "-----BEGIN RSA PRIVATE KEY-----"], // pragma: allowlist secret gitleaks:allow
    ["mongodb-uri-with-creds", "MONGO=mongodb" + "+srv://fixtureuser:fixturepw@cluster0.fixture.mongodb.net/db"], // pragma: allowlist secret gitleaks:allow
    ["postgres-uri-with-creds", "DATABASE_URL=postgres://fixtureuser:fixturepw@db.fixture.internal:5432/app"], // pragma: allowlist secret gitleaks:allow
    ["mysql-uri-with-creds", "MYSQL=mysql://fixtureuser:fixturepw@db.fixture.internal/app"], // pragma: allowlist secret gitleaks:allow
    ["redis-uri-with-creds", "REDIS=redis://:fixturepw@cache.fixture.internal:6379"], // pragma: allowlist secret gitleaks:allow
    ["amqp-uri-with-creds", "AMQP=amqps://fixtureuser:fixturepw@mq.fixture.internal/vhost"], // pragma: allowlist secret gitleaks:allow
    ["aws-access-key", "aws_access_key_id = AKIAFIXTUREFIXTURE00"], // pragma: allowlist secret gitleaks:allow
    ["stripe-live-secret", "STRIPE=sk_live_FIXTUREFIXTUREFIXTURE0"], // pragma: allowlist secret gitleaks:allow
    ["github-pat", "GITHUB_TOKEN=ghp_FIXTUREFIXTUREFIXTUREFIXTUREFIXTURE0"], // pragma: allowlist secret gitleaks:allow
    ["google-api-key", "GOOGLE=AI" + "zaFIXTUREFIXTUREFIXTUREFIXTUREFIXTURE"], // pragma: allowlist secret gitleaks:allow
    ["slack-token", "SLACK=xoxb-FIXTUREFIXTURE0"], // pragma: allowlist secret gitleaks:allow
  ];
  // Realistic repo content that must stay silent — URLs, base64-looking text,
  // placeholder connection strings, a CI secret reference, and ONE line that would
  // fire but carries the allowlist marker.
  const SILENT = [
    "https://api.github.com/repos/u00dxk2/agent-ops-patterns/commits?per_page=50",
    "const b64 = \"YWdlbnQtb3BzLXBhdHRlcm5zIHNlbGZ0ZXN0IGZpeHR1cmUgc3RyaW5n\";",
    "DATABASE_URL=postgres://user:password@localhost:5432/app",
    "MONGODB_URI=mongodb+srv://<user>:<password>@cluster.example.com/db",
    "redis://cache.internal:6379/0",
    "Authorization: Bearer ${{ secrets.GITHUB_TOKEN }}",
    "The scanner keys on the xoxb prefix and the AKIA prefix; neither word alone is a token.",
    "aws_access_key_id = AKIAFIXTUREFIXTURE01  # pragma: allowlist secret",
  ];

  let failed = 0;
  let arms = 0;
  const arm = (label, ok, why) => {
    arms++;
    console.log(`selftest arm — ${label}: ${ok ? "PASS" : "FAIL"}${ok ? "" : ` — ${why}`}`);
    if (!ok) failed++;
  };

  // Every pattern owns a fixture, and every fixture names a live pattern — a pattern
  // with no fixture is untested and a clean sweep would not prove it.
  const names = PATTERNS.map((p) => p.name);
  const missing = names.filter((n) => !FIRE.some(([f]) => f === n));
  const stray = FIRE.map(([f]) => f).filter((f) => !names.includes(f));
  arm("coverage — every pattern has exactly one fixture", missing.length === 0 && stray.length === 0 && FIRE.length === names.length,
    `missing ${JSON.stringify(missing)} stray ${JSON.stringify(stray)}`);

  const self = fileURLToPath(import.meta.url);
  const base = mkdtempSync(join(tmpdir(), "css-history-selftest-"));
  const env = { ...process.env };
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "RESULT_LINE_NEST"]) delete env[k];
  const GIT_CFG = [
    "-c", "user.name=selftest", "-c", "user.email=selftest@example.invalid",
    "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", "-c", `core.hooksPath=${join(base, "no-hooks")}`,
  ];
  const git = (repo, args, extraEnv = {}) =>
    execFileSync("git", ["-C", repo, ...GIT_CFG, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...env, ...extraEnv } });
  const initRepo = (name) => {
    const dir = join(base, name);
    execFileSync("git", ["init", "-q", "-b", "main", dir], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env });
    return dir;
  };
  const runSelf = (args, cwd, extraEnv = {}) => {
    const r = spawnSync(process.execPath, [self, ...args], { cwd, encoding: "utf8", env: { ...env, ...extraEnv } });
    return { status: r.status, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
  };
  const fixtureValues = FIRE.map(([, v]) => v);
  const leaked = (out) => fixtureValues.filter((v) => out.includes(v));

  try {
    // RED — a commit that trips every pattern.
    const red = initRepo("red");
    writeFileSync(join(red, "config.txt"), `${FIRE.map(([, v]) => v).join("\n")}\n`);
    git(red, ["add", "-A"]);
    git(red, ["commit", "-q", "-m", "add fixture config"]);
    const r1 = runSelf(["--history", String(days), "--repo", red]);
    const unnamed = FIRE.map(([n]) => n).filter((n) => !r1.out.includes(`[${n}]`));
    const leak1 = leaked(r1.out);
    arm(
      `RED — every pattern fires on one commit, exit 3, values redacted (${days}d window)`,
      r1.status === 3 && unnamed.length === 0 && leak1.length === 0 && /^history: 1 commits scanned · \d+ hunks · \d+ added lines/m.test(r1.out),
      `exit ${r1.status}; unnamed ${JSON.stringify(unnamed)}; ${leak1.length} fixture value(s) PRINTED; out: ${r1.out.slice(0, 200)}`,
    );

    // GREEN — realistic content plus one allowlisted line.
    const green = initRepo("green");
    writeFileSync(join(green, "README.md"), `${SILENT.join("\n")}\n`);
    git(green, ["add", "-A"]);
    git(green, ["commit", "-q", "-m", "add realistic content"]);
    const r2 = runSelf(["--history", String(days), "--repo", green]);
    arm(
      "GREEN — realistic content + an allowlisted line, exit 0 with a non-zero denominator",
      r2.status === 0 && /^history: 1 commits scanned · [1-9]\d* hunks · [1-9]\d* added lines/m.test(r2.out) && r2.out.includes("CLEAN"),
      `exit ${r2.status}; out: ${r2.out.slice(0, 200)}`,
    );

    // EMPTY — the only commit predates the window.
    const empty = initRepo("empty");
    writeFileSync(join(empty, "old.txt"), `${FIRE[6][1]}\n`);
    git(empty, ["add", "-A"]);
    const old = new Date(Date.now() - (days + 400) * 86_400_000).toISOString();
    git(empty, ["commit", "-q", "-m", "an old commit"], { GIT_AUTHOR_DATE: old, GIT_COMMITTER_DATE: old });
    const r3 = runSelf(["--history", String(days), "--repo", empty]);
    arm(
      "EMPTY — 0 commits in the window → NOTHING SWEPT, exit 2 (a secret outside the window is not a clean run)",
      r3.status === 2 && r3.out.includes("NOTHING SWEPT") && /^history: 0 commits scanned/m.test(r3.out) && leaked(r3.out).length === 0,
      `exit ${r3.status}; out: ${r3.out.slice(0, 200)}`,
    );

    // STAGED regression — the pre-commit path still exits 1 on a fixture, 0 on clean.
    const staged = initRepo("staged");
    writeFileSync(join(staged, "a.txt"), `${FIRE[7][1]}\n`);
    git(staged, ["add", "-A"]);
    const r4 = runSelf([], staged);
    git(staged, ["reset", "-q"]);
    writeFileSync(join(staged, "a.txt"), `${SILENT.join("\n")}\n`);
    git(staged, ["add", "-A"]);
    const r5 = runSelf([], staged);
    arm(
      "STAGED regression — exit 1 on a staged fixture, 0 on realistic staged content",
      r4.status === 1 && r4.out.includes("[stripe-live-secret]") && r5.status === 0,
      `fixture exit ${r4.status}, clean exit ${r5.status}`,
    );

    // MESSAGE regression — the commit-msg path still exits 1 on a fixture, 0 on clean.
    const msgBad = join(base, "msg-bad.txt");
    const msgOk = join(base, "msg-ok.txt");
    writeFileSync(msgBad, `fix: rotate the key\n\nold value was ${FIRE[8][1]}\n`);
    writeFileSync(msgOk, `fix: rotate the key\n\n# comment lines are ignored\nno value quoted here\n`);
    const r6 = runSelf(["--message-file", msgBad], base);
    const r7 = runSelf(["--message-file", msgOk], base);
    arm(
      "MESSAGE regression — exit 1 on a fixture in the message, 0 on a clean message",
      r6.status === 1 && r6.out.includes("[github-pat]") && r7.status === 0,
      `fixture exit ${r6.status}, clean exit ${r7.status}`,
    );

    // RANGE — only the commits in <a>..<b> are swept: a hit inside fires, a hit before
    // the range stays out, an empty range is not a clean verdict.
    const rng = initRepo("range");
    const commitFile = (name, body) => {
      writeFileSync(join(rng, name), body);
      git(rng, ["add", "-A"]);
      git(rng, ["commit", "-q", "-m", `add ${name}`]);
      return git(rng, ["rev-parse", "HEAD"]).trim();
    };
    const c0 = commitFile("a.txt", `${SILENT[0]}\n`);
    const c1 = commitFile("b.txt", `${FIRE[7][1]}\n`);
    const c2 = commitFile("c.txt", `${SILENT[1]}\n`);
    const inside = runSelf(["--range", `${c0}..${c2}`, "--repo", rng]);
    const before = runSelf(["--range", `${c1}..${c2}`, "--repo", rng]);
    const none = runSelf(["--range", `${c2}..${c2}`, "--repo", rng]);
    const optionShaped = runSelf(["--range", "-p", "--repo", rng]);
    arm(
      "RANGE — hit inside the range exits 3 redacted; hit before it stays out (exit 0, 1 commit); empty range NOTHING SWEPT; option-shaped range refused",
      inside.status === 3 && inside.out.includes("[stripe-live-secret]") && /^history: 2 commits scanned/m.test(inside.out) && leaked(inside.out).length === 0 &&
        before.status === 0 && /^history: 1 commits scanned/m.test(before.out) &&
        none.status === 2 && none.out.includes("NOTHING SWEPT") &&
        optionShaped.status === 2,
      `inside exit ${inside.status}, before exit ${before.status}, empty exit ${none.status}, option-shaped exit ${optionShaped.status}`,
    );

    // USAGE — bad args and an unknown flag refuse with 2, never scan.
    const r8 = runSelf(["--history", "zero", "--repo", red]);
    const r9 = runSelf(["--history", String(days), "--repo", red, "--histroy"]);
    arm("USAGE — non-numeric days and an unknown flag both exit 2", r8.status === 2 && r9.status === 2, `bad days exit ${r8.status}, unknown flag exit ${r9.status}`);

    // LONE CR — to git, an added line holding a bare "\r" is ONE line, and it must be read
    // as one: a reader that also splits on "\r" (readline does) strips the "+" prefix from
    // the second half, never classifies it, and reads the key CLEAN.
    const cr = initRepo("lone-cr");
    writeFileSync(join(cr, "notes.txt"), `see the value below\r${FIRE[6][1]}\n`);
    git(cr, ["add", "-A"]);
    git(cr, ["commit", "-q", "-m", "add a line holding a bare CR"]);
    const r10 = runSelf(["--history", String(days), "--repo", cr]);
    arm(
      "LONE CR — a value after a bare CR inside an added line still fires, exit 3, redacted",
      r10.status === 3 && r10.out.includes("[aws-access-key]") && leaked(r10.out).length === 0,
      `exit ${r10.status}; out: ${r10.out.slice(0, 200)}`,
    );

    // CONTENT THAT LOOKS LIKE STRUCTURE — an added line whose TEXT begins "++ " is printed
    // by git as "+++ …", a file-header prefix. Read by prefix alone it was never scanned,
    // and its text became the FILE PATH printed beside the next hit (the value leaked into
    // redacted output). Line 2 pins that attribution: its hit must name fixture.diff:2.
    const pp = initRepo("plus-plus");
    writeFileSync(join(pp, "fixture.diff"), `++ ${FIRE[7][1]}\n${FIRE[6][1]}\n`);
    git(pp, ["add", "-A"]);
    git(pp, ["commit", "-q", "-m", "add diff-shaped content"]);
    const r12 = runSelf(["--history", String(days), "--repo", pp]);
    arm(
      "CONTENT-AS-STRUCTURE — a value on an added line starting \"++ \" fires, the next hit names fixture.diff:2, nothing leaks",
      r12.status === 3 && r12.out.includes("[stripe-live-secret]") && /\[aws-access-key\]\s+\S+\s+fixture\.diff:2$/m.test(r12.out) &&
        /^history: 1 commits scanned · 1 hunks · 2 added lines/m.test(r12.out) && leaked(r12.out).length === 0,
      `exit ${r12.status}; out: ${r12.out.slice(0, 200)}`,
    );

    // ROOT — a config that hides the root commit's diff (log.showRoot=false) must not hide
    // its content from the sweep: the first commit is where a .env tends to land.
    const root = initRepo("root");
    writeFileSync(join(root, "a.env"), `${FIRE[7][1]}\n`);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "first commit"]);
    const r13 = runSelf(["--history", String(days), "--repo", root], undefined,
      { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "log.showRoot", GIT_CONFIG_VALUE_0: "false" });
    arm(
      "ROOT — with log.showRoot=false in the environment the root commit is still read, exit 3",
      r13.status === 3 && r13.out.includes("[stripe-live-secret]"),
      `exit ${r13.status}; out: ${r13.out.slice(0, 200)}`,
    );

    // BINARY — a file git will not diff (binary, or -diff in .gitattributes) has no hunk,
    // so its content is not read; the denominator must SAY so rather than read clean.
    const bin = initRepo("binary");
    writeFileSync(join(bin, ".gitattributes"), "*.env -diff\n");
    writeFileSync(join(bin, "x.env"), `${FIRE[7][1]}\n`);
    git(bin, ["add", "-A"]);
    git(bin, ["commit", "-q", "-m", "a -diff file"]);
    const r14 = runSelf(["--history", String(days), "--repo", bin]);
    arm(
      "BINARY — a -diff file is counted as \"1 binary file diffs not read\" in the denominator",
      /^history: 1 commits scanned · \d+ hunks · \d+ added lines · 1 binary file diffs not read/m.test(r14.out) && leaked(r14.out).length === 0,
      `exit ${r14.status}; out: ${r14.out.slice(0, 200)}`,
    );

    // SECRET-SHAPED PATH — a real file NAME holding a value: the hit fires and the name is
    // withheld, because the path is printed beside every hit.
    const named = initRepo("named");
    writeFileSync(join(named, `${FIRE[7][1]}.txt`), `${FIRE[7][1]}\n`);
    git(named, ["add", "-A"]);
    git(named, ["commit", "-q", "-m", "a secret-shaped file name"]);
    const r15 = runSelf(["--history", String(days), "--repo", named]);
    // Two more names, written through the index because neither can exist on a Windows
    // disk: one carrying the content ALLOWLIST marker, one starting with a TAB (git prints
    // it as "\t", which defeated the line matcher's \b). The token below is the stripe
    // fixture's value without its "STRIPE=" prefix, so leaked() alone would miss it.
    const stripeValue = FIRE[7][1].slice(FIRE[7][1].indexOf("=") + 1);
    const blobFile = join(base, "named-blob.txt");
    writeFileSync(blobFile, `${FIRE[7][1]}\n`);
    const blob = git(named, ["hash-object", "-w", blobFile]).trim();
    // core.protectNTFS refuses ":" and control characters in an index path on Windows; these
    // names live only in the object store (never checked out), so it is off for these calls.
    const ntfs = ["-c", "core.protectNTFS=false"];
    git(named, [...ntfs, "update-index", "--add", "--cacheinfo", `100644,${blob},secret-scan:ignore-${stripeValue}.txt`]);
    git(named, [...ntfs, "update-index", "--add", "--cacheinfo", `100644,${blob},\t${stripeValue}.txt`]);
    git(named, [...ntfs, "commit", "-q", "-m", "an allowlist-marker name and a tab-led name"]);
    const r15b = runSelf(["--history", String(days), "--repo", named]);
    const withheld = (r15b.out.match(/<path withheld: not printable under the path rule>/g) ?? []).length;
    arm(
      "SECRET-SHAPED PATH — values in file names (plain, allowlist-marked, tab-led) are withheld, never printed",
      r15.status === 3 && r15.out.includes("<path withheld") && leaked(r15.out).length === 0 &&
        r15b.status === 3 && withheld >= 3 && !r15b.out.includes(stripeValue),
      `plain exit ${r15.status}; all exit ${r15b.status}, ${withheld} withheld, value printed: ${r15b.out.includes(stripeValue)}`,
    );

    // RELATIVE — diff.relative=true with --repo at a SUBDIRECTORY must not drop the files
    // outside it: the sweep covers the repository, not the directory it was pointed into.
    const rel = initRepo("relative");
    mkdirSync(join(rel, "sub"));
    writeFileSync(join(rel, "sub", "readme.txt"), "inside\n");
    writeFileSync(join(rel, "outside.env"), `${FIRE[7][1]}\n`);
    git(rel, ["add", "-A"]);
    git(rel, ["commit", "-q", "-m", "a key outside the subdirectory"]);
    const r16 = runSelf(["--history", String(days), "--repo", join(rel, "sub")], undefined,
      { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "diff.relative", GIT_CONFIG_VALUE_0: "true" });
    arm(
      "RELATIVE — with diff.relative=true and --repo at a subdirectory, a key outside it still fires, exit 3",
      r16.status === 3 && r16.out.includes("[stripe-live-secret]"),
      `exit ${r16.status}; out: ${r16.out.slice(0, 200)}`,
    );

    // GIT FAILS — git exits non-zero (an unknown revision): ERROR with a RESULT line, exit 2.
    // Without the exit-code check this run would read NOTHING SWEPT, a different verdict.
    const r11 = runSelf(["--range", "no-such-rev..HEAD", "--repo", red]);
    arm(
      "GIT FAILS — an unknown revision reads ERROR (not NOTHING SWEPT), exit 2, with a RESULT line",
      r11.status === 2 && /^RESULT: ERROR — git unreadable/m.test(r11.out) && !r11.out.includes("NOTHING SWEPT"),
      `exit ${r11.status}; out: ${r11.out.slice(0, 200)}`,
    );
  } catch (err) {
    failed++;
    console.log(`selftest arm — harness: FAIL — ${String(err?.message ?? err).split("\n")[0]}`);
  } finally {
    try { rmSync(base, { recursive: true, force: true }); } catch { /* temp dir; best effort */ }
  }
  // An arm dropped by a later edit (or skipped behind an early return) must not still
  // read PASS: the expected count is stated once, here, and checked.
  const EXPECTED_ARMS = 15;
  if (failed === 0 && arms !== EXPECTED_ARMS) {
    failed++;
    console.log(`selftest arm — arm count: FAIL — ${arms} ran, ${EXPECTED_ARMS} expected`);
  }
  console.log(failed === 0 ? `selftest: PASS (${FIRE.length} patterns, ${SILENT.length} silent lines, ${arms} arms)` : `selftest: FAIL — ${failed} arm(s) failed`);
  return failed === 0 ? 0 : 1;
}

// ---------------------------------------------------------------- staged (default)
let diff = "";
try {
  diff = execFileSync(
    "git",
    ["diff", "--cached", "--unified=0", "--no-color", "--diff-filter=ACM"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
} catch {
  process.exit(0); // no staged changes / git unavailable → never block
}

const findings = [];
let file = "?";
for (const line of diff.split("\n")) {
  if (line.startsWith("+++ b/")) { file = line.slice(6); continue; }
  if (line.startsWith("+++") || line.startsWith("---")) continue;
  if (!line.startsWith("+")) continue;
  const pattern = firstPatternHit(line.slice(1));
  if (pattern) findings.push({ file, pattern });
}

if (findings.length) {
  console.error("\n✗ pre-commit: possible secret(s) in staged changes:\n");
  for (const f of findings) console.error(`  [${f.pattern}]  ${f.file}`);
  console.error("\n  Move the secret to an environment variable or a secret manager — never a committed file.");
  console.error("  False positive? append a trailing `pragma: allowlist secret` to the line, then re-commit.\n");
  process.exit(1);
}
process.exit(0);
