# Ops snapshot - 2026-11-08

The README used to open by telling you I run a large multi-agent system. That's an
unauditable testimonial, so I softened it. This file is the other half of the fix: the
numbers I can actually produce, roughly how each was measured, and an honest list of the
ones I can't.

Read the "how" column as an abbreviated description, not a reproduction recipe. Some
entries really are the command; others name a file listing whose count I then took, or
an authenticated API call against a moving window. Every row carries its query bounds.
The file counts and the test row also carry the source revision they were read at. The
bus rows cannot, and carry their query clock instead. The last revision admitted it had not
captured the deployed server revision at query time. This one did: the same script read
`/api/cc/version` immediately before and immediately after the bus queries, and both reads
returned `d6fbf409`. A different reported revision still visible at the end of the sweep would now show.
A deploy and rollback between the two reads, or a redeploy of the same revision, would not. A stranger could re-derive the file counts
and the test row from what is written here, and could re-run the bus queries against a
different window but not this one.

It's a snapshot with a date on it, not a live dashboard. A number on a page that nobody
re-measures becomes a lie on a schedule. This is the fourth measurement, after 2026-08-16,
2026-08-29 and 2026-09-16, and the deltas are in the table because a rate is more informative
than a level.

## What I can show

| Number | What it is | How it was measured (abbreviated) |
| --- | --- | --- |
| **17,082** unit tests passing, 30 skipped, in 628 files | The code that runs the fleet, not this repo. Was 13,004 in 435 files on 9/16 | `Verify` CI run `42526315426` at `af4b0b53` (main), finished 2026-11-08T21:51:16Z: `npm run test:unit` → `Tests 17082 passed \| 30 skipped (17112)`, `Test Files 627 passed \| 1 skipped (628)` |
| **170** check scripts | Standalone detectors with a pass/fail verdict. Was 156 | `git ls-tree --name-only af4b0b53 scripts/`, kept where the name matches `^scripts/check-[^/]*\.mjs$` - top level only, non-recursive. A recursive count returns 171 |
| **369** shared libraries | The `cc-*` primitives those detectors are built from. Was 289 | `git ls-tree --name-only af4b0b53 src/lib/`, kept where the name matches `^src/lib/cc-` - top level only. None of them is a test file |
| **665** agent messages in 24 hours | Traffic on the Postgres bus the agents coordinate over, ending on a Sunday afternoon. The 9/16 row was 1,125 on a Wednesday | `GET /api/cc/agent-msg?since=2026-11-07T23:29:34Z&limit=1` → `matchedCount`, queried 2026-11-08T23:29:34Z |
| **3,633** agent messages in 7 days | Same endpoint, wider window (~519/day). Was 4,816 | as above, `since=2026-11-01T23:29:34Z`; the response carries no `servedSince`, so the read reached past the window start and this is a count. The same query four minutes earlier returned 3,634, which is what a rolling window does |
| **25** distinct projects posting to the bus in 7 days | Was 24 | `GET /api/cc/agent-msg?summary=1&windowHours=168` (no `limit`), response `ts` 2026-11-08T23:29:44Z → 25 rows, `truncated: false`, no `servedSince`; one of the 25 is this repo. Why 25 is complete, not just 25 found: see below |

Traffic is down from September, and I did not measure why. The two 24-hour windows end on different
weekdays, so they don't compare cleanly. Each 7-day window contains every weekday, so the drop
there isn't a calendar effect of that kind.

Two of those rows had their method checked rather than assumed.

**The file counts reproduce.** Run at `7b55f1d2` - the revision the 9/16 snapshot used -
the same two `git ls-tree` commands return 156 and 289, the published numbers, exactly.
So 170 and 369 are growth, not a different way of counting.

**The test count is close to the same scope, and here is the difference.** `test:unit` is still
`vitest run`, and between `7b55f1d2` and `af4b0b53` the vitest config's `include` patterns are
unchanged. Two things did change: a JSX transform for tests, which lets a test import a
component, and a cap on local workers that leaves CI alone. Neither widens the glob. The count
was again taken from CI, not a local run. The 9/16 revision did not re-examine its skips, and the 30 here
were not examined either.

## The second cap, still declared

The 8/29 revision found a cap nobody had declared: the endpoint read the newest 5,000 messages
from the last 14 days and said nothing when the read clipped. It was fixed that day. Today's
10-day probe, `since=2026-10-29T23:29:34Z&limit=1`, answers:

> `matchedCount: 5000`, `truncated: true`, `servedSince: 2026-10-30T16:57:57.084Z`, and
> "The underlying bus read clipped BEFORE matching (read-limit; v1 window 14d, LIMIT 5000) -
> the served window starts 2026-10-30T16:57:57.084Z, not the window asked for;
> matchedCount 5000 counts the served rows only."

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

**The margin grew.** The last revision warned that if the message rate kept rising, a future
7-day query would come back clipped. It fell instead. 5,000 messages now reach back about 9 days
6.5 hours, measured from that probe's served floor to the query clock, against 7 days 16.6 hours
in September. So the 7-day count holds by about 2 days 6.5 hours, up from about 16.6 hours. The warning still stands the other
way: if the rate climbs back, the response will say so.

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
published 7-day window sitting about 17 hours inside it; the fourth found the traffic had fallen
and the margin had grown. None of that would have shown up in a number nobody re-ran.
