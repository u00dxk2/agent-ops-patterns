import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GRANT_SCHEMA_VERSION,
  DEFAULT_GRANT_TTL_MS,
  MAX_GRANT_TTL_MS,
  normalizeCommand,
  commandHash,
  isAllowedGrantClass,
  buildGrant,
  serializeGrant,
  parseGrant,
  isGrantLive,
  matchGrant,
  markConsumed,
  composeAuditLine,
} from "../lib/capability-grant.mjs";

const NOW = Date.parse("2026-06-06T23:30:00.000Z");
const CMD = "deploy --env production";
const CLASSES = ["deploy", "prod-write-probe"];
const QUERY = { command: CMD, scope: "my-app", actionClass: "deploy", nowMs: NOW };

function mint(overrides = {}) {
  return buildGrant({
    command: CMD,
    scope: "my-app",
    actionClass: "deploy",
    allowedClasses: CLASSES,
    id: "grant-abc123",
    nowMs: NOW,
    ...overrides,
  });
}

describe("normalizeCommand — trim only, internal bytes preserved", () => {
  it("trims leading/trailing whitespace and nothing else", () => {
    assert.equal(normalizeCommand("  deploy --env production  "), CMD);
    assert.equal(normalizeCommand("deploy  --env production"), "deploy  --env production");
  });
  it("is null/garbage safe (non-strings normalize to empty)", () => {
    assert.equal(normalizeCommand(null), "");
    assert.equal(normalizeCommand(undefined), "");
    assert.equal(normalizeCommand(42), "");
  });
});

describe("commandHash — byte-exact binding", () => {
  it("internal whitespace is SIGNIFICANT: re-spaced and multi-line variants hash differently", () => {
    // The adversarial-review repro: collapsing whitespace made a two-line
    // command (two shell commands) hash identically to a one-line echo.
    assert.notEqual(commandHash("echo SAFE rm -rf ./victim"), commandHash("echo SAFE\nrm -rf ./victim"));
    assert.notEqual(commandHash("run 'safe  text'"), commandHash("run 'safe text'"));
    assert.notEqual(commandHash("deploy  --env production"), commandHash(CMD));
  });
  it("leading/trailing whitespace alone does not change the hash", () => {
    assert.equal(commandHash(CMD), commandHash(`  ${CMD}  `));
  });
  it("differs for a different command (exact binding)", () => {
    assert.notEqual(commandHash(CMD), commandHash("deploy --env staging"));
  });
});

describe("isAllowedGrantClass — fail-closed allowlist", () => {
  it("only classes in the caller's declared list", () => {
    assert.equal(isAllowedGrantClass("deploy", CLASSES), true);
    assert.equal(isAllowedGrantClass("prod-write-probe", CLASSES), true);
    assert.equal(isAllowedGrantClass("git-push", CLASSES), false);
    assert.equal(isAllowedGrantClass(null, CLASSES), false);
  });
  it("an EMPTY or absent allowlist allows NOTHING (fail-closed, not fail-open)", () => {
    assert.equal(isAllowedGrantClass("deploy", []), false);
    assert.equal(isAllowedGrantClass("deploy", undefined), false);
    assert.equal(isAllowedGrantClass("deploy", null), false);
  });
});

describe("buildGrant", () => {
  it("builds a well-formed grant with sha256 + TTL + singleUse default true", () => {
    const g = mint();
    assert.equal(g.v, GRANT_SCHEMA_VERSION);
    assert.equal(g.command, CMD);
    assert.equal(g.commandSha256, commandHash(CMD));
    assert.equal(g.scope, "my-app");
    assert.equal(g.actionClass, "deploy");
    assert.equal(g.expiresAtMs, NOW + DEFAULT_GRANT_TTL_MS);
    assert.equal(g.singleUse, true);
    assert.equal(g.mintedBy, "operator");
  });

  it("honors a custom ttl + singleUse=false + mintedBy", () => {
    const g = mint({ ttlMs: 60_000, singleUse: false, mintedBy: "operator-terminal" });
    assert.equal(g.expiresAtMs, NOW + 60_000);
    assert.equal(g.singleUse, false);
    assert.equal(g.mintedBy, "operator-terminal");
  });

  it("stores the trimmed command; internal whitespace survives verbatim", () => {
    const g = mint({ command: "  deploy  --env production " });
    assert.equal(g.command, "deploy  --env production");
    assert.equal(g.commandSha256, commandHash("deploy  --env production"));
  });

  it("THROWS on an explicit invalid ttl — an invalid request must not silently widen to the default", () => {
    assert.throws(() => mint({ ttlMs: 0 }), /ttlMs/);
    assert.throws(() => mint({ ttlMs: -1 }), /ttlMs/);
    assert.throws(() => mint({ ttlMs: Number.NaN }), /ttlMs/);
    assert.throws(() => mint({ ttlMs: "900000" }), /ttlMs/);
  });

  it("THROWS on an out-of-allowlist class (no silent over-broad grant)", () => {
    assert.throws(() => mint({ actionClass: "git-push" }), /actionClass/);
    assert.throws(() => mint({ actionClass: "arbitrary" }));
  });

  it("THROWS with an empty allowlist — minting requires a declared class list", () => {
    assert.throws(() => mint({ allowedClasses: [] }), /actionClass/);
  });

  it("THROWS on empty/non-string command / missing scope / missing id / bad clock", () => {
    assert.throws(() => mint({ command: "   " }), /command/);
    assert.throws(() => mint({ command: { toString: () => CMD } }), /command/);
    assert.throws(() => mint({ scope: "" }), /scope/);
    assert.throws(() => mint({ id: "" }), /id/);
    assert.throws(() => mint({ nowMs: Number.NaN }), /nowMs/);
    assert.throws(() => mint({ nowMs: "1000" }), /nowMs/);
  });
});

describe("serializeGrant / parseGrant", () => {
  it("round-trips a grant", () => {
    const g = mint();
    const parsed = parseGrant(serializeGrant(g), CLASSES);
    assert.notEqual(parsed, null);
    assert.equal(parsed.commandSha256, g.commandSha256);
    assert.equal(parsed.scope, "my-app");
    assert.equal(parsed.actionClass, "deploy");
    assert.equal(parsed.expiresAtMs, g.expiresAtMs);
  });

  it("FAIL-CLOSED: null on empty / non-JSON / wrong version / bad hash / bad class / bad scope / bad expiry", () => {
    assert.equal(parseGrant("", CLASSES), null);
    assert.equal(parseGrant("not json", CLASSES), null);
    assert.equal(parseGrant("null", CLASSES), null);
    assert.equal(parseGrant(JSON.stringify({ ...mint(), v: 999 }), CLASSES), null);
    assert.equal(parseGrant(JSON.stringify({ ...mint(), commandSha256: "deadbeef" }), CLASSES), null); // not 64 hex
    assert.equal(parseGrant(JSON.stringify({ ...mint(), actionClass: "git-push" }), CLASSES), null);
    assert.equal(parseGrant(JSON.stringify({ ...mint(), scope: "" }), CLASSES), null);
    assert.equal(parseGrant(JSON.stringify({ ...mint(), expiresAtMs: "soon" }), CLASSES), null);
  });

  it("FAIL-CLOSED: exact types, no coercion — the adversarial-review repro grant parses to null", () => {
    // String "v", string expiresAtMs, missing id/command/mintedAtMs: every
    // one of these coerced its way past an earlier draft.
    const repro = {
      v: "1",
      commandSha256: commandHash(CMD),
      scope: "prod",
      actionClass: "deploy",
      expiresAtMs: "1001000",
    };
    assert.equal(parseGrant(JSON.stringify(repro), CLASSES), null);
    assert.equal(parseGrant(JSON.stringify({ ...mint(), v: "1" }), CLASSES), null);
    assert.equal(parseGrant(JSON.stringify({ ...mint(), id: "" }), CLASSES), null);
    assert.equal(parseGrant(JSON.stringify({ ...mint(), mintedAtMs: "0" }), CLASSES), null);
    assert.equal(parseGrant(JSON.stringify({ ...mint(), consumedAtMs: "later" }), CLASSES), null);
  });

  it("FAIL-CLOSED: a hash that is not the hash of the stored command parses to null", () => {
    // The stored command is audit-visible; the hash is what matches. They
    // must be the same command or the audit trail can lie.
    const g = { ...mint(), command: "echo harmless-looking" };
    assert.equal(parseGrant(JSON.stringify(g), CLASSES), null);
  });

  it("FAIL-CLOSED: a valid grant file parses to null under an empty allowlist", () => {
    assert.equal(parseGrant(serializeGrant(mint()), []), null);
  });
});

describe("isGrantLive", () => {
  it("true before expiry, false at/after expiry", () => {
    const g = mint();
    assert.equal(isGrantLive(g, NOW), true);
    assert.equal(isGrantLive(g, NOW + DEFAULT_GRANT_TTL_MS - 1), true);
    assert.equal(isGrantLive(g, NOW + DEFAULT_GRANT_TTL_MS), false);
    assert.equal(isGrantLive(g, NOW + DEFAULT_GRANT_TTL_MS + 1), false);
  });

  it("false once consumed", () => {
    assert.equal(isGrantLive(markConsumed(mint(), NOW), NOW), false);
  });

  it("FAIL-CLOSED: false for null/malformed grant / non-finite clock", () => {
    assert.equal(isGrantLive(null, NOW), false);
    assert.equal(isGrantLive({ expiresAtMs: NOW + 9e9 }, NOW), false); // shape-invalid fragment
    assert.equal(isGrantLive(mint(), Number.NaN), false);
  });

  it("FAIL-CLOSED: a non-number clock is rejected, never coerced — null must not become epoch 0", () => {
    const g = mint();
    assert.equal(isGrantLive(g, null), false);
    assert.equal(isGrantLive(g, false), false);
    assert.equal(isGrantLive(g, ""), false);
    assert.equal(isGrantLive(g, String(NOW)), false);
  });

  it("FAIL-CLOSED: a NaN consumedAtMs reads as consumed/invalid, never as unconsumed", () => {
    assert.equal(isGrantLive({ ...mint(), consumedAtMs: Number.NaN }, NOW), false);
  });
});

describe("matchGrant — exact-command authorization", () => {
  it("matches the exact pre-authorized command within scope + class + TTL", () => {
    const m = matchGrant([mint()], { ...QUERY, command: `  ${CMD}  ` }, CLASSES);
    assert.notEqual(m, null);
    assert.equal(m.id, "grant-abc123");
  });

  it("does NOT match a different command (exact binding — the security boundary)", () => {
    const grants = [mint()];
    assert.equal(matchGrant(grants, { ...QUERY, command: "deploy --env staging" }, CLASSES), null);
    // a superset/dangerous command must NOT ride a narrow grant
    assert.equal(matchGrant(grants, { ...QUERY, command: `${CMD} && rm -rf /` }, CLASSES), null);
    // a re-spaced or multi-line variant is a DIFFERENT command now — safe miss
    assert.equal(matchGrant(grants, { ...QUERY, command: "deploy  --env production" }, CLASSES), null);
    assert.equal(matchGrant(grants, { ...QUERY, command: "deploy\n--env production" }, CLASSES), null);
  });

  it("REQUIRES scope and actionClass on the query — omitting either is a null, not a wildcard", () => {
    // An unscoped match let a grant minted for app A authorize the same
    // command string in app B (directory-dependent commands differ).
    const grants = [mint()];
    assert.equal(matchGrant(grants, { command: CMD, nowMs: NOW }, CLASSES), null);
    assert.equal(matchGrant(grants, { command: CMD, scope: "my-app", nowMs: NOW }, CLASSES), null);
    assert.equal(matchGrant(grants, { command: CMD, actionClass: "deploy", nowMs: NOW }, CLASSES), null);
  });

  it("does NOT match a wrong scope or wrong class", () => {
    const grants = [mint()];
    assert.equal(matchGrant(grants, { ...QUERY, scope: "other-app" }, CLASSES), null);
    assert.equal(matchGrant(grants, { ...QUERY, actionClass: "git-push" }, CLASSES), null);
  });

  it("does NOT match an expired or consumed grant", () => {
    assert.equal(matchGrant([mint()], { ...QUERY, nowMs: NOW + DEFAULT_GRANT_TTL_MS }, CLASSES), null);
    assert.equal(matchGrant([markConsumed(mint(), NOW)], QUERY, CLASSES), null);
  });

  it("REJECTS a non-string command — a stateful toString() must never reach the hash", () => {
    let call = 0;
    const shifty = { toString: () => (call++ === 0 ? "nonempty" : CMD) };
    assert.equal(matchGrant([mint()], { ...QUERY, command: shifty }, CLASSES), null);
  });

  it("REJECTS an accessor-backed command — the value type-checked must be the value hashed", () => {
    // A getter defeats the stateful-toString() defense above: every read returns
    // a genuine string, so `typeof` passes, but the reads can DIFFER. Before the
    // read-once fix, matchGrant read query.command three times — type-checking a
    // hostile value, hashing the benign one, and approving; the caller's own
    // later read then returned the hostile string again.
    const EVIL = `${CMD} && rm -rf ./victim`;
    const values = [EVIL, CMD, EVIL];
    let reads = 0;
    const query = {
      get command() {
        reads += 1;
        return values.length > 1 ? values.shift() : values[0];
      },
      scope: QUERY.scope,
      actionClass: QUERY.actionClass,
      nowMs: NOW,
    };
    assert.equal(matchGrant([mint()], query, CLASSES), null);
    assert.equal(reads, 1, "matchGrant must read query.command exactly once");
  });

  it("an accessor cannot validate one value and store another (mint path)", () => {
    // buildGrant used to re-read opts after validating them, so a getter could
    // pass the allowlist check as "deploy" and land "git-push" in the grant,
    // or validate a 1s TTL and store one that never expires.
    let classReads = 0;
    assert.equal(
      buildGrant({
        command: CMD,
        scope: "my-app",
        allowedClasses: CLASSES,
        id: "g1",
        nowMs: NOW,
        get actionClass() {
          return ++classReads === 1 ? CLASSES[0] : "git-push";
        },
      }).actionClass,
      CLASSES[0],
      "the stored class must be the one that passed the allowlist",
    );

    let ttlReads = 0;
    assert.equal(
      buildGrant({
        command: CMD,
        scope: "my-app",
        actionClass: CLASSES[0],
        allowedClasses: CLASSES,
        id: "g2",
        nowMs: NOW,
        get ttlMs() {
          return ++ttlReads === 1 ? 1000 : Number.MAX_SAFE_INTEGER;
        },
      }).expiresAtMs,
      NOW + 1000,
      "the stored TTL must be the one that was validated",
    );
  });

  it("EVERY query field is read once, not just command", () => {
    // The first accessor test only covered `command`, so re-reading scope,
    // actionClass or nowMs was still an uncaught mutation — and each is enough
    // to authorize against a different grant than the one that was checked.
    for (const field of ["scope", "actionClass", "nowMs"]) {
      let reads = 0;
      const good = { scope: "my-app", actionClass: CLASSES[0], nowMs: NOW }[field];
      const evil = { scope: "other-app", actionClass: "git-push", nowMs: NOW + 10_000_000 }[field];
      const query = {
        command: CMD,
        scope: "my-app",
        actionClass: CLASSES[0],
        nowMs: NOW,
        get [field]() {
          reads += 1;
          return reads === 1 ? evil : good;
        },
      };
      assert.equal(matchGrant([mint()], query, CLASSES), null, `${field}: hostile first read must deny`);
      assert.equal(reads, 1, `${field} must be read exactly once`);
    }
  });

  it("a consumed grant stays dead across serialize/parse", () => {
    // Round-tripping never appeared in the suite, so dropping consumedAtMs (or
    // forcing singleUse:false) in parseGrant was invisible: a spent grant came
    // back live, and every single-use grant came back reusable.
    const consumed = markConsumed(mint(), NOW + 1);
    const parsed = parseGrant(serializeGrant(consumed), CLASSES);
    assert.equal(parsed.consumedAtMs, NOW + 1, "the consumption timestamp must survive the round trip");
    assert.equal(isGrantLive(parsed, NOW + 2), false);
    assert.equal(matchGrant([parsed], QUERY, CLASSES), null);
  });

  it("singleUse survives serialize/parse in BOTH directions", () => {
    assert.equal(parseGrant(serializeGrant(mint()), CLASSES).singleUse, true);
    const multi = buildGrant({
      command: CMD,
      scope: "my-app",
      actionClass: CLASSES[0],
      allowedClasses: CLASSES,
      id: "multi",
      nowMs: NOW,
      singleUse: false,
    });
    assert.equal(parseGrant(serializeGrant(multi), CLASSES).singleUse, false);
  });

  it("a stateful allowlist cannot widen itself between the length check and the lookup", () => {
    // `.length` was read for the emptiness check and again inside .includes(),
    // so a Proxy returning 1 then 2 admitted a class the caller never declared.
    let lengthReads = 0;
    const shifty = new Proxy(["deploy", "git-push"], {
      get(target, prop, recv) {
        if (prop === "length") return ++lengthReads === 1 ? 1 : 2;
        return Reflect.get(target, prop, recv);
      },
    });
    assert.equal(isAllowedGrantClass("git-push", shifty), false);
  });

  it("an accessor clock is read once, and the verdict follows that one value", () => {
    // hasValidShape used to read expiresAtMs, then the comparison read it again: a
    // getter returning a finite future value and then NaN made `nowMs >= NaN`
    // false, which read as "not expired". Now the grant is snapshotted once, so
    // there is no second value: the verdict is whatever the single read says.
    for (const [first, then, expected] of [
      [NOW + 1000, Number.NaN, true], // read once: a valid, unexpired grant
      [Number.NaN, NOW + 1000, false], // read once: malformed, dead
      [NOW - 1, NOW + 1000, false], // read once: expired, dead
    ]) {
      let reads = 0;
      const grant = { ...mint(), get expiresAtMs() { return ++reads === 1 ? first : then; } };
      assert.equal(isGrantLive(grant, NOW), expected, `first read ${first}`);
      assert.equal(reads, 1);
    }
  });

  it("FAIL-CLOSED: empty command, garbage list, bad clock, malformed grants, empty allowlist", () => {
    assert.equal(matchGrant([mint()], { ...QUERY, command: "" }, CLASSES), null);
    assert.equal(matchGrant([mint()], { ...QUERY, nowMs: Number.NaN }, CLASSES), null);
    assert.equal(matchGrant([mint()], { ...QUERY, nowMs: null }, CLASSES), null);
    assert.equal(matchGrant(null, QUERY, CLASSES), null);
    assert.notEqual(matchGrant([null, { actionClass: "git-push" }, mint()], QUERY, CLASSES), null); // skips the bad, finds the good
    assert.equal(matchGrant([null, { actionClass: "git-push" }], QUERY, CLASSES), null);
    assert.equal(matchGrant([mint()], QUERY, []), null); // empty allowlist denies
    assert.equal(matchGrant([mint()], QUERY), null); // absent allowlist denies
  });

  it("SKIPS (never throws on) a grant with wrong-typed fields, even a numeric hash", () => {
    const rogueHash = { ...mint(), commandSha256: 12345 };
    assert.equal(matchGrant([rogueHash], QUERY, CLASSES), null);
  });

  it("skips an out-of-allowlist-class grant even if the hash matches (defense in depth)", () => {
    const rogue = { ...mint(), actionClass: "git-push" };
    assert.equal(matchGrant([rogue], QUERY, CLASSES), null);
  });

  it("skips a grant whose hash does not match its own stored command (integrity binding)", () => {
    const lying = { ...mint(), command: "echo harmless-looking" };
    assert.equal(matchGrant([lying], { ...QUERY, command: "echo harmless-looking" }, CLASSES), null); // hash is of CMD, not this
    assert.equal(matchGrant([lying], QUERY, CLASSES), null); // and the CMD query fails shape validation too
  });

  it("LIMIT: matching mutates nothing — single-use enforcement is the caller's atomic store", () => {
    const grants = [mint()];
    assert.notEqual(matchGrant(grants, QUERY, CLASSES), null);
    assert.notEqual(matchGrant(grants, QUERY, CLASSES), null); // still matches: consume-then-execute is YOUR hook's job
  });
});

describe("lifetime cap — no standing grants", () => {
  const LONG = 1e13; // ~300 years
  it("exports a one-hour cap, above the fifteen-minute default", () => {
    assert.equal(MAX_GRANT_TTL_MS, 60 * 60 * 1000);
    assert.ok(DEFAULT_GRANT_TTL_MS <= MAX_GRANT_TTL_MS);
  });
  it("buildGrant THROWS on a ttl over the cap; the cap itself mints", () => {
    assert.throws(() => mint({ ttlMs: LONG }), /ttlMs/);
    assert.throws(() => mint({ ttlMs: MAX_GRANT_TTL_MS + 1 }), /ttlMs/);
    assert.equal(mint({ ttlMs: MAX_GRANT_TTL_MS }).expiresAtMs, NOW + MAX_GRANT_TTL_MS);
  });
  it("a hand-edited long-lived grant is dead: not live, not parsed, never matched", () => {
    const g = { ...mint(), expiresAtMs: NOW + LONG };
    assert.equal(isGrantLive(g, NOW + 1), false);
    assert.equal(parseGrant(JSON.stringify(g), CLASSES), null);
    assert.equal(matchGrant([g], { ...QUERY, nowMs: NOW + 1 }, CLASSES), null);
  });
  it("a grant minted in the future, or with no positive lifetime, is not live", () => {
    assert.equal(isGrantLive(mint({ nowMs: NOW + 60_000 }), NOW), false);
    assert.equal(isGrantLive({ ...mint(), expiresAtMs: NOW }, NOW - 1), false);
  });
  it("timestamps must be safe-integer milliseconds (a fraction can round a lifetime under the cap)", () => {
    assert.equal(isGrantLive({ ...mint(), mintedAtMs: -(2 ** -32), expiresAtMs: MAX_GRANT_TTL_MS }, 0), false);
    assert.equal(isGrantLive({ ...mint(), mintedAtMs: 0, expiresAtMs: Number.MIN_VALUE }, 0), false);
    assert.throws(() => mint({ nowMs: NOW + 0.5 }), /nowMs/);
    assert.throws(() => mint({ ttlMs: 1.5 }), /ttlMs/);
  });
});

// ---------------------------------------------------------------------------
// READ ONCE, JUDGE THE SNAPSHOT. Every function that judges a grant copies its
// fields once into a plain object and decides on that copy only; the copy is
// what matchGrant returns. Each test below is an accessor exploit that worked
// against per-field re-reads (the previous shape of this file).
// ---------------------------------------------------------------------------
describe("grant snapshot — every grant field is read exactly once per call", () => {
  const counting = (g) => {
    const reads = {};
    const proxy = new Proxy(g, {
      get(target, prop, recv) {
        if (typeof prop === "string") reads[prop] = (reads[prop] ?? 0) + 1;
        return Reflect.get(target, prop, recv);
      },
    });
    return { proxy, reads };
  };

  it("isGrantLive and matchGrant read each field once", () => {
    for (const call of [(p) => isGrantLive(p, NOW), (p) => matchGrant([p], QUERY, CLASSES)]) {
      const { proxy, reads } = counting(mint());
      call(proxy);
      for (const [field, n] of Object.entries(reads)) assert.equal(n, 1, `${field} read ${n} times`);
      assert.ok(reads.commandSha256 === 1 && reads.expiresAtMs === 1, "the decision fields were read");
    }
  });

  it("a commandSha256 getter cannot pass the integrity check and then match another command", () => {
    let n = 0;
    const g = { ...mint(), get commandSha256() { return ++n <= 3 ? commandHash(CMD) : commandHash("evil"); } };
    assert.equal(matchGrant([g], { ...QUERY, command: "evil" }, CLASSES), null);
  });

  it("a mintedAtMs getter cannot pass as future-safe and then decide liveness with another value", () => {
    let r = 0;
    const g = { ...mint(), get mintedAtMs() { return ++r <= 3 ? NOW + 1000 : NOW; } };
    assert.equal(isGrantLive(g, NOW), false);
  });

  it("a getter that rewrites the grant mid-match cannot widen what is returned", () => {
    let s = 0;
    const g = mint();
    Object.defineProperty(g, "scope", { get() { if (++s >= 2) g.expiresAtMs = NOW + 1e13; return "my-app"; }, enumerable: true });
    const m = matchGrant([g], QUERY, CLASSES);
    assert.ok(m === null || m.expiresAtMs - m.mintedAtMs <= MAX_GRANT_TTL_MS, "the returned grant is the validated snapshot");
  });

  it("an expiresAtMs getter cannot pass the cap and then widen", () => {
    let reads = 0;
    const tricky = { ...mint() };
    Object.defineProperty(tricky, "expiresAtMs", { get: () => (++reads <= 1 ? NOW + 1000 : NOW + 1e13), enumerable: true });
    assert.equal(isGrantLive(tricky, NOW + MAX_GRANT_TTL_MS + 5), false);
  });

  it("matchGrant never throws: hostile query, grant list or allowlist reads are 'no match'", () => {
    assert.equal(matchGrant([mint()], { ...QUERY, get command() { throw new Error("query"); } }, CLASSES), null);
    assert.equal(matchGrant(Object.defineProperty([mint()], "0", { get() { throw new Error("index"); } }), QUERY, CLASSES), null);
    assert.equal(matchGrant([mint()], QUERY, new Proxy(CLASSES, { get() { throw new Error("allowlist"); } })), null);
    const revoked = Proxy.revocable([mint()], {});
    revoked.revoke();
    assert.equal(matchGrant(revoked.proxy, QUERY, CLASSES), null);
  });

  it("matchGrant reads the grant list by index, not through its iterator", () => {
    const list = [mint()];
    list[Symbol.iterator] = function* () { yield mint({ id: "smuggled" }); };
    assert.equal(matchGrant(list, QUERY, CLASSES)?.id, "grant-abc123");
  });

  it("markConsumed copies only grant fields: a toJSON hook cannot drop the consumed stamp", () => {
    const c = markConsumed({ ...mint(), toJSON: () => mint() }, NOW);
    assert.equal(c.consumedAtMs, NOW);
    assert.equal(isGrantLive(parseGrant(serializeGrant(c), CLASSES), NOW), false);
    assert.throws(() => markConsumed(null, NOW), /readable grant/);
  });

  it("buildGrant reads the allowlist by index too: an iterator cannot smuggle a class into a mint", () => {
    const allowed = ["deploy"];
    allowed[Symbol.iterator] = function* () { yield "admin"; };
    assert.throws(() => mint({ actionClass: "admin", allowedClasses: allowed }), /actionClass/);
  });

  it("buildGrant refuses an expiry past the safe-integer range", () => {
    assert.throws(() => mint({ nowMs: Number.MAX_SAFE_INTEGER, ttlMs: 1 }), /safe-integer/);
  });

  it("a throwing getter fails closed (no throw out of isGrantLive / matchGrant)", () => {
    const g = { ...mint(), get scope() { throw new Error("boom"); } };
    assert.equal(isGrantLive(g, NOW), false);
    assert.equal(matchGrant([g, mint()], QUERY, CLASSES)?.id, "grant-abc123"); // skips the bad, finds the good
  });
});

describe("markConsumed + composeAuditLine", () => {
  it("markConsumed stamps consumedAtMs", () => {
    assert.equal(markConsumed(mint(), NOW + 5000).consumedAtMs, NOW + 5000);
  });

  it("markConsumed THROWS on a non-finite clock — NaN would read as unconsumed downstream", () => {
    assert.throws(() => markConsumed(mint(), Number.NaN), /nowMs/);
    assert.throws(() => markConsumed(mint(), "now"), /nowMs/);
  });

  it("composeAuditLine emits parseable NDJSON with the event + hash, and NO raw command by default", () => {
    // A command can carry a secret (`curl -H "Authorization: Bearer …"`), and the
    // audit log is the file adopters are told to keep. The hash identifies the
    // command; the text appears only through a caller-supplied redactor.
    const j = JSON.parse(composeAuditLine({ event: "consume", grant: mint(), nowMs: NOW, note: "matched pending command" }));
    assert.equal(j.event, "consume");
    assert.equal(j.atMs, NOW);
    assert.equal(j.command, null);
    assert.equal(j.commandSha256, commandHash(CMD));
    assert.equal(j.scope, "my-app");
    assert.equal(j.note, "matched pending command");
  });

  it("composeAuditLine writes the command only through the caller's redactor, fail-closed", () => {
    const secretCmd = 'curl -H "Authorization: Bearer abc123SECRET" https://api.example/deploy';
    const g = mint({ command: secretCmd });
    const redact = (/** @type {string} */ s) => s.replace(/Bearer [^\s"]+/, "Bearer [redacted]");
    const j = JSON.parse(composeAuditLine({ event: "mint", grant: g, nowMs: NOW, redact }));
    assert.equal(j.command, 'curl -H "Authorization: Bearer [redacted]" https://api.example/deploy');
    assert.equal(j.commandSha256, commandHash(secretCmd));
    // A redactor that throws or returns a non-string leaves the command out.
    const boom = () => { throw new Error("redactor failed"); };
    assert.equal(JSON.parse(composeAuditLine({ event: "mint", grant: g, nowMs: NOW, redact: boom })).command, null);
    assert.equal(JSON.parse(composeAuditLine({ event: "mint", grant: g, nowMs: NOW, redact: () => 42 })).command, null);
  });

  it("composeAuditLine: a command getter cannot hand the redactor one value and log another; throwing getters fail closed", () => {
    let cr = 0;
    const g = { ...mint(), get command() { return ++cr === 1 ? "Bearer SECRET" : { replace: () => "Bearer SECRET" }; } };
    const out = JSON.parse(composeAuditLine({ event: "mint", grant: g, nowMs: NOW, redact: (s) => s.replace(/Bearer .+/, "[redacted]") }));
    assert.notEqual(out.command, "Bearer SECRET");
    const thrower = { ...mint(), get command() { throw new Error("boom"); } };
    assert.equal(JSON.parse(composeAuditLine({ event: "mint", grant: thrower, nowMs: NOW, redact: (s) => s })).command, null);
    const badOpts = { event: "mint", grant: mint(), nowMs: NOW, get redact() { throw new Error("boom"); } };
    assert.equal(JSON.parse(composeAuditLine(badOpts)).command, null);
  });

  it("composeAuditLine logs strings and finite numbers only: no caller hook runs, nothing is coerced", () => {
    assert.doesNotThrow(() => composeAuditLine({ event: "mint", nowMs: Symbol("t") }));
    assert.equal(JSON.parse(composeAuditLine({ event: "mint", nowMs: Symbol("t") })).atMs, null);
    const hooked = { ...mint(), mintedBy: { toJSON: () => CMD } };
    assert.equal(JSON.parse(composeAuditLine({ event: "mint", grant: hooked, nowMs: NOW })).mintedBy, null);
    assert.equal(JSON.parse(composeAuditLine({ event: { toString: () => CMD }, nowMs: NOW })).event, "unknown");
    assert.equal(JSON.parse(composeAuditLine({ event: "mint", nowMs: NOW, note: 10n })).note, null);
  });

  it("composeAuditLine: event is from a closed set and commandSha256 must be a hash", () => {
    assert.equal(JSON.parse(composeAuditLine({ event: CMD, nowMs: NOW })).event, "unknown");
    const forged = { ...mint(), commandSha256: CMD };
    assert.equal(JSON.parse(composeAuditLine({ event: "denied", grant: forged, nowMs: NOW })).commandSha256, null);
    // Contract, pinned: caller-chosen metadata strings are logged as given.
    assert.equal(JSON.parse(composeAuditLine({ event: "mint", grant: mint(), nowMs: NOW })).scope, "my-app");
  });

  it("composeAuditLine tolerates a missing grant (denied/no-grant events)", () => {
    const j = JSON.parse(composeAuditLine({ event: "denied", nowMs: NOW }));
    assert.equal(j.event, "denied");
    assert.equal(j.id, null);
  });
});
