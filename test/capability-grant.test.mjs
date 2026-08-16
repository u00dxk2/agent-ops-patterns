import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GRANT_SCHEMA_VERSION,
  DEFAULT_GRANT_TTL_MS,
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

  it("an expired grant cannot read as live via an accessor clock", () => {
    // hasValidShape read expiresAtMs, then the comparison read it again. A
    // getter returning a finite future value and then NaN made `nowMs >= NaN`
    // false, which reads as "not expired".
    let reads = 0;
    const grant = {
      ...mint(),
      get expiresAtMs() {
        return ++reads === 1 ? NOW + 1000 : Number.NaN;
      },
    };
    assert.equal(isGrantLive(grant, NOW), false);
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

describe("markConsumed + composeAuditLine", () => {
  it("markConsumed stamps consumedAtMs", () => {
    assert.equal(markConsumed(mint(), NOW + 5000).consumedAtMs, NOW + 5000);
  });

  it("markConsumed THROWS on a non-finite clock — NaN would read as unconsumed downstream", () => {
    assert.throws(() => markConsumed(mint(), Number.NaN), /nowMs/);
    assert.throws(() => markConsumed(mint(), "now"), /nowMs/);
  });

  it("composeAuditLine emits parseable NDJSON with the event + command + hash", () => {
    const j = JSON.parse(composeAuditLine({ event: "consume", grant: mint(), nowMs: NOW, note: "matched pending command" }));
    assert.equal(j.event, "consume");
    assert.equal(j.atMs, NOW);
    assert.equal(j.command, CMD);
    assert.equal(j.commandSha256, commandHash(CMD));
    assert.equal(j.scope, "my-app");
    assert.equal(j.note, "matched pending command");
  });

  it("composeAuditLine tolerates a missing grant (denied/no-grant events)", () => {
    const j = JSON.parse(composeAuditLine({ event: "denied", nowMs: NOW }));
    assert.equal(j.event, "denied");
    assert.equal(j.id, null);
  });
});
