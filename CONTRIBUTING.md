# Contributing

This repo is maintained by one person and operated by agents. That shapes the rules below more than politeness does.

## Feature proposals: send intent, not code

Adopted from [yc-software/qm](https://github.com/yc-software/qm)'s contribution governance, because it fits an agent-operated repo exactly: **outside feature proposals are accepted as human-written intent documents, never as code.**

Open an issue that says, in your own words:

- the failure you hit in production (what shipped a wrong answer, to whom);
- what you believe the guard/pattern should do — and, in the house style, what it should deliberately NOT catch;
- how you'd know it works (the input that must go red).

If it belongs here, we'll burn our own tokens on the implementation. This is not gatekeeping for its own sake: every artifact in this repo follows one house contract — for the **libraries**, that means a pure single file, zero dependencies, a fail-soft or fail-closed posture declared and pinned by tests, and limits written as tested expectations; the **written protocols** are held to accuracy and stated scope instead, since nothing executes them, and holding a contributor's code to that contract costs more review than writing it fresh — while the *intent* is the part we genuinely cannot generate. A well-written failure story is the most valuable PR this repo can receive. Not because an agent couldn't draft one - it could, easily, and convincingly. What an agent can't supply is the provenance: the reproducible input, the log line, the commit where it broke. Bring that and the story is worth more than the code.

What is welcome as a direct PR, no intent doc needed:

- **Adoption reports** — "this caught X for us" as an issue is the single most useful contribution (see README § Posture).
- **Bug reports with a failing test.** The test is the intent document.
- **Mechanical one-liners** where the README explicitly invites them (e.g. adding a vendor shape to `snippet-redact` — one pattern line plus its test).

## Before this repo accepts outside PRs into CI with any privileges

Current state, honestly: the [tests workflow](./.github/workflows/tests.yml) references no repository secrets, installs no dependencies, and runs `node --test` plus a stdlib Python self-check. It now pins `permissions: contents: read` explicitly rather than inheriting whatever the repository default happens to be - that was a real gap, caught by an adversarial review of this file. A fork PR still executes fork-controlled code, so treat it as untrusted execution with a minimal token, not as safe. That is a property to preserve, not an accident to outgrow.

The moment any workflow here gains a secret, a write-capable token, or a job that executes contributed *content* (not just contributed code under `pull_request`'s read-only default), install a fork-PR boundary FIRST. It has three parts:

- **Fork content never enters the secret-bearing job.** The privileged job runs only when the PR's head repository is this one. A fork gets a separate job that reads GitHub's file and review metadata and never checks out anything the fork wrote.
- **Approval binds to the exact head SHA.** The fork job passes only when a reviewer with write access has approved the PR's *current* head commit. An approval of an earlier commit counts for nothing, so a push after approval needs a new one.
- **One required check that always runs.** A final job reports whichever of the two applied, so a privileged job that was *skipped* for a fork can never satisfy branch protection by its absence.

The working example is the recipe scanner [aaif-goose/goose](https://github.com/aaif-goose/goose) ran until it retired that scanner in August 2026 — [the last version of the workflow](https://github.com/aaif-goose/goose/blob/66e395b7497530af0f3f39131ef71aa9f6952bac/.github/workflows/recipe-security-scanner.yml), pinned to a commit because the file is gone from `main`. The ordering matters — that guard exists *before* the first outside PR is accepted, because the PR that needed it will not announce itself.
