# agent-ops-patterns

Operational patterns for running LLM agents in production, extracted from a live system: a 15-product software portfolio operated by one person through ~14 concurrent Claude Code agent sessions, a Postgres message bus, and a zero-LLM health-detector layer — running daily since spring 2026.

Agent frameworks get you to the demo. These patterns are about what happens after: recalled transcripts leaking secrets into context, agent memory rotting into duplicates and dead links, health monitoring that costs more than the work, and instruction files edited daily with no regression safety. Each pattern here earned its place by catching real failures in production.

## What's here

| Artifact | What it does | How to adopt |
|---|---|---|
| [`lib/snippet-redact.mjs`](./lib/snippet-redact.mjs) | Redacts secret-shaped text (API keys, JWTs, DB URIs, PEM blocks…) at the output boundary of any recall/search path, with named shape tokens (`[redacted:github-token]`) so hits stay findable. Defense-in-depth, not DLP — see [Coverage and limits](#coverage-and-limits). | **Use as-is** — vendor the one file (zero deps, pure function) |
| [`lib/memory-integrity.mjs`](./lib/memory-integrity.mjs) | Zero-LLM integrity pass over a markdown agent-memory dir (MEMORY.md-style index + per-fact files + `[[wiki-links]]` — the Claude Code auto-memory shape): dead links, silent merges, over-budget index, orphans, near-duplicates; plus a backlink graph and **suggest-only** repairs. | **Use as-is** — vendor the one file; wire a thin CLI to your memory dir |
| [`patterns/fail-soft-detectors.md`](./patterns/fail-soft-detectors.md) | The discipline for zero-LLM health detectors around agent fleets: PRESENCE-not-judgment, declared failure postures, structural no-LLM enforcement, alert dedup, no watchdog stacks, resurrect-else-reap, kill-switches. | **Read and apply** — protocol, with the two libs as reference implementations |
| [`patterns/checks-that-cant-fail.md`](./patterns/checks-that-cant-fail.md) | Why a green check nobody has seen go red is not evidence, and the guard for four ways a check silently stops running while still reporting "clean": the never-red monitor, the dead-instrument zero (positive controls), the sweep that reached nothing (NOTHING SWEPT), and the config-absent silent disable. | **Read and apply** — protocol; the operations analog of mutation testing |
| [`patterns/skill-regression-testing.md`](./patterns/skill-regression-testing.md) | Treating agent skills/prompts as process code: TDD-against-a-watched-failure, benchmark-gated edits, shadow-A/B with auto-rollback, anti-rationalization red flags. | **Read and apply** — the thinnest layer in the systems we surveyed (July 2026) |

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

Run the tests: `npm test` (built-in `node:test`, no dev dependencies, Node ≥ 20).

## Design rules the code follows

- **PRESENCE, not JUDGMENT** — detectors flag absence/inconsistency; correctness stays human.
- **Fail-soft** — every ambiguity resolves to no finding; a bug in a guard can only under-report. Tested behavior, not a comment.
- **Zero LLM calls** on watch/lint paths — deterministic, free to run every session.
- **Suggest, never auto-apply** — repair output names the fix; a human applies it.
- **Output-boundary redaction** — protect the display path; never mutate stored or executed text.

## Coverage and limits

`snippet-redact` is **defense-in-depth, not a DLP guarantee.** A shape-matcher cannot recognize a secret it has no shape for, and the honest boundary is a tested contract here, not a footnote — each limit below has an explicit test in [`test/snippet-redact.test.mjs`](./test/snippet-redact.test.mjs).

- **40-hex strings pass, deliberately.** A pre-2021 GitHub personal access token is 40 hex characters — the *same shape* as a git SHA. Shape alone cannot distinguish them, and redacting every SHA in developer text is worse than useless. The hex floor is 48 (sha256-length tokens still redact). **If legacy 40-hex tokens might appear in your recalled text, rotate them; this will not save you.**
- **Opaque / unprefixed credentials pass** — `MY_SERVICE_TOKEN=<random>`, session cookies, short-lived OAuth codes, `Authorization:` header values. Key-*name*-based rules (`KEY=…`, `"token": …`) are deliberately absent: they false-positive hard on source code, and this runs on recalled prose. Pair with an ingestion-side scrubber if you need that class.
- **Vendors not in the shape list pass** (SendGrid `SG.`, Slack `xapp-`, Telegram bot tokens, …). The list is what our own corpus actually leaked; adding a shape is a one-line PR.
- **Generic base64 inside URLs, `data:` URIs, and hash-integrity strings (`sha512-…`) passes**, as do digit-free letter runs — those are overwhelmingly webhook paths, inline assets, lockfile hashes, and identifiers, and mid-URL redaction mangles benign text. URL-shaped credentials want their own shape rule (Slack incoming-webhook URLs have one; credentialed DB URIs are covered).
- **Not for text that will be executed or stored.** Redacting a command or a config file corrupts it. Display boundary only.

No catastrophic backtracking: every pattern is boundary-guarded, literal-prefixed, and free of nested quantifiers, with a test asserting linear behavior on 200k-character adversarial inputs. Output is a fixed point — re-redacting redacted text is a no-op, including across adjacent padded base64 runs.

## Evidence and lineage

These shipped inside a production system, not as a framework exercise: the silent-merge check found a live instance in our own memory index the day it was written; the redaction lib guards our cross-session search path.

Pattern lineage is credited in each file. The output-boundary scrub reimplements an index-boundary pattern from [CorvinOS](https://github.com/CorvinLabs/CorvinOS); the link graph and suggest-only repair adapt [gbrain](https://github.com/garrytan/gbrain)'s self-wiring graph and dream-cycle repair to zero-LLM pattern-matching. The fail-soft discipline is independently corroborated by two public sources we did not author: Katherine Cass's [*Field Notes From an Eng Manager Building Her First Autonomous Agent System*](https://k4therin2.github.io/agent-system-v1-retrospective.html) — the retrospective on her 11-agent system, quoted in [`patterns/fail-soft-detectors.md`](./patterns/fail-soft-detectors.md) — and Dan Lorenc's [multiclaude](https://dlorenc.medium.com/a-gentle-introduction-to-multiclaude-36491514ba89) daemon design.

## Posture

Reference patterns with runnable implementations — **not a supported framework**. Issues and PRs are welcome; response is not guaranteed. If you adopt something and it catches a failure for you, an issue saying so is the most useful contribution.

MIT © David Kooi
