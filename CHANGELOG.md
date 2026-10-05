# Changelog

Changes that matter to anyone who vendors a file from this repo. Each entry names the files to re-pull.

## 2026-10-05

### Commit-message mode printed part of the secret it caught

**Re-pull:** `scripts/check-staged-secrets.mjs`.

`--message-file` (the commit-msg hook) printed the first 60 characters of the message line that matched, which is enough for a whole GitHub token, and this output lands in agent transcripts and CI logs. It now prints the pattern, the line number and the line length, never the line's text. The selftest's MESSAGE arm checks that no part of the line is printed.

### Redactors missed a key that follows an escape sequence

**Re-pull:** `lib/snippet-redact.mjs`, `lib/secret_redaction.py`.

Every prefixed shape (GitHub, AWS, Stripe, Google, Slack, Anthropic, OpenAI, JWT, long hex, credentialed DB URIs, Slack webhooks) was anchored with a leading `\b`. In escaped text, which is how most recalled text is stored, the character before the key is often a letter: a JSONL transcript holds a newline as the two characters `\` `n`. So in `…\nghp_…` the `\b` failed and the whole key came back unredacted. The same was true after `\t`, `\r`, `\uXXXX` and URL-encoded `%XX`. The base64 fallback missed most of these keys too (it stops at `_` and `-`).

The leading anchor is now `(?:(?<![A-Za-z0-9_])|(?<=\\[ntr])|(?<=%[0-9A-Fa-f]{2})|(?<=\\u[0-9A-Fa-f]{4}))`, the same text in both languages. If you ported the shapes into your own code, swap the leading `\b` on each prefixed shape for this anchor.

Still not caught, now documented and tested: a key glued straight onto a word (`xghp_…`), a key behind other escapes (`\x22`, `%2522`, `\b`, `\f`), and a URI whose slashes are escaped (`postgres:\/\/…`). New, accepted false positive: `%XX` is not decoded, so `%62sk-…` is redacted. The extra lookbehinds cost time: on the adversarial probes, about 3× in JavaScript and 5× in Python, still well inside the two-second test bound.
