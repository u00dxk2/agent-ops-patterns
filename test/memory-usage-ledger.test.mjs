import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseLedgerText, makeTouchRows, tallyUsage } from "../lib/memory-usage-ledger.mjs";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-08-15T12:00:00Z");
const iso = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();

describe("tallyUsage — evidence for eviction, never a verdict", () => {
  it("counts in-window touches per name, tracks last touch, orders by count", () => {
    const rows = [
      { ts: iso(1), name: "alpha", session: "s1" },
      { ts: iso(2), name: "alpha", session: "s2" },
      { ts: iso(3), name: "beta", session: "s1" },
    ];
    const t = tallyUsage(rows, ["alpha", "beta", "gamma"], { days: 90, now: NOW });
    assert.deepEqual(t.touched.map((e) => e.name), ["alpha", "beta"]);
    assert.equal(t.touched[0].count, 2);
    assert.equal(t.touched[0].lastTouch, iso(1));
    assert.deepEqual(t.neverTouched, ["gamma"]);
    assert.equal(t.rowsRead, 3);
  });

  it("a touch outside the window does not count — the file reads never-touched IN THE WINDOW", () => {
    const rows = [{ ts: iso(200), name: "beta", session: "s0" }];
    const t = tallyUsage(rows, ["beta"], { days: 90, now: NOW });
    assert.deepEqual(t.neverTouched, ["beta"]);
    assert.equal(t.rowsRead, 1, "the out-of-window row still counts as evidence READ");
  });

  it("drops malformed rows fail-soft (missing name/ts, wrong types, garbage dates)", () => {
    const rows = [
      { bogus: true },
      { ts: 12345, name: "alpha" },
      { ts: "not a date", name: "alpha" },
      { ts: iso(1), name: null },
      { ts: iso(1), name: "alpha" },
    ];
    const t = tallyUsage(rows, ["alpha"], { days: 90, now: NOW });
    assert.equal(t.touched.length, 1);
    assert.equal(t.touched[0].count, 1);
    assert.equal(t.rowsRead, 1, "only the well-formed row is evidence");
  });

  it("tolerates garbage inputs entirely — non-array rows/names, absent opts", () => {
    assert.deepEqual(tallyUsage(null, null).touched, []);
    assert.equal(tallyUsage(undefined, ["a"]).neverTouched.length, 1);
  });
});

describe("tallyUsage — limits, pinned as tested expectations", () => {
  it("LIMIT: an empty ledger is absence of evidence, not evidence of rot — rowsRead says so", () => {
    // Every file lands never-touched, and rowsRead === 0 is the consumer's
    // signal to refuse the eviction read (the dead-instrument zero from
    // patterns/checks-that-cant-fail.md).
    const t = tallyUsage([], ["alpha", "beta"], { days: 90, now: NOW });
    assert.deepEqual(t.neverTouched, ["alpha", "beta"]);
    assert.equal(t.rowsRead, 0);
  });

  it("LIMIT: a future-dated touch counts, unclamped — the writer bug stays visible", () => {
    const rows = [{ ts: iso(-5), name: "alpha", session: "s1" }];
    const t = tallyUsage(rows, ["alpha"], { days: 90, now: NOW });
    assert.equal(t.touched[0]?.count, 1);
  });

  it("LIMIT: a self-reported touch is taken at face value — the lib cannot tell load-bearing from merely-mentioned", () => {
    // The convention (touch = load-bearing) lives in the caller's session-close
    // discipline; this pins that the function does not pretend to detect it.
    const rows = [{ ts: iso(1), name: "alpha", session: "over-toucher" }];
    assert.equal(tallyUsage(rows, ["alpha"], { days: 90, now: NOW }).touched[0].count, 1);
  });
});

describe("parseLedgerText — fail-soft JSONL", () => {
  it("parses rows, tolerates CRLF and blank lines, drops garbage lines and non-objects", () => {
    const text = '{"ts":"2026-08-14T00:00:00Z","name":"a"}\r\n\r\nnot json\n[1,2]\n{"ts":"2026-08-14T00:00:00Z","name":"b"}\n';
    const rows = parseLedgerText(text);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.name), ["a", "b"]);
  });

  it("empty/absent text → no rows", () => {
    assert.deepEqual(parseLedgerText(""), []);
    assert.deepEqual(parseLedgerText(null), []);
  });
});

describe("makeTouchRows — write-time validation, so a caller bug surfaces before it corrupts the tally", () => {
  it("builds rows with a shared timestamp and the session id", () => {
    const { rows, rejected } = makeTouchRows(["alpha", "beta"], { session: "s9", now: NOW });
    assert.equal(rows.length, 2);
    assert.equal(rejected.length, 0);
    assert.equal(rows[0].ts, new Date(NOW).toISOString());
    assert.equal(rows[1].session, "s9");
  });

  it("REJECTS path-shaped and .md-suffixed names rather than normalizing them", () => {
    const { rows, rejected } = makeTouchRows(["ok", "dir/бad", "win\\bad", "alpha.md", "", 7], { now: NOW });
    assert.deepEqual(rows.map((r) => r.name), ["ok"]);
    assert.equal(rejected.length, 5);
  });

  it("records names missing from knownNames but reports them as unknown (likely typos)", () => {
    const { rows, unknown } = makeTouchRows(["alpha", "alhpa"], { now: NOW, knownNames: ["alpha"] });
    assert.equal(rows.length, 2, "still recorded — the file may be written later this close-out");
    assert.deepEqual(unknown, ["alhpa"]);
  });
});
