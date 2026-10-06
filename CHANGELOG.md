# Changelog

Changes that matter to anyone who vendors a file from this repo. Each entry names the files to re-pull.

## 2026-10-05

### memory-usage-ledger: last touch compared timestamps as text

**Re-pull:** `lib/memory-usage-ledger.mjs`.

`tallyUsage` parsed each timestamp for the window test but picked `lastTouch` by string comparison, so `2026-10-04T11:00:00+02:00` (09:00 UTC) beat `2026-10-04T10:00:00Z` and an older touch was reported as the latest. It now compares parsed instants, keeps the winning row's original string, and breaks a tie between two spellings of one instant by string so the result does not depend on row order. Ledgers written by `makeTouchRows` (all UTC `Z`) were not affected.

### strip-comments: `return typeof /re/` let a trailing comment through

**Re-pull:** `lib/strip-comments.mjs`.

Whitespace and comments were skipped without ending the current word, so `return typeof` was read as one identifier, `returntypeof`. That is not a keyword, so the `/` after it was taken for division, a quote inside the regex then opened a string, and the string copied the comment after it into the output: `includesOutsideComments('return typeof /["]/; // sentinel', "sentinel")` returned `true`, the false green this library exists to prevent. Whitespace and comments now end a word, and the completed word still decides the slash. Over 6,309 real source files (this repo plus a 73-million-character production codebase) the output is byte-identical before and after.

### Scanner: `--range=a..b` ran the staged scan instead

**Re-pull:** `scripts/check-staged-secrets.mjs`. **Behavior change:** `--flag=value` now exits 2.

The unknown-flag check accepted `--range=…`, `--history=…`, `--message-file=…` and `--repo=…` by their names, but the modes look flags up by exact token, so each one fell through: `--range=HEAD~1..HEAD` with a clean index ran the default staged scan and exited 0 without reading a single commit, and `--repo=<path>` swept the current directory. Any `--flag=value` is now refused with exit 2 before anything is scanned; the refusal names the flag and does not echo its value. Pass the value as the next argument.

### Scanner was quadratic on repeated database-URI prefixes

**Re-pull:** `scripts/check-staged-secrets.mjs`.

The redactors got this bound earlier today; the scanner's six database rules did not. One line of `postgres://u:` repeated 40,000 times took about 46 seconds to scan, because every repeat started a password scan that ran to the end of the line. The password run may no longer cross another `://`, so each scan stops at the next start: the same line now takes under a second, including process start-up. New limit, documented and tested: a database-URI password that contains `://` is not caught. Over this repo's full history the hit list is unchanged (9 before, 9 after, same lines).

### Scanner: one placeholder URI cleared every secret on its line

**Re-pull:** `scripts/check-staged-secrets.mjs`. **Behavior change:** a line that mixes an example URI with a real secret now fires.

A credential URI or URL match was voided if the placeholder test (`localhost`, `example.com`, `<…>`, `:password@` and the rest) passed anywhere on the LINE, and the scan returned clean straight away. So a JSON line holding a placeholder database URI and a real GitHub token, or a placeholder URI and a real one, read clean. The placeholder test now runs on each URI candidate alone (its credentials plus its host and port, never its path), and a skipped candidate no longer stops the scan: the rest of the line and the remaining patterns are still checked. On this repo's full history (107 commits, 12,751 added lines) the hit list is identical before and after.

Two fixes followed a second review the same evening. The host after `@` stops at `<`, so markup straight after a real host (`@db.internal<br>`) is no longer read as a `<…>` placeholder; a host wholly in angle brackets (`@<host>`) still is. And the `<…>` placeholder test now stops at the next `<`: a candidate holding a long run of `<` made it quadratic (160,000 of them took about 27 seconds on the regex alone, and the old whole-line test had the same cost).

### A Google-shaped key ending in `-` escaped all three tools

**Re-pull:** `lib/snippet-redact.mjs`, `lib/secret_redaction.py`, `scripts/check-staged-secrets.mjs`.

The `google-api-key` rule ended in `\b`, which needs a word character on one side. A key whose last character is `-` (part of the key alphabet), followed by a space, a quote or the end of the text, failed it, and at 39 characters it is under the base64 fallback's floor, so it passed both redactors and the scanner intact. The rule now ends in `(?:\b|(?![0-9A-Za-z_]))`: every match the old rule made still matches, and the trailing-`-` key now does too.

### capability-grant: an accessor authorization bypass, a lifetime cap, no command text in the audit line

**Re-pull:** `lib/capability-grant.mjs`. **Behavior changes:** read this whole entry before upgrading.

- **Authorization bypass via an accessor (pre-existing, fixed).** `matchGrant` read `commandSha256` again after the grant had passed validation, so a grant object whose getter returned the approved command's hash during validation and another command's hash afterwards authorized the other command. Every function that judges a grant now copies its fields once into a plain object and decides on that copy only. `matchGrant` returns the copy, not your object, so consume by the grant's `id` or store key, not by object identity; fields outside the grant schema are not carried. Unmodified records from `parseGrant` (plain JSON) were not open to this exploit. `matchGrant` also no longer throws: an exception from anything it reads is no match. The grant list and the allowlist are read by index, so their iterators are never consulted; `buildGrant` reads the allowlist the same way.
- Grants could effectively never expire: `buildGrant` accepted any positive finite TTL with no cap, and an otherwise valid grant stayed live until whatever expiry it carried. New `MAX_GRANT_TTL_MS` (one hour). Minting throws above it; `parseGrant`, `isGrantLive` and `matchGrant` reject a lifetime that exceeds it or is not positive; `isGrantLive` and `matchGrant` also reject a `mintedAtMs` after `nowMs`. Mint and expiry timestamps and `ttlMs` must be safe-integer milliseconds (a fractional mint time could round an over-long lifetime down to the cap): mint with `Date.now()`, not `performance.timeOrigin + performance.now()`. The `nowMs` you pass to `isGrantLive` / `matchGrant` may still be fractional.
- `composeAuditLine` wrote the raw command into the audit log, and a command can carry a secret. The `command` field is now `null` unless you pass `redact` (a function from command to display-safe text); a redactor that throws or returns a non-string also gives `null`. `commandSha256` is unchanged. If you relied on the text, pass `redact: (s) => redactSecretShapes(s).text` from `lib/snippet-redact.mjs`. `event` must be one of `mint` / `consume` / `revoke` / `denied` (else `unknown`), `commandSha256` is logged only when it is a 64-character hex hash, and `atMs` only when it is a finite number. `id`, `scope`, `actionClass`, `mintedBy` and `note` are logged only if they are readable strings, and then as given, so keep secrets out of them. Nothing you pass is coerced or serialized through its own `toJSON` / `toString`.
- `markConsumed` copies only the supported grant fields. It used to spread the object, keeping hooks such as a `toJSON` that could serialize the record back without its consumed stamp. It now throws on an unreadable grant.

### stale-basis accepted free text as a date

**Re-pull:** `lib/stale-basis.mjs`. **Behavior change:** values that are not date-shaped are now skipped.

`pickStaleBasis` treated any string `Date.parse` could read as a date. V8 reads "see PR 4821" as the year 4821, so a note in a signal field could win the chain and hold the item fresh until that date. Signal, external and created dates must now be `YYYY-MM-DD` naming a real calendar day (V8 rolls `2026-02-30` over to March 2), optionally with a time (`T`, `t` or a space) and a `Z` or `±HH[:]MM` offset, and still pass `Date.parse`. Basic (`20260801`), week and ordinal forms are not accepted; convert them before calling. A returned `created` date is now trimmed, like the other bases.

### Credential URLs and keys both tools missed; staged scan skipped renames

**Re-pull:** `lib/snippet-redact.mjs`, `lib/secret_redaction.py`, `scripts/check-staged-secrets.mjs`.

- Redactors and scanner: credentialed `rediss://`, `mariadb://`, `mssql://` and `sqlserver://` URIs now match, and every database scheme accepts a SQLAlchemy-style `+driver` suffix (`postgresql+asyncpg://`, `mysql+mysqldb://`, `redis+sentinel://`).
- Redactors: a new `url-creds` shape replaces only `user:password@` in an `http(s)://` URL; the scheme, host and path stay readable. It stops at `/`, `?` and `#`, so an `@` in a query or fragment is not taken for credentials. A secret in the query string is not caught (LIMIT test).
- Scanner: new `anthropic-key` (`sk-ant-`), `openai-key` (`sk-proj-`, `sk-svcacct-`, `sk-admin-`, or a legacy 32+ character body), `basic-auth-url` and `sqlserver-uri-with-creds` patterns, 15 in all. `github-pat` now covers `gho_`/`ghu_`/`ghs_`/`ghr_`. The PGP armour header (`BEGIN PGP PRIVATE KEY BLOCK`) now matches; the old alternative never could.
- Scanner, pre-commit path: lines added to a renamed or type-changed file are scanned (`--diff-filter=ACMRT`). The staged diff is now read with the same hunk-count rule as the history sweep, context lines included, and `diff.interHunkContext` is pinned to 0, so an added line starting `++ ` is scanned instead of being taken for a file header. Staged file names follow the history path rule (withheld when secret-shaped, legacy `sk-` keys included).
- Redactors: each prefixed shape checks its possible first character before the escape-residue anchor. No match changes (a differential run over about 104,000 inputs per language found none). On this machine's adversarial probes (Python 3.14) the Python port went from about 3.2 s to 0.5 s.

Selftest: 17 arms (was 15). Sweeping this repo's full history with the new patterns adds 7 hits, all synthetic fixtures or documentation examples already in the tree.

### Redactors were quadratic on repeated JWT and DB-URI prefixes

**Re-pull:** `lib/snippet-redact.mjs`, `lib/secret_redaction.py`.

A string repeating `eyJ-` (200k characters) took about 60 seconds in the JavaScript library, and `postgres://u:` repeated to 195k characters took about 5 seconds. Each repeat was a new start for the regex, and each start scanned to the end of the text. The JWT rule now uses an anchor that also refuses a `-` before `eyJ`, and a DB-URI password may not run across another `://`, so each scan stops at the next start (no length cap, so long and URL-encoded passwords still redact). Both probes now finish in well under a second, in both languages. New limits, documented and tested: a JWT glued onto `-` (`token-eyJ…`, `cache-eyJ….json`) and a DB-URI password that contains `://` are not redacted.

### Commit-message mode printed part of the secret it caught

**Re-pull:** `scripts/check-staged-secrets.mjs`.

`--message-file` (the commit-msg hook) printed the first 60 characters of the message line that matched, which is enough for a whole GitHub token, and this output lands in agent transcripts and CI logs. It now prints the pattern, the line number and the line length, never the line's text. The selftest's MESSAGE arm checks that no part of the line is printed.

### Redactors missed a key that follows an escape sequence

**Re-pull:** `lib/snippet-redact.mjs`, `lib/secret_redaction.py`.

Every prefixed shape (GitHub, AWS, Stripe, Google, Slack, Anthropic, OpenAI, JWT, long hex, credentialed DB URIs, Slack webhooks) was anchored with a leading `\b`. In escaped text, which is how most recalled text is stored, the character before the key is often a letter: a JSONL transcript holds a newline as the two characters `\` `n`. So in `…\nghp_…` the `\b` failed and the whole key came back unredacted. The same was true after `\t`, `\r`, `\uXXXX` and URL-encoded `%XX`. The base64 fallback missed most of these keys too (it stops at `_` and `-`).

The leading anchor is now `(?:(?<![A-Za-z0-9_])|(?<=\\[ntr])|(?<=%[0-9A-Fa-f]{2})|(?<=\\u[0-9A-Fa-f]{4}))`, the same text in both languages. If you ported the shapes into your own code, swap the leading `\b` on each prefixed shape for this anchor.

Still not caught, now documented and tested: a key glued straight onto a word (`xghp_…`), a key behind other escapes (`\x22`, `%2522`, `\b`, `\f`), and a URI whose slashes are escaped (`postgres:\/\/…`). New, accepted false positive: `%XX` is not decoded, so `%62sk-…` is redacted. The extra lookbehinds cost time: on the adversarial probes, about 3× in JavaScript and 5× in Python, still well inside the two-second test bound.
