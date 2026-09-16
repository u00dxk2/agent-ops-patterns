# Ops snapshot - 2026-09-16

The README used to open by telling you I run a large multi-agent system. That's an
unauditable testimonial, so I softened it. This file is the other half of the fix: the
numbers I can actually produce, roughly how each was measured, and an honest list of the
ones I can't.

Read the "how" column as an abbreviated description, not a reproduction recipe. Some
entries really are the command; others name a file listing whose count I then took, or
an authenticated API call against a moving window. Every row carries its query bounds.
The file counts and the test row also carry the source revision they were read at; the
bus rows cannot, and carry their query clock plus the deployment note below instead.
The previous revision named one thing still
missing - the deployed server revision behind the bus numbers - and this one gets closer
without quite closing it. The deploy record, read minutes after the last query, showed
production running `7aea546d`, then the branch head; that commit was made at
2026-09-16T15:21Z, before the first query at 15:56Z. What I did not do is capture the
revision at query time, so a deploy landing during the measurement interval would not be
visible here. Read it as "the build serving afterwards, whose commit predates the
queries," not as proof that one build served them all. A stranger
could re-derive the file counts and the test row from what is written here, and could
re-run the bus queries against a different window but not this one.

It's a snapshot with a date on it, not a live dashboard. A number on a page that nobody
re-measures becomes a lie on a schedule. This is the third measurement; the first was
2026-08-16 and the second 2026-08-29, and the deltas are in the table because a rate is
more informative than a level.

## What I can show

| Number | What it is | How it was measured (abbreviated) |
| --- | --- | --- |
| **13,004** unit tests passing, 17 skipped, in 435 files | The code that runs the fleet, not this repo. Was 7,076 in 273 files on 8/29 and 5,186 in 257 on 8/16 | `Verify` CI run `35106222446` at `7b55f1d2` (main), finished 2026-09-16T14:15:35Z: `npm run test:unit` → `Tests 13004 passed \| 17 skipped (13021)`, `Test Files 434 passed \| 1 skipped (435)` |
| **156** check scripts | Standalone detectors with a pass/fail verdict. Was 114 | `git ls-tree --name-only 7b55f1d2 scripts/`, names matching `check-*.mjs` |
| **289** shared libraries | The `cc-*` primitives those detectors are built from. Was 203 | `git ls-tree --name-only 7b55f1d2 src/lib/`, names starting `cc-`; none of them is a test file |
| **1,125** agent messages in 24 hours | Traffic on the Postgres bus the agents coordinate over - a Wednesday. The 8/29 row was 340 on a Saturday; the Friday before it, 845 | `GET /api/cc/agent-msg?since=2026-09-15T15:56:40Z&limit=1` → `matchedCount`, queried 2026-09-16T15:56:40Z |
| **4,816** agent messages in 7 days | Same endpoint, wider window (~688/day). Was 4,332 | as above, `since=2026-09-09T15:56:40Z`; the response carries no `servedSince`, so the read reached past the window start and this is a count. A re-read about a minute later returned 4,818 - the window was still filling |
| **24** distinct projects posting to the bus in 7 days | Was 26 | `GET /api/cc/agent-msg?summary=1&windowHours=168` (no `limit`), response `ts` 2026-09-16T15:58:01Z, so the server's window starts 2026-09-09T15:58:01Z → 24 rows, `truncated: false`, no `servedSince`; every row's newest post is inside that window (the oldest of them 2026-09-16T14:49Z); one of the 24 is this repo. Why 24 is complete, not just 24 found: see below |

Two of those rows had their method checked rather than assumed, because a count that
moves this much is more likely to be a changed ruler than a changed world.

**The file counts reproduce.** Run at `bd1ab42f` - the revision the 8/29 snapshot used -
the same two `git ls-tree` commands return 114 and 203, the published numbers, exactly.
So 156 and 289 are growth, not a different way of counting.

**The test count is the same scope.** Tests nearly doubled in eighteen days, which is the
shape of a widened glob. It isn't one: `test:unit` is still `vitest run`, and between
`bd1ab42f` and `7b55f1d2` the vitest config's `include` patterns are unchanged - the only
edit raised the per-test timeout. The count was again taken from CI, not a local run,
because the suite writes fixtures and I did not want to run it inside a working tree
other sessions were using. The 8/29 revision said its 10 skips were platform-gated by
design; the 17 here were not re-examined, so that sentence is not extended to them.

## The second cap, now declared

The 8/29 revision found a cap nobody had declared. The endpoint read the newest 5,000
messages from the last 14 days, counted matches over that read, and said nothing about
the read being clipped: a 10-day and a 14-day query both answered `matchedCount: 5000,
truncated: false`. Any window wider than about eight days got a confident number that
was really a floor.

It was fixed the same day, in the fleet's own code (`7895b2b5c`, an ancestor of the
deployed `7aea546d`). Today's 10-day probe - `since=2026-09-06T15:56:40Z&limit=1`,
queried 2026-09-16T15:56:40Z, and re-read about eighty seconds later to capture the
response text verbatim - answers:

> `matchedCount: 5000`, `truncated: true`, `servedSince: 2026-09-08T23:22:49.155Z`, and
> "The underlying bus read clipped BEFORE matching (read-limit; v1 window 14d, LIMIT 5000) -
> the served window starts 2026-09-08T23:22:49.155Z, not the window asked for;
> matchedCount 5000 counts the served rows only."

That is the sentence the fix exists to produce, read off production rather than a test.

Two things about it matter for anyone re-running these queries.

**`truncated` alone no longer tells you which cap bit.** The three message-count queries
(24 hours, 7 days, and the 10-day probe) send `limit=1`, so every one of those responses
is page-capped and says `truncated: true`. The field that separates "the page was short"
from "the read was clipped" is `servedSince`: absent on a count, present on a floor. A
reader who keys on `truncated` would call the 24-hour and 7-day rows floors.

**The project count is judged differently, and that is what makes it a count.** The
summary query sends no `limit`; it returns one row per project over the whole 5,000-row
read. Rows present only proves those projects posted. What proves none are missing is
the server's own clip judgment. For this shape it is made against `windowHours`, and at
168 hours it answered `truncated: false` with no `servedSince`: the read reached back past
the window start, so a project that posted in the window is in the read. The 7-day message
query agrees independently - no `servedSince` there either. One boundary: the summary
groups agent posts, and skips rows a person typed into the bus, so a project whose only
activity in the week was a human message would not be counted.

**The cap is now within a day of the 7-day row.** Traffic rose, so 5,000 messages now
reach back 7 days 16.6 hours instead of about eight days - measured from that probe's
served floor (2026-09-08T23:22:49Z) to the 15:56:40Z query clock the whole sweep shares.
The floor slides forward as rows land: the same probe eighty seconds earlier put it at
23:22:08Z. So the 7-day count holds by a margin of roughly 16.6 hours.

Which way that margin moves is worth being careful about, because the obvious reading is
wrong. Over those eighty seconds the floor advanced about 41 seconds - but a rolling
7-day window's start advanced the full 80, so headroom grew by roughly 39 seconds, not
shrank. Headroom for a *rolling* window only shrinks when messages arrive fast enough
that 5,000 of them span less time than before; two readings 80 seconds apart say nothing
about that trend. What does lose coverage as the floor advances is a *fixed* window - the
one published above. The conditional is the honest form: if the message rate keeps rising,
a future 7-day query will be answered from a clipped read, and the response will say so. If the rate keeps climbing, the next measurement may not be able
to publish a 7-day message count at all - and the response will say so, which is the
difference between this revision and the last one.

## What I got wrong, and what's actually missing

(Unchanged since the 2026-08-16 revision. Nothing in this section was re-measured, and
whether the two missing instruments exist yet was not checked this time either.)

I was asked to publish daily active users across the portfolio, retention for one app,
and churn for another. I went to check, got the first answer badly wrong, and was
corrected within the hour by the person who knows what we've been instrumenting.

**Correction, same day.** The first version of this section said only 2 of 20 products had
a live user read, and that portfolio-wide daily actives were therefore unpublishable. That
was wrong, and the way it was wrong is worth more than the number.

I checked one endpoint - the one that measures "distinct users taking a custom product
action," with pageviews and passive events deliberately excluded - saw that most rows were
hand-reported, and concluded we couldn't measure active users. But that endpoint answers a
deliberately harder question than "who showed up." The analytics instruments were live the
whole time. **Eleven products report daily and weekly actives on demand**, and one reports
a separate product-telemetry stream measuring roughly a thousand users a day.

So the failure wasn't a missing instrument. It was reading an instrument that answers a
different question and treating its silence as the absence of data. That's a mistake with
a name in my own notes, and I made it anyway, in a file whose entire purpose is publishing
numbers honestly. Which is roughly the point of the exercise.

**What is still genuinely missing, and it isn't daily actives.** Retention for one app and
churn for the newsletter - both *different metrics* from active users, both defined, and
neither wired up. Standing those instruments up is the honest move there; publishing an
active-user count next to the word "retention" is not.

**One number I won't publish even though I have it.** Two of the eleven report zero daily
actives against healthy weekly numbers - one shows 0 today against 846 for the week. That
is either a real usage pattern or a broken daily query, and I don't currently know which.
A zero from an instrument is a claim about the instrument until you've checked it.

## Why this file exists

Every number above is operational - how much machinery runs, how much traffic it carries,
how much of it is tested. None of it is a business metric, and that's deliberate: the
claim this repo makes is "these patterns come from a system that actually runs," and
operational numbers are the ones that bear on that claim. Revenue and user counts answer
a different question, one this repo isn't asking you to believe.

Re-measure date: whenever the next real change lands. If you're reading this months
later and it hasn't moved, treat it as stale - that's what the date is for. The second
measurement found a cap that wasn't declared; the third found it declared, and found the
published 7-day window sitting about 17 hours inside it. Neither would have shown up in a
number nobody re-ran.
