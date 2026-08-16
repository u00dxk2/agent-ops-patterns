# Checks that can't fail: a green check nobody has seen go red is not evidence

The most dangerous line in an agent-ops system is a health check that has always been green. Not because green is a lie — because you have no idea whether it *can* be red. A check that has never fired is not passing; it is unfalsified. And in a system where an LLM reads that green as "all clear" and moves on, an unfalsifiable check is worse than no check: it manufactures confidence you didn't earn.

This pattern is the discipline that separates a check that ran from a check that only *looks* like it ran. It comes from a system running dozens of concurrent Claude Code agent sessions across a 22-product portfolio, where every one of the four failure modes below shipped a false "clean" to a human or an agent before we built the guard against it.

The unifying thesis: **a check that didn't really run is byte-for-byte indistinguishable from a check that passed — unless you engineer the difference in.** All four modes are the same bug wearing different clothes.

## The four modes

### 1. The green check nobody has ever seen go red

A monitor watches a condition. It has reported green every day since it shipped. Is the condition healthy, or is the monitor *incapable of reporting red* — wrong field, wrong scope, a threshold that can't be crossed, an exception swallowed three frames down?

You cannot tell from the green. The only evidence that a check works is having watched it go red on an input you know is bad.

**The guard:** every read-state check owes three things before its green counts as evidence — a written `redCondition` (what input *should* make it fire), a `redProvenAt` (the timestamp you deliberately fed it that input and watched it go red), and the `redProof` (what you saw). If you cannot make a check go red, that inability *is the finding* — you have discovered the check is decorative, and you found it before it cost you.

This is [mutation testing](https://en.wikipedia.org/wiki/Mutation_testing)'s logic applied to operations: a test suite that no injected fault can kill is not testing anything, and the professional response is to measure that directly rather than trust coverage. A green check with no `redProvenAt` is an unkilled mutant.

### 2. The zero that's a finding vs. the zero from a dead instrument

A probe queries for a problem and returns nothing. "Zero open issues." "No secrets found." "No stale rows." Three different things produce that identical output: a genuine zero, a dead instrument (the query errored and the catch returned `[]`), and a misconfigured probe (querying a field, path, or scope that doesn't exist, so the result is *always* empty).

The empty result reads as good news on every one of them.

**The guard — a positive control before you trust a negative.** Borrowed straight from the lab: you do not trust a test that came back negative until the *positive control* came back positive on the same run. A probe's zero is not reportable until the probe has returned non-empty on a case *known to be true*. Point the secret-scanner at a file with a planted fake secret; if it doesn't flag that, its clean report on everything else is worthless. Query the metric for a date you *know* had traffic before you believe the zero for today. Make asserting an absence require a passing positive control in the same code path, and the dead-instrument zero stops masquerading as the healthy zero.

### 3. The sweep that matched nothing because it couldn't reach anything

A search returns no hits. But "searched the target and found nothing" and "the search never reached the target" produce the same empty set — and the second is not a clean bill of health, it is a broken tool reporting success.

The canonical instance, which cost us real time: a credential search scoped by file *inclusion* pattern — `--include=*.ts`, or a glob of source extensions. It comes back clean. It came back clean because `.env` has no extension, and neither do `.npmrc`, `.pgpass`, `id_rsa`, or `credentials` — the exact files most likely to hold a secret were unreachable by construction. The sweep answered a question ("are there secrets in TypeScript files") that nobody asked, wearing the mask of the question everyone cared about.

**The guard:** a check that swept zero targets must report **NOTHING SWEPT**, never "clean" — they are different verdicts and only one of them is reassuring. Count what you actually reached (files opened, projects enumerated, rows scanned) and surface that count in the result. Zero reached is a probe failure to escalate, not a pass. Search by content across the whole tree and exclude by explicit path (`.git/`, `node_modules/`); never define your search by an inclusion pattern that silently amputates the riskiest inputs.

### 4. The check disabled by an absent config

A check reads a threshold or an enable-flag from config. The config key is missing. The check treats "missing" as "off" (or as a default that can never trip) and returns clean — silently, forever, until someone notices a whole category of findings stopped arriving.

We ran a linter that was dark for two weeks this way: an override field was absent, the absent value fell through to a branch that disabled the rule, and every run reported clean. Nobody saw it stop, because a check that stops looks exactly like a check that has nothing to report.

**The guard:** an absent config must never *quietly* clobber a check into passivity. Either fail loud (the check refuses to run and says why) or default to the *active* posture (missing threshold → strictest, missing flag → enabled), so the failure of omission surfaces as noise rather than silence. Whichever you choose, write a test that feeds the check an *empty* config and asserts it either fires or errors — never that it passes.

## The one-line test for all four

Before you trust any check's green, ask: **"When did I last see this go red, and if never, can I make it?"**

If the answer is "I've never seen it red and I don't know how to make it red," you do not have a passing check. You have an untested assertion with a status light bolted on. The fix is never a better green — it is a demonstrated red.

## Relationship to fail-soft

This looks like it contradicts [fail-soft detectors](./fail-soft-detectors.md) (§2: "any ambiguity resolves to NO finding"), and the tension is worth naming. Fail-soft governs what a *detector* does with a genuinely ambiguous input at runtime — bias to silence so you don't burn the operator's trust budget on false alarms. This pattern governs what *you* do before trusting a detector's silence at all. Fail-soft says: when unsure, don't cry wolf. This says: before you believe there are no wolves, prove your wolf-detector can see a wolf. A fail-soft detector whose "no finding" has never been shown to be capable of becoming a finding is the exact trap above — a fail-soft posture is a license for silence, and silence is only trustworthy from an instrument proven able to speak.
