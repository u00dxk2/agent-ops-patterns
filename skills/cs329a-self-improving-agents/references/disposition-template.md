# Disposition record - template

Write this file into the repo you were pointed at, at a path the operator will find again (`docs/dispositions/<YYYY-MM-DD>-cs329a.md` unless the repo has a convention). It is the whole output of the skill. Everything else you say in chat is a summary of this file.

Copy the skeleton below. Keep the headings; fill every row; do not delete a row because it seemed not to apply - "does not apply" is itself a verdict that needs evidence.

---

```markdown
# CS329A disposition - <repo name> - <YYYY-MM-DD>

**Run by:** <agent + model> · **Operator:** <who asked> · **Time spent:** <approx>

**Sources actually opened this run** (not "available" - opened):
- `references/ideas.md` - yes (required)
- `references/papers.md` → <which papers you fetched, by name, or "none">
- `references/lectures.md` → <which lecture videos/transcripts, or "none">

**Surfaces inventoried in this repo** (the grep/read you did before any verdict; paths, not descriptions):
- LLM-as-judge / verifier / grader call sites: <paths or "none found - searched for: <terms>">
- Eval sets, fixtures, golden corpora: <paths or none>
- Health checks / gates / CI checks that produce a pass-fail: <paths or none>
- Research or reference ingestion (deep-research reports, papers, docs the agent cites): <paths or none>
- Multi-step agent dispatch (anything that runs unattended > ~15 min): <paths or none>

**Bars pre-committed before any number was read** (write these BEFORE running a backtest or count; leave the section with "none needed" if no idea turns on a number):
- <idea #> : <the threshold, in one sentence, and what happens on each side of it>

## Verdicts

| # | Idea (from ideas.md) | Verdict | Evidence (quoted `file:line` or the command + its output line) | Action taken / declined because / what would make it decidable |
|---|---|---|---|---|
| 1 | Coverage vs. selection | APPLIES / DOES NOT APPLY / ALREADY IN PLACE / NOT DECIDABLE | … | … |
| 2 | Filter verifiers before ensembling | | | |
| 3 | Meta-verification | | | |
| 4 | Signal needs spread | | | |
| 5 | Judge the plan, not just the result | | | |
| 6 | Reliability horizon | | | |
| 7 | Deep research has a low ceiling | | | |
| 8 | Diversity is the bottleneck | | | |
| 9 | Fusion beats picking; process beats outcome on false positives | | | |
| 10 | Route by difficulty; small models carry the bulk | | | |

## Summary

- **Took:** <N> - <one line each, with the commit or file if something shipped>
- **Declined:** <M> - <one line each: "because <reason>">
- **Not decidable:** <K> - <one line each: what measurement or record would decide it, and whether you started collecting it>
- **Already in place:** <J> - <one line each, with the path that proves it>
- **Highest-leverage take, if only one thing gets done:** <one line>
- **What this run did NOT check:** <the surfaces you did not reach, the ideas you judged from a single read, anything you took on the operator's word>
```

---

## Verdict vocabulary

- **APPLIES** - the idea names a gap in this repo, you can point at the code that has the gap, and you either did something about it or wrote down the smallest thing that would.
- **DOES NOT APPLY** - the repo has no surface the idea is about, and you name what you searched for and where. A repo with no LLM judges gets DOES NOT APPLY on idea 2 with the grep that proved it - not a blank.
- **ALREADY IN PLACE** - the repo does this, and you quote the path that proves it. The same bar as APPLIES: a claim, with evidence.
- **NOT DECIDABLE** - the idea turns on a number the repo cannot produce yet (no labels, no history, no record). Say what record would decide it. Starting that record is usually the highest-leverage action in the whole run, and it is a legitimate "took."

## Rules the record must satisfy

1. **No verdict without a quoted path or a command output.** "N/A" with no evidence is the failure mode this whole skill exists to name: a check that never ran, reading as a pass.
2. **"Declined, because X" is a complete answer.** The operator did not ask you to adopt anything. They asked you to decide, with reasons they can check.
3. **Bars before numbers.** If a verdict depends on a count or a backtest, the threshold is written in the "Bars pre-committed" section before the count is read. A bar chosen after the number is a rationalization; the record should make that visible.
4. **A number you quote outward comes from the paper, not the lecture.** The lecture figures in `ideas.md` are how the lecturer said it; `papers.md` is where to check before it goes in a client note or a public doc.
5. **Name what you did not check.** Every run has a boundary. A run that claims to have checked everything is less trustworthy than one that says where it stopped.
