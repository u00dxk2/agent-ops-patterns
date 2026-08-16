import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { screenDecision, isPass, VERDICTS } from "../lib/shadow-screen.mjs";

describe("screenDecision — the four mode×outcome states", () => {
  it("enforce + flagged → block, stopped", () => {
    assert.deepEqual(screenDecision({ mode: "enforce", ran: true, flagged: true }), { verdict: "block", proceed: false });
  });

  it("enforce + clean → allow, proceeds", () => {
    assert.deepEqual(screenDecision({ mode: "enforce", ran: true, flagged: false }), { verdict: "allow", proceed: true });
  });

  it("ran:false is unscreened whatever `flagged` says — BOTH operands are load-bearing", () => {
    // Dropping `o.ran === true` from the predicate left `typeof flagged ===
    // "boolean"` sufficient, so {ran:false, flagged:false} became a real
    // `allow`: a screener explicitly reported as NOT RUN reading green. The
    // suite did not catch it because it only tested ran:false with a
    // non-boolean flagged.
    for (const flagged of [true, false]) {
      assert.equal(screenDecision({ mode: "enforce", ran: false, flagged }).verdict, "unscreened");
      assert.equal(screenDecision({ mode: "shadow", ran: false, flagged }).verdict, "unscreened");
    }
    // And enforce-mode unscreened must not proceed unless explicitly allowed.
    assert.equal(screenDecision({ mode: "enforce", ran: false, flagged: false }).proceed, false);
  });

  it("an accessor-backed `flagged` cannot be type-checked as a finding and enforced as clean", () => {
    // The screener said "flagged". Before the read-once fix, `flagged` was read
    // twice: the typeof gate saw true, the verdict branch saw the second read.
    // A flagged action came back verdict "allow", proceed true.
    let reads = 0;
    const input = {
      mode: "enforce",
      ran: true,
      get flagged() {
        reads += 1;
        return reads === 1;
      },
    };
    assert.deepEqual(screenDecision(input), { verdict: "block", proceed: false });
    assert.equal(reads, 1, "screenDecision must read flagged exactly once");
  });

  it("shadow + flagged → would_block, but the action PROCEEDS (a watching gate never gates)", () => {
    assert.deepEqual(screenDecision({ mode: "shadow", ran: true, flagged: true }), { verdict: "would_block", proceed: true });
  });

  it("shadow + clean → shadow_allow, proceeds", () => {
    assert.deepEqual(screenDecision({ mode: "shadow", ran: true, flagged: false }), { verdict: "shadow_allow", proceed: true });
  });
});

describe("screenDecision — unscreened: the screener that never ran must never read as a pass", () => {
  it("screener did not run → unscreened in both modes", () => {
    assert.equal(screenDecision({ mode: "enforce", ran: false }).verdict, "unscreened");
    assert.equal(screenDecision({ mode: "shadow", ran: false }).verdict, "unscreened");
  });

  it("enforce + unscreened is FAIL-CLOSED by default: the action does not proceed", () => {
    assert.deepEqual(screenDecision({ mode: "enforce", ran: false }), { verdict: "unscreened", proceed: false });
  });

  it("shadow + unscreened proceeds (shadow never gates) but is still labeled unscreened, never shadow_allow", () => {
    assert.deepEqual(screenDecision({ mode: "shadow", ran: false }), { verdict: "unscreened", proceed: true });
  });

  it("declared fail-open (unscreenedProceeds: true) lets the action through but the verdict STAYS unscreened", () => {
    const d = screenDecision({ mode: "enforce", ran: false, unscreenedProceeds: true });
    assert.deepEqual(d, { verdict: "unscreened", proceed: true });
    assert.equal(isPass(d.verdict), false, "fail-open is a policy choice, not evidence the screen looked");
  });

  it("a screener that ran but returned garbage (non-boolean flagged) counts as not-run", () => {
    assert.equal(screenDecision({ mode: "enforce", ran: true }).verdict, "unscreened");
    assert.equal(screenDecision({ mode: "enforce", ran: true, flagged: "yes" }).verdict, "unscreened");
    assert.equal(screenDecision({ mode: "shadow", ran: true, flagged: null }).verdict, "unscreened");
  });

  it("an unknown mode is treated as enforce — a typo'd deployment gets safe-and-noisy, not silently-watching", () => {
    assert.deepEqual(screenDecision({ mode: "Shadow", ran: true, flagged: true }), { verdict: "block", proceed: false });
    assert.deepEqual(screenDecision({ mode: "watch", ran: false }), { verdict: "unscreened", proceed: false });
    assert.deepEqual(screenDecision(null), { verdict: "unscreened", proceed: false });
  });
});

describe("isPass — a dashboard cannot absorb a dark screener into its green number", () => {
  it("true only for allow and shadow_allow", () => {
    assert.equal(isPass("allow"), true);
    assert.equal(isPass("shadow_allow"), true);
    assert.equal(isPass("block"), false);
    assert.equal(isPass("would_block"), false);
    assert.equal(isPass("unscreened"), false);
    assert.equal(isPass("garbage"), false);
  });

  it("the vocabulary is closed: five verdicts, frozen", () => {
    assert.deepEqual([...VERDICTS].sort(), ["allow", "block", "shadow_allow", "unscreened", "would_block"]);
    assert.ok(Object.isFrozen(VERDICTS));
  });
});

describe("shadow-screen — limits, pinned as tested expectations", () => {
  it("LIMIT: it classifies; it does not enforce — a caller ignoring `proceed` defeats it undetectably", () => {
    // No pure function can see its caller. This pins that the helper's whole
    // output is the {verdict, proceed} pair — wiring proceed to enforcement
    // is the adopter's, and patterns/shadow-screen-states.md says how.
    const d = screenDecision({ mode: "enforce", ran: true, flagged: true });
    assert.deepEqual(Object.keys(d).sort(), ["proceed", "verdict"]);
  });

  it("LIMIT: it cannot judge screener quality — a screener that never flags yields wall-to-wall allows", () => {
    for (const mode of ["shadow", "enforce"]) {
      assert.equal(isPass(screenDecision({ mode, ran: true, flagged: false }).verdict), true);
    }
    // Prove the screener CAN fire before trusting its quiet — checks-that-cant-fail.
  });
});
