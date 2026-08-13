import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickStaleBasis } from "../lib/stale-basis.mjs";

describe("pickStaleBasis — newest signal wins, labeled", () => {
  it("picks the newest of the declared signal fields and names it", () => {
    const item = {
      lastEvaluated: "2026-07-01T00:00:00Z",
      lastChecked: "2026-08-01T00:00:00Z",
      created: "2026-01-01T00:00:00Z",
    };
    assert.deepEqual(pickStaleBasis(item), { date: "2026-08-01T00:00:00Z", basis: "lastChecked" });
  });

  it("an external signal (e.g. linked-commit date) wins when it is newest", () => {
    const item = { lastEvaluated: "2026-07-01T00:00:00Z", created: "2026-01-01T00:00:00Z" };
    const r = pickStaleBasis(item, {
      externalSignals: [{ date: "2026-08-10T12:00:00Z", basis: "linkedCommit" }],
    });
    assert.deepEqual(r, { date: "2026-08-10T12:00:00Z", basis: "linkedCommit" });
  });

  it("falls back to created when no signal exists, labeled as such", () => {
    const r = pickStaleBasis({ created: "2026-01-01T00:00:00Z" });
    assert.deepEqual(r, { date: "2026-01-01T00:00:00Z", basis: "created" });
  });

  it('returns {date: null, basis: "none"} when nothing is usable — a DISTINCT verdict, not "fresh"', () => {
    assert.deepEqual(pickStaleBasis({}), { date: null, basis: "none" });
    assert.deepEqual(pickStaleBasis(null), { date: null, basis: "none" });
    assert.deepEqual(pickStaleBasis(undefined), { date: null, basis: "none" });
  });

  it("honors custom signal/created field names (your schema, your names)", () => {
    const item = { verified_at: "2026-08-05T00:00:00Z", opened_at: "2026-02-01T00:00:00Z" };
    const r = pickStaleBasis(item, { signalFields: ["verified_at"], createdField: "opened_at" });
    assert.deepEqual(r, { date: "2026-08-05T00:00:00Z", basis: "verified_at" });
  });
});

describe("pickStaleBasis — the bulk-write exclusion (the point of the lib)", () => {
  it("a newer `updated` timestamp does NOT advance the clock — it is not a signal field", () => {
    // The bulk-migration scenario: every row got `updated` stamped today, but
    // nobody LOOKED at this item since July. Staleness must read July.
    const item = {
      lastEvaluated: "2026-07-01T00:00:00Z",
      updated: "2026-08-13T00:00:00Z", // mass edit — must be invisible to the chain
      created: "2026-01-01T00:00:00Z",
    };
    assert.deepEqual(pickStaleBasis(item), { date: "2026-07-01T00:00:00Z", basis: "lastEvaluated" });
  });

  it("…unless a caller explicitly opts a field in — the exclusion is the default, not a trap", () => {
    const item = { updated: "2026-08-13T00:00:00Z", created: "2026-01-01T00:00:00Z" };
    const r = pickStaleBasis(item, { signalFields: ["updated"] });
    assert.equal(r.basis, "updated");
  });
});

describe("pickStaleBasis — fail-soft on malformed input", () => {
  it("tolerates malformed OPTIONS too: null opts / non-array fields fall back to defaults, never throw", () => {
    assert.deepEqual(pickStaleBasis({}, null), { date: null, basis: "none" });
    assert.deepEqual(pickStaleBasis({}, { signalFields: null }), { date: null, basis: "none" });
    assert.deepEqual(pickStaleBasis({}, { externalSignals: null }), { date: null, basis: "none" });
    const item = { lastEvaluated: "2026-07-01T00:00:00Z" };
    assert.equal(pickStaleBasis(item, { signalFields: "lastEvaluated" }).basis, "lastEvaluated"); // non-array → defaults, which include it
    assert.equal(pickStaleBasis(item, { createdField: 7 }).basis, "lastEvaluated");
  });

  it("skips unparseable / empty / non-string dates instead of throwing", () => {
    const item = {
      lastEvaluated: "not a date",
      lastChecked: "   ",
      created: 1234, // non-string — ignored
    };
    assert.deepEqual(pickStaleBasis(item), { date: null, basis: "none" });
  });

  it("a malformed external signal is skipped, valid ones still compete", () => {
    const r = pickStaleBasis({}, {
      externalSignals: [
        { date: "garbage", basis: "linkedCommit" },
        { date: null, basis: "linkedCommit" },
        { date: "2026-06-01T00:00:00Z", basis: "linkedCommit" },
      ],
    });
    assert.deepEqual(r, { date: "2026-06-01T00:00:00Z", basis: "linkedCommit" });
  });

  it("LIMIT: a future-dated signal wins — no clamping, so the writer bug stays visible", () => {
    const item = { lastEvaluated: "2027-01-01T00:00:00Z", created: "2026-01-01T00:00:00Z" };
    const r = pickStaleBasis(item);
    assert.equal(r.date, "2027-01-01T00:00:00Z"); // garbage in, visible out — lint for this upstream
  });

  it("LIMIT: a signal stamped by a dishonest writer is indistinguishable from a real one", () => {
    // If a bulk write stamps lastEvaluated, the clock resets and no chain can
    // tell. The convention lives in the writers; this pins that the function
    // takes the stamp at face value rather than pretending to detect it.
    const item = { lastEvaluated: "2026-08-13T00:00:00Z", created: "2026-01-01T00:00:00Z" };
    assert.equal(pickStaleBasis(item).basis, "lastEvaluated");
  });
});
