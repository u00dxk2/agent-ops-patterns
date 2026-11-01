# The shared schema: making two maps comparable

A single map can follow its own conventions and still read well. Two maps built by different
people, or by the same person a month apart, cannot be compared unless both followed the same
rules, because their counts then measure the choices of the people who built them, not the
systems. In practice, one person counts each admin setting as a seat and another counts all of
them as one, and the first system then looks far more human than the second.

These rules fix those choices. Use them whenever a map may sit beside another one, including a
later edition of itself, and state on the page which schema version the map follows and the
date. This file is **shared schema v1**, with S11 added later. Ids S1-S8, S10 and S11 are in
use. S9 is held for an optional section that is not settled and is left out here.

## S1. One seat = one question, one holder

Two code paths are ONE seat when they answer the same question with the same holder (the same
prompt, the same function, or the same logic copied once per provider). They are TWO seats when
the holder or the prompt differs. List every merge on the map's boundary section under
"Consolidated", naming the paths merged. A merge that is not listed there is a defect.

## S2. What counts as a seat

| Class | Counted? | Where it goes instead |
|---|---|---|
| A decision made while the system runs (by code, a model or a person) about: what the model sees, which action comes next, whether an action may run, whether output is accepted or the task is done, what is remembered or dropped, when to stop, what goes to a person | **Yes** | |
| A person's decision at RUN time (approve, reject, answer a question, give feedback) in the system's own UI or CLI | **Yes**, human seat | |
| A setting a person chooses once (system prompt, which tools are on, thresholds, model choice) | **No** | A "Settings that change seats" table: each setting, who sets it, which seats it changes (and S11 if it changes who decides) |
| Bookkeeping that decides nothing (saving a reply, logging, counting tokens) | **No** | Unless it drops or reshapes content. That is a seat (truncation, compaction) |
| Example, test or dead code | **No** | Listed under Excluded. Judgment code that is wired up but never reached goes under "Missing seats: disconnected" |
| Code outside the repo that the system hands a decision to by contract (an integrator's callback, a hosted service) | **Yes**, holder kind `external` | |

## S3. Fixed stages, so seats line up across maps

Every map uses the same section letters, in this order. A stage with no seats says "none in this
system". That is itself a comparable finding.

| | Stage | The question family |
|---|---|---|
| A | Intake and routing | Which path, mode or agent does this input take? |
| B | Context | What does the model see this turn (prompt assembly, retrieval, memory recall)? |
| C | Choosing the next action | What does the model decide to do, and how is its output parsed? |
| D | Gatekeeping | May this action run (approval, policy, sandbox, risk analysis, hooks)? |
| E | Execution and observation | How is the action run, and what comes back to the model? |
| F | Limits and memory | Budgets, stop conditions, compaction, what is kept for later |
| G | Judging the result | Is the step or task done, correct, good enough? |
| H | Delegation | Hand-offs to sub-agents or other agents, and what they return |
| I | Learning and feedback | Human feedback, self-improvement, saved skills, what changes on the next run |

Seat ids are the stage letter plus an ordinal (`D3`). Give each card the HTML id `seat-D3` and
each gap `gap-7`, so another page can link straight to one.

## S4. Quadrant from the QUESTION, holder kind from the CODE

- **Quadrant** answers "what kind of question is this?" RULE: given the inputs there is one right
  answer, and a run that answers differently has a bug. RULING: competent people could differ. A
  similarity threshold, a risk level or a "done?" check is a RULING even when code holds it.
  (This is the skill's "determinism is not rule-ness" pass, made into the definition.)
- **Holder kind** is one of: `llm` (a language-model call, including a hosted LLM classifier),
  `model` (a learned model that is not an LLM: an embedding threshold, a cross-encoder, a
  classifier), `code`, `human`, `external` (code outside the repo that the system hands the
  decision to). A hosted vendor service is `external` unless the repo shows that an LLM answers.
- So a card reads e.g. "RULING · code" for a fixed threshold. Show the full grid (machine or
  human × rule or ruling) on the chip, the filter and the census, and state an empty cell instead
  of leaving it out.
- A design-time choice inside code (the threshold value someone picked) goes in the card's Notes.
  It is a setting (S2), not a separate seat.

## S5. Fixed card fields, every card, with an explicit "none"

Every card carries every field, with an explicit value when nothing was found. Use one label for
each field and no variants.

| Field | Value when empty |
|---|---|
| Question | (never empty) |
| Quadrant · holder kind | (never empty) |
| Holder | `file:line`, a model setting, or a role (never empty) |
| Contract (llm and model seats) | what the prompt asks for vs what the consumer accepts, each at `file:line`; for code and human seats: "n/a" |
| On error | fail-closed / fail-open / fail-soft / raises, at `file:line`; or "not traced" |
| Checked by | a test or validator at `file:line` whose import path you verified reaches the seat; or "nothing found: <the search you ran>" |
| Failure history | issue / PR / commit; or "none found: <the search you ran>" |
| Gaps | gap numbers; or "none" |
| Why human (human seats only) | exactly one of: taste, accountability, exception handling, training signal; then prose |
| Notes | optional |

Folds: every `llm` seat has a "Full working prompt" fold, and no other seat has one. Code
excerpts go in a separate "Code" fold.

## S6. Gaps: evidence, severity, count

**Evidence tag, one per claim, each in its own colour:**

- `REPRODUCED`: a test or script was run at a named commit and showed the failure (and the fix
  or a control passing). Put the commit and date on the gap.
- `READ-LEAD`: the person responsible for the map re-read the cited lines at the citation commit.
- `READ-REVIEW`: only a reviewer or helper read it, and the lead did not.
- `REPORTED`: the project's own issue, PR or docs say so, and nobody here re-read it.

**Severity class, so maps compare:**

- `S1`: an action with effects outside the process runs without the approval the system says it
  needs, or a secret or private data goes somewhere the user would not expect.
- `S2`: a check cannot fire, or reports the wrong answer (a "done" that is not done, a validator
  whose clean read cannot be falsified).
- `S3`: a judgment with real cost to the user's work and nothing checking it.
- `S4`: legibility or maintenance: prompt and parser drift, a disconnected seat, an undocumented
  default.
- Plus the flag `DESIGN` when the project documents the choice as intended. Count those
  separately and never call them bugs.

Within a class, rank by cost. **The count** is the number of live numbered gaps. A withdrawn gap
keeps its number, is tagged `WITHDRAWN` with the reason, and leaves the count and the ranking.
Smaller findings get their own series (`m1, m2, …`) outside the gap count.

## S7. Provenance and scope

- **One citation commit per map**, with branch and date: "every line citation is to `<sha>`". A
  reproduction names its own commit on its gap.
- **"Last checked"** in the header is the date of the newest claim on the page.
- **A mechanical denominator.** List every place the code calls a language model (a search for the
  client calls, with the command printed) and mark each call site as a seat, part of a
  consolidated seat, or excluded with a reason. Do the same for every approval point. Printing the
  search and each call site's fate makes this number less dependent on who built the map than a
  free-form seat count ("the boundary covers 14 of 17 model call sites"). Without it,
  ratios across maps compare boundaries, not systems.

## S8. Data beside the page

Keep each map's seats and gaps as data next to the page source (see `seats-json.md` in this
folder), plus a check script that fails when the page's census and the data disagree. Numbers in any
comparison across maps are computed from those files, never retyped from pages.

## S10. Same brief, same grain

A count is only comparable when the same brief produced it. A census cut by four parallel readers,
each told to seat every run-time decision in their stages, comes back far denser than one cut by a
single pass with a looser brief. So:

- Use the SAME census brief text for every map you will compare (`census-brief-template.md` in
  this folder), changing only the repository, its layout, its boundary and its security channel.
- A map built before the brief existed is re-censused with it before any cross-map number is
  quoted.
- Comparisons lead with RATIOS and the mechanical denominator (share of rulings; share of rulings
  held by a model, by code and by a person; share of seats with a verified checker; model call
  sites and approval points per stage), not raw seat totals. Always print a raw total together
  with its boundary.
- A page with more than about 60 seats groups them into named FAMILIES inside each stage (e.g. F:
  "budgets and timeouts", "compression"), collapsed by default. The family is presentation only
  and is never counted.

## S11. Holder by setting

S1 and S4 record ONE holder per seat: the one at the shipped defaults. When a setting moves a seat
between a person, code and a model, that single holder hides a range: a small share held by a
person at the defaults may be a much larger one under another configuration.

A seat gets an S11 entry when, at the citation commit, a shipped setting changes the seat's
**holder kind**. Read that in the code that applies the setting, not just in the docs.

- In: an approval mode that sends the same "may this run?" question to a person under one setting
  and decides it in code under another; a setting that hands the seat to an LLM or classifier; a
  setting that hands it to an `external` holder.
- Out (record it under `considered` with the reason): a setting that changes a threshold, list,
  prompt or model name while the holder kind stays the same; a flag that removes the seat
  entirely.
- A setting only an integrator can change by writing code counts, with `whoSets: "integrator
  code"`, so the reader can discount it.

The record is a sidecar file, one per map, and no seat is edited because of it:

```json
{
  "schema": "holder-by-setting/v1",
  "citationCommit": "<full sha, equal to the map's pin>",
  "searched": "<the searches run, so a zero means something>",
  "entries": [
    {
      "seatId": "D7",
      "recordedHolderKind": "human",
      "defaultSource": "code | shipped example config | seat absent by default",
      "default": { "setting": "<name>", "value": "<default>", "holderKind": "human", "at": "path:line" },
      "alternatives": [
        { "setting": "<name>", "value": "<value>", "holderKind": "code", "effect": "<one sentence>",
          "at": "path:line", "whoSets": "end user | operator | integrator code" }
      ],
      "presentWhen": "<only when the seat is absent by default: the switch, with path:line>"
    }
  ],
  "considered": [ { "seatId": "F3", "why": "threshold only; holder stays code" } ],
  "families": [
    { "question": "<one question seated once per holder>", "seatIds": ["F12", "F19"],
      "setting": "<name>", "picks": [ { "value": "<v>", "seatId": "F12" } ],
      "defaultSeatId": "F12", "at": "path:line" }
  ]
}
```

- Cite every `at` at the line where the setting is READ and the branch taken.
- When a seat is absent by default, `default.holderKind` is the kind of whatever answers the
  question in its place out of the box. In the cases this rule was written from, that was code:
  an upstream gate lets the action run, or the action runs unchecked.
- A `family` is one question the map seats once per holder, where a setting picks which seat
  applies. It needs at least two DISTINCT holder kinds among its seats. Two seats that run in
  sequence are not a family.
- The page can then print a **band** for the person-held share of rulings: at the defaults, with
  every entry at its human alternative, and with every entry at a non-human one. LIMIT: the band
  assumes settings are chosen independently. It does not detect a combination the code forbids.
