# The ten ideas that survived nine lectures

Read all ten before judging any. Each carries the lecture part it came from and the paper behind its numbers (`papers.md` has the URLs). The numbers are as the lecturers stated them in fall 2025; open the paper before a number leaves your repo.

Each idea ends with **What it would mean here** - the question to ask of the system you are judging. Those questions are hypotheses. Your evidence decides.

---

## 1. Coverage vs. selection is the whole game

Sampling the same prompt N times raises the chance that at least one answer is right, and it does so log-linearly on every model size the authors tried, down to 70M parameters (Large Language Monkeys, part 2). But that only becomes system accuracy if you can *pick* the right one. Majority vote and prompted-LLM ranking plateau at 10-50 samples; the hardest problems are solved one to three times in ten thousand, which no vote can find. A trained verifier keeps working further - to roughly 400 samples in the GSM8K verifier work (part 3) - and then its precision drops and system accuracy *falls*, because two near-identical answers past the verifier's resolution are a coin flip. More samples than your verifier can discriminate makes the system worse, not flat.

**What it would mean here:** anywhere you sample N candidates, what selects among them, and has that selector's accuracy ever been measured against a label? If the answer is "the same model ranks them," ideas 2 (an unfiltered judge) and 8 (self-critique) apply before this one does.

## 2. Filter verifiers before you ensemble them

Weaver (part 3; Saad-Falcon et al.) tested "multi-agent verification" - several LLM judges, each prompted on a different rubric aspect, votes combined - and it did **worse than plain majority vote** on the hard benchmarks. What worked: take a small labeled set (~1% of the data), drop every verifier below a quality floor, then weight the survivors by an accuracy estimate (naive Bayes or logistic regression; nothing fancier was needed). The assumption that makes the weighting valid is that each surviving verifier captures an *independent* aspect of correctness - verifiers that agree on everything teach you nothing. With that, an 8B generator plus a filtered verifier pool matched a 70B model's majority vote, and the whole pool distilled into a ~400M model that kept ~97% of the accuracy at a fraction of the compute.

**What it would mean here:** if you have more than one judge on anything, do you have labels; has any judge ever been dropped for failing them; are the survivors weighted by anything, or do they vote equally; and do they ever disagree (judges that always agree add nothing)? ALREADY IN PLACE needs evidence for all four, not just the first. An ensemble whose members have never been scored against an outcome is the configuration Weaver measured as below majority vote. Pre-commit the floor before you run the backtest. If you cannot join judge verdicts to outcomes at all, the verdict is NOT DECIDABLE and the action is to start persisting per-judge verdicts beside outcomes. And ensembles are not the only judges: a LONE judge with no label record routes to idea 3 (start the record), and a lone judge grading its own producer routes to idea 8 - neither is this idea's case, and neither disappears into DOES NOT APPLY. Remember prompts are code: an ensemble defined in a markdown skill or workflow file counts, and a source-only search will miss it.

## 3. Meta-verification: verify the verifier's findings

DeepSeekMath-V2 (part 9) found that an LLM judge asked "is this proof valid?" will say yes to invalid proofs. The fix that moved the number was a second pass over the *judge's output*: do the issues it named actually exist in the proof, and does its score follow from them? The confirmed/refuted record from that second pass is what trained a better verifier, and once the meta-verifier was reliable the human labelling could stop. The same shape appears in every cross-family review loop: a second model reviews the first, someone checks which of the second model's findings were real, and that record - not the findings - is the asset.

**What it would mean here:** when a model reviews another model's work, is anyone writing down which findings were confirmed and which refuted? If that record exists, has it been tallied by finding class - which classes can be auto-accepted, which must be re-verified? If it does not exist, starting it costs one line per finding. Beware survivorship: a record kept only when someone bothered to confirm will over-state precision, and should say so in its own header.

## 4. Signal needs spread

DAPO (part 6) throws away every training prompt on which all sampled answers were right or all were wrong: there is no gradient in either. GRPO needs a *distribution* of rewards to learn anything at all. Absolute Zero (part 9) has the model propose its own tasks and scores a proposal at 1 minus the current success rate - zero for trivial, zero for impossible - so the curriculum stays at the edge. The operational translation is the same in every direction: a check that is always green tells you nothing, a check that is always red has been trained out of everyone's attention, and an eval set that always passes is a set nobody needed. Budget - review, fixtures, evals, sampling - belongs where the pass rate is in the middle.

**What it would mean here:** for each health check, gate, or eval, do you know its pass rate over the last month? Is there a per-run record from which that could even be computed? Fixtures: are they drawn from the cases the system sometimes gets wrong, or from the ones it always gets right? A "documented floor" (a check everyone knows fires and ignores) is the always-red case and is worth naming explicitly.

## 5. Judge the plan, not just the result

Two halves, judged separately in the record: **(5a)** review the plan or query before execution; **(5b)** hold out a test set the generator never iterates against.

SWiRL (part 5) put a process reward on the *query* the agent was about to issue - "is this a sensible thing to search / compute next?" - judged before the tool ever answered, and found the judge could do that well without seeing the result. Training on trajectories whose steps were judged good but whose final answer was wrong beat training only on correct outcomes, because outcome-only filtering only ever teaches the model what it could already do. RLEF (part 4) makes the complementary point for code: the model iterates against *public* tests and is scored on *private* tests it never sees, so it cannot memorize the test. Process reward models (part 3) manage false positives - the right answer reached by a wrong process - that outcome reward cannot see.

**What it would mean here:** (5a) is review timed before execution (a plan, a PR description, a query) or only after (a result)? Do you keep the failed runs that had good steps, or only the successes? (5b) Where the agent iterates against a test set, is there a held-out set it never sees, or does the same set serve both? A repo can be ALREADY IN PLACE on one half and APPLIES on the other; that is the common case, not an edge.

## 6. Reliability horizon

METR (part 8) measures the length of task, in human-professional time, that a model completes 50% of the time; it has been doubling roughly every seven months. The 80%-success horizon is much shorter - for Claude 3.7 Sonnet, about 15 minutes against 59 - so a task an agent "can do" is one it does half the time. The failure modes that account for the gap are the same across models: poor planning, wrong tool choice, arithmetic errors in reasoning, abandoning the task early, and repeating the same failed action. Two findings from the same lecture bear on context: contractors unfamiliar with a codebase were 5-18× slower than its maintainers, and the models behaved like contractors; and in GDPval, instruction-following was the top failure ("promised to read the reference file, then didn't"), under-specified prompts fell apart, and a try-n-times loop with the model checking its own last attempt was 1.6× cheaper than a single try. Humans still architected *what* to work on.

**What it would mean here:** the verdict turns on the failure classes: are abandonment (finishing without evidence) and repetition COUNTED as failure classes alongside crashes, anywhere a record survives? A framework whose unattended dispatches can run long is in the 50% regime by construction, so the regime alone decides nothing - and only wall-clock allowances place a dispatch in a time regime at all; an iteration or turn budget is not a duration. Then the context questions: is context injected at the start of a task (a primer, a map of the repo) or does every session start as a contractor? Does anything check that a reference the agent was told to read was actually read?

## 7. Deep research has a low ceiling

DeepScholar-Bench (part 8) scored deep-research systems on writing a related-work section against expert-vetted ground truth: no system exceeded 19% on the combined bar. They wrote fluently, missed the foundational sources, and even when handed the perfect source list captured about half the key facts. Fluency and verifiability traded off - the most readable output had the worst citation precision. Search-o1 (part 7) is the counter-move at the retrieval layer: retrieve, then *extract the relevant span* and append only that, rather than appending whole documents; appending more documents made direct reasoning worse, and extracting from more documents made it better.

**What it would mean here:** if external research (a deep-research report, a paper summary, an agent's literature read) flows into decisions, is the load-bearing citation ever opened? A field on the ingest record - "citation verified: how / no" - is the smallest version. If a retrieval layer appends documents into a prompt, does it extract or dump?

## 8. Diversity is the bottleneck of self-improvement

A single model fine-tuned on its own filtered outputs improves for a few rounds and then stalls, and the stall is measurable as collapsing diversity in what it generates (multi-agent finetuning, part 9). Several models - or several specializations of one - restore the diversity, and the paper's "poor man's version" is simply to use different models. Two related points from earlier lectures: the lecturers remarked in the part-1 Q&A that models prefer their own reasoning traces even to better traces from another model - a remark, not a paper; no row in `papers.md` backs it, so treat it as anecdote - and self-critique is harder than critique by a different model because models are overconfident in their own outputs (part 4, on Constitutional AI).

**What it would mean here:** does anything critique a model's output using the *same* model? If so, that is the configuration the course rates weakest. Is a second family available for critique, and is it used for critique rather than for generating the trace? Where a system generates its own training or evaluation data, is diversity measured at all?

## 9. Fusion beats picking; process beats outcome on false positives

Two halves, judged separately in the record: **(9a)** fuse the top-k candidates instead of picking one; **(9b)** a process check catches the right answer reached by a wrong process.

Archon (part 2; Saad-Falcon et al.) found that handing the top-k candidate answers to one model and asking it to *synthesize* a single answer beat picking the best single candidate - even picking with a perfect oracle. Filtering to the top few and then fusing beat fusing everything. A critic-then-ranker-then-fuser ordering worked best, and stacking such layers kept helping on hard tasks. Separately (part 3), process reward models catch the right-answer-wrong-process case that outcome rewards cannot, which matters most exactly where a wrong process will fail on the next input.

**What it would mean here:** (9a) anywhere you generate N and keep one, is there a cheap experiment in fusing the top three? (Only where the output can be judged - fusion on copy with no verifier just inherits idea 2's problem.) (9b) Where a check passes on the final output, can a wrong intermediate step still pass it?

## 10. Route by difficulty; small models carry the bulk

For easy and medium problems, sequential revision with a small model plus test-time compute beat a larger model per token; for the hardest tail, parallel exploration was needed and the frontier model still won even with a large sampling budget (Snell et al., part 2). The free difficulty signal is disagreement: where repeated samples disagree, the problem is hard. A large generator with a small verifier beat the reverse (part 3). And the intelligence-per-watt study (part 9) measured that local models of ≤20B active parameters now answer roughly 89% of real chat queries correctly, and that 77% of ChatGPT traffic is practical guidance, information lookup, or writing - the easy bulk.

**What it would mean here:** is the model choice per call site a routing decision or a default? Which calls are classification, extraction, or grading - the shapes a small model handles - and which are generation on the hard tail? Is sample disagreement used anywhere as a "needs review" flag, which requires no labels?

---

## What the course does NOT cover, that a running system will hit

Named here so a run does not mistake a real gap for course-approved practice:

- **Deterministic verifiers have their own confident-wrong path.** The lectures assume a unit test or a formal check is ground truth. A cached value read "with no model involved" earns high confidence and can still be stale; a fixture that cannot distinguish a right answer from a wrong one has zero power. Mutation-test your verifiers.
- **Irreversible actions.** The planning lecture says so itself: tree search over actions that spend, delete, or send is out of scope. That boundary belongs to the operator's permission layer, not the planner.
- **The record's own bias.** A confirmed/refuted record kept only when someone bothered to confirm will read as high precision. Idea 3's tally is only as honest as its header.
