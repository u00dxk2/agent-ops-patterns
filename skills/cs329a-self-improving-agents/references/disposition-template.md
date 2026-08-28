# Disposition record - template

Write this file into the repo you were pointed at, at a path the operator will find again (`docs/dispositions/<YYYY-MM-DD>-cs329a.md` unless the repo has a convention). It is the whole output of the skill. Everything else you say in chat is a summary of this file.

Copy the skeleton below. Keep the headings; fill every row; do not delete a row because it seemed not to apply - "does not apply" is itself a verdict that needs evidence.

---

```markdown
# CS329A disposition - <repo name> - <YYYY-MM-DD>

**Run by:** <agent + model> · **Operator:** <who asked> · **Time spent:** <approx>

**Mandate for this run:** <read-only | record-only | small reversible changes allowed | full ships allowed - the operator's words, quoted>

**Prior records found in this repo:** <path(s) of any earlier disposition or research read of this course, or "none"> - treated as evidence to re-verify, not as verdicts to inherit.

**Sources actually opened this run** (not "available" - opened):
- `references/ideas.md` - yes (required)
- `references/papers.md` → <which papers you fetched, by name, or "none">
- `references/lectures.md` → <which lecture videos/transcripts, or "none">
- `references/worked-example.md` → <"after the table was filled" | "not opened">

**Surfaces inventoried in this repo** (the grep/read you did before any verdict; paths, not descriptions):
- LLM-as-judge / verifier / grader call sites, and whether the grading model is the producing model: <paths or "none found - searched for: <terms>">
- Eval sets, fixtures, golden corpora, and whether any part is held out from what iterates against it: <paths or none>
- Health checks / gates / CI checks that produce a pass-fail, and where their verdicts are recorded: <paths or none>
- Research or reference ingestion (deep-research reports, papers, docs the agent cites): <paths or none>
- Multi-step agent dispatch (anything that runs unattended > ~15 min): <paths or none>

**Bars pre-committed before any deciding number was read** (bars cover numbers a verdict turns on - a backtest, a precision, a spread - not inventory counts; write "none needed" if no verdict turns on a computed number; if a bar was written after its number, say so here AND in the row):
- <idea #> : <the threshold, in one sentence, and what happens on each side of it>

## Verdicts

| # | Idea (from ideas.md) | Verdict | Evidence (quoted `file:line`, or the command + its output line) | Action taken / smallest next step / declined because / what would make it decidable |
|---|---|---|---|---|
| 1 | Coverage vs. selection | APPLIES / DOES NOT APPLY / ALREADY IN PLACE / NOT DECIDABLE | … | … |
| 2 | Filter verifiers before ensembling | | | |
| 3 | Meta-verification | | | |
| 4 | Signal needs spread | | | |
| 5a | Judge the plan before execution | | | |
| 5b | Hold out a private test set | | | |
| 6 | Reliability horizon | | | |
| 7 | Deep research has a low ceiling | | | |
| 8 | Diversity is the bottleneck | | | |
| 9a | Fuse the top-k instead of picking one | | | |
| 9b | Process reward catches right-answer-wrong-process | | | |
| 10 | Route by difficulty; small models carry the bulk | | | |

## Summary

Verdicts (must sum to 12):
- **APPLIES:** <N> - <one line each: the gap, and the smallest next step>
- **DOES NOT APPLY:** <M> - <one line each: what was searched>
- **ALREADY IN PLACE:** <J> - <one line each, with the path that proves it>
- **NOT DECIDABLE:** <K> - <one line each: what record would decide it, and whether you started it>

Actions (independent of verdicts; may be 0 under a read-only mandate):
- **Acted on:** <count> - <what shipped, with the commit or file; "0 - mandate was record-only" is a complete line>

- **Highest-leverage take, if only one thing gets done:** <one line>
- **What this run did NOT check:** <the surfaces you did not reach, the ideas you judged from a single read, anything you took on the operator's or a prior record's word, whether any paper was opened>
- **Refuted by:** <nobody yet - this record has not been adversarially read; do that before acting on it>
```

---

## Verdict vocabulary

- **APPLIES** - the idea names a gap in this repo, you can point at the code that has the gap, and you either did something about it or wrote down the smallest thing that would.
- **DOES NOT APPLY** - the repo has no surface the idea is about, and you name what you searched for and where. A repo with no LLM judges gets DOES NOT APPLY on idea 2 with the grep that proved it - not a blank. The evidence for this verdict is a command and its (empty) output, not a file path.
- **ALREADY IN PLACE** - the repo does this, and you quote the path that proves it. The same bar as APPLIES: a claim, with evidence. It proves a code path exists, not that it runs - say so if you could not check the deployment.
- **NOT DECIDABLE** - the idea turns on a number the repo cannot produce yet (no labels, no history, no record, or a record that is too small or too slow to reach the bar). Say what record would decide it and how long, at the current rate, it would take to become decidable. Starting that record is usually the highest-leverage action in the whole run.

Verdict and action are separate. APPLIES with "Acted on: 0" under a record-only mandate is a complete, honest pair.

## Rules the record must satisfy

1. **No verdict without a quoted path or a command output.** "N/A" with no evidence is the failure mode this whole skill exists to name: a check that never ran, reading as a pass.
2. **"Declined, because X" is a complete answer.** The operator did not ask you to adopt anything. They asked you to decide, with reasons they can check.
3. **Bars before deciding numbers.** If a verdict depends on a computed count, backtest, or precision, the threshold is written in "Bars pre-committed" before that number is read. Inventory counts are exempt. A bar written after its number is disclosed in the row, not hidden - the record should make it visible, and a run that discloses it is more trustworthy than one that does not.
4. **A number you quote outward comes from the paper, not the lecture.** Inside the record, lecture figures are fine when labelled as the lecturer's. Outside it, `papers.md` is where to check.
5. **Name what you did not check, and who has not refuted you.** Every run has a boundary. A run that claims to have checked everything is less trustworthy than one that says where it stopped.
