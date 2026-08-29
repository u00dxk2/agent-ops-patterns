# Disposition record - template

Under a **record-only** or wider mandate, write this file into the repo you were pointed at, at a path the operator will find again (`docs/dispositions/<YYYY-MM-DD>-cs329a.md` unless the repo has a convention). Under a **read-only** mandate, deliver the same content in your reply or wherever the operator named outside the repo; write nothing into it. Either way it is the whole output of the skill. Everything else you say in chat is a summary of it.

Copy the skeleton below. Keep the headings; fill every row; do not delete a row because it seemed not to apply - "does not apply" is itself a verdict that needs evidence.

---

```markdown
# CS329A disposition - <repo name> - <YYYY-MM-DD>

**Run by:** <agent + model> · **Operator:** <who asked> · **Time spent:** <approx>

**Mandate for this run:** <read-only | record-only | small reversible changes | full ships> - operator's words: "<quoted>"

**Prior records found in this repo:** <path(s) of any earlier disposition or research read of this course, or "none"> - treated as evidence to re-verify, not as verdicts to inherit.

**Sources actually opened this run** (not "available" - opened):
- `references/ideas.md` - yes (required)
- `references/papers.md` → <which papers you fetched, by name, or "none">
- `references/lectures.md` → <which lecture videos/transcripts, or "none">
- `references/worked-example.md` → <"after the table was filled" | "not opened" | "before the run - say so">
- `references/worked-example-2.md` → <same three answers>

**Surfaces inventoried in this repo** (the grep/read you did before any verdict; paths, not descriptions; a negative search is recorded as: directory it ran from · exact command · exit code · the "0 matches" line):
- LLM-as-judge / verifier / grader call sites, and whether the grading model is the producing model: <paths, or the negative search>
- Candidate generation with selection (best-of-N, retries, sampling, fusion), and what selects: <…>
- Eval sets, fixtures, golden corpora, and whether any part is held out from what iterates against it: <…>
- Health checks / gates / CI checks that produce a pass-fail, and where their verdicts are recorded: <…>
- Pre-execution review points (plan, PR description, query) vs post-result review: <…>
- Research or reference ingestion (deep-research reports, papers, docs the agent cites): <…>
- Multi-step agent dispatch (anything that runs unattended > ~15 min): <…>
- Model choice per call site (routed or default): <…>
- Surfaces I could not reach: <what, and what I tried - or "none">

**Bars pre-committed before any deciding number was read** (bars cover numbers a verdict turns on - a backtest, a precision, a spread, or an inventory count the verdict itself depends on, such as "is the label set big enough" - write those before counting; plain inventory counts are exempt; write "none needed" if no verdict turns on a computed number):
- <idea #> : <the threshold, in one sentence, and what happens on each side of it>

## Verdicts

| # | Idea (from ideas.md) | Verdict | Evidence (quoted `file:line`, or the negative search in full) | Action taken / smallest next step / declined because / what would make it decidable |
|---|---|---|---|---|
| 1 | Coverage vs. selection | APPLIES / DOES NOT APPLY / ALREADY IN PLACE (code\|running) / NOT DECIDABLE / UNREADABLE | … | … |
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
- **DOES NOT APPLY:** <M> - <one line each: the negative search>
- **ALREADY IN PLACE (code):** <J1> - <one line each, with the path that proves the code path>
- **ALREADY IN PLACE (running):** <J2> - <one line each, with the log / run / schedule that proves it executes>
- **NOT DECIDABLE:** <K> - <one line each: what record would decide it, how long at the current rate, and whether you started it>
- **UNREADABLE:** <U> - <one line each: what you could not reach and what you tried>

Actions (independent of verdicts; may be 0 under read-only or record-only):
- **Acted on:** <count> - <what shipped, with the commit or file; "0 - mandate was record-only" is a complete line; writing this record does not count>

Integrity:
- **Bars written after their number:** <count> - <which rows; 0 is the goal, a nonzero count disclosed here beats one hidden in a row>
- **Highest-leverage take, if only one thing gets done:** <one line>
- **What this run did NOT check:** <the surfaces you did not reach, the ideas you judged from a single read, anything you took on the operator's or a prior record's word, whether any paper was opened>
- **Refuted by:** <nobody yet - this record has not been adversarially read; do that before acting on it>
```

---

## Verdict vocabulary

- **APPLIES** - the idea names a gap in this repo, you can point at the code that has the gap, and you either did something about it or wrote down the smallest thing that would.
- **DOES NOT APPLY** - the repo has no surface the idea is about, and you record the negative search in full: the directory, the exact command, its exit code, the "0 matches" line. A repo with no LLM judges gets DOES NOT APPLY on idea 2 with that search attached - not a blank, and not an empty output with nothing around it.
- **ALREADY IN PLACE (code)** - the repo has the code path, and you quote it. Same evidence bar as APPLIES. It says nothing about whether the path runs.
- **ALREADY IN PLACE (running)** - the code path exists *and* you have evidence it executes over the subjects it claims: a log with recent rows, a CI run, a cron entry, a receipt. Most runs will earn few of these; say so rather than upgrade.
- **NOT DECIDABLE** - the verdict on the idea depends on a measurement the repo cannot produce yet (no labels, no history, or a record too small or too slow to reach the bar). Say what record would decide it and how long, at the current rate, it would take. Starting that record is the action. Precedence: if the *only* gap is "no record exists yet," the verdict is NOT DECIDABLE and the missing record is the next step - not APPLIES.
- **UNREADABLE** - a surface exists or might, and you could not reach it: a path you could not read, a deployment you cannot see, a command that errored. Say what you tried. Never rounded to DOES NOT APPLY.

Verdict and action are separate. APPLIES with "Acted on: 0" under a record-only mandate is a complete, honest pair.

## Rules the record must satisfy

1. **No verdict without evidence in the stated form.** A quoted path for the positive verdicts; the full negative search for DOES NOT APPLY; what you tried for UNREADABLE. "N/A" with none of these is the failure mode this whole skill exists to name: a check that never ran, reading as a pass.
2. **"Declined, because X" is a complete answer.** The operator did not ask you to adopt anything. They asked you to decide, with reasons they can check.
3. **Bars before deciding numbers.** If a verdict depends on a computed count, backtest, precision, or on an inventory count the verdict itself turns on, the threshold is written in "Bars pre-committed" before that number is read. A bar written after its number is disclosed in the row *and* counted in the summary's integrity line - visible at the top, not buried.
4. **A number you quote outward comes from the paper, not the lecture.** Inside the record, lecture figures are fine when labelled as the lecturer's. Outside it, `papers.md` is where to check.
5. **Name what you did not check, and who has not refuted you.** Every run has a boundary. A run that claims to have checked everything is less trustworthy than one that says where it stopped.
