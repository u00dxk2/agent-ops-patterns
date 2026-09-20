# Security

One person maintains this, unfunded. Below is what I can honestly promise, which is less
than a company would promise. I would rather write that down than imply a process that
does not exist.

## Reporting a hole

Use GitHub's private reporting: **[Report a vulnerability](https://github.com/u00dxk2/agent-ops-patterns/security/advisories/new)**
— the Security tab, "Report a vulnerability". The thread stays private while it's worked on,
and nothing out of it goes public without your say — including if the answer turns out to be
that there won't be a fix.

Please don't open a public issue for a security hole. The public "I ran the audit" issue
form is for audit scores, and it asks for verdicts only precisely because pasting real
output into a public issue is the failure Question 1 is about.

## What to expect — best effort, no SLA

- **An agent working on this repo reads and triages the reports first**, not me directly. I
  see what it surfaces. That is worth knowing before you decide how much detail to send.
- **No guaranteed response time.** If a couple of weeks pass with no reply, that means the
  report is *unacknowledged* — not that it failed to arrive, and not that it was dismissed.
  To nudge it, comment on your own advisory thread; that notifies us again and stays private.
  You are never expected to go public to get a reply, and please don't feel you have to say
  anywhere that you reported something.
- **No bounty, no swag, no CVE-wrangling service.** I will credit you in the fix commit
  unless you'd rather I didn't.
- **If I can't fix it, it still gets written down** — in that library's `## Limits` section,
  because a hole nobody wrote down is the thing this repo exists to complain about. But that
  note is agreed with you first and goes out on a timetable you've seen. Nothing from your
  report becomes public before you've had a say, including when there will never be a fix.

## Scope

In scope: the libraries in `lib/`, the audit prompt in `SELF-AUDIT.md`, and the workflows in
`.github/`.

Out of scope: the written protocols in `patterns/`. They are practices, not executable
code — disagreeing with one is an issue, not a vulnerability.

## Prior art on this repo's own holes

Before publication an adversarial review found a real hole in the permission library — the
artifact whose entire job is Question 4 of the audit. It was fixed before the audit shipped,
and [the fix commit](https://github.com/u00dxk2/agent-ops-patterns/commit/792c788) says how
it was found. `SELF-AUDIT.md` says so too, under "What to do with the answer". That is the
standard I would like to be held to here.
