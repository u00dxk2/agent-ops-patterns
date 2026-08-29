# Ops snapshot - 2026-08-29

The README used to open by telling you I run a large multi-agent system. That's an
unauditable testimonial, so I softened it. This file is the other half of the fix: the
numbers I can actually produce, roughly how each was measured, and an honest list of the
ones I can't.

Read the "how" column as an abbreviated description, not a reproduction recipe. Some
entries really are the command (`npm run test:unit`); others name a file listing whose
count I then took, or an authenticated API call against a moving window. This revision
carries the exact query bounds and the source revision where a row has one, which the
first revision did not - that was the stated fix "if these numbers ever need to carry
weight," and re-measuring was the occasion to do it. What is still missing is the
deployed server revision behind the bus numbers; the queries were made against
production and the running build was not captured. A stranger could re-derive the file
counts and the test row from what is written here, and could re-run the bus queries
against a different window but not this one.

It's a snapshot with a date on it, not a live dashboard. A number on a page that nobody
re-measures becomes a lie on a schedule. This is the second measurement; the first was
2026-08-16, and the deltas are in the table because a rate is more informative than a
level.

## What I can show

| Number | What it is | How it was measured (abbreviated) |
| --- | --- | --- |
| **7,076** unit tests passing, 10 skipped, in 273 files | The code that runs the fleet, not this repo. Was 5,186 in 257 files on 8/16 | skylark-site `Verify` CI run `33270286950` at `bd1ab42f` (main), 2026-08-29T19:16Z: `npm run test:unit` → `Tests 7076 passed \| 10 skipped (7086)`, `Test Files 272 passed \| 1 skipped (273)` |
| **114** check scripts | Standalone detectors with a pass/fail verdict. Was 85 | count of `scripts/check-*.mjs` on disk at `bd1ab42f` |
| **203** shared libraries | The `cc-*` primitives those detectors are built from. Was 168 | count of `src/lib/cc-*` on disk at `bd1ab42f` (no test files live there; tests are under `__tests__/`) |
| **340** agent messages in 24 hours | Traffic on the Postgres bus the agents coordinate over - a Saturday. Friday 8/28 read 845; the 8/16 row was 580 | `GET /api/cc/agent-msg?since=2026-08-28T19:25:29Z&limit=1` → `matchedCount`, queried 2026-08-29T19:25:29Z |
| **4,332** agent messages in 7 days | Same endpoint, wider window (~619/day). Was 4,013 | as above, `since=2026-08-22T19:25:29Z`; complete, not a floor - see the second-cap paragraph for why that had to be checked |
| **26** distinct projects posting to the bus in 7 days | An exact count this time, not a floor. Was "at least 23" | `?summary=1`, whose grouping runs over the whole server-side read rather than a page, filtered to projects whose newest post falls inside the window; one of the 26 is this repo, which posted one status line during this session |

Three of those numbers need their caveats said out loud, because the caveat is the
interesting part.

**The test row, and the flaky pair.** The 8/16 revision said "5,186 passing, with two
flaky" and explained that a first run had shown two failures which vanished on re-run.
This revision took the count from CI rather than a local run, because the suite writes
fixtures and I did not want to run it inside a working tree other sessions were using.
One green run says nothing about flakiness either way; the two tests were not re-tested
and the paragraph about them is not retracted, just not extended. The 10 skips are
platform-gated by design (an EPERM end-to-end file and two rename cases that only run on
Windows), not failures wearing a different label.

**The message counts are real, and getting them fixed the API.** The first version of
this file could only say "at least 500 a day." The bus endpoint clamped every response
to 500 rows and said nothing about it, so a 1-day window and a 7-day window both came
back with exactly 500 - which reads as "the window argument is being ignored," the shape
`cc-windowed-segmentation` exists to catch. Caught on our own API, by trying to publish
a number. The endpoint now returns `matchedCount` alongside the page, plus `truncated`
and a `countIsFloor` message when the cap bites, and the difference turned out to be 580
rather than "≥500."

**A second cap, found this time, and it is not declared.** Re-measuring meant asking
whether `matchedCount` itself could be a floor, so I probed wider windows. A 10-day
query returns `matchedCount: 5000`. So does a 14-day query. That is not the traffic; it
is the reader underneath the route, which selects the newest 5,000 rows from the last 14
days and hands them up as "all messages." The route then counts matches over that read
and declares the 500-row *page* cap faithfully, with no idea the 5,000-row *read* cap
exists. So the response's own NO SILENT CAPS contract holds at the layer that wrote it
and is violated one layer down: any window wider than about eight days gets a confident
`matchedCount` that is a floor, with `truncated: false`. The 7-day number above is safe
only because the probe showed the 5,000 newest rows reach back past seven days; it is
the probe that makes it a count. This is the same failure the 8/16 revision described,
one layer deeper, found by the same method - and it is a defect in the fleet's code, not
this repo's, so it is routed there rather than fixed here.

**The distinct-project count was a floor for two revisions.** It was computed by
grouping the returned page - 500 rows of 3,948 - and the 8/16 revision said so, then
left it standing next to a paragraph about exactly that failure. The fix was not more
paging: the endpoint has no cursor, and `since` alone can't walk backward through a
newest-first list. The fix was a different response shape whose grouping runs over the
full server-side read, filtered client-side to projects whose newest post is inside the
window. Because that read spans more than seven days (the probe above), any project that
posted in the window is in it, and 26 is a count.

## What I got wrong, and what's actually missing

(Unchanged from the 2026-08-16 revision. Nothing in this section was re-measured, and
the two missing instruments are still missing.)

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
later and it hasn't moved, treat it as stale - that's what the date is for. Two
measurements thirteen days apart is what it took to notice that the interesting number
is the second cap, not the traffic.
