# Gallery: cognitive operations maps of open-source agent systems

Each map takes one open-source agent system and lists the recurring judgments it found there, each as a *seat*: the question the judgment answers and who holds it (code, a model, or a person). Seats are sorted rule vs ruling and human vs machine. The OpenHands map also records how each seat has failed and what checks it where the mapping found them, identifies the prompt pieces and assembly paths found in the mapped source for the seats a model holds, quotes prompt source text on 14 of its cards (each quote linked to the lines it came from), and has a report of the gaps the mapping exposed. The Cline map is a shorter edition: each card shows its question, how it is answered and where in the code it is held, and it has no gap report.

The method is ["Cognitive Operations Maps"](https://uncagedminds.substack.com/p/cognitive-operations-maps). The skill that builds one for your own system is [`skills/cog-ops-map/`](../skills/cog-ops-map/SKILL.md).

| Map | System | Seats | Checked against |
|---|---|---|---|
| [OpenHands](https://u00dxk2.github.io/agent-ops-patterns/gallery/openhands/) | [`OpenHands/software-agent-sdk`](https://github.com/OpenHands/software-agent-sdk), the agent loop of the OpenHands coding agent | 171 (95 rule, 76 ruling; 4 held by a person); 56 gaps found in this edition (12 flagged as stated design) plus 14 carried from the [first edition](https://u00dxk2.github.io/agent-ops-patterns/gallery/openhands/edition-1/) | commit `aae9c437`, 2026-10-06 |
| [Cline](https://u00dxk2.github.io/agent-ops-patterns/gallery/cline/) | [`cline/cline`](https://github.com/cline/cline), the Cline agent: its SDK, CLI, hub and VS Code extension | 114 (52 rule, 62 ruling; 12 held by a person); no gap report | commit `d19f176b`, 2026-11-02 |
| [opencode](https://u00dxk2.github.io/agent-ops-patterns/gallery/opencode/) | [`anomalyco/opencode`](https://github.com/anomalyco/opencode), the opencode coding agent: its core, CLI, server and terminal interface | 123 (65 rule, 58 ruling; 11 held by a person); no gap report | commit `0093fe57`, 2026-10-24 |
| [pi](https://u00dxk2.github.io/agent-ops-patterns/gallery/pi/) | [`earendil-works/pi`](https://github.com/earendil-works/pi), the pi coding agent: its command-line agent, agent loop, model layer, code mode and MCP client | 111 shown (45 rule, 66 ruling; 9 held by a person); 1 decision left out of this edition; no gap report | commit `1ce44bed`, 2026-10-28 |
| [agno](https://u00dxk2.github.io/agent-ops-patterns/gallery/agno/) | [`agno-agi/agno`](https://github.com/agno-agi/agno), the agno framework's Agent: its run loop, tools, model layer, hooks and guardrails, memory, knowledge and learning, plus teams and workflows | 115 shown (33 rule, 82 ruling; 4 held by a person); 3 decisions left out of this edition; no gap report | commit `9153aacd`, 2026-10-29 |
| [AnythingLLM](https://u00dxk2.github.io/agent-ops-patterns/gallery/anythingllm/) | [`Mintplex-Labs/anything-llm`](https://github.com/Mintplex-Labs/anything-llm), the AnythingLLM server's agent and chat decisions: its agent loop and tools, chat and agent endpoints, retrieval and memory, agent flows, MCP bridge, scheduled jobs, Telegram bot and model providers | 110 shown (57 rule, 53 ruling; 14 held by a person); 7 decisions left out of this edition; no gap report | commit `d7d68e75`, 2026-10-15 |
| [browser-use](https://u00dxk2.github.io/agent-ops-patterns/gallery/browser-use/) | [`browser-use/browser-use`](https://github.com/browser-use/browser-use), browser-use's Agent at its defaults: its step loop, what the model sees, the actions it can take, the browser session's watchdogs, limits and the final judgment | 85 shown (24 rule, 61 ruling; 1 held by a person); 5 decisions left out of this edition; no gap report | commit `b49a68e4`, 2026-10-29 |
| [OpenAI Codex](https://u00dxk2.github.io/agent-ops-patterns/gallery/codex/) | [`openai/codex`](https://github.com/openai/codex), the Rust agent in `codex-rs/`: intake and routing, what the model sees, its next move, approvals, execution, limits and memory, judging results, delegation and feedback | 157 shown (73 rule, 84 ruling; 10 held by a person); 8 decisions left out of this edition; no gap report | commit `a5c40924`, 2026-11-02 |
| [goose](https://u00dxk2.github.io/agent-ops-patterns/gallery/goose/) | [`aaif-goose/goose`](https://github.com/aaif-goose/goose), the goose agent: its core crates, CLI, built-in extensions and desktop app | 85 shown (42 rule, 43 ruling; 6 held by a person); 17 decisions left out of this edition; no gap report | commit `cfb67d72`, 2026-11-02 |
| [DeerFlow](https://u00dxk2.github.io/agent-ops-patterns/gallery/deer-flow/) | [`bytedance/deer-flow`](https://github.com/bytedance/deer-flow), the DeerFlow agent harness: its Python harness package and the gateway, channel and scheduler code that answers the harness's requests | 114 shown (60 rule, 54 ruling; 4 held by a person); 19 decisions left out of this edition; no gap report | commit `14abd9a2`, 2026-11-02 |

## How to read one

Each map is one self-contained HTML file with no external requests. The links in the table open it in your browser; the files are also in this folder (for example [`openhands/index.html`](./openhands/index.html)) if you would rather download one. The OpenHands map has a "Download .md" button that exports its seat cards and gap report as Markdown, if you'd rather hand it to your own assistant.

## What a map is, and is not

- **Not exhaustive.** Each map names the parts of the system it covered and how its seats were found; a judgment outside those, or in a helper nobody opened, is not on it.
- **A snapshot.** It describes the code at the commit it names. The project keeps moving, so a cited line number can stop pointing at what it describes; each map says which parts were checked at which commit.
- **A reading, mostly.** Each gap says whether it was reproduced with a test or read from the source. Most are readings of code paths, not observed failures.
- **Not a security audit, and not a verdict on the project.** The maps describe behaviour. Where a project's own docstring states a choice, the map quotes or cites it.
- **Shared with the project first.** Where a map publishes a finding that was reproduced, it was reported to the project in public before or alongside the map, and the map names the report by issue number.

Corrections are welcome through the [correction form](https://github.com/u00dxk2/agent-ops-patterns/issues/new?template=map-correction.yml). A wrong sentence about someone else's code is the worst bug a map can have.

Quotations from code in each map belong to the mapped project and keep its licence, which each map names.
