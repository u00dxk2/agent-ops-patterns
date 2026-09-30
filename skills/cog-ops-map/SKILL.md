---
name: cog-ops-map
description: Build a cognitive operations map for any project, feature, or system — every recurring judgment inventoried as a SEAT (the question it answers, who holds it — a model, code, or a human — how it fails, what checks it), classified rule-vs-ruling × human-vs-machine, rendered as a shareable visual artifact teammates WITHOUT repo access can read (FULL working prompts and code shown inline, with a download-as-markdown button for handing the map to an LLM), plus a first-class "what the mapping exposed" gap report. Use whenever the user asks for a cognitive operations map, an ops map, to "map the seats" or judgments of a system, to make a pipeline's decision-making legible to teammates or non-engineers, to audit who/what holds which judgment, or mentions the cognitive-operations-maps thesis. Also reach for it when someone wants "documentation" of an AI-heavy system for business or creative collaborators — this map is usually what they actually need.
---

# Cognitive operations map

Produce two deliverables for a target system:

1. **The map** — a visual, shareable artifact: every recurring judgment as a seat, in plain
   language, with the actual prompts/code/protocols readable inline.
2. **The gap report** — what drawing the map exposed. In the first real run of this method,
   one afternoon of mapping surfaced real gaps that no existing audit had named. The map is a product; the mapping is an audit. Treat both
   as first-class.

The framework comes from a published essay: read `references/framework.md` for the full
vocabulary and the field-tested gap checklist before starting, and cite the source in the artifact.
Source: David Kooi, "Cognitive Operations Maps", https://uncagedminds.substack.com/p/cognitive-operations-maps

**Where the dated examples come from.** A date on a rule marks the failure it was written
after. The examples describe how the mapping method failed, not the systems it was mapping.

## The vocabulary (use it exactly)

- A **seat** is "a single recurring cognitive operation, stated as the question it answers."
  Not a team, a tool, or a job title. The chair matters, not who sits in it.
- **Rule vs ruling** — run the seat twice on the same input: answers differ and that's a bug
  → RULE (deterministic; validated by tests). Answers differ and both are defensible →
  RULING (judgment; validated against past verdicts).
- **Human vs machine** — and when a seat is human, name WHICH of the four reasons keeps it
  human: taste, accountability, exception handling, or training-signal generation.
- Each seat's record: the QUESTION · the HOLDER (exact model id, file path, or named person)
  · the FAILURE MODE (a real documented one, never hypothetical) · the VALIDATION (what
  checks its work — tests, gold sets, human review, or honestly "nothing") · COST per run
  where the code or docs state it.
- The organizing grid is the 2×2: machine-rule / machine-ruling / human-rule / human-ruling.
  **Humans and models are the same node type** — render them identically.
- **CONTRACT** (every AI seat): what the prompt tells the model to produce, versus what the
  consumer actually accepts or does. Read them side by side; never infer either from docs. The card
  format misses this without an explicit field — holder, failure, and validator can all be correct
  while the prompt and its parser disagree.
  **Where the contract is compilable (shape, enum, length, ordering), say so — that is the fix,
  not a prompt tweak.**

**Passes over the finished card set, all mandatory** (a warning about misclassification does
not fire on its own):

1. **Determinism is not rule-ness.** For every machine·RULE seat ask: *would two competent
   practitioners answer this differently and both be defensible?* If yes it is a RULING
   implemented deterministically — reclassify and check for a validator. Deterministic code
   makes a seat *reproducible*, never *correct*. A deterministic-looking seat whose validation
   field reads "no gold set" does not trigger the reflex to file a gap, so ask on purpose.
2. **A record is not a validator.** If a VALIDATION field names a log, an audit trail, a
   changelog, or a persistence step, it validates NOTHING — rewrite it as "nothing" and file the
   gap. *A log records what changed; nothing judges whether the change was good.*
3. **Can this instrument produce a DIRTY read at all?** For every validator that currently
   reports clean, trace its own failure path: if that path swallows, salvages, retries, or
   normalizes the very condition the instrument exists to detect, the instrument is
   *structurally incapable* of firing and its clean read is unfalsifiable. This is worse than a
   missing check, because it ships with a number attached and reads as reassurance. Distinct
   from rule 2 — here the validator exists, is wired, and returns clean. **Ask: what would a
   dirty read look like, and can the code produce one?** If nothing can, that is the finding.
   For example: a retry loop that swallows the very error a warning is meant to count; a
   salvage parser that turns every failure into a logged `success`; a log-and-continue path
   that lets output ship incomplete while every other instrument reports perfect health.

## Why the format finds what other rails miss — say this out loud before you start

It changes how you fill the card in. Every other instrument checks ONE side of a joint: tests
check code, evals check outputs, linters check source, persona runs check the surface. The seat
card is the only artifact that puts a prompt, its holder, and its checker in the same field of
view — so contradictions between them fall out on their own. **The gap report is a byproduct of
the card's structure, not a parallel deliverable.** Two corollaries:

1. **The HOLDER field must resolve to exactly ONE name.** *A catalog lets two call sites hide
   behind one row; a seat cannot, because "who holds this?" has to resolve to a single answer.*
   If two call sites disagree, that IS the finding — never widen the row to cover both. Filling
   in the HOLDER box is what forces both call sites open.
2. **Anything that lets you skip the adjacency destroys the mechanism** — summarizing a prompt
   instead of embedding it, citing a checker from its own doc instead of the import graph.

## Phase 1 — Inventory by reading, never inventing

**First output: the system boundary, named.** Many repos hold several pipelines plus a
review/instrumentation layer that can be denser with seats than the product itself. Before
inventorying, write down what's in scope (which product/pipeline), what's consolidated
(an instrument cluster can be one seat), and what's excluded (parked features, sibling
pipelines) — and put that boundary statement on the artifact. When feedback tooling
outweighs the pipeline, map the pipeline fully and the tooling as consolidated seats;
a second map can go deep on the tooling later.

Then walk the real pipeline end to end: input → every transform → output → **and the
feedback loops back** (human replies, approvals, grading, retraining signals — these are
seats too, and they are easy to leave uninstrumented). For each seat, get
the holder from the code itself: the exact model constant, the file and function, the named
person. Failure modes come from the project's actual history — incident docs, retros, fixed
bugs, reverted commits, **and the project's issue/watch tracker** (2026-07-30: the richest failure evidence on one
map lived in a dated issue ledger that no doc pointed at; it was found by grepping on
instinct). A map with invented failure modes reads as marketing; real ones are what make
teammates trust it.

**Verify each checker's wiring HERE, at inventory time, not as a gate on finished cards.** The
import-graph grep under "Gates before done" is listed there because that is where it was first
written, but in practice verifying a checker's import path *changes what the card says* (one
checker had moved across two refactors; the "what checks it" claim had to be
rewritten, not confirmed). Record the holder and the checker's import path in the same motion,
before any card exists — authoring cards and then rewriting them is the expensive order.

Don't skip the unglamorous seats: ingest filters, dedup checks, formatting rewrites, delivery
mechanics, approval gates. Misclassification hides there: a step described as "just
formatting" that makes judgment calls is a rule doing a ruling's job.

**Sequencing + consolidation**: if a fresh model/call-site census exists,
**seed the seat inventory from it and treat it as a HYPOTHESIS** rather than re-deriving — but
code-verify every holder. Run the map as a BREADTH pass and any adversarial prompt pass
immediately AFTER it as a DEPTH pass over the folds; depth inside breadth wrecks the breadth.
When consolidating instrument clusters: **consolidate instruments that share a denominator;
SPLIT any instrument whose output feeds an automated action, because those need their own
validation row.** An attribution instrument drawn as its own seat, for example, has to answer
*"what verifies that a row labelled X was actually produced by X?"* — a question a consolidated
card never asks.

## Phase 2 — Choose the medium

Pick the first option that fits, in this order:

1. **The project has an authenticated web surface** (internal app, admin area) — AND you
   have the authority to add routes there. A technical fit is not enough: writing a new page
   into a shared production repo is feature work, and on someone else's project it needs an
   explicit invitation. Also judge the auth strength against the content — inline prompts
   behind a real login is fine; behind a single shared password, ask the user first. When in
   doubt on either count, use medium 2. If you do build the page, follow the repo's
   conventions and verify the route is actually behind auth (curl unauthenticated, expect a
   redirect). This is the best home when it applies, because prompts stay in sync with the
   code that runs them.
2. **Otherwise**: build ONE self-contained HTML file — all CSS and SVG inline, zero external
   dependencies, opens from disk or a shared drive. Embed the prompt/code excerpts at build
   time. Offer to commit it to the repo (don't commit uninvited), and tell the user plainly
   that the file contains the system's internal prompts before they share it beyond the team.
3. **Fallback**: a markdown doc with the same structure. Least good — no expand/collapse, no
   diagram — say so and prefer 1 or 2.

## Phase 3 — Build the artifact

- **The flow diagram**: input → seats → output → feedback loop, each node colored by its 2×2
  quadrant, with a one-sentence legend per quadrant. CSS grid/flex + inline SVG arrows; no
  charting libraries. Must read cleanly at phone width — wide content scrolls inside its own
  container, never the page.
- **Per-seat "look inside"**: every LLM seat shows a curated verbatim excerpt (the scannable
  highlight); every deterministic seat shows a short real code excerpt; every human seat shows
  its protocol. Add repo links alongside for those who have access. This inline rendering IS
  the point — the named audience is teammates without repo access. **Never render secrets,
  env values, keys, or customer data.** Prompt text and code only.
- **The FULL working prompt, every AI seat, from the first build** (learned 2026-07-28: the
  first edition of one map shipped excerpts only and had to be rebuilt next day — build it right
  once). Each machine·ruling seat's card ends with a collapsed "Full working prompt" fold
  holding EVERY piece that reaches the model — system prompt, user-message template, and
  retry/correction addenda — each labeled with what it is and when it fires, plus a
  `file:line` provenance tag. Extraction method (this is what makes it cheap and faithful):
  1. Fan out a search subagent to build a manifest of every prompt piece, keyed on its
     **exported const/function NAME** (file, name, kind, assembly order, shared-piece notes —
     one prompt reused by two seats gets sliced once and noted).
  2. Write an injector script that slices the source **by name anchor, never by line range**,
     strips the code shell from single template literals (text between first and last backtick;
     unescape `\n`, `` \` ``, `\${`), shows programmatically-assembled prompts as dedented
     source labeled as such, HTML-escapes, and injects into marker-comment-wrapped regions so
     the script is re-runnable. **COMMIT the injector next to the artifact** — name anchors
     survive edits, which removes the reason line-ranged scripts had to be thrown away, and the
     same-commit maintenance contract below is unachievable without this tooling: the only
     alternative is retyping prompt text by hand, which step 3 forbids. Give it a `--check`
     mode that re-slices from source and diffs against the artifact, and wire that into a gate
     the project already runs (its test suite or CI). **A prose maintenance contract is not a
     control.** (Anchor 2026-07-30: a project obeyed "delete the script," two prompts changed
     the same night, and it hand-edited the HTML *without noticing it was doing the forbidden
     thing* — one fold was verified stale within hours.)
     **Write injections with a replacer FUNCTION, never a replacement string** — prompt text
     routinely contains `$`, and `String.replace` reads `$3,000` as capture-group 3 and will
     **silently truncate the fold** (observed: −450 chars, caught only because a `--check` run
     was non-idempotent). Same family as the "never `printf` text containing `%`" warning.
     **The injector MUST assert that no fold is zero-length, and that assertion belongs in the
     injector, not in review.** (2026-07-31: a map shipped with all 24 "Full working prompt"
     folds containing **zero bytes** — markers authored, injector never committed per the old
     instruction, so nothing ever filled them. It looked complete to its author *and to review*;
     the named audience would have opened 24 empty boxes. **Drift is the failure mode of a map
     that once worked; emptiness is the failure mode of one that never did — and only the second
     survives a careful author.**)
  2b. **On medium 1, live-slicing is REQUIRED — injection (2, above) is the fallback for media
     that cannot execute at view time.** Have the route slice the prompts out of source **at
     request time**, keyed on exported-name anchors, so a served fold *cannot* disagree with the
     code that ran this morning — the injector and its `--check` gate disappear entirely.
     (Proposed 2026-07-31; productionized on another map 2026-08-18 after its injected folds
     went stale in 11 days — one prompt rework was all it took.) The working recipe, so the next
     run doesn't re-derive it: markers like `<div class="live-slice" data-file data-name
     data-kind data-within?>`; a scanner that walks template literals with full fidelity
     (escapes, nested `${…}` expressions, nested backticks, strings and comments inside
     expressions) and shows "assembled" prompts as whole dedented declarations; an optional
     **`within` scope** that first slices an enclosing function — real code declares
     `const systemPrompt` in three different functions of one file; and **hoist inline
     concatenated prompt strings to named module consts** (a behavior-identical refactor, run
     the suite) rather than slicing a giant enclosing function to reach three lines of prompt.
     Known scanner trap: a close-bracket ending the scan before the initializer's `=` — the
     type annotation in `const X: string[] = […]` — so gate the statement-end on having passed
     the equals.
     **Failure posture, both halves mandatory.** (a) FAIL LOUD at run time: a missing anchor
     renders a visible error block and reports to the error tracker — never an empty fold.
     (b) FAIL EARLY in CI: a test that reads the SERVED map file, extracts every marker, and
     resolves each against today's source with a minimum-length floor (~40 chars) — one gate
     that kills the rename-drift class AND the zero-byte-fold class before a reader sees either.
     The one failure neither half can catch: a marker resolving cleanly to the WRONG const that
     happens to exist — that is what the adversarial post-pass samples for (verify a handful of
     markers, preferring `within`-scoped and generically-named anchors, against the seat each
     fold sits in).
  3. **Never retype prompt text by hand** — thousands of lines of prompts should pass through the
     script, not the model's context; hand transcription costs tokens and invents errors.
  Explain the reading conventions ONCE up top: system prompt = standing instructions, user
  message = the template the day's data is poured into, `${…}` = a slot code fills at run
  time. These folds are the map's most concrete asset: "if this seat's output ever felt off
  to you, its instructions are right there to react to."
- **A "How to read this page" section** before the seats: what a seat is, rule vs ruling in
  one line each, how to read a prompt, a plain gloss of fail-open/fail-soft (it recurs in
  every gap list), and a suggested first path through the cards (the core writer seat, then
  its checkers). Non-engineers don't infer reading order from structure — hand it to them.
- **A "Download .md" button** (fixed upper corner, or in the sticky nav): a small inline JS
  DOM→markdown serializer over the whole page — headings, seat cards, dl rows, **tables**, and
  every prompt fold — so a reader can hand the entire map to their own AI assistant and
  interrogate it. Use `~~~~` fences for prompt blocks (prompts routinely contain ``` and would
  break normal fences); skip pure-navigation elements; append a one-line internal-document
  provenance footer. **The serializer MUST have an explicit `<table>` branch** (emit a markdown
  table) — an element-only recursive walker silently DROPS tables, and one map's census was
  absent from every export for three weeks before anyone noticed (found 2026-08-18). **Verify
  the EXPORT, never the button: after any structural edit, count the H2 headings in the exported
  file against the page and confirm the census table serialized.** (2026-09-04: an
  appended gap entry lost the list's `</ol>`; the browser rendered the four sections that followed
  as if nothing were wrong, and the exporter's OL branch — which emits `<li>` children only —
  dropped all four silently. Same class as the table drop, one level up.) Tell the user this
  button exists — it changes how they share the map.
- **Past ~30 seats, reading aids stop being decoration and become required:** a sticky section
  nav, an expand-all control, and cross-cutting filters (by quadrant; by changed-since-last-
  edition). A 50-seat map without them reads as a wall; the filters are ~30 lines of inline JS
  keyed on card classes and update badges. (A 54-seat map, 2026-08-18.)
- **Language**: pick the least technical intended reader by name and write for them. Every
  piece of jargon gets a plain gloss or gets cut. Each seat's question should be quotable in
  a business conversation.
- **Agent-held seats**: when a seat is held by an AI agent (a session with operating docs and
  memory, not a pinned API call), say honestly that it has no quotable prompt — its standing
  instructions are the project's docs and accumulated memory — and name the level structure
  if one exists (e.g. a project agent vs a supervising agent that audits it). Readers will
  ask "where's the AI-that-runs-things on this map?"; answer it on the card.

## Phase 4 — The gap report

**Asymmetry sweep — a named step, run once every seat has a filled VALIDATION field.** Order
the seats by stakes (whose failure costs the most?) and read the VALIDATION column straight
down. The finding is any seat whose validation is *weaker than a lower-stakes sibling's*. This
comparison is the map's unique yield and the reason it finds what the existing rails cannot:
metrics, linters, and error trackers each look at ONE subsystem at a time, so none of them can
see that two unrelated subsystems are protected in inverted proportion to what they are worth.
Report each inversion as a gap even when both seats are individually defensible — the defect is
the ORDERING, not either seat. (This step exists because the first such inversion was
noticed by accident of layout, not because the method asked for it.)

While inventorying, record every gap the map exposes. `references/framework.md` carries the
field-tested checklist (seats with no validator, rulings misclassified as rules, human seats
generating no training signal, shared model pins, unowned pins, cost figures that undercount,
unfiltered ingest paths, prompts nobody has re-read since shipping). Render the gap list ON
the artifact itself — a map that admits its system's flaws is more credible than one that
doesn't — and deliver it separately in your report, ranked by severity, each gap traceable to
a file or seat.

One class earns its own callout because it hides inside the map's authority claim: **the
census mechanism's scan boundary.** Whatever makes the census trustworthy (a CI walk, an AST
census, a registry check) covers some scope — and everything OUTSIDE that scope inherits the
census's credibility without its verification. One map, 2026-08-18: the CI census walks
`src/` only, so script-side model calls (the daily grading instruments) are census-exempt —
a new one would appear in no census and trip no gate. **State the boundary ON the census
section itself**: an inventory that names its own blind spot is more credible than one that
claims completeness, and the printed statement is the cheapest possible guard.

## Phase 4.5 — The missing-seat pass

An absence is invisible until the present seats are on paper — so run this only after the census
is complete. It has produced some of the most valuable findings. Two kinds:

- **Missing GUARD** — a judgment you already make with nothing checking it.
- **Missing PRODUCT** — a judgment you *don't* make that would create real user value.

**Ask the disconnection question, not only the absence question.** After *"what judgment don't we
make?"* ask **"what judgment DO we make that reaches nothing?"** — a seat that was built,
works, and has no live callers. **For any codebase past a certain age, expect disconnection to be more
common than absence — and it is far cheaper to fix, because the hard part already exists and
already shipped its gates.** Symptoms: a table with rows and no readers; a computed value
rendered and discarded; a field consumed as prompt flavour text that decides nothing.

**Check both bounds on every guard you find.** Guards get written for the failure the author
imagined, and the opposite bound goes unguarded. **The reason it survives review: the guarded
direction produces a visible error, while the unguarded direction produces a plausible-looking
artifact — and nobody files a bug against an output that looks fine.** A max-length guard
with no minimum is the common shape.
Ask of each guard: too-big is handled — what about too-small, empty, stale, or duplicate?

**Quadrant counts are the diagnostic.** Heavy machine·rule with few rulings = a product that
never adapts (a dozen or more rules to one ruling, or to *zero* in-product rulings, is a
common first reading). Also ask: *does the pipeline actually make the judgment our
positioning promises?* — now answerable at file:line. And: *what does the product compute, show,
and then throw away?*

**Watch for the stateless-judge pattern.** When several systems' maps sit side by side, it is
common to find that every one of a system's ruling seats judges ONE item at a time — no seat
forms a view across time or across a corpus about a *person*. It is invisible per-project and
obvious the moment several seat inventories sit side by side.

**Every proposed seat must arrive with (a) the cheapest version that produces real signal and
(b) a control that could kill it.** Cross-corpus judgment seats fail as Barnum statements — a
cold read *feels* like insight, which makes this class uniquely capable of faking its own
success. Controls that work: a **shuffle test** (present the output
alongside several users' histories shuffled — if a reader can't pick the right person, every
statement is generic), a **decoy** (insert a deliberately wrong option; recognition of all of
them kills it), and a **non-obviousness** criterion (is any of this non-obvious to someone who
already read the corpus?). **A proposed seat without a control is a wish.**

## Gates before "done"

- Every claim on the map traces to a file/line, a prompt, or a named person — spot-check
  yourself; a wrong holder or invented failure destroys the artifact's authority.
- **TREAT EVERY ABSENCE CLAIM AS PROVISIONAL UNTIL INDEPENDENTLY RE-DERIVED.** *"Nothing checks
  this," "no seat does X," "zero call-sites"* — **a flat negative is the least reliable output
  this method produces**, because "I looked and found nothing" is indistinguishable from "I
  didn't look in the right place" unless something forces a second pass. Re-derive by a *different route* than the first — a dependency
  grep, a call-graph walk, and a runtime-log read are three routes; re-reading the same file
  twice is one. Where an absence survives all three, say which three; where it hasn't been
  re-derived, mark it provisional on the artifact rather than as a finding. **The absence can
  be on your own map.** (2026-09-04: a map's first edition banked a missing seat; the second
  edition found that seat on the SAME map, one card down, inside a consolidated card. The
  absence survived a retro, a tracker row, and a probe that PASSED, because a consolidated card
  hides the seat that contradicts the census. Before filing a missing seat, grep the map's own consolidated cards
  for the question.)
- **Build the map in the repo whose code it maps** — a rule, not a preference. A map built in a
  sibling/orchestration repo makes the same-commit maintenance contract *physically impossible*,
  and CI that checks out only the mapped repo will **silently skip** any freshness gate.
  (2026-07-31.)
- **When a VALIDATION field names an eval, note whether that eval has a measured NOISE FLOOR**
  (run the incumbent against itself first; a pass/fail criterion with no floor is
  unfalsifiable — a control run can fail criteria no model could pass, including the one in
  production). *No floor measured* is a legitimate card entry and a legitimate gap. Two correctly
  reasoned exceptions: a **direct mechanism probe** — inspecting the actual differing cases and
  explaining WHY they differ — needs no floor; and a metric pinned at exactly **0** has a floor
  bounded by 0, so the first genuine non-zero is signal (the floor becomes mandatory the moment
  the count leaves zero).
- **Every "what checks it" claim gets an import-graph grep at WRITE time** — verify the
  checker module is actually imported/called by the seat's pipeline before the claim is
  committed, never from memory or from the checker's own doc. Anchor (2026-07-28): one
  map credited a regex gate on a seat whose pipeline never imported it; the error
  survived review and cross-check and was only caught later by someone wiring code. A map
  that overstates a check is worse than no map — it manufactures exactly the false assurance
  the gap report exists to expose.
- **Medium-1 deploy check**: if the route serves a file at runtime (e.g. a `docs/` HTML),
  verify the host's build filters actually deploy changes to that path — query the deploy
  service's API, don't assume. Anchor (2026-07-28): the host's ignored-paths filter covered `docs/**`,
  so a docs-only map update pushed cleanly and silently never went live. Document the manual
  deploy trigger next to the route.
- Screenshot the rendered artifact at desktop AND phone width, and actually look at the
  pixels (the first runs caught real mobile-overflow bugs this way; automated checks did
  not). Operational details that matter: browser tools usually block `file://` — serve the
  HTML over localhost for the check; and if the design uses expandable cards, OPEN every
  `<details>` before the phone check (a collapsed-card screenshot validates nothing) — a
  programmatic overflow scan with all cards expanded is the honest instrument.
- Confirm the auth posture matches the content: inline prompts on an unauthenticated surface
  is a leak — medium 1 requires the auth check, medium 2 requires telling the user the file
  contains internal prompts before they share it.
- Report shape: seat count by quadrant → the gap list ranked → where the artifact lives and
  how to share it → what you could not determine from the code (honest unknowns beat
  guesses).

## Edition updates — the second build is a different job

The phases above describe a FIRST build. When an existing map has fallen 2+ weeks behind its
system (one map's first edition was 19 days stale, spanning a model swap and two
prompt-architecture rebuilds), run an UPDATE edition. It has its own moves:

- **Open with a "What changed since the last edition" section** — dated, one line per change,
  each linking into the card that carries the detail. Returning readers are the map's actual
  audience; making them re-read 50 cards to find the delta spends the trust the first edition
  earned.
- **Badge changed cards** (a small `updated` tag on the summary row with 2–3 words of why) and
  key a **"changed since last edition" filter** off the badges — at that map's update 27 of
  54 seats had changed, and the filter is what made that legible.
- **Stable IDs survive; classifications don't have to.** When the census reclassifies a seat's
  quadrant, keep the ID, change the card, and SAY on the card what happened ("the first
  edition drew this seat as the deterministic detector; the census reclassified it to the
  judgment it actually makes"). Silent reclassification reads as an error to anyone comparing
  editions — that update fixed four of these (they had sat as card-vs-census contradictions
  since the first census regeneration).
- **Append dated Outcome lines to the existing gap list BEFORE hunting new gaps** — the
  found→fixed ledger is the artifact's strongest trust signal, and updating it first forces a
  re-read of every old gap against current code on the way to the new ones.
- **After a model swap, re-verify every holder line wholesale** — a swap moves dozens of
  holder claims at once and is the single fastest way an edition rots. Check for the swap's
  signature incident class too: an unbranched call site the new provider can't reach, failing
  silently behind a fail-soft.
- Seed the update from the previous edition's file (never rebuild from scratch — the narrative
  prose is accumulated capital), but treat every carried factual claim as a HYPOTHESIS until
  re-checked, exactly like a census seed in Phase 1.

## After it ships — the map is a living document

- **Same-commit maintenance contract**: when a change to the mapped system ships (a gate
  added, a seat re-held, a flag flipped), update the affected seat cards in the SAME commit
  as the code change — a map that drifts from the code inverts from asset to liability. A
  map's credibility comes from cards that say "since <date>, also checked by X"
  within hours of X shipping.
- **Gap Outcome lines**: when a gap gets remediated, append a dated **Outcome:** line to its
  entry rather than deleting it — the gap list doubles as the audit's scoreboard, and "found
  → fixed same day" is the strongest trust signal the artifact can carry. Keep the map's
  header dated: "Built <date> · updated <date> — <what changed>."
- Keep the artifact's URL and title stable across updates; readers bookmark it and share
  links mid-thread.

## Where this skill stops working

- It needs to read the system's code. Holders, prompt/consumer contracts and checker wiring come
  from source; docs, retros and protocols supply the other fields (failure history, human seats).
  A holder or validator that exists only in a running deployment, a vendor console or someone's
  head cannot be established from here; mark it unknown rather than guessing.
- Reading code does not establish runtime behavior. A "checked by X" card backed by a verified
  call path supports a point-in-time wiring claim, not proof that X runs or catches anything.
  Pair it with a check that can go red (`patterns/checks-that-cant-fail.md` in this repo) for the
  operational half.
- A map is a snapshot and drifts when the code changes. The same-commit maintenance contract has
  to update the affected cards. Phase 3 live slicing keeps the embedded prompt source current,
  but not the surrounding claims (holders, classifications, validators, gaps).
- Rule vs ruling is a judgment the mapping agent makes. Record whether a classification rests on
  reasoning or on observed runs, and keep borderline ones provisional. Identical outputs alone
  do not make a seat a rule (see "Determinism is not rule-ness" above).
- Absence claims ("nothing checks this", "no seat does X") stay provisional until they are
  re-derived by a different route, as the gate above requires.
- The finished map contains the system's prompts. Sharing it is a disclosure decision for the
  system's owner, not something the skill can make safe.
- No worked example ships with the skill yet. One from a real run is planned; none will be
  constructed.
