# Shadow-screen states: four verdicts for a gate, and a fifth for the gate that never ran

Most gates you put in front of agent actions - a security classifier, a policy regex, a quality judge - over-fire when they first ship, and you usually don't know the false-positive rate in advance. If you have a labeled replay set, run the gate over it offline first; that gives you a real estimate before anything reaches an operator. When you don't have one (the common case for a gate written this week about behavior nobody logged), the way to learn the rate without burning your operators' trust budget is to ship the gate *watching* before it ships *enforcing*: record what it would have done, let the action proceed, and read the log for a while.

That plan quietly fails if your gate's output is a boolean. "Blocked: false" is four different facts wearing one value — *the gate looked and found nothing*, *the gate found something but we're only watching*, *the gate is disabled*, and *the gate crashed*. When you later ask "is this gate ready to enforce?", a boolean log cannot answer, and the crashed-gate rows are sitting in your data disguised as clean ones.

## The vocabulary

Five verdicts. The first four are the mode × outcome grid; the fifth is the one that keeps the other four honest.

| | gate fired | gate quiet |
|---|---|---|
| **watching (shadow)** | `would_block` — recorded; action proceeds | `shadow_allow` — action proceeds |
| **enforcing** | `block` — action stopped | `allow` — action proceeds |

And separately, in either mode:

- **`unscreened`** — the screener never actually ran: unavailable, timed out, threw, returned garbage. Not `allow`. Not `shadow_allow`. Its own verdict, and one the caller must record on every attempted decision - the helper returns it and logs nothing, so an unscreened action that nobody wrote down is indistinguishable from one that was never attempted.

Credit: [yc-software/qm](https://github.com/yc-software/qm)'s security screen (`src/core/orchestrator/security-screen.ts`) ships exactly this vocabulary, and the explicit `unscreened` verdict is the reason to copy it rather than reinvent it. Most home-grown screens default the unavailable case to allow — usually not by decision, but because the `catch` block had to return *something* and `false` type-checked.

## Why `unscreened` is the load-bearing state

A screener that is down produces the same observable as a screener with nothing to report: silence. If silence maps to `allow`, an outage in your screening path reads as a run of perfectly clean actions — your gate can go dark for a month and the dashboard gets *greener*. This is the same failure family as [checks that can't fail](./checks-that-cant-fail.md) — the dead-instrument zero and the config-absent silent disable — arriving independently in a different codebase, which is the kind of convergence that tells you the pattern is real and not a house habit.

Two rules make the fifth state do its work:

1. **`unscreened` never counts as a pass.** Whatever tallies pass rates must exclude it (the helper's `isPass` refuses it). A rising `unscreened` count means your *screen* is dark, not that your fleet is clean — alert on it like the outage it is.
2. **In enforce mode, `unscreened` fails closed by default.** If you need fail-open (screening a path where availability beats screening), you declare it in code — `unscreenedProceeds: true` — where a reviewer can see the choice. The verdict still says `unscreened` either way; fail-open is a policy about *proceeding*, never evidence the screen looked.

## Reading a shadow window

The point of shadow mode is the promotion decision, and the vocabulary is what makes the log decidable:

- **`would_block` rows are your backtest.** Review them before enforcing — each one is either a true positive (the gate earns its keep) or a false positive (the gate would have burned trust). Promote to enforce only from a reviewed window, never from "it's been quiet."
- **`shadow_allow` without a proven red is not evidence.** A gate that never fired in shadow might be well-tuned, or might be incapable of firing — feed it a known-bad input and watch it produce `would_block` before you trust its quiet ([checks-that-cant-fail](./checks-that-cant-fail.md), mode 1).
- **`unscreened` rows in the window cap your confidence.** A shadow window that was 30% unscreened observed 70% of the traffic; say so in the promotion decision.

## The helper

[`lib/shadow-screen.mjs`](../lib/shadow-screen.mjs) is the vocabulary as a pure function: `screenDecision({mode, ran, flagged, unscreenedProceeds})` → `{verdict, proceed}`, plus `isPass(verdict)`. Deliberately small — it classifies one decision. Logging every verdict, aggregating the window, and actually wiring `proceed` to enforcement are yours, and the one failure it cannot see is the caller that computes `proceed` and ignores it: that is a shadow screen wearing an enforce label, and only a human reading the wiring catches it.
