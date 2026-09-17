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
 *   - Removing a value from the tip does not remove it from history. Rotate first.
 *
 * `--history <days> --selftest` builds throwaway repos and runs this file as a child
 * process against them: every pattern must fire RED, realistic content must stay
 * GREEN, and an empty window must read NOTHING SWEPT. A green that has never been
 * seen red is not evidence.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
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
          history: <N> commits scanned · <M> hunks · <K> added lines · window <days>d since <ISO>
  node scripts/${SCRIPT}.mjs --range <a>..<b> [--repo <path>]
        the same sweep, same exits and redaction, over exactly the commits in the range
        (git log -p <a>..<b>) — the CI form: per commit, so a value added then deleted inside
        one PR still fires. An empty range is NOTHING SWEPT (exit 2); an unknown rev is ERROR (2).
  node scripts/${SCRIPT}.mjs --history <days> --selftest
        throwaway-repo arms, each run as a real child process of this script:
          RED    a commit tripping EVERY pattern → exit 3, every pattern named, no value printed
          GREEN  realistic content + an allowlisted line → exit 0
          EMPTY  the only commit is outside the window → NOTHING SWEPT, exit 2
          RANGE  a hit inside --range fires; a hit before it stays out; an empty range is NOTHING SWEPT
          plus staged / --message-file regression arms (exit 1 on a fixture, 0 on clean).
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

  const r = sweepHistory({ repo, ...scope });
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
 * @returns {{ summary: string, hits: Array<{pattern: string, sha: string, file: string, line: number}>, nothingSwept: boolean, error?: string }}
 */
function sweepHistory({ repo, revArgs, label }) {
  let log = "";
  try {
    log = execFileSync(
      "git",
      [
        "-C", repo, "log", "-p", "--no-color", "--unified=0", "--no-ext-diff", "--no-textconv",
        // One marker line per commit (0x01 never starts a diff line); the body is not printed.
        "--format=%x01commit %h",
        ...revArgs,
      ],
      { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    const first = String(err?.stderr || err?.message || "git log failed").trim().split("\n")[0];
    return { summary: "", hits: [], nothingSwept: false, error: `git unreadable (${repo}): ${first}` };
  }

  let commits = 0;
  let hunks = 0;
  let added = 0;
  let sha = "?";
  let file = "?";
  let newLine = 0;
  const hits = [];
  for (const raw of log.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.startsWith("\x01commit ")) { commits++; sha = line.slice(8).trim(); file = "?"; continue; }
    if (line.startsWith("+++ ")) { file = diffPath(line.slice(4)); continue; }
    if (line.startsWith("--- ")) continue;
    if (line.startsWith("@@")) {
      hunks++;
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(line);
      newLine = m ? Number(m[1]) : 0;
      continue;
    }
    if (line.startsWith("+")) {
      added++;
      const n = newLine++;
      const pattern = firstPatternHit(line.slice(1));
      if (pattern) hits.push({ pattern, sha, file, line: n });
      continue;
    }
    if (line.startsWith(" ")) newLine++; // context (none under --unified=0; kept for correctness)
  }

  const summary = `history: ${commits} commits scanned · ${hunks} hunks · ${added} added lines · ${label}`;
  return { summary, hits, nothingSwept: commits === 0 };
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
  // allowlist marker, so it fires when committed to the fixture repo.
  const FIRE = [
    ["private-key-block", "-----BEGIN RSA PRIVATE KEY-----"], // pragma: allowlist secret gitleaks:allow
    ["mongodb-uri-with-creds", "MONGO=mongodb+srv://fixtureuser:fixturepw@cluster0.fixture.mongodb.net/db"], // pragma: allowlist secret gitleaks:allow
    ["postgres-uri-with-creds", "DATABASE_URL=postgres://fixtureuser:fixturepw@db.fixture.internal:5432/app"], // pragma: allowlist secret gitleaks:allow
    ["mysql-uri-with-creds", "MYSQL=mysql://fixtureuser:fixturepw@db.fixture.internal/app"], // pragma: allowlist secret gitleaks:allow
    ["redis-uri-with-creds", "REDIS=redis://:fixturepw@cache.fixture.internal:6379"], // pragma: allowlist secret gitleaks:allow
    ["amqp-uri-with-creds", "AMQP=amqps://fixtureuser:fixturepw@mq.fixture.internal/vhost"], // pragma: allowlist secret gitleaks:allow
    ["aws-access-key", "aws_access_key_id = AKIAFIXTUREFIXTURE00"], // pragma: allowlist secret gitleaks:allow
    ["stripe-live-secret", "STRIPE=sk_live_FIXTUREFIXTUREFIXTURE0"], // pragma: allowlist secret gitleaks:allow
    ["github-pat", "GITHUB_TOKEN=ghp_FIXTUREFIXTUREFIXTUREFIXTUREFIXTURE0"], // pragma: allowlist secret gitleaks:allow
    ["google-api-key", "GOOGLE=AIzaFIXTUREFIXTUREFIXTUREFIXTUREFIXTURE"], // pragma: allowlist secret gitleaks:allow
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
  const arm = (label, ok, why) => {
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
  const runSelf = (args, cwd) => {
    const r = spawnSync(process.execPath, [self, ...args], { cwd, encoding: "utf8", env });
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
  } catch (err) {
    failed++;
    console.log(`selftest arm — harness: FAIL — ${String(err?.message ?? err).split("\n")[0]}`);
  } finally {
    try { rmSync(base, { recursive: true, force: true }); } catch { /* temp dir; best effort */ }
  }
  console.log(failed === 0 ? `selftest: PASS (${FIRE.length} patterns, ${SILENT.length} silent lines, 8 arms)` : `selftest: FAIL — ${failed} arm(s) failed`);
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
