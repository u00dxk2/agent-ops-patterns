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
| **5,184 passing, 2 failing** | Same run, same day | as above |
| **85** check scripts | Standalone detectors with a pass/fail verdict | `ls scripts/check-*.mjs` |
| **168** shared libraries | The `cc-*` primitives those detectors are built from | `ls src/lib/cc-*` |
| **≥500** agent messages in 24 hours | Traffic on the Postgres bus the agents coordinate over | `GET /api/cc/agent-msg?since=<24h>` |
| **23** distinct projects posting to the bus | Over the same window | same query, grouped |

Two of those numbers need their caveats said out loud, because the caveat is the
interesting part.

**The 2 failing tests are real and they're mine.** They were failing before I started
writing this file and they're failing now. I could have run the suite, seen 5,184 green,
and written "over five thousand tests passing." Publishing the failure is cheaper than
being caught rounding.

**The 500 is a floor, not a count.** The bus API caps its response at 500 rows, so a
1-day window and a 7-day window both return exactly 500. Identical results across
different windows means the window argument isn't reaching the query - which is a
detector this very repo would flag. So: at least 500 messages a day, and I don't
currently know the real number. Fixing the cap is on the list.

## What I can't show, and why

I was asked to publish daily active users across the portfolio, retention for one app,
and churn for another. I went to check, and here's what the instruments actually say.

**Active users: 2 of 20 projects have a live read.** One reports 181 weekly actives from
product telemetry; one reports 3. Eleven more have numbers a human typed in, most of them
as of July 20th - roughly four weeks stale. Seven have no read at all.

So a portfolio-wide "total DAU" would be two real numbers, eleven month-old hand-reports,
and seven zeros standing in for "we never wired this up." Summing that gives you a number
that looks like measurement and isn't. The rule I hold myself to is that a missing
instrument is never a zero, and that rule doesn't get suspended because the total would
look better.

**Retention for the app I was asked about: not instrumented.** Its readiness gate says
so explicitly - the honest move there is to stand the instrument up, not to publish a
proxy and call it retention.

**Churn for the newsletter: not instrumented either.** Weekly-active-reader rate is
defined and not yet wired.

That's three of the three metrics originally requested, all unavailable. I'd rather
say that than publish a plausible-looking number I can't defend.

## Why this file exists

Every number above is operational - how much machinery runs, how much traffic it carries,
how much of it is tested. None of it is a business metric, and that's deliberate: the
claim this repo makes is "these patterns come from a system that actually runs," and
operational numbers are the ones that bear on that claim. Revenue and user counts answer
a different question, one this repo isn't asking you to believe.

Re-measure date: whenever the next real change lands. If you're reading this months
later and it hasn't moved, treat it as stale - that's what the date is for.
