# agent-ops-patterns

[![tests](https://github.com/u00dxk2/agent-ops-patterns/actions/workflows/tests.yml/badge.svg)](https://github.com/u00dxk2/agent-ops-patterns/actions/workflows/tests.yml)

Maps of who decides what inside open-source agent systems, and the skill to make one of your own.

## The maps

Each map takes one open-source agent system and lists the recurring judgments it found there, each as a *seat*: the question it answers and who holds it (code, a model, or a person). Each map is one self-contained HTML page that makes no external requests, read at a named commit (two for LangChain, which spans two repositories). How to read one, and what a map is not: [`gallery/`](./gallery/README.md).

| Map | Short version | One thing it shows | Seats shown | Read at |
|---|---|---|---|---|
| [OpenHands](https://u00dxk2.github.io/agent-ops-patterns/gallery/openhands/) | [How it decides](https://u00dxk2.github.io/agent-ops-patterns/gallery/openhands/card.html) | Its goal judge reads `"complete": "false"` as complete, because in Python `bool("false")` is `True`. Reproduced with a failing test and reported as [#5492](https://github.com/OpenHands/software-agent-sdk/issues/5492). | 171, plus 70 gap entries | `aae9c437`, 2026-10-06 |
| [Cline](https://u00dxk2.github.io/agent-ops-patterns/gallery/cline/) | [How it decides](https://u00dxk2.github.io/agent-ops-patterns/gallery/cline/card.html) | 116 of its recurring judgments, each with its question, how it is answered and where in the code it is held. | 116 | `d19f176b`, 2026-11-02 |
| [opencode](https://u00dxk2.github.io/agent-ops-patterns/gallery/opencode/) | [How it decides](https://u00dxk2.github.io/agent-ops-patterns/gallery/opencode/card.html) | Its Plan agent is described in code as a "Read-only agent", but the one rule it adds blocks only file edits outside its plan folder. | 125 | `0093fe57`, 2026-10-24 |
| [pi](https://u00dxk2.github.io/agent-ops-patterns/gallery/pi/) | [How it decides](https://u00dxk2.github.io/agent-ops-patterns/gallery/pi/card.html) | pi ships no approval prompt for tool calls: out of the box, no one is asked before a tool runs. | 111 | `1ce44bed`, 2026-10-28 |
| [agno](https://u00dxk2.github.io/agent-ops-patterns/gallery/agno/) | [How it decides](https://u00dxk2.github.io/agent-ops-patterns/gallery/agno/card.html) | By default, an ordinary agno agent runs valid tool calls without asking anyone, unless the developer sets that tool to pause the run or adds agno's ask-the-person tools. | 115 | `9153aacd`, 2026-10-29 |
| [AnythingLLM](https://u00dxk2.github.io/agent-ops-patterns/gallery/anythingllm/) | [How it decides](https://u00dxk2.github.io/agent-ops-patterns/gallery/anythingllm/card.html) | In the web chat, the person sees an approval card for an agent tool only if neither an operator's pre-approved list nor their own "always allow" list covers the skill. | 110 | `d7d68e75`, 2026-10-15 |
| [browser-use](https://u00dxk2.github.io/agent-ops-patterns/gallery/browser-use/) | [How it decides](https://u00dxk2.github.io/agent-ops-patterns/gallery/browser-use/card.html) | browser-use runs the actions the model picks as soon as they are parsed: nobody approves a form submit, a purchase or a page script unless the developer adds a check in their own code. | 85 | `b49a68e4`, 2026-10-29 |
| [OpenAI Codex](https://u00dxk2.github.io/agent-ops-patterns/gallery/codex/) | — | Of the 158 judgments shown, 10 are held by a person, and six of those are approval questions: run this command, reach this network host, apply these file changes, grant extra permissions, run again without the sandbox, or install a skill's MCP servers. | 158 | `a5c40924`, 2026-11-02 |
| [goose](https://u00dxk2.github.io/agent-ops-patterns/gallery/goose/) | — | Of the 89 judgments shown, 7 are held by a person, and three of those are the person's answer to "may this tool call run?": in the desktop app, in the terminal and in a paired chat. | 89 | `cfb67d72`, 2026-11-02 |
| [DeerFlow](https://u00dxk2.github.io/agent-ops-patterns/gallery/deer-flow/) | — | Of the 118 judgments shown, 5 are held by a person: whether the sandbox may reach a host outside its allowlist, the answer to the agent's own questions, a thumbs up or down on a run, which saved memories are right, and whether a run in progress should stop. | 118 | `14abd9a2`, 2026-11-02 |
| [LangChain](https://u00dxk2.github.io/agent-ops-patterns/gallery/langchain/) | — | By default, nobody is asked before an agent built with LangChain's create_agent runs a tool the model called; review happens only if the developer adds a stop, such as the human-in-the-loop middleware. | 89 | `efebcf50`, 2026-11-02 + `ee3c043b`, 2026-11-01 |
| [Hermes Agent](https://u00dxk2.github.io/agent-ops-patterns/gallery/hermes/) | [How it decides](https://u00dxk2.github.io/agent-ops-patterns/gallery/hermes/card.html) | With a run budget set, Hermes can warn near the end, but the setting does not itself stop the run when the time is up. | 279 | `b200f5bc`, 2026-11-03 |

The OpenHands map also has a gap report; the other eleven are shorter editions without one, and each says what it leaves out. A wrong sentence about someone else's code is the worst bug a map can have: corrections are welcome through the [correction form](https://github.com/u00dxk2/agent-ops-patterns/issues/new?template=map-correction.yml).

The maps here are free to read. To have your own agent system mapped, as paid work, see [skylarkcreations.com/agent-maps](https://skylarkcreations.com/agent-maps).

## Designing a new system? Start here

The maps describe systems that already exist. If you're about to build one, these are the parts of this repo that can change a design:

- **[`skills/cog-ops-design/`](./skills/cog-ops-design/SKILL.md)** makes you decide every recurring judgment before the code exists, each with a control that could prove it worthless (or a test, where the seat has one right answer), and refuses a design with a selector and no way to measure it.
- **[`ideas.md`](./skills/cs329a-self-improving-agents/references/ideas.md), ideas 1, 2, 4, 8 and 9,** is the reading for anything that generates many candidates and keeps a few. Sampling more only helps if something can pick among them, unfiltered judge ensembles did worse than majority vote in the work it cites, and critique by the same model is the configuration the course rates weakest.
- **[`checks-that-cant-fail`](./patterns/checks-that-cant-fail.md)**: a check nobody has seen go red is not evidence, so build in the way to see it fail.
- **[`claims-are-hypotheses`](./patterns/claims-are-hypotheses.md)**: check a design's premises against their source before building on them.
- **[`shadow-screen-states`](./patterns/shadow-screen-states.md)**: run a new gate watching before you let it enforce, in a vocabulary that keeps the log decidable.
- **[`cog-ops-map` Phase 4.5](./skills/cog-ops-map/SKILL.md#phase-45--the-missing-seat-pass)**: every proposed seat arrives with its cheapest version and a control that could kill it.

## Map a system you already run

The [cog-ops-map skill](./skills/cog-ops-map/SKILL.md) has your agent map a system you work on: every recurring judgment as a seat, sorted rule vs ruling and human vs machine, with a report of the gaps the mapping exposed. In Claude Code:

```
claude plugin marketplace add u00dxk2/agent-ops-patterns
claude plugin install agent-ops-skills@agent-ops-patterns
```

Then say "build a cognitive operations map of <system>". Or copy the folder into any harness that reads the Agent Skills format. The method is ["Cognitive Operations Maps"](https://uncagedminds.substack.com/p/cognitive-operations-maps). The skill carries a general version of the method developed while building these maps.

## Also here

- **[A five-question self-audit](./SELF-AUDIT.md)** to paste to your own agent: read-only, scored out of five. Read the file first; it asks your agent to read your history, logs, memory and config. [Got a score? Tell me](https://github.com/u00dxk2/agent-ops-patterns/issues/new?template=ran-the-audit.yml), verdicts only. The paste:

  ```
  Get the exact text of https://raw.githubusercontent.com/u00dxk2/agent-ops-patterns/main/SELF-AUDIT.md
  with a plain download such as curl, not a web tool that summarizes, then run
  the audit in its section "The prompt" on this system. Read-only. If you cannot
  get the exact text, ask me to paste that section - don't run it from a summary.
  ```
- Small zero-dependency libraries and written patterns for running LLM agents in production, in the table below.

## What's here

| Artifact | What it does | How to adopt |
|---|---|---|
| [`lib/snippet-redact.mjs`](./lib/snippet-redact.mjs) | Redacts secret-shaped text (API keys, JWTs, DB URIs, PEM blocks…) at the output boundary of any recall/search path, with named shape tokens (`[redacted:github-token]`) so hits stay findable. Defense-in-depth, not DLP — see [LIMITS.md](./LIMITS.md). | **Use as-is** — vendor the one file (zero deps, pure function) |
| [`lib/memory-integrity.mjs`](./lib/memory-integrity.mjs) | Zero-LLM integrity pass over a markdown agent-memory dir (MEMORY.md-style index + per-fact files + `[[wiki-links]]` — the Claude Code auto-memory shape): dead links, silent merges, over-budget index, orphans, near-duplicates, and (opt-in, with a synchronous resolver you supply) index lines naming a script that resolves to no file; plus a backlink graph, **suggest-only** repairs, and a fleet-wide index-size classifier where an agent you couldn't measure is a finding rather than a clean row. | **Use as-is** — vendor the one file; wire a thin CLI to your memory dir |
| [`lib/secret_redaction.py`](./lib/secret_redaction.py) | The same output-boundary redaction for Python recall paths (agent-memory layers, log excerpting) — a faithful port of `snippet-redact.mjs`, kept in sync; extracted while proposing this boundary upstream to a Python memory framework ([mem0ai/mem0#6817](https://github.com/mem0ai/mem0/issues/6817)). | **Use as-is** — vendor the one file (stdlib-only); `python lib/secret_redaction.py` runs its self-check |
| [`lib/capability-grant.mjs`](./lib/capability-grant.mjs) | Scoped, single-use, TTL-bounded capability grants for human-gated agent actions: an approval relayed through a chat/bus message is not authorization, so a direct human "go" mints a grant bound to the sha256 of one exact command, honored once. Fail-closed: any ambiguity falls through to your normal permission prompt. | **Reference logic** — pure and complete as logic, and **not an authorization boundary on its own**. You supply: complete, non-bypassable mediation (no execution path reaches the action except through the hook); an authenticated *and* authorized minting principal, minting outside any agent session; a grant store, class policy and audit log the agent cannot write or delete; random ids; scope and class resolution; a trusted clock; atomic consume-before-execute; executing the same captured value that was checked; binding or independently trusting mutable context (cwd, PATH, executable resolution, environment, shell, referenced files) — a command hash does not bind a command's *effect* when those can change; and a fallback to your normal prompt. Budget real work here, not a wrapper |
| [`lib/stale-basis.mjs`](./lib/stale-basis.mjs) | One staleness chain for tracker/memory items — newest of the declared *signal* dates (fields stamped only when an item was actually looked at), with bulk-write `updated` timestamps deliberately excluded so a mass edit can't silently re-date the whole tracker. Verdicts name which basis won. | **Use as-is** — vendor the one file; import it from EVERY reader (two hand-rolled copies of a staleness chain will drift) |
| [`lib/rrf-fuse.mjs`](./lib/rrf-fuse.mjs) | Reciprocal rank fusion (k=60) of a recency ranking and a relevance ranking for agent-recall paths — because recency-only recall buries the relevant old hit under marginal recent ones. Fuses ranks, not magnitudes, so a dumb regex match-count works as the second signal. | **Use as-is** — vendor the one file (zero deps, pure function) |
| [`lib/memory-usage-ledger.mjs`](./lib/memory-usage-ledger.mjs) | Usage evidence for agent-memory eviction: session close records which memory files carried load, the tally reports counts / last touch / never-touched over a window. The tally is EVIDENCE for an eviction pass, never a verdict — and an empty ledger reports itself as absence of evidence, not rot. | **Use as-is** — vendor the one file; wire a thin touch/tally CLI (the lib is pure) |
| [`lib/scannable-command.mjs`](./lib/scannable-command.mjs) | De-obfuscates command text before policy regexes scan it (quote-split tokens, ANSI-C `$'…'` including hex/octal/unicode spellings, backslash escapes; `C:\` and `\\server` prefixes survive but interior path separators do not, so match path rules against the raw text), under the raw-OR-normalized doctrine: a hit on either form counts, so normalization can only widen detection, never narrow it. A speed bump against mistakes and injection, not a sandbox boundary. | **Use as-is** — vendor the one file |
| [`lib/shadow-screen.mjs`](./lib/shadow-screen.mjs) | The four-state gate vocabulary (`would_block`/`shadow_allow` watching; `block`/`allow` enforcing) plus the explicit `unscreened` verdict when the screener never ran — a check that never ran must never read as a pass. Fail-closed on unscreened in enforce mode; fail-open is a declared edit, never a default. | **Use as-is** — vendor the one file; the pattern doc below says how to read the log |
| [`lib/strip-comments.mjs`](./lib/strip-comments.mjs) | Removes JS/TS/JSX or POSIX-shell comments before a string-PRESENCE check reads the source — a guard that greps raw source is satisfied by the comment explaining a removal, which is a false green with a production outage under it. Tracks strings, template-literal text, `${}` substitutions and regex literals, so neither silent failure direction (needle survives in a comment / needle eaten out of code) occurs on those shapes, except the known misreads listed under its limits below. | **Use as-is** — vendor the one file (zero deps, pure functions); `includesOutsideComments(src, needle)` is the whole adoption |
| [`lib/known-flags.mjs`](./lib/known-flags.mjs) | Refuses any unrecognized `--flag` before a CLI writes anything, reporting every offender by its position (with a suggested known flag when one is close) and never echoing the token, so a secret pasted as `--<secret>` stays out of the CI log. A dropped flag returns `ok:true` with the flag ignored — how a documented-but-never-implemented flag "works" repeatedly, and how a typo'd scope flag shrinks a 1,192-file sweep to 2 files and prints PASS. Deliberately not a parser: it asserts over raw argv, so adoption is one call and no parsing behavior moves. | **Use as-is** — vendor the one file (node: builtins only); pass `entry: import.meta.url` from any script that is also imported by another |
| [`lib/result-line.mjs`](./lib/result-line.mjs) | Prints one terminal, greppable `RESULT: <VERDICT>` line on every path a check process can exit by — because `\| tail`, `\| head`, a captured file, and PowerShell `-Last N` all report the pipe's exit, not the command's. The verdict rides the TEXT as a second carrier; the exit code stays authoritative. An unmapped exit renders `UNKNOWN` rather than a guessed verdict. | **Use as-is** — vendor the one file; pass `{ fd: 2 }` on any `--json` script or the verdict line corrupts the document |
| [`patterns/shadow-screen-states.md`](./patterns/shadow-screen-states.md) | Ship gates watching before enforcing, with vocabulary that keeps the log decidable: reviewing `would_block` rows before promotion, refusing to count `unscreened` as a pass, and treating a rising unscreened rate as the outage it is. | **Read and apply** — `shadow-screen` is the state helper |
| [`patterns/fail-soft-detectors.md`](./patterns/fail-soft-detectors.md) | The discipline for zero-LLM health detectors around agent fleets: PRESENCE-not-judgment, declared failure postures, structural no-LLM enforcement, alert dedup, no watchdog stacks, resurrect-else-reap, kill-switches. | **Read and apply** — protocol, with `snippet-redact` + `memory-integrity` as reference implementations |
| [`patterns/checks-that-cant-fail.md`](./patterns/checks-that-cant-fail.md) | Why a green check nobody has seen go red is not evidence, and the guard for four ways a check silently stops running while still reporting "clean": the never-red monitor, the dead-instrument zero (positive controls), the sweep that reached nothing (NOTHING SWEPT), and the config-absent silent disable. | **Read and apply** — protocol; the operations analog of mutation testing |
| [`patterns/claims-are-hypotheses.md`](./patterns/claims-are-hypotheses.md) | The text-side twin of the above: four places a sentence gets trusted because of who wrote it — a plan's premise, a "done" checkbox, a remembered rule, a review — each with a dated incident and a copyable guard (premise block, `claimed`/`verified` status, verbatim rulings file, cross-family review prompt). | **Read and apply** — protocol; copy the four blocks |
| [`patterns/secret-movers.md`](./patterns/secret-movers.md) | Moving a credential between stores without the agent ever holding it: the caller names a source, the value is read in-process, output is name/length/status/`verified`, and failures print fixed strings that never echo input — because in the recorded leaks it was the error path, not the happy one. Includes a skeleton exercised against stubs, and blast-radius rules. | **Read and apply** — adapt the skeleton to your host's API, and implement the dummy write/read/delete self-test the pattern describes (the skeleton omits it for length); pass it before moving a real credential |
| [`patterns/skill-regression-testing.md`](./patterns/skill-regression-testing.md) | Treating agent skills/prompts as process code: TDD-against-a-watched-failure, benchmark-gated edits, shadow-A/B with auto-rollback, anti-rationalization red flags. | **Read and apply** — the thinnest layer in the systems we looked at informally (July 2026; a look around, not a survey) |
| [`patterns/durability-tiered-write-governance.md`](./patterns/durability-tiered-write-governance.md) | Gate agent actions by how hard they are to undo, on a three-rung ladder: effect-free authorized reads never sent for approval, schema-bounded reversible writes machine-approved, substrate/irreversible writes human-direct via minted grants. Replaces case-law permission accretion with an admission test per rule. | **Read and apply** — `capability-grant` is the rung-3 mechanism |
| [`skills/cs329a-self-improving-agents/`](./skills/cs329a-self-improving-agents/SKILL.md) | An Agent Skill: your agent reads Stanford CS329A's ten load-bearing ideas (verifier filtering before ensembling, meta-verification, signal-needs-spread, reliability horizon, the deep-research ceiling…) against YOUR repo and writes a disposition record — one verdict per idea, a quoted `file:line` or a scoped command with its exit code and output per verdict, bars pre-committed before any deciding number. Offers; never assigns. | **Install** — `claude plugin marketplace add u00dxk2/agent-ops-patterns` then `claude plugin install agent-ops-skills@agent-ops-patterns`; or copy the folder (Agent Skills format). Citations link the papers, never the lectures; CI checks every link resolves |
| [`skills/cog-ops-map/`](./skills/cog-ops-map/SKILL.md) | An Agent Skill: your agent maps every recurring judgment in a system as a seat (question, holder, real failure, validator), sorts seats rule vs ruling × human vs machine, and builds a map a teammate without repo access can read, with each model-call seat's prompt template or assembly source inline, plus a gap report. | **Install** — same plugin as above; or copy the folder (Agent Skills format) |
| [`skills/cog-ops-design/`](./skills/cog-ops-design/SKILL.md) | An Agent Skill: the same seat card, filled in before the system exists, with a control, a label record and a pre-committed bar on the seats that need them, a list of recorded failure classes to design against, and a refusal list. Emits a seats file to compare the built system against. | **Install** — same plugin as above; or copy the folder, though it reads files elsewhere in this repo |
| [`gallery/`](./gallery/README.md) | Cognitive operations maps of twelve open-source agent systems (the table at the top), built with the method behind the skill above. | **Read** — open a map in your browser from the gallery table |

I run a software portfolio by myself, through a lot of concurrent Claude Code agent sessions coordinated over a Postgres message bus and watched by a layer of small detectors that make no model calls. These patterns came out of that. The origin story is still my word - but [OPS-SNAPSHOT.md](./OPS-SNAPSHOT.md) is the part I can measure, with the command next to each number and an honest list of what I can't produce. Judge the code on the code: the libraries are all here and all tested, the written protocols are practices rather than executable specifications, and every library says where it stops working.

Agent frameworks get you to the demo. These patterns are about what happens after: recalled transcripts handing your own secrets back to you, agent memory rotting into duplicates and dead links, health monitoring that costs more than the work it watches, and instruction files edited daily with nothing catching the regression. Each one is here because something broke and this is what stopped it breaking again.

Two essays frame the territory these patterns assume. Cliff Rosen's ["The Agent in the Middle"](https://www.orchestratorstudios.ai/articles/the-agent-in-the-middle.html) is the *access* half — an agent replacing the UX layer over your systems' substrates, given understanding (skills) and access (tools). My own ["Cognitive Operations Maps"](https://uncagedminds.substack.com/p/cognitive-operations-maps) is the *judgment* half — which recurring decisions the agent holds, and how you validate them. This repo is the operational layer under both: what keeps that architecture honest once it runs unattended.

## Skills: assess a source against your repo, map a system's judgments, design one

The self-audit hands your agent five questions. The first skill in [`skills/`](./skills/)
hands it a *source* - a course, a paper set - and asks it to decide, idea by idea,
whether the source names a gap in your system. The output is a disposition record:
one row per idea, a verdict of APPLIES / DOES NOT APPLY / ALREADY IN PLACE / NOT
DECIDABLE / UNREADABLE, a quoted `file:line` or a scoped command with its exit code and
output per verdict, thresholds written down *before* any deciding number is read, and
"declined, because X" accepted as a complete answer.
The skill offers; your agent decides; the record is what you review.

The first one is [`skills/cs329a-self-improving-agents/`](./skills/cs329a-self-improving-agents/SKILL.md) -
Stanford CS329A "Self-Improving AI Agents" (fall 2025, nine lectures on verifiers,
test-time compute, planning, RL, deep-research agents and agentic evals) reduced to ten
ideas, each with the lecture and the paper behind its numbers. It ships our summaries and
the paper links, not the lectures - those are Stanford's - and a test that every citation
resolves. We ran it on our own system first: the idea we were most excited about came back
NOT DECIDABLE (0 of 39 labels joinable), the most valuable ship was a log file, and the
verifiers refuted three of four builder receipts. That run is in
[`references/answer-keys/worked-example.md`](./skills/cs329a-self-improving-agents/references/answer-keys/worked-example.md),
misses included. Then we pointed it, read-only, at a system we do not own -
NousResearch's hermes-agent, 10,666 files - and that run is
[`references/answer-keys/worked-example-2.md`](./skills/cs329a-self-improving-agents/references/answer-keys/worked-example-2.md):
five APPLIES, one DOES NOT APPLY with the searches attached, two NOT DECIDABLE, nothing
acted on by mandate, one bar written late and counted, and ten notes on what the skill
got wrong when handed a stranger's repo. A same-day cross-family adversarial round then
overturned two of that record's first verdicts and corrected five citation sets - the
round and the fold are in the file, original wrong rows quoted, because a disposition
that cannot show its own refutations is asking to be trusted the way it asks you to
trust nothing else.

Install as a Claude Code plugin:

```
claude plugin marketplace add u00dxk2/agent-ops-patterns
claude plugin install agent-ops-skills@agent-ops-patterns
```

or copy the skill folder into any harness that reads the Agent Skills format
(`SKILL.md` + `references/`). Then point your agent at the repo you want judged and say
"run the CS329A disposition." Expect twelve rows (ten ideas, two of them split) and a short
chat summary; the rows are the deliverable. Before publishing, a fresh agent with no memory
of the system - though it had read the then-ungated worked example, which is why that file
is now gated last - ran the skill against the same system and came back with three findings
the first run had missed and ten complaints about the skill; a Codex adversarial pass then
found sixteen more. All folded in, all recorded in the worked example.

The second is [`skills/cog-ops-map/`](./skills/cog-ops-map/SKILL.md), the tool for the
*judgment* half above. It has your agent draw a cognitive operations map of a system. Every
recurring judgment becomes a seat: the question it answers, who holds it (a model, code or a
person), how it has failed, and what checks it. Seats are sorted rule vs ruling and human vs
machine. The map is built for a teammate without repo access: an authenticated page, a
self-contained HTML file, or a Markdown fallback, showing the prompt template or assembly source
for every seat that calls a model and the working context of seats held by an agent. The mapping
also writes a gap report. Dated notes in the skill mark the incident that motivated a rule. Say "build a cognitive operations map of <system>" once the plugin is installed. For finished ones, see the twelve maps at the top of this page and in the [gallery](./gallery/README.md).

The third is [`skills/cog-ops-design/`](./skills/cog-ops-design/SKILL.md), the same card filled in before the code exists. It adds what a design needs and a map does not: a control that could kill the seat, a record of its verdicts beside the outcome, and a bar written before the first number is read. Say "design this system" with your idea in your own words. It has been run once, by hand, and has no public worked example yet.

## Quickstart

The block imports `./lib/` by relative path, so run it from a clone
(`git clone https://github.com/u00dxk2/agent-ops-patterns && cd agent-ops-patterns`),
or vendor the two `lib/` files next to wherever you save it.

```js
// Redact at the display boundary of anything that recalls stored text.
// The whole block runs as written from the clone root: save it as a .mjs file
// there, point MEMORY_DIR at your own memory directory, and run it with node.
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

// A missing MEMORY_DIR is "nothing was read", not a crash: it falls through to
// the NOTHING SWEPT branch below. Regular .md files only, case-insensitively.
// readdirSync returns directories too, and readFileSync on a directory throws —
// which is how a lint run turns into a crash on someone else's machine. Match
// the extension without regard to case, or a README.MD drops out of the
// inventory before the coverage count ever sees it, and your "reached" number
// quietly under-reports.
const isDir = fs.statSync(MEMORY_DIR, { throwIfNoEntry: false })?.isDirectory() ?? false;
const files = !isDir ? [] : fs
  .readdirSync(MEMORY_DIR, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".md"))
  .map((e) => ({
    name: e.name,
    content: fs.readFileSync(path.join(MEMORY_DIR, e.name), "utf8"),
  }));

const indexText = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : "";

const input = {
  indexText,
  files,
  // The cap is 24,400 LF-normalized UTF-8 bytes. Measure the text you read, not
  // `statSync().size`: on a CRLF working tree the file is +1 byte per line, and
  // a valid index goes over the line for its line endings alone.
  indexByteLength: Buffer.byteLength(indexText.replace(/\r\n/g, "\n"), "utf8"),
  // Opt-in, and it must be synchronous (a Promise is never `false`, and the lib
  // throws rather than let the check go silently inert). Return `false` only
  // when you can PROVE the file is absent — here, "not in this repo"; if your
  // tools live elsewhere too, widen the search or return null.
  toolResolver: (token) => fs.existsSync(path.resolve(token)),
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

Every library, skill and written protocol here says what it does not do, and most of the libraries pin those limits in tests. They're collected in [LIMITS.md](./LIMITS.md). Read the section for anything you plan to adopt.

## Evidence and lineage

These shipped inside a production system, not as a framework exercise: the silent-merge check found a live instance in our own memory index the day it was written; the redaction lib guards our cross-session search path.

Pattern lineage is credited in each file. The output-boundary scrub reimplements an index-boundary pattern from [CorvinOS](https://github.com/CorvinLabs/CorvinOS); the link graph and suggest-only repair adapt [gbrain](https://github.com/garrytan/gbrain)'s self-wiring graph and dream-cycle repair to zero-LLM pattern-matching. The August 2026 additions are one-way ports with upstreams credited in each header: `scannable-command` and `shadow-screen` port the command-normalization and screen-state vocabulary from [yc-software/qm](https://github.com/yc-software/qm) (whose contribution-as-intent governance [CONTRIBUTING.md](./CONTRIBUTING.md) also adopts); `rrf-fuse` was prompted by [TencentCloud/TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)'s hybrid retrieval, with the fusion itself per Cormack, Clarke & Buettcher (SIGIR 2009); `memory-usage-ledger` is the convergent core of [PEEK](https://arxiv.org/abs/2605.19932)'s usage-scored evictor and qm's memory-strategy bench — two systems independently arriving at score-memory-by-use is why we trust the shape. The fail-soft discipline is independently corroborated by two public sources we did not author: Katherine Cass's [*Field Notes From an Eng Manager Building Her First Autonomous Agent System*](https://k4therin2.github.io/agent-system-v1-retrospective.html) — the retrospective on her 11-agent system, quoted in [`patterns/fail-soft-detectors.md`](./patterns/fail-soft-detectors.md) — and Dan Lorenc's [multiclaude](https://dlorenc.medium.com/a-gentle-introduction-to-multiclaude-36491514ba89) daemon design.

## Posture

Reference patterns with runnable implementations — **not a supported framework**. Issues are welcome; response is not guaranteed. Feature proposals travel as human-written intent documents, not code — see [CONTRIBUTING.md](./CONTRIBUTING.md). If you adopt something and it catches a failure for you, an issue saying so is the most useful contribution.

MIT © David Kooi
