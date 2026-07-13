# Fail-soft detectors: zero-LLM health monitoring for agent fleets

The operational failure modes of LLM-agent systems — silent stalls, wedged listeners, dead schedulers, half-delivered work — are boring, mechanical, and constant. The instinct is to point another LLM at them ("a watchdog agent"). That instinct is wrong, and this document is the discipline that replaces it, extracted from a system that runs ~14 concurrent coding-agent sessions across a 15-product portfolio with one human operator.

Independent corroboration that the LLM-watchdog path fails comes from a source we did not author: Katherine Cass's public retrospective of her 11-agent system, [*Field Notes From an Eng Manager Building Her First Autonomous Agent System*](https://k4therin2.github.io/agent-system-v1-retrospective.html). It documents multi-hour silent outages — one ran "28+ hours", another hung with "no heartbeat detection"; a watchdog agent that would "detect the same error 15 minutes later. Same investigation. Same report. Burning tokens on repeat," on which her verdict is *"this 100% should have been code, not an LLM call. Simple logic like 'have I seen this exact error in the last hour?' doesn't need intelligence — it needs a counter and a timestamp"*; and watchdog-of-watchdog stacking — "Sophie (watchdog) monitoring Grace, a watchdog for Sophie monitoring Grace" — of which she concludes: "The complexity just created more failure modes."

## The rules

### 1. Detectors observe PRESENCE, never JUDGMENT

A detector answers "is the signal there?" — a heartbeat file is stale, a queue row sat unconsumed, a report section is absent, a deploy event never arrived. It never answers "is the work good?" Correctness judgments stay with humans (or with explicitly separate judge components that are themselves evaluated). This split is what lets you run detectors on every poll for free and trust a silence.

### 2. Declare a failure posture per detector — and bias to fail-soft

Three postures, named in the detector's header comment:

- **fail-soft** — any ambiguity resolves to NO finding. A bug in the detector can only cause *under*-reporting, never a fabricated fault. This is the default for anything that pages a human: false alarms burn the operator's trust budget, and a detector that cries wolf gets ignored the week it matters.
- **fail-safe** — unknown input resolves to the safe *default* (e.g., an unrecognized action classifies as "needs human review", an unknown project counts as "instrument not ready").
- **fail-closed** — a bug can only fail-to-approve (for gates in front of irreversible actions: capability grants, publish paths).

The point is not which posture — it's that the posture is *chosen and written down*, so a reviewer can check every branch against it. Most detector bugs we've caught were branches that violated the declared posture.

### 3. Zero LLM calls on the watch path — enforced structurally, not by convention

Detectors, health checks, and delivery guards make no model calls. Ever. Cost is the obvious reason (a detector polls; a poll times N agents times 24h compounds); determinism is the deeper one — a detector must behave identically at 3am on the hundredth identical input.

Convention decays, so enforce it in CI: a test that fails the suite if any detector module imports an LLM SDK, contains an LLM API hostname, or imports the sanctioned LLM-call wrapper. Deliberate exceptions live in an allowlist inside the test, so growing the list is a visible review event. (Pattern lineage: [CorvinOS](https://github.com/CorvinLabs/CorvinOS)'s compute-worker AST lint; ours is a plain import/string scan, which has proven sufficient.)

### 4. Dedup alerts with a counter and a timestamp

A detector that fires on a *condition* will re-fire every poll for as long as the condition holds. Every alert needs: first-seen timestamp, occurrence counter, and a re-alert policy (typically: alert on first detection, then silence until the condition *changes* — clears, escalates past a threshold, or crosses an age boundary). The dark-clock corollary: age is always computed from first-seen, never reset by re-detection — re-dating never hides rot.

### 5. No watchdog-of-watchdog stacks

One liveness anchor (a cheap heartbeat artifact every component touches — a file mtime, a DB row) plus one dead-man mechanism that fires when the anchor goes stale. If you find yourself writing a monitor for the monitor, the design is wrong; make the primary anchor cheaper and more honest instead. Every layer you add is a new component that can wedge, and the stack's failure modes multiply.

### 6. Resurrect-else-reap, as an explicit two-step

When a component is detected dead: try to resurrect it once; if resurrection fails, clean up the corpse (release its claims, mark its work re-dispatchable, remove its liveness artifacts) so the system converges instead of accumulating zombies. The two steps are distinct states, logged distinctly. (Corroborated independently by Dan Lorenc's [multiclaude](https://dlorenc.medium.com/a-gentle-introduction-to-multiclaude-36491514ba89) daemon design — health-check/resurrect/reap on a fixed cadence.)

### 7. Every detector ships with a kill-switch

One env var (`X_DISABLED=1`) checked at the top. When a detector misbehaves in production, the operator turns it off in seconds without a deploy, and the switch's existence makes shipping detectors *less* risky, so more of them ship.

### 8. Distrust the measurement before the system

A zero from a probe means one of: a real zero, a dead instrument, or a misconfigured probe (reading a field that doesn't exist). Classify explicitly — "a `0` read from an ABSENT field is probe-misconfigured, never an outage." At low volume, treat surprising readings as evidence about the *instrument* first and the system second. Most of our worst diagnostic detours started by trusting a broken measurement.

## The shape of a detector module

Pure function core (inputs in, findings out, no I/O) + a thin CLI wrapper that does the reading and exits with a distinct code per outcome (0 clean / 3 findings / 4 probe-blind). The pure core gets unit tests, including tests that *malformed input produces no finding* — the fail-soft posture is itself tested behavior, not a comment.

`lib/snippet-redact.mjs` and `lib/memory-integrity.mjs` in this repo are working examples of the shape.
