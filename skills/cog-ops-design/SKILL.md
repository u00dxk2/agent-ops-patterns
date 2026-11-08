---
name: cog-ops-design
description: Draw the cognitive operations map of a system that does not exist yet, before any code. From an idea in the owner's words, make the author decide every recurring judgment the system will make as a SEAT (the question, who will hold it and why, rule or ruling, what checks it at launch, the control that could kill it, what it does on error, what it costs), read the design against failure classes recorded in this repository, refuse designs those records warn against, and emit a seats file the built system is later mapped against with cog-ops-map. Use when someone says "let's build an agent that ...", "design an agentic system for ...", or asks for a plan, spec or architecture of an LLM pipeline; also when a build brief names model calls, judges, filters or best-of-N selection and no map exists yet.
---

# Cognitive operations design (the forward map)

`cog-ops-map` reads a system that exists and draws who decides what. This skill fills in the same card BEFORE the system exists, so the decisions get made on purpose instead of falling out of whatever gets coded first. The output is the list of judgments the system will make, each with its holder, its validator and the test that could prove it worthless. The built system is later checked against that list.

The vocabulary is `cog-ops-map`'s, used exactly: seat, rule vs ruling, human vs machine with the four reasons (taste, accountability, exception handling, training signal), holder kind (`llm`, `model`, `code`, `human`, `external`). See [`../cog-ops-map/references/framework.md`](../cog-ops-map/references/framework.md) and [`../cog-ops-map/references/shared-schema.md`](../cog-ops-map/references/shared-schema.md). This skill reads files elsewhere in the [agent-ops-patterns](https://github.com/u00dxk2/agent-ops-patterns) repository. If you copied only this folder, read them there.

## Inputs (write them down before the first seat)

1. **The idea in the owner's words, verbatim, with its source.** A paraphrase is a proposal, and is labelled as one ([`claims-are-hypotheses`](../../patterns/claims-are-hypotheses.md), section 3).
2. **The outcome,** in one sentence: what number, read where, says the system works. If no number exists yet, the first seat you design is the one that produces it.
3. **The population:** what goes in, and roughly how many per week.
4. **The irreversible actions:** anything that publishes, sends, spends, deletes or reaches a stranger. Each one gets a human-direct gate or a written reason it does not ([`durability-tiered-write-governance`](../../patterns/durability-tiered-write-governance.md)).
5. **The owner's constraints,** quoted: budget, what must stay human, what must never be done.
6. **What is out of scope,** named, so a later map can say "excluded" instead of "missing".

## Procedure

**1. Walk the pipeline as it will run,** from input to outcome and the loop back. At each point where two competent people could do different things, or where code will decide something a person used to, write a seat. Do not skip ingest filters, dedup, formatting, delivery and the outcome read. Rulings hide as rules there.

**2. Fill every field on every seat, with an explicit "none" or "nothing yet".** The card is adapted from `shared-schema.md` S5. The three fields in bold are ones a design needs and a map does not. Failure history and Gaps wait for the map of the built system:

| Field | What a design must say |
|---|---|
| Question | quotable in a business conversation |
| Quadrant, holder kind | RULE or RULING by the question, not by whether code will hold it (S4) |
| Holder | the model, the code, or the named person; one holder |
| Contract (`llm` and `model` seats) | what the prompt will ask for and what the consumer will accept; for code and human seats, "n/a" |
| Why human or why machine | one of the four reasons for a human; for a machine, what makes it safe to be one |
| Validator at launch | a test, a label source, a human read; or "nothing until N outcomes", stated as a number |
| **Control** | the experiment that would prove this seat adds nothing: a shuffle test, a decoy, a random baseline, a non-obviousness check ([`cog-ops-map`](../cog-ops-map/SKILL.md) Phase 4.5: "A proposed seat without a control is a wish."). A seat with one right answer, such as a lookup, says "none" and is tested instead |
| **Label record** | where this seat's verdicts are written beside the outcome, so a validator can exist later ([`ideas.md`](../cs329a-self-improving-agents/references/ideas.md), ideas 2 and 3) |
| **Bar, pre-committed** | for any seat that filters, ranks or scores: the number it must beat, written before the first number is read ([`cs329a` SKILL.md](../cs329a-self-improving-agents/SKILL.md), step 3) |
| On error | fail-closed, fail-open, fail-soft or raises; the author picks one and writes why |
| Cost per run | a figure, or "unknown, measured in week 1" |
| Failure class | which recorded failure below this seat is built to avoid, or "none" |

**3. Read the seat list against the recorded failure classes.** Before the design is called done, write on each seat which one it answers.

- **A selector or judge on output nobody can verify.** Prompted ranking plateaus, unfiltered judge ensembles did worse than majority vote in the work cited, and critique by the same model is the configuration the course rates weakest ([`ideas.md`](../cs329a-self-improving-agents/references/ideas.md), ideas 1, 2 and 8). Design: run it in shadow first, take labels from outcomes, keep a random baseline, pre-commit a bar, critique with a different model family.
- **A gate enforced on day one.** A gate red on 0% or 100% of subjects carries no signal ([`cs329a` SKILL.md](../cs329a-self-improving-agents/SKILL.md), "What the course argues against"). Design: record `would_block`, `shadow_allow` and `unscreened` from the start ([`shadow-screen-states`](../../patterns/shadow-screen-states.md)).
- **A check never seen red, a zero from a dead instrument, a sweep that reached nothing** ([`checks-that-cant-fail`](../../patterns/checks-that-cant-fail.md)). Design: a positive control inside every validator, and NOTHING SWEPT as its own verdict.
- **A "done" or "good" decided by a string match or a parser default.** The [OpenHands map](https://u00dxk2.github.io/agent-ops-patterns/gallery/openhands/) records a judge that reads `"complete": "false"` as complete. Design: where the contract can be compiled (shape, enum, length, ordering), compile it (`cog-ops-map`, CONTRACT).
- **A budget that warns but does not stop.** The [Hermes card](https://u00dxk2.github.io/agent-ops-patterns/gallery/hermes/card.html) records a run budget that warns near the end and does not itself stop the run. Design: the stop is code, and the warning is extra.
- **A human seat whose verdicts vanish** (`framework.md`, gap class 3). Design: every approval is a row.
- **A premise taken from a list** ([`claims-are-hypotheses`](../../patterns/claims-are-hypotheses.md), section 1). Design: a premise block with the verifying output pasted, per item, for anything legal, financial or about a named person.
- **A seat built and wired to nothing** (`cog-ops-map` Phase 4.5, the disconnection question). Design: every seat names what consumes its answer.

**4. Refuse.** The skill does not finish while any of these stand, and it says which:

- a filtering, ranking or scoring seat with no label record and no pre-committed bar;
- an ensemble of judges with no labelled set;
- a human seat with no stated reason from the four;
- an irreversible action with no human-direct gate and no written reason;
- a validator that is a log, an audit trail or "we will review it";
- a RULING seat with no control;
- a seat whose on-error posture is unstated;
- a design whose outcome metric no seat produces.

**5. Emit.**

- `seats.design.json`: a design variant of the shape in [`seats-json.md`](../cog-ops-map/references/seats-json.md). Each seat adds `"status": "designed"`, `control`, `labelRecord` and `bar`. No code exists yet, so `citationCommit` is null, `holder` names the model, the code or the person from the card, and citation, failure-history and source fields are empty. An `llm` seat's prompt is a draft or "not written yet". The map's checker does not apply to this variant, and the built system's map gets its own seats file.
- A one-page map in Markdown. The build mechanics in `cog-ops-map` Phase 3 are for a finished system and do not apply here.
- "Not decided yet": the questions the owner has to answer, each with a recommendation.
- "What these records gave nothing for": the domain knowledge the design rests on that nothing here supports. This list is honest scope, and it is usually most of the design.
- The first-week measurement plan: which seats run in shadow, which bars, which positive controls, what gets read on day 7.

**6. After the build,** run `cog-ops-map` on the code and compare its seats with `seats.design.json`, by hand. A seat in the build that the design never named is a finding, a designed seat the build dropped is a finding, and a holder that changed kind is a finding.

## Where this skill stops working

- It designs the judgments only. Whether anyone wants the product is outside it, and it knows nothing about your domain. A design can pass every refusal and still be a bad product.
- The failure classes come from a dozen open-source agent systems, one portfolio's incidents and one course. A system of another shape, such as a batch pipeline or a marketplace, will have failures these records never saw.
- The nine fixed stages in `shared-schema.md` S3 fit agent loops. For a pipeline, order the seats by the pipeline and say so. Do not invent seats to fill empty stages.
- It has been run once, by hand, on one private design. That run added two seats and moved one seat's holder from a model to a person, with the model in shadow, so it changed a design on first use. One run says little, and you can't check that one from here. There is no public worked example yet, and nothing automates the comparison in step 6.
