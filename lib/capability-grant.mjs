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
 *    two-line command never matches a one-line grant. Exact binding IS the
 *    security boundary; an indentation mismatch is a safe miss.
 *  - FAIL-CLOSED EVERYWHERE: malformed grant, parse error, missing field,
 *    expired TTL, unknown action class, empty allowlist, bad clock, any
 *    ambiguity → NO match → the action falls through to your default
 *    permission prompt (the human runs it themselves = status quo). A bug in
 *    this lib can only FAIL TO APPROVE, never wrongly approve.
 *  - SINGLE-USE + TTL: a grant authorizes one execution and dies at expiry
 *    (default 15 minutes) whether used or not. Standing grants are the
 *    anti-pattern this exists to avoid.
 *  - DECLARED ACTION CLASSES: every function that judges a grant takes the
 *    caller's `allowedClasses` list. Widening it is an edit to YOUR code —
 *    a visible review event — never a config value an agent can nudge.
 *
 * WHAT THIS DOES NOT PROVIDE (honest limits, each pinned by a test):
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
 *    or the same command re-indented). A benign variation misses (safe:
 *    falls through to the prompt); this is the deliberate trade, not a bug
 *    to fix with fuzzier matching or normalization.
 *  - **The clock is yours.** All functions are pure and take `nowMs`; a
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
  if (!Array.isArray(allowedClasses) || allowedClasses.length === 0) return false;
  return typeof cls === "string" && allowedClasses.includes(cls.trim());
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
  const command = opts.command;
  if (typeof command !== "string" || !normalizeCommand(command)) {
    throw new Error("capability-grant: refusing to mint a grant for an empty or non-string command");
  }
  if (!isAllowedGrantClass(opts.actionClass, opts.allowedClasses)) {
    throw new Error(
      `capability-grant: actionClass must be one of the caller's allowedClasses (got ${JSON.stringify(opts.actionClass)})`,
    );
  }
  const scope = String(opts.scope ?? "").trim();
  if (!scope) {
    throw new Error("capability-grant: scope is required");
  }
  const nowMs = opts.nowMs;
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) {
    throw new Error("capability-grant: nowMs must be a finite number");
  }
  const id = String(opts.id ?? "").trim();
  if (!id) {
    throw new Error("capability-grant: id is required");
  }
  // The default TTL applies ONLY when ttlMs is omitted. An explicit but
  // invalid TTL (0, negative, NaN, a string) throws — a caller that asked
  // for a bounded grant must never silently receive a broader one.
  let ttlMs = DEFAULT_GRANT_TTL_MS;
  if (opts.ttlMs !== undefined) {
    if (typeof opts.ttlMs !== "number" || !Number.isFinite(opts.ttlMs) || opts.ttlMs <= 0) {
      throw new Error("capability-grant: ttlMs must be a finite number > 0 when supplied");
    }
    ttlMs = opts.ttlMs;
  }
  return {
    v: GRANT_SCHEMA_VERSION,
    id,
    command: normalizeCommand(command),
    commandSha256: commandHash(command),
    scope,
    actionClass: String(opts.actionClass).trim(),
    mintedAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
    singleUse: opts.singleUse !== false, // default TRUE (safest)
    mintedBy: opts.mintedBy ? String(opts.mintedBy) : "operator",
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
 * Strict structural validation of a grant object. Every field is checked by
 * exact type — no coercion anywhere on the authorization path, because
 * coercion is how `"v": "1"` and `expiresAtMs: "1001000"` sneaked past an
 * earlier draft. The hash is additionally verified to be the hash OF the
 * stored command, so a grant record can never claim one command in its
 * audit-visible `command` field while matching another via its hash.
 *
 * @param {unknown} g
 * @returns {g is Grant}
 */
function hasValidShape(g) {
  if (!g || typeof g !== "object") return false;
  const j = /** @type {Record<string, unknown>} */ (g);
  if (j.v !== GRANT_SCHEMA_VERSION) return false;
  if (typeof j.id !== "string" || !j.id.trim()) return false;
  if (typeof j.command !== "string" || !normalizeCommand(j.command)) return false;
  if (typeof j.commandSha256 !== "string" || !/^[0-9a-f]{64}$/i.test(j.commandSha256)) return false;
  if (j.commandSha256.toLowerCase() !== commandHash(j.command)) return false;
  if (typeof j.scope !== "string" || !j.scope.trim()) return false;
  if (typeof j.actionClass !== "string" || !j.actionClass.trim()) return false;
  if (typeof j.mintedAtMs !== "number" || !Number.isFinite(j.mintedAtMs)) return false;
  if (typeof j.expiresAtMs !== "number" || !Number.isFinite(j.expiresAtMs)) return false;
  if (j.consumedAtMs !== undefined && (typeof j.consumedAtMs !== "number" || !Number.isFinite(j.consumedAtMs))) return false;
  return true;
}

/**
 * Parse a grant file. Returns null on empty / non-JSON / wrong-shape /
 * wrong-version / out-of-allowlist input, on any field of the wrong exact
 * type, and on a hash that is not the hash of the stored command — the
 * caller treats null as "no grant". FAIL-CLOSED.
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
  if (!hasValidShape(j)) return null;
  if (!isAllowedGrantClass(j.actionClass, allowedClasses)) return null;
  return {
    v: GRANT_SCHEMA_VERSION,
    id: j.id,
    command: j.command,
    commandSha256: j.commandSha256.toLowerCase(),
    scope: j.scope.trim(),
    actionClass: j.actionClass.trim(),
    mintedAtMs: j.mintedAtMs,
    expiresAtMs: j.expiresAtMs,
    singleUse: j.singleUse !== false,
    mintedBy: typeof j.mintedBy === "string" ? j.mintedBy : undefined,
    consumedAtMs: j.consumedAtMs,
  };
}

/**
 * Is the grant live (structurally valid, not expired, not already consumed)
 * at nowMs? FAIL-CLOSED: malformed grant / non-number or non-finite clock →
 * false. The clock must be an actual number — `null` coercing to epoch 0
 * once revived an expired grant in an earlier draft.
 *
 * @param {Grant|null|undefined} grant
 * @param {number} nowMs
 * @returns {boolean}
 */
export function isGrantLive(grant, nowMs) {
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) return false;
  if (!hasValidShape(grant)) return false;
  if (nowMs >= grant.expiresAtMs) return false;
  if (grant.consumedAtMs !== undefined) return false;
  return true;
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

  for (const g of grants) {
    if (!isGrantLive(g, nowMs)) continue;
    if (!isAllowedGrantClass(g.actionClass, allowedClasses)) continue;
    if (g.commandSha256.toLowerCase() !== wantHash) continue;
    if (g.scope !== wantScope) continue;
    if (g.actionClass !== wantClass) continue;
    return g;
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
  return { ...grant, consumedAtMs: nowMs };
}

/**
 * Compose a one-line audit-log record (NDJSON) for a mint, consume, revoke,
 * or denied event. Records the command + hash + scope + outcome so any mint —
 * including an unexpected agent self-mint — is visible after the fact. PURE;
 * the caller appends it to the log file.
 *
 * @param {{event: "mint"|"consume"|"revoke"|"denied", grant?: Grant, nowMs: number, note?: string}} opts
 * @returns {string} a single NDJSON line (no trailing newline)
 */
export function composeAuditLine(opts = /** @type {any} */ ({})) {
  const g = opts.grant ?? /** @type {Partial<Grant>} */ ({});
  return JSON.stringify({
    event: String(opts.event ?? "unknown"),
    atMs: Number(opts.nowMs),
    id: g.id ?? null,
    scope: g.scope ?? null,
    actionClass: g.actionClass ?? null,
    command: g.command ?? null,
    commandSha256: g.commandSha256 ?? null,
    mintedBy: g.mintedBy ?? null,
    note: opts.note ? String(opts.note) : null,
  });
}
