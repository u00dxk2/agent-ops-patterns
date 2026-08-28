---
name: cs329a-self-improving-agents
description: Read Stanford CS329A "Self-Improving AI Agents" (verifiers, test-time compute, planning, RL, deep-research agents, agentic evals) against THIS repo and write a disposition record - for each of ten ideas, APPLIES / DOES NOT APPLY / ALREADY IN PLACE / NOT DECIDABLE / UNREADABLE with a quoted file:line or a scoped command with its exit code and output per verdict, bars pre-committed before any deciding number is read, and "declined, because" as a complete answer. Use when an operator points the agent at the course, or asks what a system that runs LLM judges, eval gates, health checks, or research ingestion should take from it. Offers, never assigns.
---

# CS329A → your system: decide, with evidence

You have been pointed at a nine-lecture course and a repo. Your job is not to adopt the course. It is to decide, idea by idea, whether each one names a gap in *this* system - and to leave a record someone else can check. The record is the deliverable. Everything else is a summary of it.

The operator does not know your codebase the way you do, and the person who wrote this skill knows it less. Every line in `references/ideas.md` is a hypothesis about your system, not a finding. "Declined, because X" is a complete answer. So is "already in place, here is the path."

## Procedure

**0. Read the mandate.** Before anything else, write down what the operator authorized, in one of four words, and quote them:
- **read-only** - you write nothing anywhere. The record is delivered in your reply, or to a location the operator names outside the repo.
- **record-only** - you write exactly one file into the repo: the record. Nothing else.
- **small reversible changes** - the record plus changes of the kind step 5 allows.
- **full ships** - the operator's normal rules govern.

Writing the record never counts as "acted on." The mandate goes at the top of the record and every later step is interpreted through it.

**1. Load the ideas.** Read `references/ideas.md` in full. Ten ideas, one paragraph each, with the lecture and paper behind every number. Two of them (5 and 9) have two halves that can earn different verdicts; the template gives each half its own row. Do not skim: the verdicts you write are indexed by these numbers.

**2. Inventory before you judge.** Before any verdict, find the surfaces the ideas are about, and write down the paths (or the search that found nothing). One row per category, every category filled:
- every place a model grades, ranks, verifies, or scores something (LLM-as-judge, reward model, evaluator, "critic") - and, for each, whether the model that produced the work is the model that grades it;
- every place N candidates are generated and fewer are kept (best-of-N, retries, sampling, fusion) - and what does the selecting;
- every eval set, fixture set, golden corpus, or benchmark the repo runs against - and whether any part of it is held out from whatever iterates against it;
- every health check, gate, or CI check that produces a pass/fail on a schedule - and whether its verdicts are recorded anywhere that survives;
- every review point that sits before execution (a plan, a PR description, a query) rather than after a result;
- every place external research or reference material is ingested and later cited;
- every multi-step agent dispatch that runs unattended for more than ~15 minutes;
- how the model for each call site is chosen: a routing decision, or a default.

A search that finds nothing is evidence only in this form: the directory it ran from, the exact command, its exit code, and the "0 matches" line. Empty output with none of those is not evidence - it cannot be told from a wrong directory or a failed search. A surface you could not reach (a submodule you cannot read, a deploy you cannot see, a command that errored) is **UNREADABLE**, and is never rounded to DOES NOT APPLY.

Inventory counts (how many judges, how many gates, how many labelled rows) are read freely during this step - with one exception in step 3.

**If the repo already holds a disposition, a research read of this course, or anything claiming "we already do this": re-verify, never inherit.** A prior record is evidence to check against the code as it is today, held to the same bar as any other claim. Run the inventory anyway. Prior runs on the system this skill was written for missed three things a fresh inventory found.

**3. Pre-commit the bars.** Some verdicts turn on a number the run has to *compute* - a backtest, a precision, a spread over history. For each, write the threshold and what happens on either side of it before you compute the number, in the "Bars pre-committed" section. The exception to step 2's freedom: when a verdict turns on an inventory count itself - "is this label set big enough?", "is this history long enough?" - write the bar *before* you count. If you find you computed first and decided after, say so in the row, and count it in the summary line "Bars written after their number." That line is part of the report; a run with a nonzero count there is weaker, and says so, which is better than a run that hides it.

**4. Judge each idea.** Open `references/disposition-template.md` and fill the table. Five verdicts, each with a quoted `file:line` or the negative-search evidence in the form above:
- **APPLIES** - a gap you can point at, plus either what you did or the smallest thing that would close it.
- **DOES NOT APPLY** - no such surface; the negative search, in full.
- **ALREADY IN PLACE** - the repo does this; quote the path. Tag it **(code)** if you proved a code path exists, **(running)** if you also proved it executes on a schedule over the subjects it claims (a log, a CI run, a cron entry). The two are counted separately.
- **NOT DECIDABLE** - the verdict on the idea depends on a measurement the repo cannot make yet. Name the record that would decide it and how long, at the current rate, it would take. Starting that record is the action, not the verdict: an idea whose *only* gap is "no record exists yet" is NOT DECIDABLE, not APPLIES.
- **UNREADABLE** - the surface exists or might, and you could not reach it. Say what you tried.

Verdict and action are separate axes. An APPLIES row whose mandate forbids changes is complete when the smallest next step is written; that is not a failure of the run.

**5. Act only where the record says to, and only inside the mandate.** Reversible, small, in-scope changes (a persisted log, a schema field, a review doc) you may make and commit if the mandate and the operator's normal rules allow it. Anything that changes a judge's verdict, enforces a gate, or spends money is written up as the smallest next step, not done. Under read-only or record-only, every APPLIES row ends at its next step, and "Acted on: 0" is the honest line. Do not build any of the things in "What the course argues against" below.

**6. Primary sources.** The record itself is an internal artifact: lecture figures from `ideas.md` may appear in it, labelled as the lecturer's. Anything that leaves the repo - a client note, a public doc, a number someone will cite - comes from the paper in `references/papers.md`, opened and read.

**7. Only now open `references/worked-example.md`.** It is the run on the system this skill was written for. It is placed last deliberately: it contains verdicts, and if the repo you were pointed at is that system or one shaped like it, it is an answer key. Read it after your table is filled, to check your *form* against it - evidence per row, bars before numbers, what was not checked - never to check your verdicts.

**8. Write the record and report.** Under record-only or wider, the record goes in the repo (`docs/dispositions/<YYYY-MM-DD>-cs329a.md` unless the repo has its own place); under read-only, it goes in your reply. Your chat reply is: the verdict counts (ALREADY IN PLACE split code/running), the "acted on" count, the "bars written after their number" count, the single highest-leverage take, and what this run did not check. Then say, in one line, that no one has refuted the record yet - and that someone should before it is acted on.

## What the course argues against

The course is as useful for what it says not to build:
- **Judge stacks on unverifiable outputs.** Multi-judge ensembles on copy, creative text, or anything without a deterministic verifier plateau below majority vote until each judge is filtered against labels (part 3). Do not add lenses to an ensemble that has no labeled set.
- **Rebuilding an ensemble on a non-decidable N.** If the backtest cannot reach the pre-committed bar, the ship is the record that would make it decidable, not a lib change.
- **Enforcing a new gate on day one.** A gate that is red on 0% or 100% of subjects carries no signal (part 6); a gate needs history before it can be trusted, and it needs a way to be seen red.
- **Prompt rules as fixes for capability gaps.** RL on verifiable rewards made models more consistent, not more capable (part 6: majority@K rose, pass@K did not). A prompt exhortation is the same move by hand. A capability gap needs a tool, a verifier, or a refusal in code.
- **Tree search over irreversible actions.** LATS (part 5; `papers.md`) does not handle actions that cannot be undone. Anything that spends, deletes, or sends stays behind a human gate regardless of how good the planner is.

## What is in `references/`

| File | When to open it |
|---|---|
| `ideas.md` | Step 1, always. The ten ideas with lecture + paper behind each number. |
| `disposition-template.md` | Step 4. The record skeleton, the verdict vocabulary, the five rules the record must satisfy. |
| `papers.md` | Step 6, and any time a verdict rests on a number you will quote outward. Every paper behind these ten ideas, from the nine-video series, with the URL that was checked when this file was written. |
| `lectures.md` | When you want the lecturer's framing on one point. The nine video links and a per-part summary in our words. No transcripts (they are Stanford's). |
| `worked-example.md` | **Step 7 only, after your table is filled.** Contains verdicts for one real system; read for form, not answers. |

## Where this skill stops working

- It reads a repo; it cannot read a deployment. "ALREADY IN PLACE (code)" proves a code path exists, not that it runs on a schedule over the subjects you think it covers - that is what the (running) tag is for, and most runs will not earn it. Pair with a check-that-can-go-red discipline (`patterns/checks-that-cant-fail.md` in this repo) for the operational half.
- The ideas are the course as taught in fall 2025 and read in August 2026. The papers are stable; the field is not. An idea that reads as settled here may have been superseded by the time you run this.
- It is written for systems that run LLM judges, eval gates, health checks, or research ingestion. A repo with none of those will produce twelve DOES NOT APPLY rows with negative searches attached - a correct and short run, not a failure.
- The record it produces has not been refuted by anyone when the run ends. On the system this was written for, adversarial verifiers found defects in three of four builder receipts, a cold second reader found three gaps the first run missed, and a Codex review of the skill itself found sixteen. Assume yours will too. Have someone refute your record before you act on it.
