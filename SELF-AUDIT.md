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
> - At the end, give me a score out of five and the single highest-leverage fix,
>   with the smallest change that would move one FAIL to a PASS.
>
> **Question 1 - what comes back when you search my history for secrets?**
> Search my agent's stored conversations, memory, and logs for the shapes of live
> credentials: `sk-`, `AKIA`, `ghp_`, `postgres://`, `-----BEGIN`, `xox`, JWTs.
> Report the count and the shapes, never the values. Then find the code on the recall
> path - search, quote, excerpt, memory read - and tell me whether anything redacts at
> the moment of recall. Index-time scrubbing does not count: the store is already
> dirty and you cannot clean it retroactively.
>
> **Question 2 - which of my health checks has never been seen red?**
> List every check, monitor, watchdog, or gate in this system. For each: is there
> evidence it has ever failed - a test that exercises the failure branch, a logged
> incident, a fixture with bad input? A check that has only ever been green is a
> status light, not a check. Also flag any check that makes an LLM call, and say what
> a counter and a timestamp would do instead.
>
> **Question 3 - what happens to "stale" after a bulk edit?**
> Find how this system decides something is stale, out of date, or needs attention.
> Then answer: if a migration or a script touched every record tonight, would every
> freshness clock reset? Show me the field the staleness calculation actually reads.
>
> **Question 4 - what did my last "yes" actually authorize?**
> Find the permission or approval mechanism. For any grant, allowlist, or approved
> action, tell me: does it name one specific action or a category? Does it expire?
> Can it be used twice? And - the one people miss - between the check and the
> execution, can the thing being executed change?
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

For each FAIL, there's a file in this repo you can vendor. One file, no dependencies,
no framework:

| If you failed | Vendor this | What it does |
| --- | --- | --- |
| Question 1 | [`lib/snippet-redact.mjs`](./lib/snippet-redact.mjs) or [`lib/secret_redaction.py`](./lib/secret_redaction.py) | Redacts secret shapes at the recall boundary, with named placeholders so hits stay findable |
| Question 2 | [`patterns/checks-that-cant-fail.md`](./patterns/checks-that-cant-fail.md) and [`patterns/fail-soft-detectors.md`](./patterns/fail-soft-detectors.md) | How to prove a check can go red, and why the watchdog shouldn't call a model |
| Question 3 | [`lib/stale-basis.mjs`](./lib/stale-basis.mjs) | A staleness basis that a bulk write cannot reset |
| Question 4 | [`lib/capability-grant.mjs`](./lib/capability-grant.mjs) and [`patterns/durability-tiered-write-governance.md`](./patterns/durability-tiered-write-governance.md) | One action, byte-matched, single-use, expiring - and gate by how hard the write is to undo |
| Question 5 | [`lib/memory-integrity.mjs`](./lib/memory-integrity.mjs) and [`lib/memory-usage-ledger.mjs`](./lib/memory-usage-ledger.mjs) | Lint memory for duplicates, contradictions and dead links; score entries by whether anything ever reads them |

Read the limits section in the README before you trust any of it. Every file here says
where it stops working, and those sentences are the ones I'd read first if I were you.

## If the audit finds something we got wrong

Open an issue. That's more useful to me than a star, and considerably more useful than
agreement. If your agent finds a hole in one of these files, I want to know - the whole
value of a small vendored file is that it's small enough to actually be checked.
