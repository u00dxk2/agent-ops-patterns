# agent-ops-patterns

[![tests](https://github.com/u00dxk2/agent-ops-patterns/actions/workflows/tests.yml/badge.svg)](https://github.com/u00dxk2/agent-ops-patterns/actions/workflows/tests.yml)

Operational patterns for running LLM agents in production, extracted from a live system: a 15-product software portfolio operated by one person through ~14 concurrent Claude Code agent sessions, a Postgres message bus, and a zero-LLM health-detector layer — running daily since spring 2026.

Agent frameworks get you to the demo. These patterns are about what happens after: recalled transcripts leaking secrets into context, agent memory rotting into duplicates and dead links, health monitoring that costs more than the work, and instruction files edited daily with no regression safety. Each pattern here earned its place by catching real failures in production.

Two essays frame the territory these patterns assume. Cliff Rosen's ["The Agent in the Middle"](https://www.orchestratorstudios.ai/articles/the-agent-in-the-middle.html) is the *access* half — an agent replacing the UX layer over your systems' substrates, given understanding (skills) and access (tools). David Kooi's ["Cognitive Operations Maps"](https://uncagedminds.substack.com/p/cognitive-operations-maps) is the *judgment* half — which recurring decisions the agent holds, and how you validate them. This repo is the operational layer under both: what keeps that architecture honest once it runs unattended.

## What's here

| Artifact | What it does | How to adopt |
|---|---|---|
| [`lib/snippet-redact.mjs`](./lib/snippet-redact.mjs) | Redacts secret-shaped text (API keys, JWTs, DB URIs, PEM blocks…) at the output boundary of any recall/search path, with named shape tokens (`[redacted:github-token]`) so hits stay findable. Defense-in-depth, not DLP — see [Coverage and limits](#coverage-and-limits). | **Use as-is** — vendor the one file (zero deps, pure function) |
| [`lib/memory-integrity.mjs`](./lib/memory-integrity.mjs) | Zero-LLM integrity pass over a markdown agent-memory dir (MEMORY.md-style index + per-fact files + `[[wiki-links]]` — the Claude Code auto-memory shape): dead links, silent merges, over-budget index, orphans, near-duplicates; plus a backlink graph and **suggest-only** repairs. | **Use as-is** — vendor the one file; wire a thin CLI to your memory dir |
| [`lib/secret_redaction.py`](./lib/secret_redaction.py) | The same output-boundary redaction for Python recall paths (agent-memory layers, log excerpting) — a faithful port of `snippet-redact.mjs`, kept in sync; extracted while proposing this boundary upstream to a Python memory framework ([mem0ai/mem0#6817](https://github.com/mem0ai/mem0/issues/6817)). | **Use as-is** — vendor the one file (stdlib-only); `python lib/secret_redaction.py` runs its self-check |
| [`lib/capability-grant.mjs`](./lib/capability-grant.mjs) | Scoped, single-use, TTL-bounded capability grants for human-gated agent actions: an approval relayed through a chat/bus message is not authorization, so a direct human "go" mints a grant bound to the sha256 of one exact command, honored once. Fail-closed: any ambiguity falls through to your normal permission prompt. | **Use as-is** — vendor the one file (pure logic); wire a thin mint CLI + permission hook for your harness |
| [`lib/stale-basis.mjs`](./lib/stale-basis.mjs) | One staleness chain for tracker/memory items — newest of the declared *signal* dates (fields stamped only when an item was actually looked at), with bulk-write `updated` timestamps deliberately excluded so a mass edit can't silently re-date the whole tracker. Verdicts name which basis won. | **Use as-is** — vendor the one file; import it from EVERY reader (two hand-rolled copies of a staleness chain will drift) |
| [`patterns/fail-soft-detectors.md`](./patterns/fail-soft-detectors.md) | The discipline for zero-LLM health detectors around agent fleets: PRESENCE-not-judgment, declared failure postures, structural no-LLM enforcement, alert dedup, no watchdog stacks, resurrect-else-reap, kill-switches. | **Read and apply** — protocol, with `snippet-redact` + `memory-integrity` as reference implementations |
| [`patterns/checks-that-cant-fail.md`](./patterns/checks-that-cant-fail.md) | Why a green check nobody has seen go red is not evidence, and the guard for four ways a check silently stops running while still reporting "clean": the never-red monitor, the dead-instrument zero (positive controls), the sweep that reached nothing (NOTHING SWEPT), and the config-absent silent disable. | **Read and apply** — protocol; the operations analog of mutation testing |
| [`patterns/skill-regression-testing.md`](./patterns/skill-regression-testing.md) | Treating agent skills/prompts as process code: TDD-against-a-watched-failure, benchmark-gated edits, shadow-A/B with auto-rollback, anti-rationalization red flags. | **Read and apply** — the thinnest layer in the systems we surveyed (July 2026) |
| [`patterns/durability-tiered-write-governance.md`](./patterns/durability-tiered-write-governance.md) | Gate agent actions by how hard they are to undo, on a three-rung ladder: reads never gated, schema-bounded writes machine-approved, substrate/irreversible writes human-direct via minted grants. Replaces case-law permission accretion with an admission test per rule. | **Read and apply** — `capability-grant` is the rung-3 mechanism |

## Quickstart

```js
// Redact at the display boundary of anything that recalls stored text:
import { redactSecretShapes } from "./lib/snippet-redact.mjs";
const { text, shapes } = redactSecretShapes(snippet);
// → text with secret-shaped runs replaced by [redacted:<shape>]; benign text passes byte-identical.
// Display boundary ONLY — never run over text that will be executed or stored.

// Lint a memory directory (caller does the I/O; the lib is pure):
import { lintMemoryIntegrity, suggestMemoryRepairs } from "./lib/memory-integrity.mjs";
const input = {
  indexText: fs.readFileSync("MEMORY.md", "utf8"),
  files: fs.readdirSync(dir).map((name) => ({ name, content: fs.readFileSync(path.join(dir, name), "utf8") })),
  indexByteLength: fs.statSync("MEMORY.md").size,
};
const { findings } = lintMemoryIntegrity(input);      // WARN/INFO findings
const { suggestions } = suggestMemoryRepairs(input);  // concrete fixes — suggest-only, never auto-applied
```

Run the tests: `npm test` (built-in `node:test`, no dev dependencies, Node ≥ 20). The Python lib carries its own assert-based self-check — `python lib/secret_redaction.py` (stdlib-only, Python ≥ 3.10) — asserting the same contract the JS suite pins, documented limits included.

## Design rules the code follows

- **PRESENCE, not JUDGMENT** — detectors flag absence/inconsistency; correctness stays human.
- **Fail-soft** — every ambiguity resolves to no finding; a bug in a guard can only under-report. Tested behavior, not a comment.
- **Fail-closed at gates** — the inverse posture for anything that *authorizes* an action (`capability-grant`): every ambiguity resolves to "no", so a bug can only fail-to-approve, never wrongly approve. Also tested behavior.
- **Zero LLM calls** on watch/lint paths — deterministic, free to run every session.
- **Suggest, never auto-apply** — repair output names the fix; a human applies it.
- **Output-boundary redaction** — protect the display path; never mutate stored or executed text.

## Coverage and limits

Every artifact here names what it does NOT do. Behavioral limits carry tests; operational limits (the ones that live in your deployment, not in this code — like the grant lib's single-user-account boundary) are labeled as what they are. Neither kind is a footnote.

### snippet-redact (and its Python port)

`snippet-redact` is **defense-in-depth, not a DLP guarantee.** A shape-matcher cannot recognize a secret it has no shape for, and the honest boundary is a tested contract here, not a footnote — each limit below has an explicit test in [`test/snippet-redact.test.mjs`](./test/snippet-redact.test.mjs).

- **40-hex strings pass, deliberately.** A pre-2021 GitHub personal access token is 40 hex characters — the *same shape* as a git SHA. Shape alone cannot distinguish them, and redacting every SHA in developer text is worse than useless. The hex floor is 48 (sha256-length tokens still redact). **If legacy 40-hex tokens might appear in your recalled text, rotate them; this will not save you.**
- **Opaque / unprefixed credentials pass** — `MY_SERVICE_TOKEN=<random>`, session cookies, short-lived OAuth codes, `Authorization:` header values. Key-*name*-based rules (`KEY=…`, `"token": …`) are deliberately absent: they false-positive hard on source code, and this runs on recalled prose. Pair with an ingestion-side scrubber if you need that class.
- **Vendors not in the shape list pass** (SendGrid `SG.`, Slack `xapp-`, Telegram bot tokens, …). The list is what our own corpus actually leaked; adding a shape is a one-line PR.
- **Generic base64 inside URLs, `data:` URIs, and hash-integrity strings (`sha512-…`) passes**, as do digit-free letter runs — those are overwhelmingly webhook paths, inline assets, lockfile hashes, and identifiers, and mid-URL redaction mangles benign text. URL-shaped credentials want their own shape rule (Slack incoming-webhook URLs have one; credentialed DB URIs are covered).
- **Not for text that will be executed or stored.** Redacting a command or a config file corrupts it. Display boundary only.

No catastrophic backtracking: every pattern is boundary-guarded and free of nested quantifiers (most are literal-prefixed; the generic base64/hex rules are bounded character classes instead), with a test asserting linear behavior on 200k-character adversarial inputs. Output is a fixed point — re-redacting redacted text is a no-op, including across adjacent padded base64 runs.

`secret_redaction.py` shares every limit above (same shapes, same skips, same self-checked contract), and compiles its patterns in ASCII mode so JS and Python agree on word boundaries — an adversarial review caught Python's Unicode `\b` hiding a key behind an `é`. Two bounded divergences remain by choice and are documented in the file header (the URL-lookback window's units, and non-ASCII whitespace); both only move skip decisions on exotic Unicode text. The JS file is canonical; edits to either must be synced to the other.

### capability-grant

- **No cryptographic boundary on a single user account.** If the agent process runs as the same OS user who mints grants, the agent could in principle write a grant file itself. The boundary is operational and needs all three legs: mint from a terminal *outside* any agent session, deny the agent the mint CLI in your harness's permission config, and append every mint/consume/deny to an audit log. If you need a hard boundary, put the grant store behind a different principal.
- **No semantic matching, deliberately.** The sha256 binds the command byte-exact after trimming — internal whitespace included, because collapsing it would make a two-line command hash like its one-line concatenation (an adversarial review demonstrated exactly that against an earlier draft). A benign re-indent misses and falls through to your normal permission prompt. Safe, and occasionally annoying — that is the trade.
- **Single-use requires your store to consume atomically.** `matchGrant` finds, it does not consume; two concurrent hooks can both match before either deletes the grant file. Delete-before-execute (or an exclusive rename) in the hook is part of the security boundary, and it is yours.
- **An empty class allowlist denies everything.** There is no "allow all" spelling; widening scope is an edit to your code, visible in review. Scope and action class are likewise required on every match query — omitting them is a null, not a wildcard.

### stale-basis

- **A dishonest signal defeats it.** If a writer stamps a signal field during a bulk write, the clock resets and no chain can tell. The convention — signal fields are stamped only by disposition-changing reads — lives in your writers; the function only enforces the chain.
- **A future-dated signal wins, unclamped** — clamping would hide the writer bug that produced it. Lint for future dates upstream if your writers might emit them.
- **`{date: null, basis: "none"}` is a distinct verdict, not "fresh".** Treating no-basis as fresh rebuilds the dead-instrument zero from [checks-that-cant-fail](./patterns/checks-that-cant-fail.md).

## Evidence and lineage

These shipped inside a production system, not as a framework exercise: the silent-merge check found a live instance in our own memory index the day it was written; the redaction lib guards our cross-session search path.

Pattern lineage is credited in each file. The output-boundary scrub reimplements an index-boundary pattern from [CorvinOS](https://github.com/CorvinLabs/CorvinOS); the link graph and suggest-only repair adapt [gbrain](https://github.com/garrytan/gbrain)'s self-wiring graph and dream-cycle repair to zero-LLM pattern-matching. The fail-soft discipline is independently corroborated by two public sources we did not author: Katherine Cass's [*Field Notes From an Eng Manager Building Her First Autonomous Agent System*](https://k4therin2.github.io/agent-system-v1-retrospective.html) — the retrospective on her 11-agent system, quoted in [`patterns/fail-soft-detectors.md`](./patterns/fail-soft-detectors.md) — and Dan Lorenc's [multiclaude](https://dlorenc.medium.com/a-gentle-introduction-to-multiclaude-36491514ba89) daemon design.

## Posture

Reference patterns with runnable implementations — **not a supported framework**. Issues and PRs are welcome; response is not guaranteed. If you adopt something and it catches a failure for you, an issue saying so is the most useful contribution.

MIT © David Kooi
