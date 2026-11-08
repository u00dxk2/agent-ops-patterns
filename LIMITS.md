# Coverage and limits

What each artifact in this repo does not do. The [README](./README.md) is the way in.

Every library here names what it does NOT do, and so do all three skills and all seven written protocols. The libraries pin representative cases of their principal limits in tests; the operational limits - the ones that live in your deployment rather than in this code, like the grant lib's single-user-account boundary - are labeled as what they are, because no test can reach them. The protocols carry a `## Limits` section apiece, but they state practices rather than executable specifications, so those limits are read and never run - nothing tests them at all. Neither kind is a footnote, but they aren't the same kind of promise either.

The CS329A skill states its own limits in its `SKILL.md` § "Where this skill stops
working" - the short version: it reads a repo, not a deployment, so "already in place"
proves a code path exists, not that it runs; and the ideas are the course as taught in
fall 2025, read in August 2026.

The cog-ops-design skill states its limits the same way: it designs judgments and knows nothing about your domain, and its failure classes come from a narrow set of records.

The cog-ops-map skill states its limits in the same-named section of its `SKILL.md`. The short
version: it maps what the code says at the moment it reads it, and reading code does not prove
runtime behavior; a map drifts when the code changes unless its cards are maintained in the same
commit (live slicing keeps only the prompt text current); a "nothing checks this" stays provisional
until re-derived by a different route; and a map is only comparable with another one if both
follow the shared schema the skill now includes. Its worked example is the gallery's pi map.

### snippet-redact (and its Python port)

`snippet-redact` is **defense-in-depth, not a DLP guarantee.** A shape-matcher cannot recognize a secret it has no shape for. Representative examples of the *matcher's* false-negative limits below are pinned in [`test/snippet-redact.test.mjs`](./test/snippet-redact.test.mjs) - but the lists are broader than the fixtures, so read a limit as "we know this class gets through," not "there is a test per bullet." The last bullet is a different kind: a deployment restriction, which no unit test can exercise.

- **40-hex strings pass, deliberately.** A pre-2021 GitHub personal access token is 40 hex characters — the *same shape* as a git SHA. Shape alone cannot distinguish them, and redacting every SHA in developer text is worse than useless. The hex floor is 48 (sha256-length tokens still redact). **If legacy 40-hex tokens might appear in your recalled text, rotate them; this will not save you.**
- **Opaque / unprefixed credentials pass** — `MY_SERVICE_TOKEN=<random>`, session cookies, short-lived OAuth codes, `Authorization:` header values. Key-*name*-based rules (`KEY=…`, `"token": …`) are deliberately absent: they false-positive hard on source code, and this runs on recalled prose. Pair with an ingestion-side scrubber if you need that class.
- **Vendors not in the shape list pass** (SendGrid `SG.`, Slack `xapp-`, Telegram bot tokens, …). The list is what our own corpus actually leaked; adding a shape is a one-line PR.
- **Generic base64 inside URLs, `data:` URIs, and hash-integrity strings (`sha512-…`) passes**, as do digit-free letter runs - those are overwhelmingly webhook paths, inline assets, lockfile hashes, and identifiers, and mid-URL redaction mangles benign text. URL-shaped credentials want their own shape rule (Slack incoming-webhook URLs have one; credentialed DB URIs are covered for MongoDB, Postgres, MySQL, MariaDB, Redis incl. `rediss://`, AMQP and SQL Server, with or without a `+driver` suffix; in `http(s)://user:password@host`, only `user:password@` is replaced, so the scheme, host and path stay readable; a secret in the query string is not caught). The URL skip is a lookback, not a parser: it searches the preceding 2,048 characters for a scheme, so a token sitting further than that from its own `https://` is not recognized as being in a URL and gets redacted anyway. Long enough URLs mangle.
- **Prefixed keys in some encodings pass.** A prefixed shape matches an intact key that starts after a non-word character or right after a `\n`, `\t`, `\r`, `%XX` or `\uXXXX` escape (as in JSONL or URL-encoded text; before 2026-10-05 it missed those too, see [CHANGELOG.md](./CHANGELOG.md)). It misses a key glued straight onto a word (`xghp_…`), a key behind any other escape (`\x22`, double-encoded `%2522`), and a URI whose own slashes are escaped (`postgres:\/\/…`). The base64 fallback catches some of these and not others. `%XX` is not decoded, so `%62sk-…` (which decodes to `bsk-…`) is redacted as a key: a false positive, accepted.
- **Two rules that keep the scan linear let these pass**: a JWT glued straight onto a `-` (`token-eyJ…`, `cache-eyJ….json`), and a credentialed DB URI whose password contains `://`.
- **Not for text that will be executed or stored.** Redacting a command or a config file corrupts it. Display boundary only.

Guarded against catastrophic backtracking: every pattern is boundary-guarded and free of nested quantifiers (most are literal-prefixed; the generic base64/hex rules are bounded character classes instead). That alone was not enough. A string that repeats a prefix gives the regex a new start at every repeat, and an unbounded run from each start is quadratic: before 2026-10-05, `eyJ-` repeated to 200k characters took about a minute. The JWT rule now refuses to start right after `-`, and a DB-URI password may not run across another `://`, so each scan stops at the next start. The test behind this paragraph runs nine adversarial probes of up to about 300k characters, including those repeated-prefix cases, and requires them to finish inside two seconds - a regression bound, which is a useful thing to have and is not a proof of linear complexity. If you need the proof, read the patterns; the test only tells you they haven't gotten slower. Output is a fixed point: re-redacting redacted text is a no-op, and every member of an adjacency chain is replaced during the **first mutation pass**, with one further pass to confirm stability. So the pass count no longer grows with chain length — it is two, whether the chain is 3 runs or 300. (Be precise about that: with `maxPasses: 1` even a fully-redacted chain comes back as the non-convergence token, because the confirming pass never ran.) That property is newer than it should be. The base64 boundary used to reject a run followed by another `=`, which cost two bugs for one character — adjacent padded runs could only be peeled one per pass, and `<secret>=<secret>` returned the **first secret raw** while reporting itself finished.

If the scan somehow cannot stabilize, the entire snippet is replaced with `[redacted:nonconvergent-snippet]` — **fail-closed, not a warning flag**. A flag only protects callers who read it, and at an output boundary the ones who don't are exactly the ones who leak. No known input reaches that branch, so the libraries take a `maxPasses` / `max_passes` seam whose only job is to let the branch be driven red in a test: a guard nobody can make fire is a guard nobody has checked.

`secret_redaction.py` shares every limit above (same shapes, same skips, same self-checked contract), and compiles its patterns in ASCII mode so JS and Python agree on word boundaries — an adversarial review caught Python's Unicode `\b` hiding a key behind an `é`. Two bounded *text-matching* divergences remain by choice and are documented in the file header (the URL-lookback window's units, and non-ASCII whitespace); both only move skip decisions on exotic Unicode text. Option-type validation also differs, and cannot be made identical: JavaScript has no integer/float distinction, so `maxPasses: 1.0` is simply `1`, while Python treats `max_passes=1.0` as a float and falls back to the default. (Python's other asymmetry — accepting `True` as `1`, because `isinstance(True, int)` — was a real bug and is fixed.) The JS file is canonical; edits to either must be synced to the other.

### capability-grant

- **No cryptographic boundary on a single user account.** If the agent process runs as the same OS user who mints grants, the agent could in principle write a grant file itself. The boundary is operational and needs all three legs: mint from a terminal *outside* any agent session, deny the agent the mint CLI in your harness's permission config, and append every mint/consume/deny to an audit log. If you need a hard boundary, put the grant store behind a different principal.
- **No semantic matching, deliberately.** The sha256 binds the command byte-exact after trimming — internal whitespace included, because collapsing it would make a two-line command hash like its one-line concatenation (an adversarial review demonstrated exactly that against an earlier draft). A whitespace change that survives trimming (a re-indent) misses and falls through to your normal permission prompt. Safe, and occasionally annoying — that is the trade.
- **Single-use requires your store to consume atomically.** `matchGrant` finds, it does not consume; two concurrent hooks can both match before either deletes the grant file. Delete-before-execute (or an exclusive rename) in the hook is part of the security boundary, and it is yours.
- **An empty class allowlist denies everything.** There is no "allow all" spelling. Keep widening scope an edit to your code, so it is visible in review; the library cannot enforce that. Scope and action class are likewise required on every match query — omitting them is a null, not a wildcard.
- **Lifetime is capped at one hour, and the cap is enforced whenever a grant is judged, not just at mint.** A grant whose expiry is more than an hour after its mint time (say, a file edited to expire in 300 years) is dead: not parsed, not live, never matched. One claiming a future mint time is never live or matched (`parseGrant` has no clock, so it cannot judge that). Multi-use grants (`singleUse: false`) are still yours to retire within that hour.
- **A grant is judged on a one-time snapshot of its fields.** A getter or Proxy cannot show one value to a check and another to the decision; `matchGrant` returns the snapshot, not your object.
- **The audit line's `command` field is null unless you pass a redactor** (`composeAuditLine({ …, redact })`). Commands can carry secrets and the audit log is meant to be kept; for a valid grant, `commandSha256` identifies the command. `id`, `scope`, `actionClass`, `mintedBy` and `note` are logged as given when they are readable strings, so keep secrets out of them.

### stale-basis

- **A dishonest signal defeats it.** If a writer stamps a signal field during a bulk write, the clock resets and no chain can tell. The convention — signal fields are stamped only by disposition-changing reads — lives in your writers; the function only enforces the chain.
- **A future-dated signal wins, unclamped** — clamping would hide the writer bug that produced it. Lint for future dates upstream if your writers might emit them.
- **Only date-shaped values count**: `YYYY-MM-DD` naming a real calendar day, optionally with a time (`T`, `t` or a space) and a `Z` or `±HH:MM` offset, and accepted by `Date.parse`. Anything else is skipped, even when `Date.parse` alone would read it: V8 reads "see PR 4821" as the year 4821, and rolls `2026-02-30` over to March 2. Before 2026-10-05 such a note could win the chain and hold an item fresh until that far-off date. A time with no offset is read in the host's timezone.
- **`{date: null, basis: "none"}` is a distinct verdict, not "fresh".** Treating no-basis as fresh rebuilds the dead-instrument zero from [checks-that-cant-fail](./patterns/checks-that-cant-fail.md).

### rrf-fuse

- **Fuses RANKS, not magnitudes** — a score of 1000 and a score of 5 are both rank-1 in their ranking; if magnitude should matter, encode it in the relevance ranking before fusion.
- **Cannot rescue an empty relevance signal** — all-zero scores degrade to pure recency; the score's quality stays the caller's.
- **Ranks only the pool it is given** — a hit truncated away before fusion cannot surface. Over-collect (we use 3× the final limit per source) before calling it.

Each pinned in [`test/rrf-fuse.test.mjs`](./test/rrf-fuse.test.mjs).

### memory-usage-ledger

- **An empty ledger is absence of evidence, not evidence of rot.** With zero rows read every file lands never-touched, which looks exactly like a directory of dead memories. The tally reports `rowsRead` so that a consumer *can* refuse the read - the zero is tested, and the refusing is yours to write. A library cannot make a caller check the number it hands back. A never-touched list means something only after sessions have recorded for a meaningful fraction of the window.
- **Touches are self-reported** — a session that forgets to record under-counts; one that touches everything it merely loaded over-counts. The convention (touch = load-bearing, not merely-present-in-context) lives in your session-close discipline, not in this code — operational limit.
- **Future-dated touches count, unclamped** (tested) — same doctrine as stale-basis: hide the writer bug and you'll never fix it.
- **It counts; it does not judge.** No thresholds, no auto-evict. PEEK (below) shows one way to make the policy deterministic once you have the evidence.

### scannable-command

Honest framing first, quoted from its upstream (qm): **a speed bump against mistakes and injection, not a sandbox boundary.** A determined adversary defeats any text-level normalizer; the real boundary is your sandbox/permission layer. Tested misses, each pinned in [`test/scannable-command.test.mjs`](./test/scannable-command.test.mjs):

- **Space-separated tokens** — `--bo dy` stays two tokens; joining adjacent words would turn prose mentions into matches and train operators to dismiss the alarm.
- **Variable expansion** — `X=--body; cmd $X` is opaque without executing the shell.
- **Encoded payloads** — base64 piped to an interpreter is data until it runs; no decode pass exists (qm re-scans interpreter-fed payloads; this port does not).
- **Heredoc quoting semantics** — `<<'EOF'` and `<<EOF` normalize identically; heredoc bodies stay visible to your regexes, but a policy that depends on whether a heredoc *expands* cannot use this pass.

### shadow-screen

- **It classifies one decision; it does not log, aggregate, or enforce.** A caller that computes `proceed` and ignores it has a shadow screen wearing an enforce label, and no pure function can see its caller — operational limit, named in the pattern doc.
- **It cannot judge screener quality** — a screener that never flags yields wall-to-wall allows. Prove the screener can fire before trusting its quiet ([checks-that-cant-fail](./patterns/checks-that-cant-fail.md)).
- **`isPass` refuses `unscreened` and `would_block`** (tested), so a pass-rate dashboard cannot absorb a dark screener into its green number.

### strip-comments

- **A lexer heuristic, not a parser.** Division-vs-regex is decided by the previous significant token plus a well-formedness lookahead, and the header names where that guess goes wrong: a contextual keyword such as `of` used as a variable name, or an operator right after a regex literal's closing slash. A wrong guess can keep a comment, and in one pinned case it strips real code. Those shapes are pinned in [`test/strip-comments.test.mjs`](./test/strip-comments.test.mjs) as `LIMIT:` tests, not just prose; the further contexts the header lists are not all pinned. If a wrong answer costs your guard more than a false alarm, use a real parser.
- **Template-literal text is opaque on purpose.** A needle between backticks is output the program emits, so a presence guard should find it. If your needle is in a comment inside a `${...}` substitution, that is code and it strips.
- **Two languages.** JS/TS/JSX and POSIX-shell `#`. No HTML comments; shell heredoc bodies are scanned like code, which for a presence guard errs toward FOUND (pinned) — a false absence is the failure this lib exists to prevent, a false presence just makes you look.

### known-flags

- **Long flags only.** Single-dash short options, bare positionals, and everything after a literal `--` pass untouched; validating those stays with the caller's own parser.
- **It checks recognition, not implementation.** A flag in the known set that the CLI never wired up sails through (pinned as a tested LIMIT) — and that is the incident's worst case. Keeping the known set equal to the *implemented* set is the caller's half of the contract.
- **It never echoes an unknown token.** No shape test can tell a short secret from a typo, so the refusal names only the argument's position and, when one is close, a known flag; you find the typo in your own command. Pinned as a tested LIMIT.
- **`entry` gating fails closed to a no-op** on loaders where `import.meta.url` is not a file URL — the guard goes quiet rather than refusing an importer's valid flags.

### result-line

- **Nothing in-process survives `kill -9`.** The line fires on `process.exit()`, natural drain, and uncaught throws; on SIGKILL the exit status (or its absence) is still the only contract.
- **`{ fd: 2 }` is mandatory for `--json` scripts** — a verdict line appended after a JSON document makes the document unparseable, and the first ship of the origin broke a consumer exactly that way (pinned: stdout stays parseable, the verdict moves to stderr).
- **One line per process.** A gate that runs inside another script prints a line that reads as the outer script's verdict; the parent declares nesting via `RESULT_LINE_NEST` because only the parent knows it is one (pinned, including the env value being sanitized and bounded — it reaches a terminal and is not a trusted format string).
- **The vocabulary is closed.** A label outside it renders `UNKNOWN` at exit and warns loudly at arm time (pinned) — a deliberate label must fail visibly on every invocation, never quietly on the one exit that matters.
