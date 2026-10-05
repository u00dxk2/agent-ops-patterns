// @ts-check
/**
 * capability-grant.mjs — scoped, single-use, fail-closed capability grants
 * for gated agent actions.
 *
 * The problem this solves: some actions an agent can run are gated behind a
 * human-approval prompt (deploys, production writes, mobile builds — whatever
 * your harness's permission layer blocks). The human says "go" in one channel
 * — a chat message, a ticket comment, a message-bus reply — and the agent
 * still can't act, because **an approval relayed through a message channel is
 * not authorization**: the permission layer can't verify who wrote a bus row,
 * and an agent that "saw an approval" is one prompt-injection away from
 * seeing one that was never given. We ran a fleet this way and the workaround
 * was the human re-running the command themselves after approving it — the
 * approval round-trip bought nothing.
 *
 * A capability grant is the controlled inverse: the human's DIRECT "go" mints
 * a grant object that pre-authorizes exactly ONE command, and the permission
 * hook honors it once. The grant binds to the command's sha256 — not a
 * pattern, not a prefix, not an intent — so the only thing it can ever
 * approve is the precise string the human read and blessed.
 *
 * SECURITY MODEL (read before changing anything here):
 *  - EXACT-COMMAND BINDING: the match key is sha256 of the command string,
 *    byte-exact after trimming leading/trailing whitespace. Nothing inside
 *    the command is rewritten — internal whitespace is significant (a
 *    newline separates two shell commands; collapsing it would merge them
 *    into one "equivalent" string, which is exactly the hole an adversarial
 *    review found in an earlier draft of this file). `deploy --prod`
 *    approved does not authorize `deploy --prod && rm -rf /`, and a
 *    two-line command does not match a one-line grant. Exact binding IS the
 *    security boundary; a whitespace change that survives trimming (a
 *    re-indent) is a safe miss.
 *  - FAIL-CLOSED EVERYWHERE: malformed grant, parse error, missing field,
 *    expired TTL, unknown action class, empty allowlist, bad clock, an
 *    invalid required field → NO match → the action falls through to your default
 *    permission prompt (the human runs it themselves = status quo). Invalid
 *    input that is detected denies; an exception while reading the query,
 *    the allowlist or a candidate grant rejects that candidate or returns
 *    null. (That is a posture, not a proof: this file has shipped an
 *    approval bug before — see CHANGELOG.md, 2026-10-05.)
 *  - SINGLE-USE + TTL: a grant (single-use by default) authorizes one
 *    execution and dies at expiry (default 15 minutes) whether used or not.
 *    Standing grants are the anti-pattern this exists to avoid, so the lifetime
 *    is CAPPED (MAX_GRANT_TTL_MS, one hour): minting refuses a longer TTL;
 *    parseGrant, isGrantLive and matchGrant refuse a grant whose stored
 *    lifetime is not positive or exceeds the cap; and isGrantLive / matchGrant
 *    also refuse one minted after `nowMs`. Mint and expiry timestamps are
 *    safe-integer ms (the `nowMs` you judge with may be fractional).
 *    Single-use is still enforced by your store (see below).
 *  - READ ONCE, JUDGE THE SNAPSHOT: every function that judges a grant copies
 *    its fields once into a plain object and decides on that copy; matchGrant
 *    returns the copy. A getter or Proxy cannot show one value to a check and
 *    another to the decision.
 *  - THE AUDIT LINE'S `command` FIELD IS NULL unless you pass a redactor: a
 *    command can hold a secret, and the audit log is kept. `commandSha256` is
 *    logged when it is a valid hash. Other fields are logged as given when
 *    they are readable strings.
 *  - DECLARED ACTION CLASSES: minting, parsing and matching take the caller's
 *    `allowedClasses` list. Keep widening it an edit to YOUR code — a
 *    visible review event — never a config value an agent can nudge; the
 *    library cannot enforce that for you.
 *
 * WHAT THIS DOES NOT PROVIDE (honest limits; the code-level ones are pinned by
 * tests, the operational ones are yours to put in place):
 *  - **No cryptographic boundary on a single user account.** If the agent
 *    process runs as the same OS user who mints grants, the agent could in
 *    principle write a grant file itself. The boundary is operational, and
 *    it needs all three legs: (a) mint from a terminal OUTSIDE any agent
 *    session, (b) deny the agent the mint CLI in your harness's permission
 *    config, (c) append every mint/consume/deny to an audit log so an
 *    unexpected self-mint is visible after the fact. If you need a hard
 *    boundary, put the grant store behind a different principal.
 *  - **No semantic understanding.** The hash can't see that two different
 *    strings run the same program (`deploy --prod` vs `deploy --prod=true`,
 *    or the same command re-indented). A variation that survives trimming
 *    misses (safe:
 *    falls through to the prompt); this is the deliberate trade, not a bug
 *    to fix with fuzzier matching or normalization.
 *  - **The clock is yours.** The clock-dependent functions take `nowMs`; a
 *    caller that passes a stale (but numeric) clock weakens the TTL. Pass
 *    `Date.now()` at the call site, nothing cached. Non-number clocks are
 *    rejected outright, never coerced.
 *  - **Single-use needs an atomic store.** matchGrant only *finds* the
 *    grant; it mutates nothing. Two concurrent enforcement hooks can both
 *    match the same grant before either consumes it. The caller's store
 *    must consume atomically (delete-before-execute, or an exclusive
 *    rename) — that boundary lives in your hook, not here.
 *
 * Pure logic only — no I/O, no clock reads, no randomness. The mint CLI and
 * the enforcement hook (both a few lines, specific to your harness) do the
 * I/O and call in here. Tested in test/capability-grant.test.mjs, including
 * the fail-closed paths and the superset-command miss.
 */

import { createHash } from "node:crypto";

export const GRANT_SCHEMA_VERSION = 1;

export const DEFAULT_GRANT_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * The longest lifetime (expiresAtMs − mintedAtMs) any grant may have. Enforced
 * when minting AND whenever a grant is judged, so a hand-edited grant file with a
 * far-future expiry is dead rather than standing. One hour: long enough for a
 * slow deploy queue, short enough that a forgotten grant does not outlive the
 * session that asked for it.
 */
export const MAX_GRANT_TTL_MS = 60 * 60 * 1000;

/**
 * Normalize a command string for hashing/matching: trim leading/trailing
 * whitespace, nothing else. Internal whitespace is preserved byte-exact —
 * collapsing it would make a two-line command (two shell commands) hash
 * identically to their one-line concatenation, and make `'a  b'` equal
 * `'a b'` inside quoted arguments. Non-strings normalize to "" (which never
 * mints and never matches).
 *
 * @param {unknown} cmd
 * @returns {string}
 */
export function normalizeCommand(cmd) {
  return typeof cmd === "string" ? cmd.trim() : "";
}

/**
 * sha256 hex of the normalized command — the grant's match key.
 * @param {unknown} cmd
 * @returns {string}
 */
export function commandHash(cmd) {
  return createHash("sha256").update(normalizeCommand(cmd), "utf8").digest("hex");
}

/**
 * @param {unknown} cls
 * @param {readonly string[]} allowedClasses  the caller's declared class list
 * @returns {boolean} true iff cls is in the caller's allowlist. An absent or
 *   empty allowlist allows NOTHING — fail-closed, not fail-open.
 */
export function isAllowedGrantClass(cls, allowedClasses) {
  const allowed = allowlistSnapshot(allowedClasses);
  return allowed !== null && typeof cls === "string" && allowed.includes(cls.trim());
}

/**
 * The caller's allowlist copied once into a plain array, or null when it is not
 * a non-empty array (or cannot be read). Shared by isAllowedGrantClass and
 * matchGrant, which takes ONE copy per call rather than one per candidate grant.
 * @param {unknown} allowedClasses
 * @returns {unknown[]|null}
 */
function allowlistSnapshot(allowedClasses) {
  try {
    if (!Array.isArray(allowedClasses)) return null;
    // Snapshot by INDEX against a length read exactly once. `length` used to be
    // read for the emptiness check and again inside `.includes()`, so a Proxy
    // returning 1 then 2 got two classes honored against a one-element
    // declaration. Note `Array.from` does NOT fix this — it goes through the
    // iterator and ignores the declared length entirely, which is the opposite
    // of fail-closed. Take the narrowest consistent view: the length the caller
    // presented first, and the elements under it.
    const declaredLength = allowedClasses.length;
    if (!Number.isInteger(declaredLength) || declaredLength <= 0) return null;
    const allowed = [];
    for (let i = 0; i < declaredLength; i++) allowed.push(allowedClasses[i]);
    return allowed;
  } catch {
    return null;
  }
}

/**
 * @typedef {Object} Grant
 * @property {number} v                 schema version
 * @property {string} id                opaque grant id (caller-supplied; use a random hex)
 * @property {string} command           the exact (normalized) command, kept for audit/transparency
 * @property {string} commandSha256     sha256 of the normalized command — the match key
 * @property {string} scope             the project/workspace the grant is scoped to
 * @property {string} actionClass       gated class (must be in the caller's allowedClasses)
 * @property {number} mintedAtMs
 * @property {number} expiresAtMs       absolute ms after which the grant is dead
 * @property {boolean} singleUse        true → consumed (and deleted) on first match
 * @property {string=} mintedBy         free-text provenance (e.g. "operator-terminal")
 * @property {number=} consumedAtMs     set when consumed (multi-use grants only; single-use are deleted)
 */

/**
 * Build a grant object. PURE — the caller supplies id + nowMs (no clock or
 * randomness here, so it stays testable). Throws on an out-of-allowlist class
 * or empty command — a loud failure, never a silently minted no-op grant.
 *
 * @param {{command: string, scope: string, actionClass: string, allowedClasses: readonly string[], id: string, nowMs: number, ttlMs?: number, singleUse?: boolean, mintedBy?: string}} opts
 * @returns {Grant}
 */
export function buildGrant(opts = /** @type {any} */ ({})) {
  // SNAPSHOT FIRST, VALIDATE SECOND. Every field is read exactly once, before
  // any check runs, and nothing below touches `opts` again. Re-reading after
  // validation let an accessor mint a grant nobody approved: an `actionClass`
  // getter returning "deploy" to the allowlist check and "git-push" to the
  // stored object, or a `ttlMs` getter validating as 1000 and storing
  // MAX_SAFE_INTEGER — a fifteen-minute grant that never expires.
  const command = opts.command;
  const rawActionClass = opts.actionClass;
  // The same index snapshot matchGrant uses — never the list's own iterator.
  const allowedClasses = allowlistSnapshot(opts.allowedClasses);
  const rawScope = opts.scope;
  const nowMs = opts.nowMs;
  const rawId = opts.id;
  const rawTtlMs = opts.ttlMs;
  const rawSingleUse = opts.singleUse;
  const rawMintedBy = opts.mintedBy;

  if (typeof command !== "string" || !normalizeCommand(command)) {
    throw new Error("capability-grant: refusing to mint a grant for an empty or non-string command");
  }
  if (!isAllowedGrantClass(rawActionClass, allowedClasses)) {
    throw new Error(
      `capability-grant: actionClass must be one of the caller's allowedClasses (got ${JSON.stringify(rawActionClass)})`,
    );
  }
  const scope = String(rawScope ?? "").trim();
  if (!scope) {
    throw new Error("capability-grant: scope is required");
  }
  if (!Number.isSafeInteger(nowMs)) {
    throw new Error("capability-grant: nowMs must be a safe-integer millisecond timestamp");
  }
  const id = String(rawId ?? "").trim();
  if (!id) {
    throw new Error("capability-grant: id is required");
  }
  // The default TTL applies ONLY when ttlMs is omitted. An explicit but
  // invalid TTL (0, negative, NaN, a string) throws — a caller that asked
  // for a bounded grant must never silently receive a broader one.
  let ttlMs = DEFAULT_GRANT_TTL_MS;
  if (rawTtlMs !== undefined) {
    if (!Number.isSafeInteger(rawTtlMs) || rawTtlMs <= 0 || rawTtlMs > MAX_GRANT_TTL_MS) {
      throw new Error(`capability-grant: ttlMs must be a whole number of ms, > 0 and <= ${MAX_GRANT_TTL_MS}, when supplied`);
    }
    ttlMs = rawTtlMs;
  }
  if (!Number.isSafeInteger(nowMs + ttlMs)) {
    throw new Error("capability-grant: nowMs + ttlMs must stay a safe-integer timestamp");
  }
  return {
    v: GRANT_SCHEMA_VERSION,
    id,
    command: normalizeCommand(command),
    commandSha256: commandHash(command),
    scope,
    actionClass: String(rawActionClass).trim(),
    mintedAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
    singleUse: rawSingleUse !== false, // default TRUE (safest)
    mintedBy: rawMintedBy ? String(rawMintedBy) : "operator",
  };
}

/**
 * Serialize a grant for the grant file.
 * @param {Grant} grant
 * @returns {string}
 */
export function serializeGrant(grant) {
  return JSON.stringify(grant, null, 2);
}

/**
 * Every field a grant can carry. snapshotGrant reads each of these EXACTLY ONCE.
 */
const GRANT_FIELDS = /** @type {const} */ ([
  "v", "id", "command", "commandSha256", "scope", "actionClass",
  "mintedAtMs", "expiresAtMs", "singleUse", "mintedBy", "consumedAtMs",
]);

/**
 * READ ONCE, JUDGE THE SNAPSHOT. Every function that judges a grant first copies
 * its fields into a plain data object, here, and decides on that copy only; the
 * copy is also what matchGrant returns. This replaced a file full of per-field
 * "read it once" fixes: a getter or Proxy that returns one value to a check and
 * another to the decision (an expiry, a mint time, the command hash) can no
 * longer reach the decision, because the decision never touches the original.
 * A getter that throws makes the grant unreadable: null, fail-closed.
 *
 * @param {unknown} g
 * @returns {Record<string, unknown>|null}
 */
function snapshotGrant(g) {
  if (!g || typeof g !== "object") return null;
  try {
    /** @type {Record<string, unknown>} */
    const s = {};
    for (const k of GRANT_FIELDS) s[k] = /** @type {any} */ (g)[k];
    return s;
  } catch {
    return null;
  }
}

/**
 * A grant's lifetime must be positive and no longer than MAX_GRANT_TTL_MS. This
 * is what makes "no standing grants" a property of the library rather than of
 * whoever wrote the grant file. Timestamps must be safe-integer milliseconds: a
 * fractional mint time can round an over-long lifetime down to the cap.
 * @param {unknown} mintedAtMs
 * @param {unknown} expiresAtMs
 */
function lifetimeOk(mintedAtMs, expiresAtMs) {
  if (!Number.isSafeInteger(mintedAtMs) || !Number.isSafeInteger(expiresAtMs)) return false;
  const lifetime = /** @type {number} */ (expiresAtMs) - /** @type {number} */ (mintedAtMs);
  return lifetime > 0 && lifetime <= MAX_GRANT_TTL_MS;
}

/**
 * Strict structural validation of a SNAPSHOT (a plain object from snapshotGrant;
 * never the caller's object). Every field the decision uses is checked by exact
 * type (`singleUse` and `mintedBy` are not judged here; parseGrant normalizes
 * them) — no coercion
 * anywhere on the authorization path, because coercion is how `"v": "1"` and
 * `expiresAtMs: "1001000"` sneaked past an earlier draft. The hash must be the
 * hash OF the stored command, so a grant record can never claim one command in
 * its audit-visible `command` field while matching another via its hash. The
 * lifetime cap is structural (no clock needed); mint-time-in-the-future is a
 * liveness question and is judged in snapshotIsLive.
 *
 * @param {Record<string, unknown>} s
 * @returns {boolean}
 */
function snapshotIsValid(s) {
  if (s.v !== GRANT_SCHEMA_VERSION) return false;
  if (typeof s.id !== "string" || !s.id.trim()) return false;
  if (typeof s.command !== "string" || !normalizeCommand(s.command)) return false;
  if (typeof s.commandSha256 !== "string" || !/^[0-9a-f]{64}$/i.test(s.commandSha256)) return false;
  if (s.commandSha256.toLowerCase() !== commandHash(s.command)) return false;
  if (typeof s.scope !== "string" || !s.scope.trim()) return false;
  if (typeof s.actionClass !== "string" || !s.actionClass.trim()) return false;
  if (!lifetimeOk(s.mintedAtMs, s.expiresAtMs)) return false;
  if (s.consumedAtMs !== undefined && (typeof s.consumedAtMs !== "number" || !Number.isFinite(s.consumedAtMs))) return false;
  return true;
}

/**
 * @param {Record<string, unknown>} s  a snapshot
 * @param {number} nowMs               already checked to be a finite number
 */
function snapshotIsLive(s, nowMs) {
  if (!snapshotIsValid(s)) return false;
  if (nowMs < /** @type {number} */ (s.mintedAtMs)) return false; // minted in the future: a clock or a forgery
  if (nowMs >= /** @type {number} */ (s.expiresAtMs)) return false;
  return s.consumedAtMs === undefined;
}

/**
 * Parse a grant file. Returns null on empty / non-JSON / wrong-shape /
 * wrong-version / out-of-allowlist input, on any judged field of the wrong exact
 * type (`singleUse` and `mintedBy` are normalized instead), on a hash that is not the hash of the stored command, and on a lifetime
 * that is not positive or exceeds MAX_GRANT_TTL_MS — the caller treats null as
 * "no grant". FAIL-CLOSED. (It takes no clock, so it does not judge expiry or a
 * future mint time; isGrantLive and matchGrant do.)
 *
 * @param {string} raw
 * @param {readonly string[]} allowedClasses
 * @returns {Grant|null}
 */
export function parseGrant(raw, allowedClasses) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let j;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  const s = snapshotGrant(j);
  if (!s || !snapshotIsValid(s)) return null;
  if (!isAllowedGrantClass(s.actionClass, allowedClasses)) return null;
  return {
    v: GRANT_SCHEMA_VERSION,
    id: /** @type {string} */ (s.id),
    command: /** @type {string} */ (s.command),
    commandSha256: /** @type {string} */ (s.commandSha256).toLowerCase(),
    scope: /** @type {string} */ (s.scope).trim(),
    actionClass: /** @type {string} */ (s.actionClass).trim(),
    mintedAtMs: /** @type {number} */ (s.mintedAtMs),
    expiresAtMs: /** @type {number} */ (s.expiresAtMs),
    singleUse: s.singleUse !== false,
    mintedBy: typeof s.mintedBy === "string" ? s.mintedBy : undefined,
    consumedAtMs: /** @type {number|undefined} */ (s.consumedAtMs),
  };
}

/**
 * Is the grant live (structurally valid, lifetime within the cap, minted no
 * later than nowMs, not expired, not consumed) at nowMs? FAIL-CLOSED: malformed
 * or unreadable grant / non-number or non-finite clock → false. The clock must
 * be an actual number — `null` coercing to epoch 0 once revived an expired grant
 * in an earlier draft.
 *
 * @param {Grant|null|undefined} grant
 * @param {number} nowMs
 * @returns {boolean}
 */
export function isGrantLive(grant, nowMs) {
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) return false;
  const s = snapshotGrant(grant);
  return s !== null && snapshotIsLive(s, nowMs);
}

/**
 * @typedef {Object} MatchQuery
 * @property {string} command      the pending command the agent wants to run (must be an actual string)
 * @property {string} scope        the active project/workspace — REQUIRED (must equal the grant's scope)
 * @property {string} actionClass  the resolved action class — REQUIRED (must equal the grant's class)
 * @property {number} nowMs
 */

/**
 * Find the grant in `grants` that authorizes this pending command, or null.
 *
 * A grant matches IFF (ALL of):
 *   - it is live (isGrantLive: structurally valid, not expired, not consumed),
 *   - its actionClass is in the caller's allowedClasses,
 *   - commandSha256 === sha256(normalize(query.command)) — the EXACT command,
 *   - query.scope equals the grant's scope, and
 *   - query.actionClass equals the grant's class.
 *
 * Scope and actionClass are REQUIRED on the query: the enforcement hook must
 * resolve both before asking. An unscoped match would let a grant minted for
 * one workspace authorize the same command string in another — a directory-
 * dependent command like `deploy --prod` means different things in each.
 *
 * The command must be an actual string. Objects are rejected, not coerced:
 * an object with a stateful `toString()` can present one string to the
 * emptiness check, a second to the hash, and a third to the executor.
 *
 * CALLER OBLIGATION — this function reads each query field exactly once, but it
 * cannot control what you execute afterwards. Capture the command in your own
 * local BEFORE calling, pass that local as `query.command`, and execute that
 * same local. Re-reading `query.command` after approval re-invokes any accessor
 * on the query object and can hand you a different string than the one this
 * grant authorized.
 *
 * FAIL-CLOSED: any malformed grant in the list is skipped (strict shape
 * validation, never a throw); an empty or garbage query returns null; an
 * empty allowlist returns null. Returns the FIRST matching grant (mint
 * single-use grants and at most one matches in practice). Matching mutates
 * nothing — consumption is the caller's store's job, atomically, BEFORE
 * executing (see the header's single-use limit).
 *
 * @param {Array<Grant|null>} grants
 * @param {MatchQuery} query
 * @param {readonly string[]} allowedClasses
 * @returns {Grant|null}
 */
export function matchGrant(grants, query = /** @type {any} */ ({}), allowedClasses = []) {
  // One boundary for the whole call: a getter, Proxy trap or iterator that throws
  // anywhere below is "no match", never an exception out of the authorization path.
  try {
    return matchGrantUnguarded(grants, query, allowedClasses);
  } catch {
    return null;
  }
}

/** @param {Array<Grant|null>} grants @param {MatchQuery} query @param {readonly string[]} allowedClasses @returns {Grant|null} */
function matchGrantUnguarded(grants, query, allowedClasses) {
  if (!Array.isArray(grants)) return null;
  if (!query || typeof query !== "object") return null;
  // Read every query field EXACTLY ONCE, before validating any of them. Rejecting
  // objects (above) stops a stateful `toString()`, but NOT an accessor-backed
  // query: a getter returns a genuine string on every read and may return a
  // DIFFERENT one each time. Validating `query.command` and then re-reading it
  // type-checks one value and hashes another. Only the locals below are used.
  const command = query.command;
  const rawScope = query.scope;
  const rawClass = query.actionClass;
  const nowMs = query.nowMs;

  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) return null;
  if (typeof command !== "string") return null;
  if (!normalizeCommand(command)) return null;
  const wantHash = commandHash(command);
  const wantScope = typeof rawScope === "string" ? rawScope.trim() : "";
  const wantClass = typeof rawClass === "string" ? rawClass.trim() : "";
  if (!wantScope || !wantClass) return null;

  const allowed = allowlistSnapshot(allowedClasses);
  if (allowed === null) return null;
  // Indexed against a length read once: the list's own iterator is not consulted.
  const count = grants.length;
  for (let i = 0; i < count; i++) {
    // Judge the snapshot, return the snapshot: nothing below reads the grant again.
    const s = snapshotGrant(grants[i]);
    if (s === null || !snapshotIsLive(s, nowMs)) continue;
    if (typeof s.actionClass !== "string" || !allowed.includes(s.actionClass.trim())) continue;
    if (/** @type {string} */ (s.commandSha256).toLowerCase() !== wantHash) continue;
    if (s.scope !== wantScope) continue;
    if (s.actionClass !== wantClass) continue;
    return /** @type {Grant} */ (/** @type {unknown} */ (s));
  }
  return null;
}

/**
 * Return a copy of the grant marked consumed at nowMs (for multi-use grants
 * kept on disk). Single-use grants are DELETED by the caller instead; this is
 * the record-keeping path. PURE. Throws on a non-finite clock — a NaN
 * consumedAtMs would read as "not consumed" downstream, which is the unsafe
 * direction.
 *
 * @param {Grant} grant
 * @param {number} nowMs
 * @returns {Grant}
 */
export function markConsumed(grant, nowMs) {
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) {
    throw new Error("capability-grant: markConsumed requires a finite nowMs");
  }
  // Copy the supported fields only, read once: a spread kept caller hooks such as
  // `toJSON`, which could serialize the record back WITHOUT the consumed stamp.
  const s = snapshotGrant(grant);
  if (s === null) throw new Error("capability-grant: markConsumed requires a readable grant object");
  return /** @type {Grant} */ (/** @type {unknown} */ ({ ...s, consumedAtMs: nowMs }));
}

/**
 * Compose a one-line audit-log record (NDJSON) for a mint, consume, revoke,
 * or denied event. Records the hash + scope + outcome so any mint — including
 * an unexpected agent self-mint — is visible after the fact. PURE; the caller
 * appends it to the log file.
 *
 * The command TEXT is left out (`command: null`) unless you pass `redact`, a
 * function from the command to a display-safe string. A command can carry a
 * secret (`curl -H "Authorization: Bearer …"`), and this log is the file you are
 * told to keep. For a valid grant, `commandSha256` identifies the command. A redactor that
 * throws or returns a non-string leaves the command out: fail-closed.
 * (`lib/snippet-redact.mjs`'s `redactSecretShapes(s).text` is one redactor.)
 *
 * @param {{event: "mint"|"consume"|"revoke"|"denied", grant?: Grant, nowMs: number, note?: string, redact?: (command: string) => string}} opts
 * @returns {string} a single NDJSON line (no trailing newline)
 */
const AUDIT_EVENTS = ["mint", "consume", "revoke", "denied"];

export function composeAuditLine(opts = /** @type {any} */ ({})) {
  // Each option is read once; a getter that throws reads as absent. The grant is
  // snapshotted (unreadable → every grant field null), so the command type-checked
  // below is the command handed to the redactor — a getter cannot swap it.
  const read = (/** @type {string} */ k) => {
    try {
      return opts?.[k];
    } catch {
      return undefined;
    }
  };
  const event = read("event");
  const nowMs = read("nowMs");
  const note = read("note");
  const redact = read("redact");
  const g = snapshotGrant(read("grant")) ?? {};
  let command = null;
  if (typeof redact === "function" && typeof g.command === "string") {
    try {
      const out = redact(g.command);
      command = typeof out === "string" ? out : null;
    } catch {
      command = null;
    }
  }
  // Strings and finite numbers only. Nothing the caller passed is coerced or
  // serialized through its own hooks (`toJSON`, `toString`). `event` comes from a
  // closed set and `commandSha256` must be a hash; `id`, `scope`, `actionClass`,
  // `mintedBy` and `note` strings are logged AS GIVEN — keep secrets out of them.
  const str = (/** @type {unknown} */ v) => (typeof v === "string" ? v : null);
  return JSON.stringify({
    event: typeof event === "string" && AUDIT_EVENTS.includes(event) ? event : "unknown",
    atMs: typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : null,
    id: str(g.id),
    scope: str(g.scope),
    actionClass: str(g.actionClass),
    command,
    commandSha256: typeof g.commandSha256 === "string" && /^[0-9a-f]{64}$/i.test(g.commandSha256) ? g.commandSha256 : null,
    mintedBy: str(g.mintedBy),
    note: str(note),
  });
}
