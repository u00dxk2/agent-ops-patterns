# AGENTS.md

Instructions for a coding agent working in this repository. Humans: [README.md](./README.md) and
[CONTRIBUTING.md](./CONTRIBUTING.md) say the same things at more length.

## What is here

- `lib/` — single-file libraries (JavaScript ESM, one Python file). Each JavaScript library has a
  test in `test/`; the Python library carries its own self-check (`python lib/secret_redaction.py`).
- `patterns/` — written protocols. Nothing executes them; they are held to accuracy and stated scope.
- `skills/` — Agent Skills: `cs329a-self-improving-agents` (validated by
  `test/skill-references.test.mjs`) and `cog-ops-map` (validated by `test/cog-ops-map-skill.test.mjs`).
- `scripts/check-staged-secrets.mjs` + `.githooks/pre-commit` — refuses a commit whose staged lines
  carry a secret shape. Turn it on in your clone with `git config core.hooksPath .githooks` (running
  `npm install` does this through `prepare`). `--history <days> --selftest` proves it can go red.
  CI runs `--range <before>..<after>` over every push and PR, so the hook being off is not a gap.
- `OPS-SNAPSHOT.md`, `SELF-AUDIT.md` — dated measurements. Do not edit a number in them without
  re-measuring it and saying how; a changed figure with no query behind it is the failure those files
  exist to avoid.

## Commands

```sh
npm test                                                   # node --test; zero dependencies, no install step
python lib/secret_redaction.py                             # Python self-check, 3.10 floor
CHECK_LINKS=1 node --test test/skill-references.test.mjs   # network: every URL in the CS329A skill's papers.md and lectures.md must resolve (cog-ops-map's URLs are not checked)
```

CI (`.github/workflows/tests.yml`) runs the first on Node 20, 22 and 24, the other two once each, and
the secret scan (self-test, then the pushed range).
The README's Node version claim is that matrix; widen the matrix before widening the claim.

## The house contract for `lib/`

A new library, or a change to one, should leave it:

- **one pure file, zero dependencies** — stdlib only, no install step;
- **explicit about failure posture** — fail-soft or fail-closed, stated in the file and pinned by a
  test, never left to whatever an exception happens to do;
- **honest about its limits** — what it deliberately does not catch is written down and asserted as a
  test named `LIMIT: …` (most test files already carry some), so a later "fix" that silently widens
  behaviour goes red.

Not every existing file meets all three yet. Bring the one you touch up to it; do not reformat the rest.

Do not add a dependency, a build step, or a secret to any workflow. Every external action is pinned
to a full commit SHA with a version comment (`test/workflow-pins.test.mjs` checks the shape, not
that SHA and comment correspond); `.github/dependabot.yml` checks weekly and proposes pin bumps
by PR, and watches nothing else. A bump PR runs the proposed action in CI before anyone reviews it. CONTRIBUTING.md explains why the
workflow's read-only posture is a property to keep.

## Traps

- **Line endings.** `.gitattributes` pins `*.md` to LF. Both skill tests parse frontmatter with an
  LF-only pattern; if it reports "frontmatter block missing" on a file you did not touch, the checkout
  has CRLF — renormalize the file, do not loosen the test.
- **Tests are the spec.** When a test and the code disagree, find out which one is wrong before
  changing either. Several tests exist to pin a boundary (a byte budget, an off-by-one) that an
  "obvious" simplification would move.
