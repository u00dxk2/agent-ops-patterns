# Skill regression testing: treating agent instructions as process code

Agent "skills" (or slash-commands, playbooks, standing prompts — reusable instruction files an agent loads to do a job) are the process layer of an agent system. They get edited constantly, and almost nobody tests the edits. In our experience — and in every public agent-orchestration system we surveyed in July 2026 — prompt/skill regression testing is the thinnest layer in the stack: teams that would never merge code without CI hand-edit the instructions that *drive* the code and ship on vibes.

These are the practices that replaced vibes for us. They assume nothing about your harness beyond "instructions live in versioned files."

## 1. Skills are code

Version them, diff them, review them, and — this is the uncomfortable one — restrict who can edit them. In our system, agents cannot modify their own skill files; proposed edits are drafted in-repo and a human installs them. A self-editing instruction layer is a quiet way to lose the properties you thought you'd pinned down. Some public frameworks take the opposite bet — background loops that self-edit skills with no human gate. That's a coherent trade (their reasoning: the agent can already execute arbitrary code anyway); ours is the conservative side of it, because the skill layer is where we pin down every property the rest of this document depends on.

## 2. TDD for skills: author against a watched failure

Never write a skill speculatively. Write it when you have a *watched baseline failure* — a real transcript where the agent did the wrong thing — and author the skill as the fix for that transcript. Keep the failure case; it is your first regression test. A skill without a motivating failure is scope, not process.

## 3. Benchmark-gated edits ("keep only measurable wins")

For a skill that runs often enough to matter: before editing, capture a small benchmark — a handful of representative inputs and a scoring rule (which can be as cheap as "did the output contain the required sections"). Run the current skill against it for a baseline. Apply the edit. Keep the edit **only if it scores ≥ baseline**. This kills the most common failure mode of prompt maintenance: the edit that fixes today's case and silently regresses three others. (Pattern lineage: [gbrain](https://github.com/garrytan/gbrain)'s `skillopt` treats a skill file as a trainable parameter with exactly this keep-rule; the idea traces upstream to Microsoft Research's [SkillOpt](https://github.com/microsoft/SkillOpt) ([arXiv:2605.23904](https://arxiv.org/abs/2605.23904)), which frames the skill doc as trainable external state of a frozen agent.)

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
