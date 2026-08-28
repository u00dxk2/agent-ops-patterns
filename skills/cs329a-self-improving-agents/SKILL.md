---
name: cs329a-self-improving-agents
description: Read Stanford CS329A "Self-Improving AI Agents" (verifiers, test-time compute, planning, RL, deep-research agents, agentic evals) against THIS repo and write a disposition record - for each of ten ideas, APPLIES / DOES NOT APPLY / ALREADY IN PLACE / NOT DECIDABLE with a quoted file path per verdict, bars pre-committed before any number is read, and "declined, because" as a complete answer. Use when an operator points the agent at the course, or asks what a system that runs LLM judges, eval gates, health checks, or research ingestion should take from it. Offers, never assigns.
---

# CS329A → your system: decide, with evidence

You have been pointed at a nine-lecture course and a repo. Your job is not to adopt the course. It is to decide, idea by idea, whether each one names a gap in *this* system - and to leave a record someone else can check. The record is the deliverable. Everything else is a summary of it.

The operator does not know your codebase the way you do, and the person who wrote this skill knows it less. Every line in `references/ideas.md` is a hypothesis about your system, not a finding. "Declined, because X" is a complete answer. So is "already in place, here is the path."

## Procedure

**1. Load the ideas.** Read `references/ideas.md` in full. Ten ideas, one paragraph each, with the lecture and paper behind every number. Do not skim: the verdicts you write are indexed by these numbers.

**2. Inventory before you judge.** Before any verdict, find the surfaces the ideas are about, and write down the paths (or the search that found nothing):
- every place a model grades, ranks, verifies, or scores something (LLM-as-judge, reward model, evaluator, "critic");
- every eval set, fixture set, golden corpus, or benchmark the repo runs against;
- every health check, gate, or CI check that produces a pass/fail on a schedule;
- every place external research or reference material is ingested and later cited;
- every multi-step agent dispatch that runs unattended for more than ~15 minutes.

A repo with none of a category gets DOES NOT APPLY on the matching ideas, with the grep that proved it. That is a real verdict.

**3. Pre-commit the bars.** Some verdicts turn on a number - a backtest, a count, a precision. For each, write the threshold and what happens on either side of it *before* you compute the number. Put it in the "Bars pre-committed" section of the record. If you compute first and decide after, say so in the record; the reader will weigh it accordingly.

**4. Judge each idea.** Open `references/disposition-template.md` and fill the table. Four verdicts, each with a quoted `file:line` or a command and its output line:
- **APPLIES** - a gap you can point at, and either what you did or the smallest thing that would close it.
- **DOES NOT APPLY** - no such surface; name what you searched for.
- **ALREADY IN PLACE** - the repo does this; quote the path. Same evidence bar as APPLIES.
- **NOT DECIDABLE** - the idea turns on a record the repo cannot produce yet. Name the record. Starting it is usually the highest-leverage action in the run.

Expect NOT DECIDABLE on the idea you find most exciting. In our own run the judge-filtering idea came back 0 of 39 joinable and the most valuable ship was a log file (`references/worked-example.md`).

**5. Act only where the record says to, and only inside the operator's mandate.** Reversible, small, in-scope changes (a persisted log, a schema field, a review doc) you may make and commit if the operator's normal rules allow it. Anything that changes a judge's verdict, enforces a gate, or spends money is written up as the smallest next step, not done. Do not build any of the things in "What the course argues against" below.

**6. Check the primary source for anything you quote outward.** Lecture figures in `ideas.md` are how the lecturer said it. Any number that leaves the repo - a client note, a public doc, a commit message people will cite - comes from the paper in `references/papers.md`, opened and read, not from the lecture summary.

**7. Write the record and report.** The record goes in the repo (`docs/dispositions/<YYYY-MM-DD>-cs329a.md` unless the repo has its own place). Your chat reply is: took N / declined M / not decidable K / already in place J, the single highest-leverage take, and what this run did not check.

## What the course argues against

The course is as useful for what it says not to build:
- **Judge stacks on unverifiable outputs.** Multi-judge ensembles on copy, creative text, or anything without a deterministic verifier plateau below majority vote until each judge is filtered against labels (part 3). Do not add lenses to an ensemble that has no labeled set.
- **Rebuilding an ensemble on a non-decidable N.** If the backtest cannot reach the pre-committed bar, the ship is the record that would make it decidable, not a lib change.
- **Enforcing a new gate on day one.** A gate that is red on 0% or 100% of subjects carries no signal (part 6); a gate needs history before it can be trusted, and it needs a way to be seen red.
- **Prompt rules as fixes for capability gaps.** RL on verifiable rewards made models more consistent, not more capable (part 6: majority@K rose, pass@K did not). A prompt exhortation is the same move by hand. A capability gap needs a tool, a verifier, or a refusal in code.
- **Tree search over irreversible actions.** LATS (part 5) does not handle actions that cannot be undone. Anything that spends, deletes, or sends stays behind a human gate regardless of how good the planner is.

## What is in `references/`

| File | When to open it |
|---|---|
| `ideas.md` | Always, first. The ten ideas with lecture + paper behind each number. |
| `disposition-template.md` | Step 4. The record skeleton, the verdict vocabulary, the five rules the record must satisfy. |
| `papers.md` | Step 6, and any time a verdict rests on a number. Every paper the course teaches, with the URL that was checked when this file was written. |
| `lectures.md` | When you want the lecturer's framing on one point. The nine video links and a per-part summary in our words. No transcripts (they are Stanford's). |
| `worked-example.md` | Before you write the summary. What the run looked like on the system this skill was written for, including the three receipts the verifiers refuted. |

## Where this skill stops working

- It reads a repo; it cannot read a deployment. "ALREADY IN PLACE" proves a code path exists, not that it runs on a schedule over the subjects you think it covers. Pair with a check-that-can-go-red discipline (`patterns/checks-that-cant-fail.md` in this repo) for the operational half.
- The ideas are the course as taught in fall 2025 and read in August 2026. The papers are stable; the field is not. An idea that reads as settled here may have been superseded by the time you run this.
- It is written for systems that run LLM judges, eval gates, health checks, or research ingestion. A repo with none of those will produce ten DOES NOT APPLY rows with greps attached - a correct and short run, not a failure.
- The person who wrote it ran it on their own system once, with sub-agents, and the verifiers found defects in three of four shipped receipts. Assume yours will too. Have someone refute your record before you act on it.
