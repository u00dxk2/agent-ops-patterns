# Worked example - the run on our own system

This skill was written after we did the exercise by hand on four operations (a software portfolio run by agents, and three client engagements), then ran the resulting brief on the portfolio itself in a side session with sub-agents. The point of this file is not that it went well. It is that the record shows where it did not, which is what a stranger reading this repo should expect their own run to look like.

The portfolio in question: ~21 small products, each with an agent lane, coordinated over a message bus, watched by a layer of zero-LLM detectors. The relevant surfaces: a shared LLM-judge ensemble library (median / majority plus a veto axis), synthetic-persona friction testing with an evaluator model, a daily rail of ~13 health gates, a research library that ingests external deep-research reports, and a cross-family review loop where a second model family (Codex) reviews the first's work.

## What the hand-written brief said (2026-08-27)

Six items, ranked by expected impact per hour, with a floor written into the brief for the one that turned on a number:

1. Filter the judge ensemble against labels (idea 2). Labels existed: a ledger of persona findings marked "changed an outcome" vs "did not count." Floor, written before any number was read: *a lens must beat the majority of the other lenses on the labeled rows, or it leaves the ensemble.*
2. Make the confirmed/refuted record on the second model's findings tallyable (idea 3).
3. Log every rail gate's verdict per run so "always green / always red" becomes measurable (idea 4).
4. Add a "load-bearing citation verified" field to research ingest (idea 7), and backtest it on the three most recent reports.
5. Route a fusion bake-off (idea 9) to the product lane that owns the surface, rather than building it centrally.
6. Two cost inputs, no build.

## What actually happened (2026-08-28, five builder sub-agents, one adversarial verifier per shipped change)

| Item | Verdict | What the record says |
|---|---|---|
| 1. Judge filtering | **NOT DECIDABLE** | 39 labeled findings; **0 of 39** had a per-lens verdict anywhere. Structural, not a missing write: the persona evaluator was a single judge, and none of the ten ensemble call sites in the fleet judged a persona finding. The library was left unchanged. What shipped was the instrument - a per-lens history file wired into the one surface whose subject already carries an outcome label - and a review doc stating the decidability bar (n ≥ 100 joinable on one subject kind, non-overlapping 95% Wilson brackets; a 10-point lens separation needs n ≈ 313 per arm). |
| 2. Verdict record | **APPLIES - shipped, with a caveat that matters** | 93 rows reconstructed from existing review artifacts; 3 of 14 finding classes decidable at N ≥ 10. The overall figure (76 confirmed / 4 refuted) is **survivorship-biased** - refutations had gone unrecorded - and the record says so in its own header. It becomes real only when verdicts are written at disposition time going forward. |
| 3. Gate spread | **APPLIES - log shipped, check deferred** | The rail runner now appends one line per gate per run. The spread check itself was *not* built: it needs 14 days of rows, and the bar is pre-committed in the ledger (DEAD = red on 0/N or N/N over ≥ 14 days, never merely lopsided). |
| 4. Citation check | **APPLIES - shipped; backtest says the number** | 1 of 3 recent reports had an unverified load-bearing claim (a frame-rate "fusion threshold" with no primary source - and the verifier found it had not stayed narrative: it had shipped as a numeric assertion in a test file). 0 of 3 dispositions would have changed. |
| 5. Fusion bake-off | **routed** | One item queued to the owning lane, with the promote/kill bar written into the item before any run. |
| 6. Cost inputs | **read, no build** | The named offline judges were ~4% of 30-day model spend; batch-API savings on them fell below the pre-committed bar, so nothing moved. The money was elsewhere (generation and offline grading on the largest model), sized for the next pass. |

## What the verifiers found

Four shipped receipts; **three carried a real defect the builder's own green could not see**: a paraphrase presented as a verbatim quote; a "never throws" claim wider than the `try` block that backed it; a provenance sentence reading "transcribed" where a third of the rows had actually been judged from a status string. Each was fixed the same hour. Keep the one-verifier-per-ship shape; a builder grading its own receipt is the single-judge anti-pattern from idea 2, in miniature.

## What we would tell a stranger from this

- Expect NOT DECIDABLE on the idea you were most excited about. The most valuable ship in the run was a log file.
- The floor written the day before is what made "not decidable" sayable. Without it, 0 of 39 would have become a story about why the lenses are probably fine.
- The record that already existed (review docs, receipts) was worth tallying and was also biased in a way only the tally revealed.
- Two of the six items were confirmations with a number attached. That is a good outcome, not a wasted one - it is the difference between "we think we do this" and a path.
- The run touched nothing the course argues against: no judge stacks on unverifiable outputs, no ensemble rebuilt on a non-decidable N, no gate enforced on day one.
