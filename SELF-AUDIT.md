# The five-question self-audit

Hand this file to your agent. Ask it to run the audit on your setup and report back.

That's the whole idea. You have an agent sitting right there with read access to your
own system - it can answer these questions about your setup far faster than you can,
and it has no reason to flatter you if you tell it not to. I can't audit your system.
It can.

**What you get back.** Nothing on your system changes: the prompt tells your agent to install
nothing, change no files, and suggest tests rather than run them, and to count secret shapes
without printing any. For each of the five questions you get PASS, FAIL or CAN'T TELL, backed
by quoted lines with file paths (or, for CAN'T TELL, where it looked); then a score out of five
and the one smallest change that would move a FAIL to a PASS.

Copy the prompt below, or point your agent at this file's URL and say "run this."

**If you point it at the URL, have it read the raw file - a summary is not the prompt.**
Web-fetch tools that summarize pages drop and reword parts of this prompt, so the first step
is a plain download of the raw version of the URL you were given, which prints the exact text
and saves nothing (on `main`:
`curl -sL https://raw.githubusercontent.com/u00dxk2/agent-ops-patterns/main/SELF-AUDIT.md`; in
Windows PowerShell type `curl.exe`, because plain `curl` there is a different command). Then run
the section "The prompt" from that text. If your agent has no shell, paste the prompt below
into it instead.

---

## The prompt

```text
Run the five-question agent-ops self-audit on this system. For each question:
find the actual code or config that answers it, quote it with a file path, and give
a verdict of PASS, FAIL, or CAN'T TELL.

Rules for you, the auditing agent:
- Read-only. Install nothing, change no files, and suggest tests rather than
  running them.
- Never guess. If you cannot find the code, the verdict is CAN'T TELL, and that is
  a useful answer - say what you looked for and where you looked.
- Do not grade generously. A partial mitigation is a FAIL with a note, not a PASS.
- Quote real lines. Do not paraphrase code into existence.
- At the end, score it: **one point per question that is a clean PASS**, out of
  five. A CAN'T TELL scores zero and is reported as a coverage gap, not rounded
  toward either verdict. Then name the single highest-leverage fix, with the
  smallest change that would move one FAIL to a PASS.
- End your report with this line, exactly as written, so your human can share the
  score without sharing the system:
  `To report this score - verdicts only, no output, file paths or config: https://github.com/u00dxk2/agent-ops-patterns/issues/new?template=ran-the-audit.yml`
  Leave that line out only when you know the person who asked you for this audit
  does not maintain the system you audited: someone else's score is theirs to report.

**Before you start - say what you are looking at.** Open your report with one line:
`Auditing: a running install`, `Auditing: a source checkout`, or `Auditing: both`.
Source code alone does not establish what a store contains, what actually runs on
a schedule, or what reaches a human, so read every store, log and record you can
reach. That includes the stores of a running install you were asked to audit, even
outside the checkout. An unrelated install elsewhere on this machine is out of scope
unless the person who asked you includes it; a matching software or directory
name alone does not make an install part of the system you were asked about. Where you cannot reach a store's contents
after checking, count nothing and
do not report zero: name the store and report its contents as a coverage gap.
Source files, fixtures and docs are not stores merely because they are in the
checkout; include them when they hold agent memory or are configured as a recall
source. An established FAIL stays a FAIL even when other evidence is unavailable.
Otherwise, if evidence a PASS needs is unavailable, the verdict is CAN'T TELL: name
what is missing. One consequence, said here so it surprises nobody: Question 2
needs operational proof, so from source code alone it cannot be a PASS and the
most such an audit can score is four out of five. Say that next to the score.

**Question 1 - what comes back when you search my history for secrets?**
**Read this constraint before you run anything.** Do not print, quote, echo or
otherwise bring a matched value into your own context. Use a command that emits
only counts and shape names - `grep -E -o -e 'PATTERN' FILES | wc -l` or
`rg --count-matches -e 'PATTERN'` - never one that prints matching lines. Count
matches, not lines: `-c` counts matching lines, so a log line holding two keys
counts once. Plain `grep` without `-E` reads `{20,}` as literal text and counts
zero without an error. A raw credential in an audit
transcript is the exact failure this question is about, and pasting one here
would mean the audit caused it.

With that constraint: enumerate every store the agent can recall from -
conversations, memory files, logs, vector indexes, caches - and count matches for
credential shapes. Anchor each one, because a bare `sk-` also matches `task-` and
`risk-`: `\bsk-[A-Za-z0-9_-]{20,}`, `\bAKIA[0-9A-Z]{16}`, `\bgh[pousr]_[0-9A-Za-z]{36,}`,
a database URI carrying `user:password@`, `-----BEGIN [A-Z ]*PRIVATE KEY-----`,
`\bxox[baprs]-[0-9A-Za-z-]{10,}`, and JWTs
(`\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b`). The full list
is `SHAPES` in this audit's own repository, not in the system you are auditing:
[`lib/snippet-redact.mjs`](https://github.com/u00dxk2/agent-ops-patterns/blob/main/lib/snippet-redact.mjs).
Then enumerate
**every** path that can return their contents: search, quote, excerpt, memory read, error messages, debug dumps. PASS only if redaction
is applied at the final boundary of **every** in-scope path - one protected path
is not a pass. Report any store you could not reach as a coverage gap, not as
clean. Note also that a shape match does not mean the credential is live; treat
the count as an upper bound on exposure, not a confirmed breach.

Index-time scrubbing does not count: the store is already dirty and you cannot
clean it retroactively.

**Question 2 - which of my health checks has never been seen red?**
List every check, monitor, watchdog, or gate in this system. For each, report two
things separately, because they fail independently:
- **Code-path red proof** - a test exercising the failure branch, a fixture with
  bad input, a logged incident.
- **Operational red proof** - is the deployed check actually invoked on a
  schedule, over the subjects you think it covers, under the configuration you
  think it uses, and does a known-red result reach a human through the real
  reporting path? Report expected / reached / skipped / errored subject counts.

A unit fixture proves a function *can* return red. It says nothing about whether
the thing is wired up, which is how an unscheduled monitor passes an audit. Both
must be true. Also flag any check that makes an LLM call, and say what a counter
and a timestamp would do instead.

The verdict for this question, decided in this order:
1. FAIL if what you can read establishes that a check fails either requirement
   above - for example, it is never invoked, cannot go red (its failure is
   swallowed or forced to success), skips subjects it should cover, or never
   reports a red result to anyone.
2. FAIL if, for some check, you read all of its tests, fixtures and incident logs
   and none shows it going red. That is a finding, not a gap.
3. Otherwise CAN'T TELL if anything you needed could not be opened: tests in a
   private submodule or an unreadable part of the tree, logs you cannot reach, or
   the operational proof.
4. PASS only when every check has both kinds of proof.

**Question 3 - what happens to "stale" after a bulk edit?**
Find how this system decides something is stale, out of date, or needs attention.
Then answer: if a migration or a script touched every record tonight, would every
freshness clock reset? Show me the field the staleness calculation actually reads.

Systems usually have more than one clock, so list every one, with the field it
reads. Finish searching the code you can read before you give the verdict: do not
stop at the first clock that fails, and name any part you could not read. A clock
is code in the system itself that decides from a time something about records the
system keeps - memories, conversations or sessions, documents, logs, transcripts,
or entries in its own database or index, one at a time or in groups (a log
directory judged by its own timestamp counts): whether they are stale, expired or
due, or should be dropped, refreshed, re-checked, or picked to be shown. It counts
however it is triggered, an in-process timer included. These are not clocks for
this question: lock files and lock heartbeats; timeouts, throttles, rate limits
and retry backoff that control a process rather than decide about a record;
intermediate scratch files, build scratch, and caches that hold only a copy of data the system still
fetches or computes from its source, kept to avoid doing that again; and picking
which source items to re-read by comparing their change times with a sync cursor
kept only for that purpose (comparing with a record's own last-write time is a
clock). Sorting a complete result by time, with nothing dropped or hidden, is not
a clock either. Automation whose only job is maintaining the project's code
repository, such as a bot that closes old issues or pull requests, is out of
scope too. A clock
does not survive a bulk write if it reads a file's modification time or a
timestamp every write updates, even when a write is what it means to measure, or
if a missing or unreadable time makes a record look fresh or never stale.
Otherwise it survives only if the time it reads can be set by nothing but the
event it measures. If you find no clock at all, say where you looked: that is
CAN'T TELL, not a PASS. The verdict: PASS only if every clock you listed
survives. One clock that does not makes the question FAIL, however minor its job;
say what that clock controls in the note.

**Question 4 - what did my last "yes" actually authorize?**
Find every permission or approval mechanism - there can be more than one: a hook, a
per-tool check, an allowlist, a mode that skips asking. For any grant, allowlist, or
approved
action: does it name one specific action or a category? Does it expire? Can it be
used twice? And - the one people miss - between the check and the execution, can
the thing being executed change?

Those four can all answer well while the whole mechanism is bypassable, so do not
PASS on them alone. Also establish: every gated execution path must go **through**
its gate with no way around it; the agent cannot mint, edit, replay or delete its
own grants or the policy and audit records; the human who approved is
authenticated **and** authorized to approve that class; consumption is atomic
before execution; the value that was checked is the value that runs; and the
mutable context around it - working directory, PATH, environment, the shell, the
files it reads - is either bound into the approval or independently trusted. A
command hash does not bind a command's *effect* when any of those can change
underneath it.

**Question 5 - who checks the agent's memory for rot?**
Find where this agent stores what it remembers. Is anything linting it? Look for
duplicate facts, entries that contradict each other, links to files that no longer
exist, and memories whose subject was deleted months ago. If nothing lints it, say
so plainly.
```

---

## What to do with the answer

You'll get a score. Don't expect five out of five - the repo you're reading had a
genuine hole in the permission library, the artifact whose entire job is Question 4.
An adversarial review found it before I published, and it was fixed before this audit
was added to the repo; [the fix commit](https://github.com/u00dxk2/agent-ops-patterns/commit/792c788)
says how it was found. That's not a confession, it's the point: the hole sat in code
written by the person who wrote these questions until someone went looking for it.
Have your agent go looking.

For each area there is reference logic or a written protocol here that may help. Be
clear-eyed about what that buys you: **none of these mappings turns a FAIL into a PASS on
its own.** Question 1 needs the matcher wired at *every* recall boundary, not vendored
once. Question 2 maps to protocols, not to code you can drop in. Question 4 needs the
trusted integration listed in the [README](./README.md#capability-grant) - the library is
the smallest part of it.
Question 5's linter finds dead links and orphans, not contradictions. One file, no
dependencies, no framework, and no illusion that the file is the fix:

| If you failed | Vendor this | What it does |
| --- | --- | --- |
| Question 1 | [`lib/snippet-redact.mjs`](./lib/snippet-redact.mjs) or [`lib/secret_redaction.py`](./lib/secret_redaction.py) | Redacts secret shapes at the recall boundary, with named placeholders so hits stay findable |
| Question 2 | [`patterns/checks-that-cant-fail.md`](./patterns/checks-that-cant-fail.md) and [`patterns/fail-soft-detectors.md`](./patterns/fail-soft-detectors.md) | How to prove a check can go red, and why the watchdog shouldn't call a model |
| Question 3 | [`lib/stale-basis.mjs`](./lib/stale-basis.mjs) | A staleness basis that ignores bulk-write `updated` stamps by default, as long as you do not configure them as signals and your writers stamp the signal fields honestly |
| Question 4 | [`lib/capability-grant.mjs`](./lib/capability-grant.mjs) and [`patterns/durability-tiered-write-governance.md`](./patterns/durability-tiered-write-governance.md) | One action, byte-matched, single-use, expiring - and gate by how hard the write is to undo |
| Question 5 | [`lib/memory-integrity.mjs`](./lib/memory-integrity.mjs) and [`lib/memory-usage-ledger.mjs`](./lib/memory-usage-ledger.mjs) | Lint memory for dead links, orphaned files, duplicate targets and a blown load budget; score entries by whether anything ever reads them. Presence and references only - whether a memory is *true* stays human, so contradictions are not detected |

Read the [limits section in the README](./README.md#coverage-and-limits) before you trust
any of it. Every library here says where it stops working, and those sentences are the
ones I'd read first if I were you.

## Telling me what it found

Three kinds of answer, three different doors:

- **Your score** - [the "I ran the audit" form](https://github.com/u00dxk2/agent-ops-patterns/issues/new?template=ran-the-audit.yml).
  Verdicts only: the number, which questions failed, one sentence. Don't paste your
  agent's output, file paths, log lines or config - a public issue is exactly the kind
  of store Question 1 is about.
- **A hole in one of these files** - a library, this prompt, a skill, or a workflow -
  [report it privately](https://github.com/u00dxk2/agent-ops-patterns/security/advisories/new),
  not in a public issue. I want to know: the whole value of a small vendored file is that
  it's small enough to actually be checked. [SECURITY.md](./SECURITY.md) says honestly
  what happens next.
- **A disagreement with a protocol or a question** - [open an issue](https://github.com/u00dxk2/agent-ops-patterns/issues/new/choose).
  That's a conversation, not a vulnerability.

And if any of it was useful, star the repo or send it to someone running agents: that's
how the next person finds it.
