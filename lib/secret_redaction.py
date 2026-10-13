"""secret_redaction.py — secret-shape redaction at the OUTPUT boundary (Python).

A port of ``lib/snippet-redact.mjs`` for Python recall paths — agent-memory
layers, log excerpting, session search — anywhere stored text is recalled
back into a display surface or model context. The JS file is the canonical
implementation; keep the SHAPES list and skip rules in sync when editing
either.  Extracted while proposing this same boundary upstream to a Python
agent-memory framework (mem0ai/mem0#6817).

CROSS-LANGUAGE FIDELITY (adversarial-review finding, pinned in the
self-check): every pattern compiles with ``re.ASCII`` so ``\\b``/``\\w``/
``\\S`` mean what they mean in JavaScript regexes (an ``é`` before ``AKIA…``
must not hide the key the way Python's Unicode ``\\b`` would). Two bounded
divergences remain, deliberately, because closing them costs more than they
protect: (1) the 2,048-char URL-lookback window counts UTF-16 code units in
JS and code points here, so astral-plane-heavy text near the window edge can
make the two implementations disagree about whether a base64 run sits inside
a URL; (2) non-ASCII whitespace (NBSP and friends) is whitespace to JS
``\\s`` but not to ASCII-mode Python, which can shift where a db-uri match
or URL scan stops on exotic-whitespace text. Both divergences only move
skip/boundary decisions on unusual Unicode; ASCII and typical text behave
identically, and the self-check asserts the cases that used to differ.

The chokepoint pattern: anything that recalls stored text passes through
``redact_secret_shapes()`` at the last moment before it's shown. Index-time
scrubbing can't help when you're searching text that already exists; the
output boundary is the one place every recall path goes through. Redaction
tokens name the shape (``[redacted:github-token]``) so hits stay findable and
debuggable.

Design rules:
 - DISPLAY boundary only. Never run this over text that will be executed or
   written back to storage — redaction must not corrupt commands,
   Authorization headers, or data at rest.
 - Deliberate carve-out: 40-hex git SHAs are NOT redacted (development text
   cites them constantly); the hex floor is 48 so sha256-length tokens still
   redact.
 - Pure, stdlib-only, idempotent. Benign text passes byte-identical.

WHAT THIS DOES NOT CATCH (defense-in-depth, NOT a DLP guarantee — a
shape-matcher cannot recognize a secret it has no shape for):
 - **40-hex strings, deliberately.** A pre-2021 GitHub personal access token
   is 40 hex characters — the same shape as a git SHA. Shape alone cannot
   tell them apart, and redacting every SHA in developer text is worse than
   useless. If legacy 40-hex tokens may appear in recalled text, rotate them;
   this module will not save you.
 - **Opaque / unprefixed credentials**: ``MY_SERVICE_TOKEN=<random>``, session
   cookies, ``Authorization:`` header values, any vendor whose key has no
   distinctive prefix. Key-name-based rules are deliberately absent — they
   false-positive hard on source code. Pair with an ingestion-side scrubber
   if you need that class.
 - **Vendors with no shape** (Slack ``xapp-``, Telegram bot tokens, …). Adding
   one means an entry here and in the JS file, plus a fixture row. The vendor
   bodies the commit scanner (scripts/check-staged-secrets.mjs) gained in SY-1
   are in _VENDOR_SHAPES with its length bounds. They run once, after every
   other shape has finished, so they only add redaction. Where a generic rule
   took all or part of a key's body first, the token is the generic one, the
   prefix shows, and an untaken part of the body can show too, as before SY-3.
   No vendor shape fires on a body shorter than the scanner's floor or longer
   than its ceiling, on a key right after a word character, ``_`` or ``-``
   (escape residue aside, as for every prefixed shape), or on one that runs on
   into ``+ / = _ -`` or a word character. Two differences from the
   scanner: it fires only on a Supabase JWT whose role is service_role (an anon
   key would block a commit for nothing), while the JWT rule here redacts what
   it matches whatever the role; and its JWT header floor is eyJ + 8, this
   one's eyJ + 10.
 - **Base64 under 40 chars**, and secrets split across a snippet boundary.
 - **Prefixed keys in some encodings.** A prefixed shape matches an intact
   key that starts after a non-word character or right after a ``\\n``,
   ``\\t``, ``\\r``, ``%XX`` or ``\\uXXXX`` escape (see _LEAD). It misses a key
   glued straight onto a word (``xghp_…``), a key behind any other escape
   (``\\x22``, double-encoded ``%2522``, ``\\b``, ``\\f``), and a URI whose own
   slashes are escaped (``postgres:\\/\\/…``). The base64 fallback catches some
   of these and not others; do not count on it.
 - **Two rules that keep the scan linear**: a JWT glued straight onto a ``-``
   (``token-eyJ…``, ``cache-eyJ….json``), and a credentialed DB URI whose
   password contains ``://``.
 - **%XX is not decoded**, so any ``%XX`` counts as an escape: ``%62sk-…``
   (which decodes to ``bsk-…``) is redacted as a key. A display-only false
   positive, accepted.
 - **Generic base64 inside URLs, data: URIs, and hash-integrity strings is
   deliberately skipped** — those runs are overwhelmingly webhook paths,
   inline assets, and lockfile hashes, and mid-URL redaction mangles benign
   text. A credential that *is* a URL wants its own shape rule. Digit-free
   base64 runs are skipped too (letters-only 40+ char runs are identifiers or
   prose).

Representative cases of the limits above are asserted in the self-check:
``python lib/secret_redaction.py``. The list is broader than the fixtures - read
a limit as "this class gets through", not "there is an assertion per bullet".
The self-check refuses to run under ``-O``/``PYTHONOPTIMIZE``, where asserts
compile out and it would print success against a no-op implementation.
"""

from __future__ import annotations

import re
from typing import Callable, NamedTuple


class Redaction(NamedTuple):
    text: str
    shapes: list[str]


# Pass cap for the stability scan. Not load-bearing in normal operation: since
# the base64 boundary stopped vetoing on "=", every input we know of reaches a
# fixed point on the FIRST pass and the second only confirms it. The cap exists
# so an unknown future shape interaction cannot spin forever - and because it
# should never be hit, hitting it is a fault, not a partial result.
# Mirrors MAX_REDACTION_PASSES in snippet-redact.mjs.
MAX_REDACTION_PASSES = 8

#: What the text is replaced with when the scan cannot reach a fixed point.
NONCONVERGENT_TOKEN = "[redacted:nonconvergent-snippet]"


_URL_BEFORE = re.compile(r"(?:https?|wss?|ftp)://\S*$", re.IGNORECASE | re.ASCII)
_PURE_HEX = re.compile(r"^[0-9a-fA-F]+$")
_SRI_BEFORE = re.compile(r"\bsha(?:256|384|512)-$", re.ASCII)


def _skip_base64(match: re.Match[str]) -> bool:
    m = match.group(0)
    if _PURE_HEX.fullmatch(m):
        return True  # pure hex → long-hex's job (floor 48; 40-hex SHAs must pass)
    if not re.search(r"[0-9]", m):
        return True  # digit-free → identifier/prose
    before = match.string[max(0, match.start() - 2048) : match.start()]
    if _URL_BEFORE.search(before):
        return True  # inside a URL — mid-URL redaction mangles benign text
    if before.endswith(";base64,"):
        return True  # data: URI payload
    if _SRI_BEFORE.search(before):
        return True  # npm/SRI hash-integrity string
    return False


# Order matters: sk-ant… (Anthropic) before the generic sk-… (OpenAI).
# Every pattern carries re.ASCII — see the fidelity note in the module docstring.
_A = re.ASCII
# Leading anchor for every prefixed shape (byte-identical to LEAD in
# snippet-redact.mjs). A plain \b failed behind an escape: in JSONL text a
# newline is the two characters "\" "n", so the char before the key is the
# letter n and the whole key came back raw. Accept "not after a word char" OR
# "right after \n \t \r, %XX or \uXXXX". \b and \f are left out on purpose
# (they almost never precede a key, and accepting them redacted Windows paths
# like C:\bsk-…). Each alternative is fixed-width, which Python's lookbehind
# requires.
_LEAD = r"(?:(?<![A-Za-z0-9_])|(?<=\\[ntr])|(?<=%[0-9A-Fa-f]{2})|(?<=\\u[0-9A-Fa-f]{4}))"


def _lead(first: str, body: str, anchor: str = _LEAD) -> re.Pattern[str]:
    # (?=first) is the body's possible first character, checked BEFORE the anchor.
    # It changes no match; it makes most positions fail on one character compare
    # instead of four lookbehinds (a leading lookbehind defeats re's literal-prefix
    # skip, and with fourteen shapes Python ran past the two-second timing bound).
    return re.compile(f"(?={first})" + anchor + body, _A)


# The JWT anchor also refuses "-" before "eyJ" ("-" is in the JWT alphabet), so
# "eyJ-eyJ-…" no longer gives the regex a fresh, end-of-string scan at every
# repeat (quadratic). Cost: a JWT glued onto "-" is not matched. Mirrors JWT_LEAD.
_JWT_LEAD = _LEAD.replace("(?<![A-Za-z0-9_])", "(?<![A-Za-z0-9_-])")
# The vendor shapes' edges: the scanner's start anchor (the JWT one), and no end
# before a character that could continue a key body. Mirrors VENDOR_LEAD / VENDOR_END.
_VENDOR_LEAD = _JWT_LEAD
_VENDOR_END = "(?![A-Za-z0-9_+/=-])"


_SHAPES: list[tuple[str, re.Pattern[str], Callable[[re.Match[str]], bool] | None]] = [
    ("private-key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)", _A), None),
    # The password run may not cross another "://": unrestricted, every
    # "postgres://u:" in a long run of them scanned to the end for an "@"
    # (quadratic). Every start contains "://", so each scan now stops at the next
    # start — linear with no length cap. Mirrors snippet-redact.mjs.
    # Schemes: TLS Redis, MariaDB, SQL Server, and SQLAlchemy "+driver" forms.
    ("db-uri-creds", _lead("[mprash]", r"(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mariadb|rediss?|amqps?|mssql|sqlserver)(?:\+[a-z0-9]+)?://[^\s:/@]*:(?:(?!://)[^\s@])+@[^\s\"')\]]+"), None),
    # Credentials in an http(s) URL; only "scheme://user:password@" is replaced.
    # Only "user:password@" is replaced; the scheme and host stay. Stops at / ? #.
    ("url-creds", re.compile(r"(?:(?<=https://)|(?<=http://))[^\s:/@?#]+:[^\s@/?#]+@", _A), None),
    ("aws-key", _lead("A", r"AKIA[0-9A-Z]{16}\b"), None),
    ("stripe-key", _lead("[srp]", r"[srp]k_(?:live|test)_[0-9a-zA-Z]{16,}\b"), None),
    ("github-token", _lead("g", r"(?:gh[pousr]_[0-9A-Za-z]{36,}|github_pat_[0-9A-Za-z_]{40,})\b"), None),
    ("google-api-key", _lead("A", r"AIza[0-9A-Za-z\-_]{35}(?:\b|(?![0-9A-Za-z_]))"), None),
    ("slack-token", _lead("x", r"xox[baprs]-[0-9A-Za-z-]{10,}\b"), None),
    # A Slack incoming-webhook URL IS a credential — its own shape (the generic
    # base64 rule skips URL interiors). GovSlack webhooks live on hooks.slack-gov.com.
    ("slack-webhook", _lead("h", r"https://hooks\.slack\.com/services/[A-Za-z0-9/]+"), None),
    ("anthropic-key", _lead("s", r"sk-ant-[A-Za-z0-9_-]{10,}"), None),
    # No (?:proj-|admin-|svcacct-)? alternation, deliberately: "-" is in the
    # trailing class, so the generic form already matches every prefixed
    # variant. Spelling them out looked like coverage and was dead regex.
    ("openai-key", _lead("s", r"sk-[A-Za-z0-9_-]{20,}"), None),
    ("jwt", _lead("e", r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b", _JWT_LEAD), None),
    # ≥48 hex: sha256-length tokens redact; 40-hex git SHAs deliberately pass.
    ("long-hex", _lead("[0-9a-fA-F]", r"[0-9a-fA-F]{48,}\b"), None),
    # ≥40-char base64 run at a token boundary. NEGATIVE lookbehind (not another
    # base64 char) rather than a delimiter allowlist: recall snippets are cut
    # mid-text, so the token can sit at index 0 or behind a bracket.
    # The trailing lookahead deliberately does NOT reject "=". It used to, and
    # that one character caused two bugs at once: a run followed by any extra
    # "=" failed to match AT ALL (so <secret>== + = + <secret> returned the
    # FIRST secret raw while reporting a clean fixed point), and two adjacent
    # padded runs could only be redacted one per pass, which is the entire
    # reason this scan ever needed multiple passes. Mirrors snippet-redact.mjs.
    ("long-base64", re.compile(r"(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/])", _A), _skip_base64),
]


# Vendor shapes from scripts/check-staged-secrets.mjs (SY-3), with the scanner's
# length bounds. NOT in _SHAPES: redact_secret_shapes runs _SHAPES to their fixed
# point exactly as before SY-3, then applies these ONCE to what is left, and
# nothing runs after them, so the result is the pre-SY-3 result with some raw
# stretches turned into tokens. Mirrors VENDOR_SHAPES in snippet-redact.mjs (the
# full reasoning and costs are there); the regex text is the same apart from
# JS's escaped "\/". SendGrid and Doppler first: their dotted bodies can hold
# another vendor prefix.
_VENDOR_SHAPES: list[tuple[str, re.Pattern[str], Callable[[re.Match[str]], bool] | None]] = [
    ("sendgrid-key", _lead("S", r"SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}" + _VENDOR_END, _VENDOR_LEAD), None),
    ("doppler-token", _lead("d", r"dp\.(?:st\.(?:[A-Za-z0-9_-]{1,64}\.)?|(?:ct|pt|sa|said|scim|audit)\.)[A-Za-z0-9]{40,44}" + _VENDOR_END, _VENDOR_LEAD), None),
    ("sentry-token", _lead("s", r"sntry[suai]_[A-Za-z0-9+/=_-]{30,512}" + _VENDOR_END, _VENDOR_LEAD), None),
    ("supabase-secret-key", _lead("s", r"sb_secret_[A-Za-z0-9_-]{20,256}" + _VENDOR_END, _VENDOR_LEAD), None),
    ("stripe-webhook-secret", _lead("w", r"whsec_[0-9a-zA-Z+/=]{24,256}" + _VENDOR_END, _VENDOR_LEAD), None),
    ("render-api-key", _lead("r", r"rnd_[A-Za-z0-9]{24,128}" + _VENDOR_END, _VENDOR_LEAD), None),
    ("supabase-access-token", _lead("s", r"sbp_(?:v0_)?[A-Za-z0-9]{32,128}" + _VENDOR_END, _VENDOR_LEAD), None),
    ("posthog-personal-key", _lead("p", r"phx_[A-Za-z0-9]{30,128}" + _VENDOR_END, _VENDOR_LEAD), None),
    # GovSlack incoming webhooks, with the scanner's segment bounds. Same token
    # as the hooks.slack.com rule above, which is older and keeps its own shape.
    ("slack-webhook", _lead("h", r"https://hooks\.slack-gov\.com/services/[A-Za-z0-9]{1,64}/[A-Za-z0-9]{1,64}/[A-Za-z0-9]{16,64}" + _VENDOR_END, _VENDOR_LEAD), None),
]


def redact_secret_shapes(text: str | None, *, max_passes: int | None = None) -> Redaction:
    """Redact secret-shaped runs in a text snippet.

    Benign text passes through byte-identical. Idempotent for the older
    shapes; a second call can redact more than the first, never less, when a
    vendor token moved a later run out of the base64 rule's URL look-back.
    Returns the redacted text plus one shape name per replacement, in scan order.

    FAIL-CLOSED on non-convergence: if the scan cannot stabilize within
    ``max_passes``, the ENTIRE snippet is replaced with NONCONVERGENT_TOKEN
    rather than returned partially redacted. That is also why there is no
    ``fixed_point`` field on the result - a flag only protects callers who read
    it, and at a security output boundary the ones who don't are exactly the
    ones who leak. Losing a snippet is recoverable; displaying a secret is not.

    ``max_passes`` is a test seam: no real input is known to reach the
    fail-closed branch, so it exists to let that branch be driven red on
    demand. A guard nobody can make fire is a guard nobody has checked.
    """
    if not isinstance(text, str) or not text:
        return Redaction(text or "", [])
    # `isinstance(True, int)` is True in Python, so a bare int check would read
    # max_passes=True as 1 and fail-close a snippet the JS port would redact
    # normally. Reject bools explicitly. (The reverse asymmetry cannot be closed:
    # JS has no int/float distinction, so maxPasses: 1.0 IS 1 there while
    # max_passes=1.0 is a float here and falls back to the default.)
    limit = (
        max_passes
        if isinstance(max_passes, int) and not isinstance(max_passes, bool) and max_passes > 0
        else MAX_REDACTION_PASSES
    )
    out = text
    shapes: list[str] = []

    def _apply(shape_list: list) -> None:
        nonlocal out
        for shape, pattern, skip in shape_list:

            def _replace(m: re.Match[str], *, _shape: str = shape, _skip=skip) -> str:
                if _skip is not None and _skip(m):
                    return m.group(0)
                shapes.append(_shape)
                return f"[redacted:{_shape}]"

            out = pattern.sub(_replace, out)

    for _ in range(limit):
        before = out
        _apply(_SHAPES)
        if out == before:
            # Fixed point of the older shapes, exactly as before SY-3. The vendor
            # shapes then run once, and nothing runs after them (_VENDOR_SHAPES).
            _apply(_VENDOR_SHAPES)
            return Redaction(out, shapes)
    # Never stabilized. Assume the worst about what is still in ``out``.
    return Redaction(NONCONVERGENT_TOKEN, [*shapes, "nonconvergent-snippet"])


def _refuse_if_assertions_disabled() -> None:
    """Refuse to run the self-check when ``assert`` has been compiled out.

    This guard lives INSIDE _self_check, not under ``if __name__ == "__main__"``.
    It used to live there, which meant ``python -O -c "import secret_redaction as
    s; s._self_check()"`` sailed straight past it and printed "all assertions
    passed" against a no-op implementation. A guard reachable by only one of the
    two ways to call the thing is not a guard.
    """
    if not __debug__:
        raise SystemExit(
            "secret_redaction.py self-check: refusing to run with assertions disabled "
            "(-O / PYTHONOPTIMIZE). Re-run without optimization."
        )


def _self_check() -> None:
    """Assert the same contract the JS test suite pins, limits included."""
    _refuse_if_assertions_disabled()
    import time

    cases = [
        ("private-key", "-----BEGIN RSA PRIVATE KEY-----\nMIIEow…\n-----END RSA PRIVATE KEY-----"),  # pragma: allowlist secret
        ("db-uri-creds", "postgres://bususer:hunter22secret@db.example.internal:5432/bus"),  # pragma: allowlist secret
        ("aws-key", "AKIAIOSFODNN7EXAMPLE"),  # pragma: allowlist secret
        # Stripe/Google/Slack fixtures are split at the provider prefix so the
        # committed text does not match a hosted scanner's pattern; the runtime
        # string is unchanged (mirrors test/snippet-redact.test.mjs).
        ("stripe-key", "sk_" + "live_FAKEfakeFAKEfake0123456789"),  # pragma: allowlist secret
        ("github-token", "ghp_abcdefghijklmnopqrstuvwxyz0123456789"),  # pragma: allowlist secret
        ("google-api-key", "AI" + "zaSyA1234567890abcdefghijklmnopqrstuv"),  # pragma: allowlist secret
        ("slack-token", "xox" + "b-123456789012-abcdefghijklmnop"),  # pragma: allowlist secret
        ("slack-webhook", "https://hooks.slack.com/services/T00000001/B00000001/XXXXfakeXXXX1234"),  # pragma: allowlist secret
        ("anthropic-key", "sk-ant-admin01-abc123def456"),
        ("openai-key", "sk-proj-abcdefghijklmnopqrstuvwxyz123456"),
        ("jwt", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9P"),
        ("long-hex", "a" * 24 + "0123456789abcdef" * 2),
        ("long-base64", 'TOKEN="QWxhZGRpbjpvcGVuIHNlc2FtZUFsYWRkaW46b3BlbiBzZXNhbWU="'),  # pragma: allowlist secret
    ]
    for shape, secret in cases:
        text, shapes = redact_secret_shapes(f"…context before {secret} context after…")
        assert shape in shapes, f"expected {shape} in {shapes}"
        assert f"[redacted:{shape}]" in text
        assert "context before" in text and "context after" in text
        assert secret[-12:] not in text, f"tail of {shape} fixture survived"

    # A Google-shaped key whose last character is "-" redacts whole: a trailing \b
    # needs a word character on one side, and "-" plus a delimiter has none.
    dash_key = "AI" + "za" + "a" * 34 + "-"
    for s in (dash_key, f"key {dash_key} end", f'"{dash_key}"'):
        r = redact_secret_shapes(s)
        assert r.shapes == ["google-api-key"], (s, r.shapes)
        assert "AI" + "za" not in r.text, s

    # Benign text passes byte-identical.
    benign = "R-071 closed at commit 0c71e3a — feed restored; see docs/specs/x.md and https://example.com/path?utm_source=bus"
    assert redact_secret_shapes(benign) == (benign, [])

    # 40-hex git SHA passes; 64-hex redacts (floor 48).
    sha_line = "shipped at f6efe271a1277aca79586ee51ef9db30592ac1c5 on main"
    assert redact_secret_shapes(sha_line).text == sha_line
    assert redact_secret_shapes("token=" + "0123456789abcdef" * 4).text == "token=[redacted:long-hex]"

    # Idempotent, including across ADJACENT padded base64 runs (fixed point).
    once = redact_secret_shapes("key sk-ant-admin01-abc123def456 end").text
    assert redact_secret_shapes(once).text == once
    b64 = "QWJjMTIzZGVmNDU2Z2hpNzg5amtsMDEybW5vMzQ1cHFy"  # pragma: allowlist secret
    adj = redact_secret_shapes(f"{b64}=={b64}==")
    assert adj.shapes.count("long-base64") == 2, adj
    assert b64[-12:] not in adj.text
    assert redact_secret_shapes(adj.text).text == adj.text

    # An adjacency chain of any length is fully redacted in ONE pass. Against
    # the old boundary (which vetoed a run followed by "="), 6 and 65 both left
    # raw runs behind. Mirrors the JS test.
    for n in (2, 6, 65, 300):
        chain = redact_secret_shapes(f"{b64}==" * n)
        assert len(chain.shapes) == n, (n, len(chain.shapes))
        assert b64[-12:] not in chain.text, f"a run survived at n={n}"
        assert redact_secret_shapes(chain.text).text == chain.text

    # A stray "=" between two runs must hide neither. This is the leak the old
    # boundary caused: the FIRST secret came back raw while the scan reported
    # itself finished.
    stray = redact_secret_shapes(f"{b64}={b64}")
    assert len(stray.shapes) == 2, stray
    assert b64[-12:] not in stray.text

    # FAIL-CLOSED: a scan that cannot stabilize returns no text at all. No known
    # input reaches this branch, so max_passes is the seam that proves it is
    # wired - a guard nobody can make fire is a guard nobody has checked.
    stuck = redact_secret_shapes(f"{b64}==" * 3, max_passes=1)
    assert stuck.text == NONCONVERGENT_TOKEN, stuck
    assert b64[-12:] not in stuck.text
    assert "nonconvergent-snippet" in stuck.shapes
    assert redact_secret_shapes(f"{b64}==" * 3).text != NONCONVERGENT_TOKEN

    # None/empty are safe; multiple shapes in one snippet all redact.
    assert redact_secret_shapes(None) == ("", [])
    assert redact_secret_shapes("") == ("", [])
    multi = redact_secret_shapes("creds: AKIAIOSFODNN7EXAMPLE + " + "xox" + "b-123456789012-abcdefghijklmnop")  # pragma: allowlist secret
    assert multi.text == "creds: [redacted:aws-key] + [redacted:slack-token]"

    # Snippet-boundary positions: index 0 and behind a bracket both redact.
    b64_padded = "QWxhZGRpbjpvcGVuIHNlc2FtZUFsYWRkaW46b3BlbiBzZXNhbWU="  # pragma: allowlist secret
    assert redact_secret_shapes(b64_padded).text == "[redacted:long-base64]"
    assert "long-base64" in redact_secret_shapes(f"({b64_padded})").shapes

    # VENDOR SHAPES (SY-3) — the scanner's vendor shapes, the same table as
    # test/redactor-vendor-shapes.test.mjs. Prefixes are split so no committed
    # line matches a provider pattern; the runtime strings are whole.
    def body(n: int) -> str:
        # Letters only: the base64 rule skips digit-free runs, so these reach the
        # vendor shapes, which run last. A body with digits is the LIMIT below.
        return ("Fxkq" * (n // 4 + 1))[:n]

    import base64
    import json as _json

    def jwt_with(payload: dict) -> str:
        compact = _json.dumps(payload, separators=(",", ":"))  # byte-identical to JS JSON.stringify
        seg = base64.urlsafe_b64encode(compact.encode()).decode().rstrip("=")
        return "eyJhbGciOiJIUzI1NiJ9." + seg + ".FIXTUREsignature"

    vendor_cases = [
        ("render-api-key", "rn" + "d_" + body(32)),
        ("render-api-key", "rn" + "d_" + body(128)),
        ("doppler-token", "d" + "p.st." + body(43)),
        ("doppler-token", "d" + "p.st.my-config_1." + body(44)),
        ("doppler-token", "d" + "p.ct." + body(40)),
        ("doppler-token", "d" + "p.pt." + body(43)),
        ("doppler-token", "d" + "p.sa." + body(43)),
        ("doppler-token", "d" + "p.said." + body(43)),
        ("doppler-token", "d" + "p.scim." + body(43)),
        ("doppler-token", "d" + "p.audit." + body(43)),
        ("sendgrid-key", "S" + "G." + body(22) + "." + body(21) + "-_" + body(20)),
        ("supabase-access-token", "sb" + "p_" + body(40)),
        ("supabase-access-token", "sb" + "p_v0_" + body(40)),
        ("supabase-secret-key", "sb" + "_secret_" + body(24) + "-_" + body(6)),
        ("posthog-personal-key", "ph" + "x_" + body(43)),
        ("sentry-token", "sntr" + "ys_" + body(40)),
        ("sentry-token", "sntr" + "yu_" + body(40)),
        ("sentry-token", "sntr" + "ya_" + body(40)),
        ("sentry-token", "sntr" + "yi_" + body(36) + "+/=_"),
        ("stripe-webhook-secret", "wh" + "sec_" + body(32)),
        ("slack-webhook", "https://hooks.slack" + "-gov.com/services/T0001/B0001/" + body(24)),
        ("stripe-key", "r" + "k_live_" + body(23) + "7"),
        ("jwt", jwt_with({"role": "service_role"})),
        ("jwt", jwt_with({"role": "anon"})),  # every JWT redacts here; the scanner's role rule is for commits
    ]
    # LIMIT: a JWT header of eyJ + 8 or 9 passes here (the scanner takes it); the
    # redactors' floor stays eyJ + 10 so a short JWT cannot cut a base64 run short.
    short_jwt = "eyJAAAAAAAA." + jwt_with({"role": "service_role"}).split(".")[1] + ".AAAAAAAA"
    assert "jwt" not in redact_secret_shapes(f"x {short_jwt} y").shapes
    for shape, secret in vendor_cases:
        r = redact_secret_shapes(f"…context before {secret} context after…")
        assert r == (f"…context before [redacted:{shape}] context after…", [shape]), (shape, r)
        if shape in ("jwt", "slack-webhook"):
            continue
        for residue in ["x\\n", "x\\t", "x\\r", "a%3D", "\\u0022", "\\\\n"]:
            text = redact_secret_shapes(f'{{"text":"line1{residue}{secret}"}}').text
            assert f"line1{residue}[redacted:{shape}]" in text, f"{residue!r} {shape}: {text}"
    # The common env-file forms redact: KEY=value, KEY: value, quoted, after a slash.
    render = "rn" + "d_" + body(32)
    for pre, post in [("RENDER_API_KEY=", ""), ("render_key: ", ""), ('"', '"'), ("'", "'"), ("/", ""), ("+", "")]:
        assert redact_secret_shapes(f"{pre}{render}{post}").shapes == ["render-api-key"], pre
    # A vendor shape never redacts a piece out of another key, nor an older shape
    # out of a vendor key (three Codex rounds reproduced each against earlier
    # versions). Mirrors OVERLAP in the JS test, which also runs the pairwise
    # check against the pre-SY-3 oracle.
    for value, expected in [
        ("sk-ant-" + "rn" + "d_" + "A" * 24, "[redacted:anthropic-key]"),
        ("sk-short-" + "rn" + "d_" + "A" * 24, "[redacted:openai-key]"),
        ("eyJabcdefghij-" + "rn" + "d_" + "A" * 24 + ".BBBBBBBBBBBBBBBB.CCCCCCCCCCCCCCCC", "[redacted:jwt]"),
        ("eyJabcdefghij." + "rn" + "d_" + "A" * 24 + "." + "A" * 16, "[redacted:jwt]"),
        ("S" + "G." + "A" * 22 + "." + "B" * 14 + "-" + "rn" + "d_" + "C" * 24, "[redacted:sendgrid-key]"),
        ("S" + "G." + "A" * 22 + "." + "sntr" + "yu_" + "A" * 36, "[redacted:sendgrid-key]"),
        ("d" + "p.st." + "sb" + "_secret_" + "A" * 20 + "." + "A" * 40, "[redacted:doppler-token]"),
        ("wh" + "sec_" + "A" * 24 + "/" + "gh" + "p_" + "A" * 36, "[redacted:stripe-webhook-secret][redacted:github-token]"),
        ("sb" + "_secret_-" + "gh" + "p_" + "A" * 36, "sb_secret_-[redacted:github-token]"),
        ("sntr" + "yu_" + "A" * 20 + "-" + "ph" + "x_" + body(30), "[redacted:sentry-token]"),
        ("rn" + "d_" + "G7" * 70, "rnd_[redacted:long-base64]"),  # past the ceiling: as before SY-3
    ]:
        got = redact_secret_shapes(f"x {value} y").text
        assert got == f"x {expected} y", (value[:12], got)
    vendor_names = {s for s, _ in vendor_cases} - {"jwt", "stripe-key", "slack-webhook"}

    def vendor_hits(text: str) -> list[str]:
        return [s for s in redact_secret_shapes(text).shapes if s in vendor_names]

    for short in [  # LIMIT: no vendor shape fires under the scanner's floor (another rule still may)
        "rn" + "d_" + body(23),
        "ph" + "x_" + body(29),
        "sb" + "p_" + body(31),
        "wh" + "sec_" + body(23),
        "sntr" + "yu_" + body(29),
        "d" + "p.st." + body(39),
        "S" + "G." + body(17) + "." + body(20),  # SendGrid's segments are exactly 22 and 43
    ]:
        assert vendor_hits(f"x {short} y") == [], short[:8]
    # LIMIT: a body past the ceiling is not a vendor match; a digit-free one is
    # skipped by the base64 rule too, as before SY-3.
    for over in ["rn" + "d_" + "A" * 200, "d" + "p.st." + "A" * 45, "S" + "G." + "A" * 22 + "." + "A" * 44]:
        assert redact_secret_shapes(f"x {over} y").shapes == [], over[:8]
    # LIMIT: no vendor shape starts right after a word character, "_" or "-" (the
    # scanner's anchor), nor ends right before a character outside its body that
    # could continue a key. Other rules still may redact these.
    for shape, secret in vendor_cases:
        if shape in vendor_names:
            for c in ["x", "7", "_", "-"]:
                assert vendor_hits(f"a {c}{secret} b") == [], (shape, c)
    for c in ["+", "/", "=", "_", "-"]:
        assert vendor_hits(f"a {render}{c} b") == [], c
    # LIMIT: the vendor shapes run LAST, so where a generic rule takes a vendor
    # key's body first, the token is the generic one and the prefix shows (the
    # body is still hidden). Under 40 characters nothing generic matches.
    assert redact_secret_shapes("k " + "rn" + "d_" + "Fx7k" * 32 + " e").text == "k rnd_[redacted:long-base64] e"
    assert redact_secret_shapes("k " + "d" + "p.st." + "Fx7k" * 11 + " e").text == "k dp.st.[redacted:long-base64] e"
    assert redact_secret_shapes("k " + "rn" + "d_" + "Fx7k" * 8 + " e").text == "k [redacted:render-api-key] e"
    # LIMIT: a generic rule can take PART of a vendor key's body and leave the
    # rest showing, exactly as before SY-3.
    part = redact_secret_shapes("k " + "sntr" + "yu_" + "G7" * 20 + "_" + "H8" * 19 + " e").text
    assert part == "k sntryu_[redacted:long-base64]_" + "H8" * 19 + " e", part
    # The vendor shapes run once, after the older shapes' fixed point (Codex
    # round 4): a chain of over-long Sentry keys, each matchable only once the
    # next is replaced, no longer runs the loop into NONCONVERGENT_TOKEN.
    chain = ("sntr" + "yu_" + "A" * 500 + "/") * 7 + "rn" + "d_" + "A" * 24
    assert redact_secret_shapes(chain).text == chain[: -len("rn" + "d_" + "A" * 24)] + "[redacted:render-api-key]"

    # DOCUMENTED LIMITS — asserted so the boundary is a contract, not a surprise.
    legacy_pat = "e72c1b4a9f3d5e6a8b0c2d4f6a8b0c2d4f6a8b0c"  # pragma: allowlist secret
    assert redact_secret_shapes(f"token={legacy_pat}").shapes == []  # LIMIT: 40-hex passes
    assert redact_secret_shapes("MY_SERVICE_TOKEN=hunter2hunter2").shapes == []  # LIMIT: no key-name rules
    for vendor in ["xapp-1-A012-3456-abcdef"]:
        assert redact_secret_shapes(vendor).shapes == []  # LIMIT: unlisted vendors pass
    url_line = "see https://api.example.com/v2/projects/abc123def456ghi789/resources/jkl012mno345pqr678stu901 for details"
    assert redact_secret_shapes(url_line) == (url_line, [])  # base64 skips URL interiors
    for line in [f"data:image/png;base64,{b64}", f"integrity sha512-{b64}=="]:
        assert redact_secret_shapes(line).text == line  # data: URI + SRI hash pass
    ident = "const VERYLONGCONSTANTNAMEWITHOUTANYDIGITSATALLXYZ = value"
    assert redact_secret_shapes(ident).text == ident  # LIMIT: digit-free runs pass
    assert redact_secret_shapes('t="QWJjMTIzZGVmNDU2Z2hpNzg5amts"').shapes == []  # LIMIT: base64 under 40 chars passes
    assert redact_secret_shapes("ghp_abcdefghij").shapes == []  # LIMIT: a secret split across a snippet boundary passes

    # ESCAPE RESIDUE — a key right after a literal \n, \t, \r, %3D or " (as
    # stored in JSONL / URL-encoded text) redacts. Mirrors the JS suite.
    residues = ["x\\n", "x\\t", "x\\r", "a%3D", "\\u0022", "\\\\n"]
    alternatives = [
        ("db-uri-creds", "mongodb+srv://u:hunter22secret@cluster0.example.net/db"),  # pragma: allowlist secret
        ("stripe-key", "pk_test_FAKEfakeFAKEfake0123456789"),  # pragma: allowlist secret
        ("github-token", "github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz0123456789"),  # pragma: allowlist secret
        ("github-token", "gho_abcdefghijklmnopqrstuvwxyz0123456789ab"),  # pragma: allowlist secret
        ("openai-key", "sk-abcdefghijklmnopqrstuvwxyz123456"),  # pragma: allowlist secret
        # TLS Redis, SQLAlchemy driver forms, MariaDB; credentials in an http(s) URL.
        ("db-uri-creds", "rediss://default:Abc123Def456Ghi789Jkl012Mno345Pq@redis.example:6379"),  # pragma: allowlist secret
        ("db-uri-creds", "postgresql+asyncpg://u:Abc123Def456Ghi789Jkl012Mno345Pq@db/x"),  # pragma: allowlist secret
        ("db-uri-creds", "mysql+pymysql://u:Abc123Def456Ghi789Jkl012Mno345Pq@db/x"),  # pragma: allowlist secret
        ("db-uri-creds", "mariadb://u:Abc123Def456Ghi789Jkl012Mno345Pq@db/x"),  # pragma: allowlist secret
        ("url-creds", "https://deploy:Abc123Def456Ghi789Jkl012Mno345Pq@"),  # pragma: allowlist secret
    ]
    prefixed = [c for c in cases if c[0] not in ("private-key", "long-base64")] + alternatives
    for shape, secret in prefixed:
        for residue in residues:
            text, shapes = redact_secret_shapes(f'{{"text":"line1{residue}{secret}"}}')
            assert shape in shapes, f"{residue!r}: expected {shape} in {shapes}"
            assert secret[-12:] not in text, f"{residue!r}: tail of {shape} survived"
            if shape == "long-hex" and "%" in residue:
                continue  # "3D" is hex: the run starts at "3" behind "%" (passed pre-fix too)
            kept = re.match(r"https?://", secret).group(0) if shape == "url-creds" else ""  # url-creds keeps the scheme
            assert f"line1{residue}{kept}[redacted:{shape}]" in text, f"{residue!r}: residue not preserved in {text}"
    glued_cases = [
        "task-abcdefghijklmnopqrstuvwxyz",
        "risk-abcdefghijklmnopqrstuvwxyz",
        "myAKIAIOSFODNN7EXAMPLE",  # pragma: allowlist secret
        r"C:\bsk-abcdefghijklmnopqrst",  # \b and \f are not residues: Windows paths pass
        r"C:\fsk-abcdefghijklmnopqrst",
    ]
    url_line = redact_secret_shapes("git remote https://deploy:Abc123Def456Ghi789Jkl012Mno345Pq@git.example/repo.git")  # pragma: allowlist secret
    assert url_line.text == "git remote https://[redacted:url-creds]git.example/repo.git", url_line  # scheme, host and path stay
    for not_creds in ["https://h:443?token=value@else", "https://h/#a:b@c", "http://user@host/x"]:  # pragma: allowlist secret
        assert "url-creds" not in redact_secret_shapes(not_creds).shapes, not_creds  # an @ in a query/fragment, no password
    for glued in glued_cases:
        assert redact_secret_shapes(glued).shapes == [], glued  # the anchor keeps the word boundary
    k = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"  # pragma: allowlist secret
    assert redact_secret_shapes("x" + k).shapes == []  # LIMIT: glued to a word, no escape
    for s in [r"\x22" + k, "%2522" + k, r"postgres:\/\/u:hunter22secret@db"]:  # pragma: allowlist secret
        assert redact_secret_shapes(s).shapes == [], s  # LIMIT: other escapes, escaped URI slashes
    assert redact_secret_shapes("https://example.test/%62sk-abcdefghijklmnopqrst").shapes == ["openai-key"]  # LIMIT: %XX not decoded
    jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9P"
    assert "jwt" not in redact_secret_shapes("token-" + jwt).shapes  # LIMIT: a JWT glued onto "-" (ReDoS bound)
    assert "jwt" in redact_secret_shapes("token=" + jwt).shapes
    # Long and URL-encoded DB-URI credentials still redact ("-"/"%" keep base64 out).
    for uri in [
        "postgres://u:" + "p%40" * 65 + "@db.example/x",
        "postgres://u:" + "p-" * 600 + "@db.example/x",
        "postgres://" + "u-" * 129 + ":pw-pw-pw@db.example/x",
    ]:
        assert "db-uri-creds" in redact_secret_shapes(uri).shapes, uri[:30]
    assert "db-uri-creds" not in redact_secret_shapes("postgres://u:a://b-c-d@db.example/x").shapes  # LIMIT: "://" in a password  # pragma: allowlist secret

    # CROSS-LANGUAGE FIDELITY — cases that diverged from the JS before re.ASCII.
    e_aws = redact_secret_shapes("éAKIAIOSFODNN7EXAMPLE")  # pragma: allowlist secret
    assert "aws-key" in e_aws.shapes, "Unicode \\b must not hide an ASCII-adjacent key"
    e_sri = f"ésha512-{b64}"
    assert redact_secret_shapes(e_sri).text == e_sri, "SRI skip must apply behind a non-ASCII char"
    ctrl_url = f"https://x.example/a\x1c{b64_padded}"
    assert redact_secret_shapes(ctrl_url).text == ctrl_url, "U+001C is not whitespace in JS; the URL skip must still reach back"

    # Linear on adversarial input (no catastrophic backtracking).
    started = time.monotonic()
    for probe in [
        "postgres://u:" + "a" * 50_000,
        "-----BEGIN RSA PRIVATE KEY-----\n" + "A" * 200_000,
        "eyJ" + "a" * 200_000,
        " " + "A" * 200_000,
        "sk-" + "a" * 200_000,
        "\\n" * 100_000 + "ghp_abcdefghijklmnopqrstuvwxyz0123456789",  # pragma: allowlist secret
        "%3D" * 100_000 + "ghp_abcdefghijklmnopqrstuvwxyz0123456789",  # pragma: allowlist secret
        # MANY start positions, not one (quadratic if each runs unbounded).
        "postgres://u:" * 15_000,
        "eyJ-" * 50_000,
        # Vendor shapes (SY-3): repeated prefixes and long bodies.
        ("sb" + "_secret_") * 20_000,
        ("sntr" + "yu_") * 25_000,
        ("d" + "p.st.") * 30_000,
        "d" + "p.st." + "a-" * 100_000,
        ("S" + "G.") * 60_000,
        "S" + "G." + "a" * 22 + "." + "-" * 200_000,
        "rn" + "d_" + "a" * 200_000,
        ("wh" + "sec_") * 30_000,
        ("https://hooks.slack" + "-gov.com/services/") * 5_000,
    ]:
        redact_secret_shapes(probe)
    assert time.monotonic() - started < 2.0, "redaction should stay linear on 200k-char input"

    print("secret_redaction.py self-check: all assertions passed")


if __name__ == "__main__":
    _self_check()  # the -O refusal lives inside it, so importers get it too
