# Claims are hypotheses: the premise, the "done", the remembered rule, and the review

Much of what an agent acts on is a sentence somebody else wrote. A plan says the bug reproduces. A task board says the setup is done. A prompt says the rule is X. A reviewer says the fix is wrong. Each one arrives looking like a fact. Each one is a claim, and in an agent operation a claim can travel further than its evidence: it gets copied into the next prompt, summarized into memory, and acted on by a session that never saw where it came from.

This pattern names four places where that happens and gives each one a guard you can copy tonight. Its twin is [checks-that-cant-fail](./checks-that-cant-fail.md), which covers the same failure on the *instrument* side: a check that has never gone red, and a zero that names no search space. This file covers the *text* side: sentences that are trusted because of who wrote them, not because anyone re-ran them.

Every incident below is real and comes from a written record. They come from one operation running many concurrent Claude Code sessions, and they are described without naming it.

## 1. Check the change against the code it cites, before you build

A plan rests on a premise: *this command fails*, *that file says X*, *users hit this screen*. If the premise is wrong, everything built on it is a well-made answer to the wrong question. Before the first commit is a cheap time to find out, and re-running the premise, not re-reading it, is a cheap way.

**Incident (2026-09-29).** A plan to fix a README quickstart said its reproduction "exits 0 inside a clone". A reviewer read the plan before the first implementation commit (an uncommitted test draft existed) and marked one line as a hypothesis: the clone used for that run had a folder copied into it by hand. Measured on a fresh clone, the quickstart crashed (`ENOENT`, exit 1). The shipped fix covered both failures ([968cd96](https://github.com/u00dxk2/agent-ops-patterns/commit/968cd96)). Without the review it would have fixed the prose and left the crash.

The same day, across the rest of that operation, six separate work streams reported that a lead or a manual walk-through had asserted something the product did not do. One read prices off the neighbouring card. One tested a phone layout at phone width but without touch input. One counted "5 real starts" that were 1 readable start out of 9.

**The guard.** Put a premise block at the top of the plan and fill it before any edit:

```
PREMISE CHECK (before any edit)
- claim:    <the one sentence this plan rests on>
- cited at: <file:line, URL, or the command that showed it>
- re-run:   <the command, run fresh, from the state a user would be in>
- output:   <pasted, not summarized>
- verdict:  HOLDS | FALSE | NOT CHECKABLE (<why>)
```

A premise marked `NOT CHECKABLE` is not built on. When someone else reviews the plan, they tag each point `OBSERVED` (they ran or read it) or `HYPOTHESIS` (it needs checking). The author measures every `HYPOTHESIS` before acting on it, because a reviewer can be wrong too. "From the state a user would be in" matters: in the incident above, the premise was re-run, but in a populated directory that a fresh clone does not have.

## 2. A "done" is a claim that something happened

A checked box records that someone *did* something. It does not record that the thing *took effect*. The gap is easy to miss when the person who did the work cannot see the effect: a setting changed in a dashboard, a DNS record added, an environment variable set on a host.

**Incident (2026-09-29).** Two setup tasks were marked done, pending verification. Re-running each one's check told a different story. An analytics probe for the first task's intended outcome still answered that the event existed but had no such property. For an email-routing task, no MX records existed at the read. Neither task's intended outcome was verified.

**Incident (same day, another team).** A memory limit was set as an environment variable to stop a job crashing. Read back, the setting was present. The next crash showed the same memory ceiling as before. The setting was real and it did nothing, and it was the failure's own output that showed it.

**The guard.** Make "done" two fields, not one, and let only the second close the task:

```
status:        open | claimed | verified
claimedBy/At:  <who, when>              # what the checkbox used to mean
verifyCommand: <the read of the EFFECT> # the failing query, the error, the metric
verifyOutput:  <pasted>
verifiedAt:    <when>                   # only this closes the task
```

The verify command reads the *failure's own output*: the error message, the missing record, the crash's number. It does not read back the setting that was supposed to fix it. A read-back proves the setting was saved. It says nothing about whether anything uses it.

## 3. A remembered rule is a claim about what someone said

An operation's standing rules — what needs approval, what never ships, what a human ruled last week — have to reach every session. The easy carriers are memory files, summaries and prompt paraphrases, and each one can rewrite the rule a little. After a few hops the rule a session obeys may not be the rule anyone made.

**Incident (2026-09-05).** A pre-flight checklist that every session was told to run lived inside a file only the coordinating session loaded, so the others could not read the checklist they were told to run. It was moved into one tracked file, and the tool that sends each session its instructions now builds the checklist index from that file at send time.

**Incident (2026-09-14).** A setup instruction said a required argument had a default. Run as written, the command refused to start with exit code 2. A session that followed the text started no watchdog at all, and the only sign was that exit code, in a background task, during start-up.

**Incident (2026-09-17).** A coordinating agent's *proposal* was quoted as the human owner's rule within two hand-offs.

**The guard.** Three parts, each small:

1. **One tracked file holds the rules.** Every prompt that carries them carries a content hash, and a session can recompute it (`sha256` of the file's rules block). A mismatch means the copy differs from the file: it is stale, or the file was edited since, or something else changed it. Either way, stop and re-read.
2. **Human rulings are stored verbatim, dated, with their source:**

   ```
   ## Ruling <date> <time, with zone> — <topic>
   Quote (verbatim): "<exactly what was said>"
   Source: <where it was said>
   Applies to: <item ids>
   ```

   Anything written in a person's name either quotes this file or is labelled `PROPOSAL`.
3. **Every command in a rule is run before the rule ships.** A rule that tells a session to run something is code, and it gets the same test code gets: run it as written, paste the output.

## 4. Review risky changes with the other model family

A second pass by the same model, even in a fresh context, shares more with the author than a different reviewer would: the same training, the same habits, the same way of reading the author's framing. A reviewer from a different model family is a cheap source of a different reading. This is a working bet, not a measurement: the incidents below show it finding real defects, not a controlled comparison.

**Incident (this repository).** An analysis of a large open-source agent framework was checked the same day by a reviewer from the other model family. It returned fourteen findings, five at P0, and two of the analysis's verdicts fell. The corrected record keeps the original wrong rows, quoted: [worked-example-2](../skills/cs329a-self-improving-agents/references/answer-keys/worked-example-2.md).

**Incident (2026-09-29, this repository).** The other-family review of the quickstart fix above found that its test's README extraction was not bounded to the quickstart section. That was fixed ([7e04d01](https://github.com/u00dxk2/agent-ops-patterns/commit/7e04d01)). A second finding asked for an error on one path to be softened, and it was rejected on purpose: the loud failure was the behaviour wanted.

**The guard.** Decide the scope first: changes touching money, auth, stored data or migrations, secrets, anything published under a person's name, or anything that arms production. Then use a review prompt with these parts:

```
You are reviewing <commit sha> against <merge-base sha>. Read-only.
The contract this change must meet, VERBATIM (not paraphrased):
  <quote>
Deliberately out of scope (do not rate these as defects): <list>
For each finding give: file:line, the failure scenario, and one tag:
  REPRODUCED (you ran it) | SUPPLIED (you relied on a number you could not re-run) | STATIC (read only)
```

The author then gives every finding a disposition *before changing anything*: `CONFIRMED`, `REFUTED`, `DELIBERATE` or `PLAUSIBLE`, each checked against the source. A reviewer's fix is a hypothesis too (section 1).

Two mechanical checks go with it. Run the reviewer read-only, because a reviewer that can write can change what it is judging. And check which directory the reviewer actually opened before reading a single finding. On 2026-09-15 a review launched for one checkout came back having reviewed another checkout, running another session's prompt, and it read as confident as a correct one.

## Limits

- **A premise check proves the premise at one moment, from one state.** A premise that held this morning can be false by the afternoon, and "the state a user would be in" is itself a guess. Re-run it whenever the plan is picked up again, not only when it is written.
- **`verified` is only as good as the verify command.** A command that reads the wrong thing verifies the wrong thing, and it will do so every time. Choosing it is judgment, and this pattern does not supply the judgment.
- **A hash proves the copy, not the rule.** A session holding the byte-exact rules file can still misapply it. And a rules file that grows without pruning can become one nobody reads, which is the memory problem again with better bookkeeping.
- **Cross-family review is not independence.** Different families can still agree on the same wrong thing. A reviewer that does not know what you left out on purpose will over-rate it: one finding was rated HIGH, and its fix needed a credential the team had deliberately chosen not to hold. Treat the review as a second reading, not as ground truth.
- **All four guards cost time on every change.** On a change whose failure is cheap, loud and quickly noticed, the premise block and the second-family review can cost more than the bug they prevent. Spend them where a wrong claim would travel.
- **When the same finding class comes back in a second review round, stop patching.** Change the shape of the code or the claim instead. This pattern does not tell you what the new shape is.
