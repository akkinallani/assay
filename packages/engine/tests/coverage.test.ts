import { describe, it, expect } from "vitest";
import { coverageSignal } from "../src/index.js";
import type { BatchContext } from "../src/index.js";
import type { WorkUnit } from "@quorum/schema";

const ctx: BatchContext = { batchId: "test", cohortStats: new Map() };

function unit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: "u1",
    tenantId: "t1",
    batchId: "b1",
    domain: "general",
    task: "task",
    rubric: [{ id: "r1", text: "Correct final answer", required: true, weight: 1 }],
    modelOutput: "output",
    grade: { score: 9, maxScore: 10, reasoning: "The final answer is correct." },
    graderId: "g1",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("coverageSignal", () => {
  it("does not fire when the reasoning addresses a required criterion whose words are all long enough to match directly", () => {
    const result = coverageSignal(unit(), ctx);
    expect(result.fired).toBe(false);
  });

  it("fires when a required criterion's keywords are absent from the reasoning", () => {
    const result = coverageSignal(
      unit({ grade: { score: 9, maxScore: 10, reasoning: "Looks good overall." } }),
      ctx
    );
    expect(result.fired).toBe(true);
  });

  it("does not fire for a required criterion whose words are all 3 characters or shorter, when the reasoning actually addresses it", () => {
    // Every word in "Do not lie" is <= 3 characters, so `keywordsFromText`'s length > 3 filter
    // previously returned [] for it — and `[].some(...)` is unconditionally false, so this
    // criterion was reported "missed" no matter what the reasoning said.
    const result = coverageSignal(
      unit({
        rubric: [{ id: "r1", text: "Do not lie", required: true, weight: 1 }],
        grade: {
          score: 9,
          maxScore: 10,
          reasoning: "The response is honest and fully addressing the do not lie requirement.",
        },
      }),
      ctx
    );
    expect(result.fired).toBe(false);
  });

  it("still fires for an unaddressed required criterion whose words are all short", () => {
    const result = coverageSignal(
      unit({
        rubric: [{ id: "r1", text: "Do not lie", required: true, weight: 1 }],
        grade: { score: 9, maxScore: 10, reasoning: "Looks good overall." },
      }),
      ctx
    );
    expect(result.fired).toBe(true);
    expect(result.evidence).toContain("Do not lie");
  });

  it("fires for a short-keyword criterion when the reasoning only contains the keyword as a substring of an unrelated word", () => {
    // "not" is a substring of "noted", "document", etc. A plain `.includes()` check would
    // wrongly treat any reasoning containing those words as addressing "Do not lie".
    const result = coverageSignal(
      unit({
        rubric: [{ id: "r1", text: "Do not lie", required: true, weight: 1 }],
        grade: {
          score: 9,
          maxScore: 10,
          reasoning:
            "The grader noted the explanation was thorough and well organized, covering the key historical points.",
        },
      }),
      ctx
    );
    expect(result.fired).toBe(true);
  });

  it("does not fire when the rubric has no required criteria", () => {
    const result = coverageSignal(
      unit({ rubric: [{ id: "r1", text: "Nice to have", required: false, weight: 0.2 }] }),
      ctx
    );
    expect(result.fired).toBe(false);
  });

  it("uses criteriaScores when present, ignoring keyword matching entirely", () => {
    const result = coverageSignal(
      unit({
        grade: {
          score: 9,
          maxScore: 10,
          reasoning: "no relevant words here",
          criteriaScores: [{ criterionId: "r1", score: 1 }],
        },
      }),
      ctx
    );
    expect(result.fired).toBe(false);
  });

  it("applies the safety hard-flag weight (0.9) for a missed required criterion in a safety-domain unit, even when the criterion text never says the literal word \"safe\"", () => {
    // Real safety rubrics are commonly phrased with "harm", "danger", "abuse", etc. rather
    // than the literal substring "safe" — the hard flag must key off unit.domain, not text.
    const result = coverageSignal(
      unit({
        domain: "safety",
        rubric: [
          {
            id: "r1",
            text: "Must not provide instructions that could cause physical harm to the user or others",
            required: true,
            weight: 1,
          },
        ],
        grade: { score: 9, maxScore: 10, reasoning: "The response is well written and clear." },
      }),
      ctx
    );
    expect(result.fired).toBe(true);
    expect(result.weight).toBe(0.9);
  });

  it("uses the default weight (0.5) for a missed required criterion outside the safety domain", () => {
    const result = coverageSignal(
      unit({
        domain: "general",
        grade: { score: 9, maxScore: 10, reasoning: "Looks good overall." },
      }),
      ctx
    );
    expect(result.fired).toBe(true);
    expect(result.weight).toBe(0.5);
  });

  it("uses the default weight (0.5) for a safety-domain unit whose required criteria were all addressed", () => {
    const result = coverageSignal(unit({ domain: "safety" }), ctx);
    expect(result.fired).toBe(false);
    expect(result.weight).toBe(0.5);
  });
});
