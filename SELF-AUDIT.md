# The five-question self-audit

Hand this file to your agent. Ask it to run the audit on your setup and report back.

That's the whole idea. You have an agent sitting right there with read access to your
own system - it can answer these questions about your setup far faster than you can,
and it has no reason to flatter you if you tell it not to. I can't audit your system.
It can.

Copy the prompt below, or just point your agent at this file's URL and say "run this."

---

## The prompt

> Run the five-question agent-ops self-audit on this system. For each question:
> find the actual code or config that answers it, quote it with a file path, and give
> a verdict of PASS, FAIL, or CAN'T TELL.
>
> Rules for you, the auditing agent:
> - Never guess. If you cannot find the code, the verdict is CAN'T TELL, and that is
>   a useful answer - say what you looked for and where you looked.
> - Do not grade generously. A partial mitigation is a FAIL with a note, not a PASS.
> - Quote real lines. Do not paraphrase code into existence.
> - At the end, score it: **one point per question that is a clean PASS**, out of
>   five. A CAN'T TELL scores zero and is reported as a coverage gap, not rounded
>   toward either verdict. Then name the single highest-leverage fix, with the
>   smallest change that would move one FAIL to a PASS.
>
> **Question 1 - what comes back when you search my history for secrets?**
> **Read this constraint before you run anything.** Do not print, quote, echo or
> otherwise bring a matched value into your own context. Use a command that emits
> only counts and shape names - `grep -c`, or `grep -o` piped through a classifier
> you write - never one that prints matching lines. A raw credential in an audit
> transcript is the exact failure this question is about, and pasting one here
> would mean the audit caused it.
>
> With that constraint: enumerate every store the agent can recall from -
> conversations, memory files, logs, vector indexes, caches - and count matches for
> credential shapes (`sk-`, `AKIA`, `ghp_`, `postgres://`, `-----BEGIN`, `xox`,
> JWTs). Then enumerate **every** path that can return their contents: search,
> quote, excerpt, memory read, error messages, debug dumps. PASS only if redaction
> is applied at the final boundary of **every** in-scope path - one protected path
> is not a pass. Report any store you could not reach as a coverage gap, not as
> clean. Note also that a shape match does not mean the credential is live; treat
> the count as an upper bound on exposure, not a confirmed breach.
>
> Index-time scrubbing does not count: the store is already dirty and you cannot
> clean it retroactively.
>
> **Question 2 - which of my health checks has never been seen red?**
> List every check, monitor, watchdog, or gate in this system. For each, report two
> things separately, because they fail independently:
> - **Code-path red proof** - a test exercising the failure branch, a fixture with
>   bad input, a logged incident.
> - **Operational red proof** - is the deployed check actually invoked on a
>   schedule, over the subjects you think it covers, under the configuration you
>   think it uses, and does a known-red result reach a human through the real
>   reporting path? Report expected / reached / skipped / errored subject counts.
>
> A unit fixture proves a function *can* return red. It says nothing about whether
> the thing is wired up, which is how an unscheduled monitor passes an audit. Both
> must be true. Also flag any check that makes an LLM call, and say what a counter
> and a timestamp would do instead.
>
> **Question 3 - what happens to "stale" after a bulk edit?**
> Find how this system decides something is stale, out of date, or needs attention.
> Then answer: if a migration or a script touched every record tonight, would every
> freshness clock reset? Show me the field the staleness calculation actually reads.
>
> **Question 4 - what did my last "yes" actually authorize?**
> Find the permission or approval mechanism. For any grant, allowlist, or approved
> action: does it name one specific action or a category? Does it expire? Can it be
> used twice? And - the one people miss - between the check and the execution, can
> the thing being executed change?
>
> Those four can all answer well while the whole mechanism is bypassable, so do not
> PASS on them alone. Also establish: every gated execution path must go **through**
> the hook with no way around it; the agent cannot mint, edit, replay or delete its
> own grants or the policy and audit records; the human who approved is
> authenticated **and** authorized to approve that class; consumption is atomic
> before execution; the value that was checked is the value that runs; and the
> mutable context around it - working directory, PATH, environment, the shell, the
> files it reads - is either bound into the approval or independently trusted. A
> command hash does not bind a command's *effect* when any of those can change
> underneath it.
>
> **Question 5 - who checks the agent's memory for rot?**
> Find where this agent stores what it remembers. Is anything linting it? Look for
> duplicate facts, entries that contradict each other, links to files that no longer
> exist, and memories whose subject was deleted months ago. If nothing lints it, say
> so plainly.

---

## What to do with the answer

You'll get a score. Mine was not five out of five - I ran this against the repo you're
reading and it came back with two blockers, one of which was a genuine hole in the
permission library, the artifact whose entire job is Question 4. Both are fixed now
and both fixes are in the git history. That's not a confession, it's the point: the
audit is worth running because it finds things, and it found things in the system
written by the person who wrote the audit.

For each area there is reference logic or a written protocol here that may help. Be
clear-eyed about what that buys you: **none of these mappings turns a FAIL into a PASS on
its own.** Question 1 needs the matcher wired at *every* recall boundary, not vendored
once. Question 2 maps to protocols, not to code you can drop in. Question 4 needs the
trusted integration listed in the README - the library is the smallest part of it.
Question 5's linter finds dead links and orphans, not contradictions. One file, no
dependencies, no framework, and no illusion that the file is the fix:

| If you failed | Vendor this | What it does |
| --- | --- | --- |
| Question 1 | [`lib/snippet-redact.mjs`](./lib/snippet-redact.mjs) or [`lib/secret_redaction.py`](./lib/secret_redaction.py) | Redacts secret shapes at the recall boundary, with named placeholders so hits stay findable |
| Question 2 | [`patterns/checks-that-cant-fail.md`](./patterns/checks-that-cant-fail.md) and [`patterns/fail-soft-detectors.md`](./patterns/fail-soft-detectors.md) | How to prove a check can go red, and why the watchdog shouldn't call a model |
| Question 3 | [`lib/stale-basis.mjs`](./lib/stale-basis.mjs) | A staleness basis that a bulk write cannot reset |
| Question 4 | [`lib/capability-grant.mjs`](./lib/capability-grant.mjs) and [`patterns/durability-tiered-write-governance.md`](./patterns/durability-tiered-write-governance.md) | One action, byte-matched, single-use, expiring - and gate by how hard the write is to undo |
| Question 5 | [`lib/memory-integrity.mjs`](./lib/memory-integrity.mjs) and [`lib/memory-usage-ledger.mjs`](./lib/memory-usage-ledger.mjs) | Lint memory for dead links, orphaned files, duplicate targets and a blown load budget; score entries by whether anything ever reads them. Presence and references only - whether a memory is *true* stays human, so contradictions are not detected |

Read the limits section in the README before you trust any of it. Every file here says
where it stops working, and those sentences are the ones I'd read first if I were you.

## If the audit finds something we got wrong

Open an issue. That's more useful to me than a star, and considerably more useful than
agreement. If your agent finds a hole in one of these files, I want to know - the whole
value of a small vendored file is that it's small enough to actually be checked.
