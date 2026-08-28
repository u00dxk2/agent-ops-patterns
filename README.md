# agent-ops-patterns

[![tests](https://github.com/u00dxk2/agent-ops-patterns/actions/workflows/tests.yml/badge.svg)](https://github.com/u00dxk2/agent-ops-patterns/actions/workflows/tests.yml)

Operational patterns for running LLM agents in production.

I run a software portfolio by myself, through a lot of concurrent Claude Code agent sessions coordinated over a Postgres message bus and watched by a layer of small detectors that make no model calls. These patterns came out of that. The origin story is still my word - but [OPS-SNAPSHOT.md](./OPS-SNAPSHOT.md) is the part I can measure, with the command next to each number and an honest list of what I can't produce. Judge the code on the code: the libraries are all here and all tested, the written protocols are practices rather than executable specifications, and every artifact says where it stops working.

Agent frameworks get you to the demo. These patterns are about what happens after: recalled transcripts handing your own secrets back to you, agent memory rotting into duplicates and dead links, health monitoring that costs more than the work it watches, and instruction files edited daily with nothing catching the regression. Each one is here because something broke and this is what stopped it breaking again.

Two essays frame the territory these patterns assume. Cliff Rosen's ["The Agent in the Middle"](https://www.orchestratorstudios.ai/articles/the-agent-in-the-middle.html) is the *access* half — an agent replacing the UX layer over your systems' substrates, given understanding (skills) and access (tools). David Kooi's ["Cognitive Operations Maps"](https://uncagedminds.substack.com/p/cognitive-operations-maps) is the *judgment* half — which recurring decisions the agent holds, and how you validate them. This repo is the operational layer under both: what keeps that architecture honest once it runs unattended.

## Start here: run the audit on your own system

Don't take my word for any of this. [**SELF-AUDIT.md**](./SELF-AUDIT.md) is a prompt you
hand to your own agent - it walks your setup through five questions and reports back
with a score, a quoted file path per verdict, and the smallest fix that would move one
failure to a pass. It takes about thirty seconds of your attention and requires no trust
in me at all.

I ran it against this repo. It found two blockers, including a real hole in the
permission library - the artifact whose whole job is question four. Both are fixed, and
both fixes are in the history.

## Skills: hand your agent a source, get a decision you can check

The self-audit hands your agent five questions. The skills in [`skills/`](./skills/)
hand it a *source* - a course, a paper set - and ask it to decide, idea by idea,
whether the source names a gap in your system. The output is a disposition record:
one row per idea, a verdict of APPLIES / DOES NOT APPLY / ALREADY IN PLACE / NOT
DECIDABLE, a quoted file path or command output per verdict, thresholds written down
*before* any number is read, and "declined, because X" accepted as a complete answer.
The skill offers; your agent decides; the record is what you review.

The first one is [`skills/cs329a-self-improving-agents/`](./skills/cs329a-self-improving-agents/SKILL.md) -
Stanford CS329A "Self-Improving AI Agents" (fall 2025, nine lectures on verifiers,
test-time compute, planning, RL, deep-research agents and agentic evals) reduced to ten
ideas, each with the lecture and the paper behind its numbers. It ships our summaries and
the paper links, not the lectures - those are Stanford's - and a test that every citation
resolves. We ran it on our own system first: the idea we were most excited about came back
NOT DECIDABLE (0 of 39 labels joinable), the most valuable ship was a log file, and the
verifiers refuted three of four builder receipts. That run is in
[`references/worked-example.md`](./skills/cs329a-self-improving-agents/references/worked-example.md),
misses included.

Install as a Claude Code plugin:

```
claude plugin marketplace add u00dxk2/agent-ops-patterns
claude plugin install agent-ops-skills@agent-ops-patterns
```

or copy the skill folder into any harness that reads the Agent Skills format
(`SKILL.md` + `references/`). Then point your agent at the repo you want judged and say
"run the CS329A disposition." Expect ten rows and a short chat summary; the rows are the
deliverable.

## What's here

| Artifact | What it does | How to adopt |
|---|---|---|
| [`lib/snippet-redact.mjs`](./lib/snippet-redact.mjs) | Redacts secret-shaped text (API keys, JWTs, DB URIs, PEM blocks…) at the output boundary of any recall/search path, with named shape tokens (`[redacted:github-token]`) so hits stay findable. Defense-in-depth, not DLP — see [Coverage and limits](#coverage-and-limits). | **Use as-is** — vendor the one file (zero deps, pure function) |
| [`lib/memory-integrity.mjs`](./lib/memory-integrity.mjs) | Zero-LLM integrity pass over a markdown agent-memory dir (MEMORY.md-style index + per-fact files + `[[wiki-links]]` — the Claude Code auto-memory shape): dead links, silent merges, over-budget index, orphans, near-duplicates; plus a backlink graph and **suggest-only** repairs. | **Use as-is** — vendor the one file; wire a thin CLI to your memory dir |
| [`lib/secret_redaction.py`](./lib/secret_redaction.py) | The same output-boundary redaction for Python recall paths (agent-memory layers, log excerpting) — a faithful port of `snippet-redact.mjs`, kept in sync; extracted while proposing this boundary upstream to a Python memory framework ([mem0ai/mem0#6817](https://github.com/mem0ai/mem0/issues/6817)). | **Use as-is** — vendor the one file (stdlib-only); `python lib/secret_redaction.py` runs its self-check |
| [`lib/capability-grant.mjs`](./lib/capability-grant.mjs) | Scoped, single-use, TTL-bounded capability grants for human-gated agent actions: an approval relayed through a chat/bus message is not authorization, so a direct human "go" mints a grant bound to the sha256 of one exact command, honored once. Fail-closed: any ambiguity falls through to your normal permission prompt. | **Reference logic** — pure and complete as logic, and **not an authorization boundary on its own**. You supply: complete, non-bypassable mediation (no execution path reaches the action except through the hook); an authenticated *and* authorized minting principal, minting outside any agent session; a grant store, class policy and audit log the agent cannot write or delete; random ids; scope and class resolution; a trusted clock; atomic consume-before-execute; executing the same captured value that was checked; binding or independently trusting mutable context (cwd, PATH, executable resolution, environment, shell, referenced files) — a command hash does not bind a command's *effect* when those can change; and a fallback to your normal prompt. Budget real work here, not a wrapper |
| [`lib/stale-basis.mjs`](./lib/stale-basis.mjs) | One staleness chain for tracker/memory items — newest of the declared *signal* dates (fields stamped only when an item was actually looked at), with bulk-write `updated` timestamps deliberately excluded so a mass edit can't silently re-date the whole tracker. Verdicts name which basis won. | **Use as-is** — vendor the one file; import it from EVERY reader (two hand-rolled copies of a staleness chain will drift) |
| [`lib/rrf-fuse.mjs`](./lib/rrf-fuse.mjs) | Reciprocal rank fusion (k=60) of a recency ranking and a relevance ranking for agent-recall paths — because recency-only recall buries the relevant old hit under marginal recent ones. Fuses ranks, not magnitudes, so a dumb regex match-count works as the second signal. | **Use as-is** — vendor the one file (zero deps, pure function) |
| [`lib/memory-usage-ledger.mjs`](./lib/memory-usage-ledger.mjs) | Usage evidence for agent-memory eviction: session close records which memory files carried load, the tally reports counts / last touch / never-touched over a window. The tally is EVIDENCE for an eviction pass, never a verdict — and an empty ledger reports itself as absence of evidence, not rot. | **Use as-is** — vendor the one file; wire a thin touch/tally CLI (the lib is pure) |
| [`lib/scannable-command.mjs`](./lib/scannable-command.mjs) | De-obfuscates command text before policy regexes scan it (quote-split tokens, ANSI-C `$'…'` including hex/octal/unicode spellings, backslash escapes; `C:\` and `\\server` prefixes survive but interior path separators do not, so match path rules against the raw text), under the raw-OR-normalized doctrine: a hit on either form counts, so normalization can only widen detection, never narrow it. A speed bump against mistakes and injection, not a sandbox boundary. | **Use as-is** — vendor the one file |
| [`lib/shadow-screen.mjs`](./lib/shadow-screen.mjs) | The four-state gate vocabulary (`would_block`/`shadow_allow` watching; `block`/`allow` enforcing) plus the explicit `unscreened` verdict when the screener never ran — a check that never ran must never read as a pass. Fail-closed on unscreened in enforce mode; fail-open is a declared edit, never a default. | **Use as-is** — vendor the one file; the pattern doc below says how to read the log |
| [`patterns/shadow-screen-states.md`](./patterns/shadow-screen-states.md) | Ship gates watching before enforcing, with vocabulary that keeps the log decidable: reviewing `would_block` rows before promotion, refusing to count `unscreened` as a pass, and treating a rising unscreened rate as the outage it is. | **Read and apply** — `shadow-screen` is the state helper |
| [`patterns/fail-soft-detectors.md`](./patterns/fail-soft-detectors.md) | The discipline for zero-LLM health detectors around agent fleets: PRESENCE-not-judgment, declared failure postures, structural no-LLM enforcement, alert dedup, no watchdog stacks, resurrect-else-reap, kill-switches. | **Read and apply** — protocol, with `snippet-redact` + `memory-integrity` as reference implementations |
| [`patterns/checks-that-cant-fail.md`](./patterns/checks-that-cant-fail.md) | Why a green check nobody has seen go red is not evidence, and the guard for four ways a check silently stops running while still reporting "clean": the never-red monitor, the dead-instrument zero (positive controls), the sweep that reached nothing (NOTHING SWEPT), and the config-absent silent disable. | **Read and apply** — protocol; the operations analog of mutation testing |
| [`patterns/skill-regression-testing.md`](./patterns/skill-regression-testing.md) | Treating agent skills/prompts as process code: TDD-against-a-watched-failure, benchmark-gated edits, shadow-A/B with auto-rollback, anti-rationalization red flags. | **Read and apply** — the thinnest layer in the systems we looked at informally (July 2026; a look around, not a survey) |
| [`patterns/durability-tiered-write-governance.md`](./patterns/durability-tiered-write-governance.md) | Gate agent actions by how hard they are to undo, on a three-rung ladder: effect-free authorized reads never sent for approval, schema-bounded reversible writes machine-approved, substrate/irreversible writes human-direct via minted grants. Replaces case-law permission accretion with an admission test per rule. | **Read and apply** — `capability-grant` is the rung-3 mechanism |
| [`skills/cs329a-self-improving-agents/`](./skills/cs329a-self-improving-agents/SKILL.md) | An Agent Skill: your agent reads Stanford CS329A's ten load-bearing ideas (verifier filtering before ensembling, meta-verification, signal-needs-spread, reliability horizon, the deep-research ceiling…) against YOUR repo and writes a disposition record — one verdict per idea, a quoted path per verdict, bars pre-committed before any number. Offers; never assigns. | **Install** — `claude plugin marketplace add u00dxk2/agent-ops-patterns` then `claude plugin install agent-ops-skills@agent-ops-patterns`; or copy the folder (Agent Skills format). Citations link the papers, never the lectures; CI checks every link resolves |

## Quickstart

```js
// Redact at the display boundary of anything that recalls stored text.
// The whole block runs as written: copy it into a file, point MEMORY_DIR at
// your own directory, and run it.
import { redactSecretShapes } from "./lib/snippet-redact.mjs";

const snippet = "recalled text with sk-ant-example0123456789abcdef in it";
const { text, shapes } = redactSecretShapes(snippet);
// → text with secret-shaped runs replaced by [redacted:<shape>]; benign text passes byte-identical.
// → if the scan can't stabilize, text is [redacted:nonconvergent-snippet] — the whole
//   snippet, not a partial redaction. Fail-closed; there is no flag to forget to check.
// Display boundary ONLY — never run over text that will be executed or stored.

// Lint a memory directory (caller does the I/O; the lib is pure).
import fs from "node:fs";
import path from "node:path";
import { lintMemoryIntegrity, suggestMemoryRepairs } from "./lib/memory-integrity.mjs";

const MEMORY_DIR = "./memory";
const indexPath = path.join(MEMORY_DIR, "MEMORY.md");

// Regular .md files only, case-insensitively. readdirSync returns directories
// too, and readFileSync on a directory throws — which is how a lint run turns
// into a crash on someone else's machine. Match the extension without regard
// to case, or a README.MD drops out of the inventory before the coverage count
// ever sees it, and your "reached" number quietly under-reports.
const files = fs
  .readdirSync(MEMORY_DIR, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".md"))
  .map((e) => ({
    name: e.name,
    content: fs.readFileSync(path.join(MEMORY_DIR, e.name), "utf8"),
  }));

const input = {
  indexText: fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : "",
  files,
  indexByteLength: fs.existsSync(indexPath) ? fs.statSync(indexPath).size : 0,
};

const { findings, swept, coverage } = lintMemoryIntegrity(input);

// Check `swept` BEFORE findings. An empty findings list means either "nothing
// was wrong" or "nothing was read", and those deserve opposite reactions.
if (!swept) {
  console.error(`NOTHING SWEPT — no readable memory files under ${MEMORY_DIR}`);
  process.exitCode = 4;                                  // probe-blind, not clean
} else {
  console.log(`swept ${coverage.reached} files (${coverage.skipped} skipped)`);
  for (const f of findings) console.log(`${f.severity}: ${f.message}`);
  process.exitCode = findings.length > 0 ? 3 : 0;        // 3 = findings, 0 = clean
}

const { suggestions } = suggestMemoryRepairs(input);     // suggest-only, never auto-applied
```

Run the tests: `npm test` (built-in `node:test`, no dev dependencies). The Python lib carries its own assert-based self-check - `python lib/secret_redaction.py` (stdlib only) - asserting the same contract the JS suite pins, documented limits included. The self-check refuses to run under `-O`, where Python compiles every `assert` out and a broken implementation would still print "all assertions passed."

Versions, stated exactly: CI runs the **JS suite** on Node 20, 22 and 24, and the **Python self-check** on Python 3.10 - on pull requests, and on pushes to `main`. Not every push to every branch, and the Python job does not run the Node suite. That precision is the point of the line: it names what the matrix in [`tests.yml`](./.github/workflows/tests.yml) actually proves, and widening the claim means widening the matrix first. (Locally I also run Node 24 and Python 3.14.)

## Design rules the code follows

- **PRESENCE, not JUDGMENT** — detectors flag absence/inconsistency; correctness stays human.
- **Fail-soft** - for the malformed and ambiguous inputs the tests enumerate, a detector returns no finding rather than a wrong one. That's a tested posture on known inputs, not a guarantee about bugs nobody has found yet.
- **Fail-closed at gates** - the inverse posture for anything that *authorizes* an action (`capability-grant`): the enumerated ambiguous cases all resolve to "no". Same caveat, and it's not academic - the accessor-TOCTOU fix in this repo's history is exactly a case where the posture held and the plumbing didn't.
- **Zero LLM calls** on watch/lint paths — deterministic, free to run every session.
- **Suggest, never auto-apply** — repair output names the fix; a human applies it.
- **Output-boundary redaction** — protect the display path; never mutate stored or executed text.

## Coverage and limits

Every artifact here names what it does NOT do. The libraries pin representative cases of their principal limits in tests; the operational limits - the ones that live in your deployment rather than in this code, like the grant lib's single-user-account boundary - are labeled as what they are, because no test can reach them. The written protocols state practices and are not executable specifications, so nothing tests those at all. Neither kind is a footnote, but they aren't the same kind of promise either.

The skill in `skills/` states its own limits in its `SKILL.md` § "Where this skill stops
working" - the short version: it reads a repo, not a deployment, so "already in place"
proves a code path exists, not that it runs; and the ideas are the course as taught in
fall 2025, read in August 2026.

### snippet-redact (and its Python port)

`snippet-redact` is **defense-in-depth, not a DLP guarantee.** A shape-matcher cannot recognize a secret it has no shape for. Representative examples of the *matcher's* false-negative limits below are pinned in [`test/snippet-redact.test.mjs`](./test/snippet-redact.test.mjs) - but the lists are broader than the fixtures, so read a limit as "we know this class gets through," not "there is a test per bullet." The last bullet is a different kind: a deployment restriction, which no unit test can exercise.

- **40-hex strings pass, deliberately.** A pre-2021 GitHub personal access token is 40 hex characters — the *same shape* as a git SHA. Shape alone cannot distinguish them, and redacting every SHA in developer text is worse than useless. The hex floor is 48 (sha256-length tokens still redact). **If legacy 40-hex tokens might appear in your recalled text, rotate them; this will not save you.**
- **Opaque / unprefixed credentials pass** — `MY_SERVICE_TOKEN=<random>`, session cookies, short-lived OAuth codes, `Authorization:` header values. Key-*name*-based rules (`KEY=…`, `"token": …`) are deliberately absent: they false-positive hard on source code, and this runs on recalled prose. Pair with an ingestion-side scrubber if you need that class.
- **Vendors not in the shape list pass** (SendGrid `SG.`, Slack `xapp-`, Telegram bot tokens, …). The list is what our own corpus actually leaked; adding a shape is a one-line PR.
- **Generic base64 inside URLs, `data:` URIs, and hash-integrity strings (`sha512-…`) passes**, as do digit-free letter runs - those are overwhelmingly webhook paths, inline assets, lockfile hashes, and identifiers, and mid-URL redaction mangles benign text. URL-shaped credentials want their own shape rule (Slack incoming-webhook URLs have one; credentialed DB URIs are covered). The URL skip is a lookback, not a parser: it searches the preceding 2,048 characters for a scheme, so a token sitting further than that from its own `https://` is not recognized as being in a URL and gets redacted anyway. Long enough URLs mangle.
- **Not for text that will be executed or stored.** Redacting a command or a config file corrupts it. Display boundary only.

Guarded against catastrophic backtracking: every pattern is boundary-guarded and free of nested quantifiers (most are literal-prefixed; the generic base64/hex rules are bounded character classes instead). The test behind that sentence runs five 200k-character adversarial probes and requires them to finish inside two seconds - a regression bound, which is a useful thing to have and is not a proof of linear complexity. If you need the proof, read the patterns; the test only tells you they haven't gotten slower. Output is a fixed point: re-redacting redacted text is a no-op, and every member of an adjacency chain is replaced during the **first mutation pass**, with one further pass to confirm stability. So the pass count no longer grows with chain length — it is two, whether the chain is 3 runs or 300. (Be precise about that: with `maxPasses: 1` even a fully-redacted chain comes back as the non-convergence token, because the confirming pass never ran.) That property is newer than it should be. The base64 boundary used to reject a run followed by another `=`, which cost two bugs for one character — adjacent padded runs could only be peeled one per pass, and `<secret>=<secret>` returned the **first secret raw** while reporting itself finished.

If the scan somehow cannot stabilize, the entire snippet is replaced with `[redacted:nonconvergent-snippet]` — **fail-closed, not a warning flag**. A flag only protects callers who read it, and at an output boundary the ones who don't are exactly the ones who leak. No known input reaches that branch, so the libraries take a `maxPasses` / `max_passes` seam whose only job is to let the branch be driven red in a test: a guard nobody can make fire is a guard nobody has checked.

`secret_redaction.py` shares every limit above (same shapes, same skips, same self-checked contract), and compiles its patterns in ASCII mode so JS and Python agree on word boundaries — an adversarial review caught Python's Unicode `\b` hiding a key behind an `é`. Two bounded *text-matching* divergences remain by choice and are documented in the file header (the URL-lookback window's units, and non-ASCII whitespace); both only move skip decisions on exotic Unicode text. Option-type validation also differs, and cannot be made identical: JavaScript has no integer/float distinction, so `maxPasses: 1.0` is simply `1`, while Python treats `max_passes=1.0` as a float and falls back to the default. (Python's other asymmetry — accepting `True` as `1`, because `isinstance(True, int)` — was a real bug and is fixed.) The JS file is canonical; edits to either must be synced to the other.

### capability-grant

- **No cryptographic boundary on a single user account.** If the agent process runs as the same OS user who mints grants, the agent could in principle write a grant file itself. The boundary is operational and needs all three legs: mint from a terminal *outside* any agent session, deny the agent the mint CLI in your harness's permission config, and append every mint/consume/deny to an audit log. If you need a hard boundary, put the grant store behind a different principal.
- **No semantic matching, deliberately.** The sha256 binds the command byte-exact after trimming — internal whitespace included, because collapsing it would make a two-line command hash like its one-line concatenation (an adversarial review demonstrated exactly that against an earlier draft). A benign re-indent misses and falls through to your normal permission prompt. Safe, and occasionally annoying — that is the trade.
- **Single-use requires your store to consume atomically.** `matchGrant` finds, it does not consume; two concurrent hooks can both match before either deletes the grant file. Delete-before-execute (or an exclusive rename) in the hook is part of the security boundary, and it is yours.
- **An empty class allowlist denies everything.** There is no "allow all" spelling; widening scope is an edit to your code, visible in review. Scope and action class are likewise required on every match query — omitting them is a null, not a wildcard.

### stale-basis

- **A dishonest signal defeats it.** If a writer stamps a signal field during a bulk write, the clock resets and no chain can tell. The convention — signal fields are stamped only by disposition-changing reads — lives in your writers; the function only enforces the chain.
- **A future-dated signal wins, unclamped** — clamping would hide the writer bug that produced it. Lint for future dates upstream if your writers might emit them.
- **`{date: null, basis: "none"}` is a distinct verdict, not "fresh".** Treating no-basis as fresh rebuilds the dead-instrument zero from [checks-that-cant-fail](./patterns/checks-that-cant-fail.md).

### rrf-fuse

- **Fuses RANKS, not magnitudes** — a score of 1000 and a score of 5 are both rank-1 in their ranking; if magnitude should matter, encode it in the relevance ranking before fusion.
- **Cannot rescue an empty relevance signal** — all-zero scores degrade to pure recency; the score's quality stays the caller's.
- **Ranks only the pool it is given** — a hit truncated away before fusion cannot surface. Over-collect (we use 3× the final limit per source) before calling it.

Each pinned in [`test/rrf-fuse.test.mjs`](./test/rrf-fuse.test.mjs).

### memory-usage-ledger

- **An empty ledger is absence of evidence, not evidence of rot.** With zero rows read every file lands never-touched, which looks exactly like a directory of dead memories. The tally reports `rowsRead` so that a consumer *can* refuse the read - the zero is tested, and the refusing is yours to write. A library cannot make a caller check the number it hands back. A never-touched list means something only after sessions have recorded for a meaningful fraction of the window.
- **Touches are self-reported** — a session that forgets to record under-counts; one that touches everything it merely loaded over-counts. The convention (touch = load-bearing, not merely-present-in-context) lives in your session-close discipline, not in this code — operational limit.
- **Future-dated touches count, unclamped** (tested) — same doctrine as stale-basis: hide the writer bug and you'll never fix it.
- **It counts; it does not judge.** No thresholds, no auto-evict. PEEK (below) shows one way to make the policy deterministic once you have the evidence.

### scannable-command

Honest framing first, quoted from its upstream (qm): **a speed bump against mistakes and injection, not a sandbox boundary.** A determined adversary defeats any text-level normalizer; the real boundary is your sandbox/permission layer. Tested misses, each pinned in [`test/scannable-command.test.mjs`](./test/scannable-command.test.mjs):

- **Space-separated tokens** — `--bo dy` stays two tokens; joining adjacent words would turn prose mentions into matches and train operators to dismiss the alarm.
- **Variable expansion** — `X=--body; cmd $X` is opaque without executing the shell.
- **Encoded payloads** — base64 piped to an interpreter is data until it runs; no decode pass exists (qm re-scans interpreter-fed payloads; this port does not).
- **Heredoc quoting semantics** — `<<'EOF'` and `<<EOF` normalize identically; heredoc bodies stay visible to your regexes, but a policy that depends on whether a heredoc *expands* cannot use this pass.

### shadow-screen

- **It classifies one decision; it does not log, aggregate, or enforce.** A caller that computes `proceed` and ignores it has a shadow screen wearing an enforce label, and no pure function can see its caller — operational limit, named in the pattern doc.
- **It cannot judge screener quality** — a screener that never flags yields wall-to-wall allows. Prove the screener can fire before trusting its quiet ([checks-that-cant-fail](./patterns/checks-that-cant-fail.md)).
- **`isPass` refuses `unscreened` and `would_block`** (tested), so a pass-rate dashboard cannot absorb a dark screener into its green number.

## Evidence and lineage

These shipped inside a production system, not as a framework exercise: the silent-merge check found a live instance in our own memory index the day it was written; the redaction lib guards our cross-session search path.

Pattern lineage is credited in each file. The output-boundary scrub reimplements an index-boundary pattern from [CorvinOS](https://github.com/CorvinLabs/CorvinOS); the link graph and suggest-only repair adapt [gbrain](https://github.com/garrytan/gbrain)'s self-wiring graph and dream-cycle repair to zero-LLM pattern-matching. The August 2026 additions are one-way ports with upstreams credited in each header: `scannable-command` and `shadow-screen` port the command-normalization and screen-state vocabulary from [yc-software/qm](https://github.com/yc-software/qm) (whose contribution-as-intent governance [CONTRIBUTING.md](./CONTRIBUTING.md) also adopts); `rrf-fuse` was prompted by [TencentCloud/TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)'s hybrid retrieval, with the fusion itself per Cormack, Clarke & Buettcher (SIGIR 2009); `memory-usage-ledger` is the convergent core of [PEEK](https://arxiv.org/abs/2605.19932)'s usage-scored evictor and qm's memory-strategy bench — two systems independently arriving at score-memory-by-use is why we trust the shape. The fail-soft discipline is independently corroborated by two public sources we did not author: Katherine Cass's [*Field Notes From an Eng Manager Building Her First Autonomous Agent System*](https://k4therin2.github.io/agent-system-v1-retrospective.html) — the retrospective on her 11-agent system, quoted in [`patterns/fail-soft-detectors.md`](./patterns/fail-soft-detectors.md) — and Dan Lorenc's [multiclaude](https://dlorenc.medium.com/a-gentle-introduction-to-multiclaude-36491514ba89) daemon design.

## Posture

Reference patterns with runnable implementations — **not a supported framework**. Issues are welcome; response is not guaranteed. Feature proposals travel as human-written intent documents, not code — see [CONTRIBUTING.md](./CONTRIBUTING.md). If you adopt something and it catches a failure for you, an issue saying so is the most useful contribution.

MIT © David Kooi
