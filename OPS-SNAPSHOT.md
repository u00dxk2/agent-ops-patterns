# Ops snapshot - 2026-08-16

The README used to open by telling you I run a large multi-agent system. That's an
unauditable testimonial, so I softened it. This file is the other half of the fix: the
numbers I can actually produce, each with the command that produced it, and an honest
list of the ones I can't.

It's a snapshot with a date on it, not a live dashboard. A number on a page that nobody
re-measures becomes a lie on a schedule.

## What I can show

| Number | What it is | How it was measured |
| --- | --- | --- |
| **5,186** unit tests in the orchestration substrate | The code that runs the fleet, not this repo | `npm run test:unit` |
| **5,186 passing** on a clean run, with two flaky | Same suite, two runs apart | as above |
| **85** check scripts | Standalone detectors with a pass/fail verdict | `ls scripts/check-*.mjs` |
| **168** shared libraries | The `cc-*` primitives those detectors are built from | `ls src/lib/cc-*` |
| **580** agent messages in 24 hours | Traffic on the Postgres bus the agents coordinate over | `GET /api/cc/agent-msg?since=<24h>` → `matchedCount` |
| **4,013** agent messages in 7 days | Same endpoint, wider window (~573/day) | as above, `since=<7d>` |
| **at least 23** distinct projects posting to the bus | Over the same window - a FLOOR, see below | same query, grouped over the returned page |

Two of those numbers need their caveats said out loud, because the caveat is the
interesting part.

**The two flaky tests, and a correction.** The first version of this file said "5,184
passing, 2 failing," because that's what the first run showed. Re-running the file alone
passed, and a second full run passed all 5,186. So the honest statement is: the suite is
green, and two tests in it are flaky under parallel load - they shell out to a script and
appear to lose a race. That's a worse problem than two honest failures, because a flaky
test teaches you to ignore a red. It's on the list. I'm leaving this paragraph in rather
than quietly editing the number, because a snapshot that revises itself silently is worth
about as much as one that rounds.

**The message counts are real now, and getting them fixed the API.** The first version of
this file could only say "at least 500 a day." The bus endpoint clamped every response to
500 rows and said nothing about it, so a 1-day window and a 7-day window both came back
with exactly 500 - which reads as "the window argument is being ignored," the shape
`cc-windowed-segmentation` exists to catch. Caught here on our own API, by trying to
publish a number.

The endpoint now returns `matchedCount` alongside the page, plus `truncated` and a
`countIsFloor` message when the cap bites. The cap stayed at 500 - raising it wouldn't
have helped, because a count taken off a capped page is a floor at any cap. What the fix
bought was the ability to tell the difference, and the difference turned out to be 580
rather than "≥500," with 4,013 over a week.

Worth saying plainly: the window argument was working the whole time. The bug was
entirely in what the response told me, and it was enough to make a working query look
broken. That's the cheap version of this failure. The expensive version is the same
endpoint quietly capping a number that someone publishes.

Which is exactly what I then did. A reviewer caught it: the distinct-project count in
the table above was computed by grouping **the returned page** - 500 rows out of 3,948 -
so it is a floor and not a count. I fixed the message totals, understood precisely why
the cap was dangerous, wrote a paragraph about it, and left the number sitting next door
that was derived from the same truncated read. The row now says "at least." Knowing the
failure mode is not the same as having swept for it.

## What I got wrong, and what's actually missing

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
later and it hasn't moved, treat it as stale - that's what the date is for.
