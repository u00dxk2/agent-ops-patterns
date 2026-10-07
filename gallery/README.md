# Gallery: cognitive operations maps of open-source agent systems

Each map takes one open-source agent system and lists the recurring judgments it found there, each as a *seat*: the question the judgment answers, who holds it (code, a model, or a person), how it has failed, and what checks it. Seats are sorted rule vs ruling and human vs machine. Every seat a model holds shows its prompt templates, or the code that assembles them, sliced from the project's source. Each map ends with a ranked report of the gaps the mapping exposed.

The method is ["Cognitive Operations Maps"](https://uncagedminds.substack.com/p/cognitive-operations-maps). The skill that builds one for your own system is [`skills/cog-ops-map/`](../skills/cog-ops-map/SKILL.md).

| Map | System | Seats | Checked against |
|---|---|---|---|
| [OpenHands](https://u00dxk2.github.io/agent-ops-patterns/gallery/openhands/) | [`OpenHands/software-agent-sdk`](https://github.com/OpenHands/software-agent-sdk), the agent loop of the OpenHands coding agent | 45 (31 rule, 12 ruling, 2 human); 14 ranked findings, 1 withdrawn | commit `aae9c437`, 2026-10-06 |

## How to read one

Each map is one self-contained HTML file with no external requests. The links in the table open it in your browser; the files are also in this folder (for example [`openhands/index.html`](./openhands/index.html)) if you would rather download one. A "Download .md" button on the page exports the seat cards, the gap report, the census and the prompt and code excerpts as Markdown, if you'd rather hand it to your own assistant.

## What a map is, and is not

- **Not exhaustive.** Each map names the folders it covered and how its seats were found; a judgment outside those, or in a helper nobody opened, is not on it.
- **A snapshot.** It describes the code at the commit it names. The project keeps moving, so a cited line number can stop pointing at what it describes; each map says which parts were checked at which commit.
- **A reading, mostly.** Each gap says whether it was reproduced with a test or read from the source. Most are readings of code paths, not observed failures.
- **Not a security audit, and not a verdict on the project.** The maps describe behaviour. Where a project's own docstring states a choice, the map quotes or cites it.
- **Shared with the project first.** Findings that were reproduced are reported to the project in public before or alongside the map, and the map names those reports by issue number.

Corrections are welcome as an [issue](https://github.com/u00dxk2/agent-ops-patterns/issues). A wrong sentence about someone else's code is the worst bug a map can have.

The prompt and code excerpts in each map belong to the mapped project and keep its licence, which each map names.
