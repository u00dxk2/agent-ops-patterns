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
 - **Vendors not in SHAPES** (SendGrid ``SG.``, Slack ``xapp-``, …). Adding a
   shape is a one-line PR; the list is what our own corpus actually leaked.
 - **Base64 under 40 chars**, and secrets split across a snippet boundary.
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
    fixed_point: bool = True


# Maximum redaction passes. N adjacent padded base64 runs need N passes to
# converge, so this is also the longest adjacency chain that reaches a fixed
# point. Beyond it the result carries fixed_point=False and one or more runs
# may remain unredacted. Mirrors MAX_REDACTION_PASSES in snippet-redact.mjs.
MAX_REDACTION_PASSES = 64


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
_SHAPES: list[tuple[str, re.Pattern[str], Callable[[re.Match[str]], bool] | None]] = [
    ("private-key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)", _A), None),
    ("db-uri-creds", re.compile(r"\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqps?)://[^\s:/@]*:[^\s@]+@[^\s\"')\]]+", _A), None),
    ("aws-key", re.compile(r"\bAKIA[0-9A-Z]{16}\b", _A), None),
    ("stripe-key", re.compile(r"\b[srp]k_(?:live|test)_[0-9a-zA-Z]{16,}\b", _A), None),
    ("github-token", re.compile(r"\b(?:gh[pousr]_[0-9A-Za-z]{36,}|github_pat_[0-9A-Za-z_]{40,})\b", _A), None),
    ("google-api-key", re.compile(r"\bAIza[0-9A-Za-z\-_]{35}\b", _A), None),
    ("slack-token", re.compile(r"\bxox[baprs]-[0-9A-Za-z-]{10,}\b", _A), None),
    # A Slack incoming-webhook URL IS a credential — its own shape (the generic
    # base64 rule skips URL interiors).
    ("slack-webhook", re.compile(r"\bhttps://hooks\.slack\.com/services/[A-Za-z0-9/]+", _A), None),
    ("anthropic-key", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{10,}", _A), None),
    ("openai-key", re.compile(r"\bsk-(?:proj-|admin-|svcacct-)?[A-Za-z0-9_-]{20,}", _A), None),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b", _A), None),
    # ≥48 hex: sha256-length tokens redact; 40-hex git SHAs deliberately pass.
    ("long-hex", re.compile(r"\b[0-9a-fA-F]{48,}\b", _A), None),
    # ≥40-char base64 run at a token boundary. NEGATIVE lookbehind (not another
    # base64 char) rather than a delimiter allowlist: recall snippets are cut
    # mid-text, so the token can sit at index 0 or behind a bracket.
    ("long-base64", re.compile(r"(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/=])", _A), _skip_base64),
]


def redact_secret_shapes(text: str | None) -> Redaction:
    """Redact secret-shaped runs in a text snippet.

    Idempotent; benign text passes through byte-identical. Returns the
    redacted text plus one shape name per replacement, in scan order.
    """
    if not isinstance(text, str) or not text:
        return Redaction(text or "", [], True)
    out = text
    shapes: list[str] = []

    # Scan to a fixed point: a replacement can expose a boundary the first
    # pass couldn't match (two adjacent padded base64 runs — the first run's
    # trailing "=" blocks the lookahead until the second run is replaced).
    # Each changing pass peels one layer of adjacency, so N adjacent runs need
    # N passes. The cap guards against pathological oscillation; when it is
    # reached the text is NOT a fixed point and fixed_point=False says so,
    # rather than letting a caller assume idempotency it did not get.
    fixed_point = False
    for _ in range(MAX_REDACTION_PASSES):
        before = out
        for shape, pattern, skip in _SHAPES:

            def _replace(m: re.Match[str], *, _shape: str = shape, _skip=skip) -> str:
                if _skip is not None and _skip(m):
                    return m.group(0)
                shapes.append(_shape)
                return f"[redacted:{_shape}]"

            out = pattern.sub(_replace, out)
        if out == before:
            fixed_point = True
            break
    return Redaction(out, shapes, fixed_point)


def _self_check() -> None:
    """Assert the same contract the JS test suite pins, limits included."""
    import time

    cases = [
        ("private-key", "-----BEGIN RSA PRIVATE KEY-----\nMIIEow…\n-----END RSA PRIVATE KEY-----"),  # pragma: allowlist secret
        ("db-uri-creds", "postgres://bususer:hunter22secret@db.example.internal:5432/bus"),  # pragma: allowlist secret
        ("aws-key", "AKIAIOSFODNN7EXAMPLE"),  # pragma: allowlist secret
        ("stripe-key", "sk_live_FAKEfakeFAKEfake0123456789"),  # pragma: allowlist secret
        ("github-token", "ghp_abcdefghijklmnopqrstuvwxyz0123456789"),  # pragma: allowlist secret
        ("google-api-key", "AIzaSyA1234567890abcdefghijklmnopqrstuv"),  # pragma: allowlist secret
        ("slack-token", "xoxb-123456789012-abcdefghijklmnop"),  # pragma: allowlist secret
        ("slack-webhook", "https://hooks.slack.com/services/T00000001/B00000001/XXXXfakeXXXX1234"),  # pragma: allowlist secret
        ("anthropic-key", "sk-ant-admin01-abc123def456"),
        ("openai-key", "sk-proj-abcdefghijklmnopqrstuvwxyz123456"),
        ("jwt", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9P"),
        ("long-hex", "a" * 24 + "0123456789abcdef" * 2),
        ("long-base64", 'TOKEN="QWxhZGRpbjpvcGVuIHNlc2FtZUFsYWRkaW46b3BlbiBzZXNhbWU="'),  # pragma: allowlist secret
    ]
    for shape, secret in cases:
        # Attribute access, not 2-tuple unpacking: Redaction carries a third
        # field (fixed_point) as of the adjacency fix, so `a, b = ...` raises.
        result = redact_secret_shapes(f"…context before {secret} context after…")
        text, shapes = result.text, result.shapes
        assert shape in shapes, f"expected {shape} in {shapes}"
        assert f"[redacted:{shape}]" in text
        assert "context before" in text and "context after" in text
        assert secret[-12:] not in text, f"tail of {shape} fixture survived"

    # Benign text passes byte-identical.
    benign = "R-071 closed at commit 0c71e3a — feed restored; see docs/specs/x.md and https://example.com/path?utm_source=bus"
    assert redact_secret_shapes(benign) == (benign, [], True)

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

    # N adjacent runs need N passes. Six is the case that failed under the old
    # 5-pass cap — one run survived and f(f(x)) != f(x). Mirrors the JS test.
    long_chain = redact_secret_shapes(f"{b64}==" * 6)
    assert long_chain.fixed_point is True, long_chain
    assert b64[-12:] not in long_chain.text, "no run may survive the scan"
    assert redact_secret_shapes(long_chain.text).text == long_chain.text

    # LIMIT: past the cap the result is NOT a fixed point, and says so rather
    # than returning partly-redacted text that claims idempotency.
    over = redact_secret_shapes(f"{b64}==" * (MAX_REDACTION_PASSES + 2))
    assert over.fixed_point is False, over
    assert redact_secret_shapes(over.text).text != over.text

    # None/empty are safe; multiple shapes in one snippet all redact.
    assert redact_secret_shapes(None) == ("", [], True)
    assert redact_secret_shapes("") == ("", [], True)
    multi = redact_secret_shapes("creds: AKIAIOSFODNN7EXAMPLE + xoxb-123456789012-abcdefghijklmnop")  # pragma: allowlist secret
    assert multi.text == "creds: [redacted:aws-key] + [redacted:slack-token]"

    # Snippet-boundary positions: index 0 and behind a bracket both redact.
    b64_padded = "QWxhZGRpbjpvcGVuIHNlc2FtZUFsYWRkaW46b3BlbiBzZXNhbWU="  # pragma: allowlist secret
    assert redact_secret_shapes(b64_padded).text == "[redacted:long-base64]"
    assert "long-base64" in redact_secret_shapes(f"({b64_padded})").shapes

    # DOCUMENTED LIMITS — asserted so the boundary is a contract, not a surprise.
    legacy_pat = "e72c1b4a9f3d5e6a8b0c2d4f6a8b0c2d4f6a8b0c"  # pragma: allowlist secret
    assert redact_secret_shapes(f"token={legacy_pat}").shapes == []  # LIMIT: 40-hex passes
    assert redact_secret_shapes("MY_SERVICE_TOKEN=hunter2hunter2").shapes == []  # LIMIT: no key-name rules
    for vendor in ["SG.abcdefghijklmnopq.abcdefghij1234567890", "xapp-1-A012-3456-abcdef"]:  # pragma: allowlist secret
        assert redact_secret_shapes(vendor).shapes == []  # LIMIT: unlisted vendors pass
    url_line = "see https://api.example.com/v2/projects/abc123def456ghi789/resources/jkl012mno345pqr678stu901 for details"
    assert redact_secret_shapes(url_line) == (url_line, [], True)  # base64 skips URL interiors
    for line in [f"data:image/png;base64,{b64}", f"integrity sha512-{b64}=="]:
        assert redact_secret_shapes(line).text == line  # data: URI + SRI hash pass
    ident = "const VERYLONGCONSTANTNAMEWITHOUTANYDIGITSATALLXYZ = value"
    assert redact_secret_shapes(ident).text == ident  # LIMIT: digit-free runs pass
    assert redact_secret_shapes('t="QWJjMTIzZGVmNDU2Z2hpNzg5amts"').shapes == []  # LIMIT: base64 under 40 chars passes
    assert redact_secret_shapes("ghp_abcdefghij").shapes == []  # LIMIT: a secret split across a snippet boundary passes

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
    ]:
        redact_secret_shapes(probe)
    assert time.monotonic() - started < 2.0, "redaction should stay linear on 200k-char input"

    print("secret_redaction.py self-check: all assertions passed")


if __name__ == "__main__":
    # Refuse to "pass" with assertions compiled out. Under `python -O` or
    # PYTHONOPTIMIZE, every assert below vanishes and the success line would
    # print against a no-op implementation — a check that cannot go red.
    if not __debug__:
        raise SystemExit(
            "secret_redaction.py self-check: refusing to run with assertions disabled "
            "(-O / PYTHONOPTIMIZE). Re-run without optimization."
        )
    _self_check()
