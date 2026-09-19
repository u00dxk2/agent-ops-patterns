# Skill regression testing: treating agent instructions as process code

Agent "skills" (or slash-commands, playbooks, standing prompts — reusable instruction files an agent loads to do a job) are the process layer of an agent system. They get edited constantly, and almost nobody tests the edits. In our own system, and in the public agent-orchestration projects we looked at informally in July 2026, prompt and skill regression testing was the thinnest layer in the stack: teams that would never merge code without CI hand-edit the instructions that *drive* the code and ship on vibes. That was a look around, not a survey - no population, no criteria, no rubric. Treat it as a thing we noticed, and check whether it's true of you.

These are the practices that replaced vibes for us. They assume nothing about your harness beyond "instructions live in versioned files."

## 1. Skills are code

Version them, diff them, review them, and — this is the uncomfortable one — restrict who can edit them. In our system, agents cannot modify their own skill files; proposed edits are drafted in-repo and a human installs them. A self-editing instruction layer is a quiet way to lose the properties you thought you'd pinned down. Some public frameworks take the opposite bet — background loops that self-edit skills with no human gate. That's a coherent trade (their reasoning: the agent can already execute arbitrary code anyway); ours is the conservative side of it, because the skill layer is where we pin down every property the rest of this document depends on.

## 2. TDD for skills: author against a watched failure

Never write a skill speculatively. Write it when you have a *watched baseline failure* — a real transcript where the agent did the wrong thing — and author the skill as the fix for that transcript. Keep the failure case; it is your first regression test. A skill without a motivating failure is scope, not process.

## 3. Benchmark-gated edits ("keep only measurable wins")

For a skill that runs often enough to matter: before editing, capture a small benchmark — a handful of representative inputs and a scoring rule (which can be as cheap as "did the output contain the required sections"). Run the current skill against it for a baseline. Apply the edit. Keep it **only if it beats the baseline by a margin you declared before you looked** - or, if the edit is meant to be a refactor rather than an improvement, only if it stays inside a non-inferiority margin you also declared in advance. Equal is not a win, and a single stochastic run is not a result; if the scoring is noisy, run it enough times to tell a real move from the noise. This kills the most common failure mode of prompt maintenance: the edit that fixes today's case and silently regresses three others. (Pattern lineage: [gbrain](https://github.com/garrytan/gbrain)'s `skillopt` treats a skill file as a trainable parameter with exactly this keep-rule; the idea traces upstream to Microsoft Research's [SkillOpt](https://github.com/microsoft/SkillOpt) ([arXiv:2605.23904](https://arxiv.org/abs/2605.23904)), which frames the skill doc as trainable external state of a frozen agent.)

## 4. Shadow-A/B for live iteration

For high-traffic skills where an offline benchmark is too thin, run the edit as a shadow variant on live traffic:

- **Assignment by stable hash parity** (e.g., of the work-item ID) — deterministic, resumable, no state to store.
- **A pre-registered outcome metric** from a stream you already collect (task ratings, completion rates) — never "it seems better."
- **Auto-rollback** when the variant underperforms past a threshold, plus a **cooldown** before the same skill can be re-experimented on, plus a **hard cap** on concurrent experiments (one is a fine cap; the point is the number is written down).

The mechanism is deliberately boring; the discipline is that a skill edit becomes an *event with a measured outcome* instead of a mood.

## 5. Anti-rationalization red flags

The failure mode of skill maintenance isn't bad edits — it's plausible narratives for keeping them. Treat these phrases, in your own reasoning or your agent's, as stop signs demanding a measurement:

- "This probably helps in most cases."
- "The benchmark doesn't capture the real benefit."
- "It failed the check, but for an unrelated reason."
- "This edit is too small to need testing."

If the benchmark genuinely doesn't capture the benefit, the fix is a better benchmark, not an exemption.

## 6. What exists off the shelf

Prompt-level harnesses exist ([promptfoo](https://github.com/promptfoo/promptfoo)'s matrices and assertions; [DeepEval](https://github.com/confident-ai/deepeval)'s local eval traces) and are worth wiring in if your skills reduce cleanly to prompt-in/text-out. The gap they don't cover — and where the patterns above do the work — is *skill-native* behavior: multi-step tool-using runs where the outcome lives in what the agent did, not in one completion. There, your outcome stream is the eval, which is why the shadow-A/B shape matters.

## Adoption order

(1) Put skills under version control with human-gated edits — free. (2) Start keeping failure transcripts and authoring skills against them — cheap, immediately clarifying. (3) Add benchmark-gating to your top 2-3 most-edited skills. (4) Shadow-A/B only where traffic justifies it.

## Limits

- **Benchmark-gating assumes the output is scorable, and the cheap scoring rule measures form.** "Did the output contain the required sections" is honest about what it is — a structural check. A skill can pass it while its judgment degrades, because the part that got worse is the part no cheap rule reads. For skills whose value *is* taste (what to prioritize, what to leave out), expect the benchmark to be the weakest link rather than the arbiter, and say which one you have.
- **Shadow-A/B needs traffic most skills will never see.** Stable-hash assignment and an auto-rollback threshold are sound and they need enough work-items to tell a real move from noise. Below that N the rollback fires on variance, and the discipline of §3 — a margin declared before you look — is doing all the work anyway.
- **Human-gated edits are a trade, not a free win.** §1 takes the conservative side deliberately, and the cost is latency: every fix waits on a person, and in a fast-moving system that queue is where improvements quietly die. The bet is that an instruction layer nobody can silently rewrite is worth more than the edits you lose. It is a bet, and it is worth re-checking against your own throughput.
- **§6's read of the ecosystem was a look around in July 2026, not a survey** — the document says so where it makes the claim, and it is repeated here because it is the kind of line that gets quoted without its caveat.
