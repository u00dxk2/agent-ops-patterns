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

describe("normalizeCommand", () => {
  it("trims and collapses internal whitespace", () => {
    assert.equal(normalizeCommand("  deploy   --env production  "), CMD);
    assert.equal(normalizeCommand("deploy\t--env\nproduction"), CMD);
  });
  it("is null/garbage safe", () => {
    assert.equal(normalizeCommand(null), "");
    assert.equal(normalizeCommand(undefined), "");
  });
});

describe("commandHash", () => {
  it("is stable across benign whitespace differences (normalize-then-hash)", () => {
    assert.equal(commandHash(CMD), commandHash("  deploy   --env production "));
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

  it("normalizes the stored command", () => {
    const g = mint({ command: "  deploy   --env production " });
    assert.equal(g.command, CMD);
  });

  it("THROWS on an out-of-allowlist class (no silent over-broad grant)", () => {
    assert.throws(() => mint({ actionClass: "git-push" }), /actionClass/);
    assert.throws(() => mint({ actionClass: "arbitrary" }));
  });

  it("THROWS with an empty allowlist — minting requires a declared class list", () => {
    assert.throws(() => mint({ allowedClasses: [] }), /actionClass/);
  });

  it("THROWS on empty command / missing scope / missing id / bad clock", () => {
    assert.throws(() => mint({ command: "   " }), /empty command/);
    assert.throws(() => mint({ scope: "" }), /scope/);
    assert.throws(() => mint({ id: "" }), /id/);
    assert.throws(() => mint({ nowMs: Number.NaN }), /nowMs/);
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

  it("FAIL-CLOSED: false for null grant / non-finite clock", () => {
    assert.equal(isGrantLive(null, NOW), false);
    assert.equal(isGrantLive(mint(), Number.NaN), false);
  });
});

describe("matchGrant — exact-command authorization", () => {
  it("matches the exact pre-authorized command (normalized) within scope + TTL", () => {
    const m = matchGrant([mint()], {
      command: "  deploy   --env production ",
      scope: "my-app",
      actionClass: "deploy",
      nowMs: NOW,
    }, CLASSES);
    assert.notEqual(m, null);
    assert.equal(m.id, "grant-abc123");
  });

  it("does NOT match a different command (exact binding — the security boundary)", () => {
    const grants = [mint()];
    assert.equal(
      matchGrant(grants, { command: "deploy --env staging", scope: "my-app", actionClass: "deploy", nowMs: NOW }, CLASSES),
      null,
    );
    // a superset/dangerous command must NOT ride a narrow grant
    assert.equal(
      matchGrant(grants, { command: "deploy --env production && rm -rf /", scope: "my-app", actionClass: "deploy", nowMs: NOW }, CLASSES),
      null,
    );
  });

  it("does NOT match a wrong scope or wrong class", () => {
    const grants = [mint()];
    assert.equal(matchGrant(grants, { command: CMD, scope: "other-app", actionClass: "deploy", nowMs: NOW }, CLASSES), null);
    assert.equal(matchGrant(grants, { command: CMD, scope: "my-app", actionClass: "git-push", nowMs: NOW }, CLASSES), null);
  });

  it("does NOT match an expired or consumed grant", () => {
    assert.equal(matchGrant([mint()], { command: CMD, scope: "my-app", nowMs: NOW + DEFAULT_GRANT_TTL_MS }, CLASSES), null);
    assert.equal(matchGrant([markConsumed(mint(), NOW)], { command: CMD, scope: "my-app", nowMs: NOW }, CLASSES), null);
  });

  it("matches without scope/class filters supplied (command + live + allowlisted is enough)", () => {
    assert.notEqual(matchGrant([mint()], { command: CMD, nowMs: NOW }, CLASSES), null);
  });

  it("FAIL-CLOSED: empty command, garbage list, bad clock, malformed grants, empty allowlist", () => {
    assert.equal(matchGrant([mint()], { command: "", scope: "my-app", nowMs: NOW }, CLASSES), null);
    assert.equal(matchGrant([mint()], { command: CMD, nowMs: Number.NaN }, CLASSES), null);
    assert.equal(matchGrant(null, { command: CMD, nowMs: NOW }, CLASSES), null);
    assert.notEqual(matchGrant([null, { actionClass: "git-push" }, mint()], { command: CMD, nowMs: NOW }, CLASSES), null); // skips the bad, finds the good
    assert.equal(matchGrant([null, { actionClass: "git-push" }], { command: CMD, nowMs: NOW }, CLASSES), null);
    assert.equal(matchGrant([mint()], { command: CMD, nowMs: NOW }, []), null); // empty allowlist denies
    assert.equal(matchGrant([mint()], { command: CMD, nowMs: NOW }), null); // absent allowlist denies
  });

  it("skips an out-of-allowlist-class grant even if the hash matches (defense in depth)", () => {
    // A grant object hand-crafted with a disallowed class never authorizes anything.
    const rogue = { ...mint(), actionClass: "git-push" };
    assert.equal(matchGrant([rogue], { command: CMD, nowMs: NOW }, CLASSES), null);
  });
});

describe("markConsumed + composeAuditLine", () => {
  it("markConsumed stamps consumedAtMs", () => {
    assert.equal(markConsumed(mint(), NOW + 5000).consumedAtMs, NOW + 5000);
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
