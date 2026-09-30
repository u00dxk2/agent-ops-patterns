# The cognitive-operations-map framework — full reference

Canonical source: David Kooi, "Cognitive Operations Maps", https://uncagedminds.substack.com/p/cognitive-operations-maps
If you can fetch it, read it — the artifact should speak the essay's language. This file distills it
plus lessons from real runs of the method.

## Definitions (key sentences, near-verbatim from the essay)

- "The unit is not a team, a tool, or a job title. It is a single recurring cognitive
  operation, stated as the question it answers." — that unit is a **seat**.
- The rule/ruling test: "Run the seat twice on the same input. If the two answers differ and
  that is a bug, you have a rule. If the two answers differ and both are defensible, you have
  a ruling." Rules validate via testing; rulings validate against past verdicts.
- Why a seat stays human — four answers: **taste** (genuinely better judgment), **accountability**
  (someone must be answerable), **exception handling**, **training-signal generation**.
- The valuable move is **vertical** (ruling → rule), which removes metering cost permanently;
  capability improvements merely move seats horizontally (human → machine).
- Accountability seats never fully automate.
- "Misclassification errors (rulings disguised as rules, and vice versa) create expensive
  blind spots" — hunting these is one of the map's jobs.

## The seat record

| Field | What goes there | Discipline |
|---|---|---|
| Question | The recurring judgment, phrased as a question a non-engineer understands | Quotable in a business conversation |
| Holder | Exact model id, file path + function, or a named person | From the code, never from memory |
| Quadrant | machine-rule / machine-ruling / human-rule / human-ruling | Apply the run-twice test honestly |
| Failure | A real, documented failure of this seat | Search order: gate/validator file headers (every gate encodes the failure that created it, usually dated) → the project's agent instructions/ops docs/retros → commit history. "None documented" is a sanctioned value — never invent one |
| Validation | What checks the work (tests, gold set, paired reads, human review) — or "nothing" | "Nothing" is a finding, not an embarrassment to hide |
| Cost | Per-run cost where code/docs state it | Wrong cost figures are themselves a gap class (see below) |
| Reason-human | For human seats only: which of the four reasons | Missing training-signal capture is the most common gap. For human-RULE seats (runbook executors, recovery procedures) the reason is usually exception handling: the seat exists because the machine path already failed |

## The shape to aim for

A finished map covers the pipeline end to end — ingest, every transform, every gate, delivery —
and then the feedback loop back to the top: human approvals, replies, and grading are seats too.
Each seat expands to its verbatim prompt, real code excerpt, or human protocol. The flow diagram
runs input → output → feedback loop, the quadrant counts are stated, and the gaps found are
rendered on the page itself.

## The field-tested gap checklist

Work through each class while inventorying — each of these has produced real findings:

1. **Seats with no validator** — especially judgment seats sitting upstream of whatever the
   project has named as its binding constraint.
2. **Rulings misclassified as rules** — deterministic-looking code making judgment calls with
   no output validation.
3. **Human seats generating no training signal** — approvals/holds/edits that vanish instead
   of becoming rows. The HIGHEST-authority human seat can be the one producing zero durable
   signal. Check every human seat for this.
4. **Cost figures that lie — or don't exist** — a displayed cost counting only one provider,
   priced at wrong rates, OR no cost counting at all (when almost no seat carries any figure,
   "nothing is lying — nothing is counting" is itself the finding). If a
   cost number is visible to a stakeholder, verify what it actually sums.
5. **Shared model pins** — several seats silently riding one model constant, so one "upgrade"
   moves them all unvalidated.
6. **Unowned pins** — a pinned model/prompt with no named re-evaluation owner or date.
7. **Unfiltered ingest paths** — documented side doors into curated stores.
8. **Prompt drift** — live prompts nobody has re-read since shipping; headers that still say
   "prototype" on seats that run in production.
9. **Status-vs-reality mismatches** — code comments, docs, or flags describing a seat's
   wiring that no longer matches what runs.
10. **Fail-open or non-binding verifiers** — the most important class for LLM pipelines, and
   the one "seats with no validator" hides: check every gate's ERROR PATH and ENFORCEMENT
   WIRING. A verifier that defaults to PASS on a parse failure, ships a neutral fallback when
   its scorer errors, or renders a verdict the pipeline is free to ignore is worse than no
   validator — it manufactures false assurance. This shape turns up on seats a checklist
   would have marked "has validator ✓". Read the gate's failure
   branches, not just its existence.
11. **The census mechanism's own scan boundary** — whatever makes the seat inventory
   trustworthy (a CI walk, an AST census, a registry check) covers some scope, and calls
   OUTSIDE that scope inherit the census's credibility without its verification. Ask: what
   directory, language, or call style does the census NOT scan, and does anything there make
   model calls? (One map, 2026-08-18: the CI census walked `src/` only; the daily grading
   instruments in `scripts/` were census-exempt and nothing would flag a new one.) State the
   boundary on the census section of the artifact itself — an inventory that names its own
   blind spot is more credible than one that claims completeness.

**Tag every gap NEW / KNOWN-TRACKED / KNOWN-DEFERRED** — check the project's own issue/debt
tracking before presenting a gap as a discovery. Presenting already-tracked debt as news
costs the artifact credibility with exactly the audience it's for; the honesty split is what
makes the gap report actionable.

## Lessons from real runs (why the gates exist)

- **Read the code, not the docs, for holders** — seat documentation drifts from the wiring;
  the map is only trusted if it reflects what RUNS.
- **The phone screenshot is not optional** — a forced-width overflow can make the page
  unreadable on a phone, and the intended readers open links on phones.
- **Put the gaps on the map** — a self-critical map is more credible than one that hides its
  system's flaws.
- **The inventory pulls no punches on friends** — human seats belong on the map with the same
  record structure as models, the owner's own included. A human approval seat with no
  training capture is one of the most useful findings a map can make.
- **Zero new dependencies** — CSS + inline SVG render everything; a charting library adds
  nothing but weight and makes medium 2 (self-contained HTML) impossible.
