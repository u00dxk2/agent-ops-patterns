# Worked example - the run on our own system

This skill was written after we did the exercise by hand on four operations (a software portfolio run by agents, and three client engagements), then ran the resulting brief on the portfolio itself in a side session with sub-agents. The point of this file is not that it went well. It is that the record shows where it did not, which is what a stranger reading this repo should expect their own run to look like.

The portfolio in question: ~21 small products, each with an agent lane, coordinated over a message bus, watched by a layer of zero-LLM detectors. The relevant surfaces: a shared LLM-judge ensemble library (median / majority plus a veto axis), synthetic-persona friction testing with an evaluator model, a daily rail of health gates (26 in the manifest when the outside-style run below counted them), a research library that ingests external deep-research reports, and a cross-family review loop where a second model family (Codex) reviews the first's work.

**Read this file after your table is filled, not before.** It contains verdicts. If the repo you were pointed at is this one, or shaped like it, this is an answer key, and the first outside-style run of the skill said so.

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

## The outside-style run (2026-08-28, same day, after the skill was written)

Before publishing, a fresh agent with no memory of the system was handed the skill as written and pointed at the same repo, under a record-only mandate. It had the prior run's documents available in the repo and was told to treat them as evidence, not answers.

**Its verdicts:** APPLIES 2 · DOES NOT APPLY 1 · ALREADY IN PLACE 5 · NOT DECIDABLE 2 (on the ten-row template of the time). Acted on: 0, by mandate.

**Three things it found that the sub-agent run above had missed, in the same repo, one day later:**
- The per-lens history file the first run shipped as "the instrument" had **written zero rows**, and the one surface it was wired to is capped at one live experiment per fortnight - at that rate the pre-committed n ≥ 100 bar is years out. The first run had shipped a log and called the idea addressed; the second run computed how long the log would take to matter.
- The gate-history file the first run shipped for idea 4 lives in a **gitignored** directory. The 14-day clock rides an untracked file on one machine, and the check that will read it cannot tell "wiped" from "never ran."
- The persona-testing planner and evaluator are the **same model**, bound by one provider flag. The first run had marked cross-family critique as "already right" from the code-review surface and never looked at this one.

None of the three needed a model call. All three came from re-verifying an ALREADY IN PLACE claim instead of inheriting it.

**What it said about the skill, and what changed because of it:**
- *The worked example is an answer key.* It described the target system with verdicts in it, and the references table said to read it "before you write the summary." Now gated to the last step, read for form only, with the warning at the top of this file.
- *"Expect NOT DECIDABLE on the idea you find most exciting" anchors the reader* in a document whose thesis is don't-decide-before-you-measure. Removed from the procedure; it lives here, as a report of one run.
- *Summary buckets did not match the verdict vocabulary* (took / declined vs. APPLIES / DOES NOT APPLY), so a record-only run had to report "Took: 0" against two APPLIES rows or fudge. Verdicts and actions are now separate axes in the template and the report.
- *No branch for "the mandate forbids all action."* Added: step 0 reads the mandate; an APPLIES row under a read-only mandate is complete at its next step.
- *Steps 2 and 3 could not both be obeyed* - an inventory is numbers, and bars were supposed to precede all numbers. Bars now govern only numbers a verdict turns on; inventory counts are exempt; a post-hoc bar is disclosed in the row.
- *Ideas 5 and 9 were each two ideas under one number*, forcing one verdict where the halves earned different ones. Split into 5a/5b and 9a/9b - twelve rows.
- *Nothing told a second run how to differ from the first.* Added: re-verify, never inherit; a prior record is evidence held to the same bar.
- *The "outward" boundary did not say whether the record itself was outward.* Ruled: the record is internal; lecture figures may appear in it labelled as the lecturer's; anything leaving the repo comes from the paper.
- *The frontmatter promised "a quoted file path per verdict," which DOES NOT APPLY cannot supply.* Now "a quoted file path or a command and its output."
- *The template had no field for the operator's mandate*, which was the most load-bearing context for reading "Acted on: 0." Added, first line.

**What it said worked:** bars-before-numbers changed its behaviour (it had 26 rows of gate history in hand and the pre-committed 14-day floor stopped it computing a one-day spread); "declined, because X is a complete answer" removed the pressure to manufacture a ship; and the five inventory categories mapped onto a repo it had never seen.

**Its own caveat, kept verbatim in spirit:** it had read the answer key before drafting, reached most verdicts independently, and could not honestly claim its idea-2 and idea-3 rows were uncontaminated. That is why the gating changed. And nobody had refuted its record when it finished - the same line it now asks every run to end with.
