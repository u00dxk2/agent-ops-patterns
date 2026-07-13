// @ts-check
/**
 * snippet-redact.mjs — secret-shape redaction at the OUTPUT boundary.
 *
 * The chokepoint pattern: anything that recalls stored text back into a
 * display surface or model context (session-search snippets, log excerpts,
 * memory quotes) passes through redactSecretShapes() at the last moment
 * before it's shown. Index-time scrubbing can't help when you're searching
 * text that already exists; the output boundary is the one place every
 * recall path goes through. Redaction tokens name the shape
 * (`[redacted:github-token]`) so hits stay findable and debuggable.
 *
 * Pattern lineage: reimplemented (not ported) from the index-boundary scrub
 * in CorvinOS's conversation recall (https://github.com/CorvinLabs/CorvinOS)
 * — moved to the output boundary so it also protects text indexed before the
 * guard existed.
 *
 * Design rules:
 * - DISPLAY boundary only. Never run this over text that will be executed
 *   or written back to storage — redaction must not corrupt commands,
 *   Authorization headers, or data at rest.
 * - Deliberate carve-out: 40-hex git SHAs are NOT redacted (development
 *   text cites them constantly); the hex floor is 48 so sha256-length
 *   tokens still redact.
 * - Pure, zero-dependency, idempotent. Benign text passes byte-identical.
 *
 * WHAT THIS DOES NOT CATCH (defense-in-depth, NOT a DLP guarantee — a
 * shape-matcher cannot recognize a secret it has no shape for):
 * - **40-hex strings, deliberately.** A pre-2021 GitHub personal access token
 *   is 40 hex characters — the same shape as a git SHA. Shape alone cannot
 *   tell them apart, and redacting every SHA in developer text is worse than
 *   useless. We pass 40-hex through. If you may have legacy 40-hex tokens in
 *   recalled text, rotate them; this lib will not save you.
 * - **Opaque / unprefixed credentials**: `MY_SERVICE_TOKEN=<random>`, session
 *   cookies, short-lived OAuth codes, `Authorization:` header values, and any
 *   vendor whose key has no distinctive prefix. Key-name-based rules (KEY=…,
 *   "token": …) are deliberately absent — they false-positive hard on source
 *   code, and this runs on recalled prose. Pair with a key-name scrubber at
 *   ingestion if you need that class.
 * - **Vendors not in SHAPES**: SendGrid (SG.), Slack app-level (xapp-),
 *   Telegram bot tokens, and many more. Adding a shape is a one-line PR; the
 *   list here is what our own corpus actually leaked.
 * - **Base64 under 40 chars**, and secrets split across a snippet boundary.
 * - **Generic base64 inside URLs, data: URIs, and hash-integrity strings
 *   (sha256-/sha384-/sha512-…) is deliberately skipped** — those runs are
 *   overwhelmingly webhook paths, inline assets, and lockfile hashes, and
 *   mid-URL redaction mangles benign text. A credential that *is* a URL
 *   wants its own shape rule (see slack-webhook; db-uri-creds covers
 *   user:pass URIs). Digit-free base64 runs are skipped too — a 40+ char
 *   random token with zero digits is vanishingly rare, and letters-only
 *   runs are almost always identifiers or prose.
 *
 * Tested in test/snippet-redact.test.mjs (node --test), including the
 * false-negative cases above as explicit, documented expectations.
 */

const SHAPES = [
  { shape: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { shape: "db-uri-creds", re: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqps?):\/\/[^\s:/@]*:[^\s@]+@[^\s"')\]]+/g },
  { shape: "aws-key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { shape: "stripe-key", re: /\b[srp]k_(?:live|test)_[0-9a-zA-Z]{16,}\b/g },
  { shape: "github-token", re: /\b(?:gh[pousr]_[0-9A-Za-z]{36,}|github_pat_[0-9A-Za-z_]{40,})\b/g },
  { shape: "google-api-key", re: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
  { shape: "slack-token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
  // A Slack incoming-webhook URL IS a credential — redact it as its own shape
  // (the generic base64 rule skips URL interiors; see skip below).
  { shape: "slack-webhook", re: /\bhttps:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g },
  // sk-ant… (Anthropic, incl. admin) before the generic sk-… (OpenAI incl. sk-proj/sk-admin).
  { shape: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{10,}/g },
  { shape: "openai-key", re: /\bsk-(?:proj-|admin-|svcacct-)?[A-Za-z0-9_-]{20,}/g },
  { shape: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g },
  // ≥48 hex: sha256-length tokens redact; 40-hex git SHAs deliberately pass.
  { shape: "long-hex", re: /\b[0-9a-fA-F]{48,}\b/g },
  // ≥40-char base64 run at a token boundary. The lookbehind is NEGATIVE (not
  // preceded by another base64 char) rather than a delimiter allowlist: a
  // recall snippet is routinely cut mid-text, so the token can sit at index 0
  // or behind a bracket, and an allowlist ([=:"'\s]) silently missed both.
  // Skipped (each with a LIMIT test): pure-hex runs (hex is a base64 subset;
  // 40-hex git SHAs must pass — hex secrets are the long-hex rule's job,
  // floor 48); digit-free runs (letters-only 40+ char runs are identifiers/
  // prose, and a random token with zero digits is vanishingly rare); runs
  // inside a URL (mid-URL redaction mangles webhook/API paths — a URL-shaped
  // credential wants its own shape rule); data: URI payloads; and npm/SRI
  // hash-integrity strings (sha256-/sha384-/sha512-<base64>).
  {
    shape: "long-base64",
    re: /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/=])/g,
    skip: (/** @type {string} */ m, /** @type {number} */ offset, /** @type {string} */ src) => {
      if (/^[0-9a-fA-F]+$/.test(m)) return true; // pure hex → long-hex's job
      if (!/[0-9]/.test(m)) return true; // digit-free → identifier/prose
      const before = src.slice(Math.max(0, offset - 2048), offset);
      if (/(?:https?|wss?|ftp):\/\/\S*$/i.test(before)) return true; // inside a URL
      if (/;base64,$/.test(before)) return true; // data: URI payload
      if (/\bsha(?:256|384|512)-$/.test(before)) return true; // hash-integrity string
      return false;
    },
  },
];

/**
 * Redact secret-shaped runs in a text snippet. Idempotent; benign text passes
 * through byte-identical.
 * @param {string|null|undefined} text
 * @returns {{ text: string, shapes: string[] }} shapes = one entry per replacement, in scan order
 */
export function redactSecretShapes(text) {
  if (typeof text !== "string" || text.length === 0) return { text: text ?? "", shapes: [] };
  let out = text;
  const shapes = /** @type {string[]} */ ([]);
  // Scan to a fixed point: a replacement can expose a boundary the first pass
  // couldn't match (e.g. two adjacent padded base64 runs — the first run's
  // trailing "=" blocks the lookahead until the second run is replaced).
  // Idempotency (f(f(x)) === f(x)) falls out for free: the returned text IS a
  // fixed point. The cap is a guard against a pathological oscillation only.
  for (let pass = 0; pass < 5; pass++) {
    const before = out;
    for (const { shape, re, skip } of SHAPES) {
      out = out.replace(re, (m, offset, src) => {
        if (skip && skip(m, offset, src)) return m;
        shapes.push(shape);
        return `[redacted:${shape}]`;
      });
    }
    if (out === before) break;
  }
  return { text: out, shapes };
}
