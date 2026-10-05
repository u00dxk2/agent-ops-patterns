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
 * - Pure, zero-dependency, idempotent. Benign text passes byte-identical
 *   (one known exception: the `%XX` limit below).
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
 * - **Prefixed keys in some encodings.** A prefixed shape matches an intact
 *   key that starts after a non-word character or right after a `\n`, `\t`,
 *   `\r`, `%XX` or `\uXXXX` escape (see LEAD below). It misses a key glued
 *   straight onto a word (`xghp_…`), a key behind any other escape (`\x22`,
 *   double-encoded `%2522`, `\b`, `\f`), and a URI whose own slashes are
 *   escaped (`postgres:\/\/…`). The base64 fallback catches some of these and
 *   not others; do not count on it.
 * - **`%XX` is not decoded**, so any `%XX` counts as an escape: `%62sk-…`
 *   (which decodes to `bsk-…`) is redacted as a key. A display-only false
 *   positive, accepted.
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

/**
 * The leading anchor for every prefixed shape. It used to be `\b`, and `\b`
 * fails exactly where recalled text is most often found: behind an escape. A
 * JSONL transcript stores a newline as the two characters `\` `n`, so in
 * `…\nghp_…` the character before the key is the letter `n` and `\b` does not
 * hold — the whole key came back raw. Same for `\t`, `\u0022` and URL-encoded
 * `%3D`.
 *
 * So: not after a word character (what `\b` meant here, since every prefix
 * starts with one), OR right after an escape whose last character happens to
 * be one — `\n \t \r`, `%XX`, `\uXXXX`. It still refuses a key glued to a word
 * with no escape (`task-…` is not an OpenAI key; see the LIMIT test). `\b` and
 * `\f` are left out on purpose: those control characters almost never precede
 * a key, and accepting them redacted Windows paths like `C:\bsk-…`.
 * Each alternative is fixed-width so the Python port can use the same text.
 */
const LEAD = String.raw`(?:(?<![A-Za-z0-9_])|(?<=\\[ntr])|(?<=%[0-9A-Fa-f]{2})|(?<=\\u[0-9A-Fa-f]{4}))`;
const lead = (/** @type {string} */ body) => new RegExp(LEAD + body, "g");

const SHAPES = [
  { shape: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { shape: "db-uri-creds", re: lead(String.raw`(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqps?):\/\/[^\s:/@]*:[^\s@]+@[^\s"')\]]+`) },
  { shape: "aws-key", re: lead(String.raw`AKIA[0-9A-Z]{16}\b`) },
  { shape: "stripe-key", re: lead(String.raw`[srp]k_(?:live|test)_[0-9a-zA-Z]{16,}\b`) },
  { shape: "github-token", re: lead(String.raw`(?:gh[pousr]_[0-9A-Za-z]{36,}|github_pat_[0-9A-Za-z_]{40,})\b`) },
  { shape: "google-api-key", re: lead(String.raw`AIza[0-9A-Za-z\-_]{35}\b`) },
  { shape: "slack-token", re: lead(String.raw`xox[baprs]-[0-9A-Za-z-]{10,}\b`) },
  // A Slack incoming-webhook URL IS a credential — redact it as its own shape
  // (the generic base64 rule skips URL interiors; see skip below).
  { shape: "slack-webhook", re: lead(String.raw`https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+`) },
  // sk-ant… (Anthropic, incl. admin) before the generic sk-… (OpenAI incl. sk-proj/sk-admin).
  { shape: "anthropic-key", re: lead(String.raw`sk-ant-[A-Za-z0-9_-]{10,}`) },
  // No `(?:proj-|admin-|svcacct-)?` alternation here, deliberately: `-` is in
  // the trailing character class, so the generic form already matches every
  // prefixed variant. Spelling them out looked like coverage and was dead
  // regex — a mutation test deleting the alternation changed nothing, which is
  // how it was found. Prefix variants are pinned in the test fixtures instead.
  { shape: "openai-key", re: lead(String.raw`sk-[A-Za-z0-9_-]{20,}`) },
  { shape: "jwt", re: lead(String.raw`eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b`) },
  // ≥48 hex: sha256-length tokens redact; 40-hex git SHAs deliberately pass.
  { shape: "long-hex", re: lead(String.raw`[0-9a-fA-F]{48,}\b`) },
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
    // The trailing lookahead deliberately does NOT reject `=`. It used to, and
    // that single character caused two bugs at once: a run followed by any
    // extra `=` failed to match AT ALL (so `<secret>==` + `=` + `<secret>`
    // returned the FIRST secret raw while reporting a clean fixed point), and
    // two adjacent padded runs could only be redacted one per pass, which is
    // the entire reason this scan ever needed multiple passes.
    re: /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/])/g,
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
 * Pass cap for the stability scan. Not load-bearing in normal operation: since
 * the base64 boundary stopped vetoing on `=`, every input we know of reaches a
 * fixed point on the FIRST pass and the second pass only confirms it. The cap
 * exists so that an unknown future shape interaction cannot spin forever — and
 * because it should never be hit, hitting it is treated as a fault, not as a
 * partial result (see the fail-closed note on redactSecretShapes).
 */
export const MAX_REDACTION_PASSES = 8;

/** What the text is replaced with when the scan cannot reach a fixed point. */
export const NONCONVERGENT_TOKEN = "[redacted:nonconvergent-snippet]";

/**
 * Redact secret-shaped runs in a text snippet. Idempotent; benign text passes
 * through byte-identical.
 *
 * FAIL-CLOSED on non-convergence. If the scan cannot stabilize within
 * `maxPasses`, the ENTIRE snippet is replaced with `NONCONVERGENT_TOKEN`
 * rather than returned partially redacted. This is deliberate and it is the
 * whole reason there is no `fixedPoint` flag on the result: a flag only
 * protects callers who read it, and at a security output boundary the ones who
 * don't are exactly the ones who leak. Losing a snippet is recoverable;
 * displaying a secret is not.
 *
 * @param {string|null|undefined} text
 * @param {{ maxPasses?: number }} [options] `maxPasses` is a test seam — it
 *   exists so the fail-closed branch can be driven red on demand, since no
 *   real input is known to reach it (a guard nobody can make fire is a guard
 *   nobody has checked).
 * @returns {{ text: string, shapes: string[] }} shapes = one entry per replacement, in scan order
 */
export function redactSecretShapes(text, options = {}) {
  if (typeof text !== "string" || text.length === 0) {
    return { text: text ?? "", shapes: [] };
  }
  const maxPasses =
    Number.isInteger(options.maxPasses) && options.maxPasses > 0
      ? options.maxPasses
      : MAX_REDACTION_PASSES;

  let out = text;
  const shapes = /** @type {string[]} */ ([]);
  for (let pass = 0; pass < maxPasses; pass++) {
    const before = out;
    for (const { shape, re, skip } of SHAPES) {
      out = out.replace(re, (m, offset, src) => {
        if (skip && skip(m, offset, src)) return m;
        shapes.push(shape);
        return `[redacted:${shape}]`;
      });
    }
    if (out === before) return { text: out, shapes };
  }
  // Never stabilized. Assume the worst about what is still in `out`.
  return { text: NONCONVERGENT_TOKEN, shapes: [...shapes, "nonconvergent-snippet"] };
}
