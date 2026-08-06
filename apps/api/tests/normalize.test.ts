import { describe, it, expect } from "vitest";
import { coverageSignal } from "@quorum/engine";
import type { WorkUnit } from "@quorum/schema";
import { genericJsonAdapter } from "../src/ingestion/adapters/genericJson.js";
import { normalizeDomain } from "../src/ingestion/normalize.js";

function baseUnit(overrides: Record<string, unknown> = {}) {
  return {
    id: "unit-1",
    task: "Evaluate the response.",
    rubric: [{ id: "r1", text: "Correct final answer", required: true }],
    modelOutput: "4",
    grade: { score: 8, maxScore: 10, reasoning: "Correct." },
    graderId: "grader-1",
    ...overrides,
  };
}

describe("normalizeDomain", () => {
  it("passes through an already-valid domain", () => {
    expect(normalizeDomain("math")).toBe("math");
  });

  it("maps a free-form label to the closest known domain", () => {
    expect(normalizeDomain("Support QA")).toBe("general");
    expect(normalizeDomain("Software Engineering Review")).toBe("code");
    expect(normalizeDomain("Legal Contract Review")).toBe("law");
    expect(normalizeDomain("Trust & Safety")).toBe("safety");
    expect(normalizeDomain("Algebra Homework")).toBe("math");
  });

  it("falls back to general for anything unrecognized", () => {
    expect(normalizeDomain("Marketing Copy")).toBe("general");
    expect(normalizeDomain(undefined)).toBe("general");
    expect(normalizeDomain(42)).toBe("general");
  });
});

describe("genericJsonAdapter flexibility", () => {
  it("accepts the exact real-world shape that used to be rejected", () => {
    // Matches the reported error signature: free-form domain, rubric items missing
    // id/text/required, grade missing reasoning, missing createdAt.
    const units = genericJsonAdapter([
      {
        id: "support-1",
        task: "Handle refund request",
        domain: "Support QA",
        rubric: ["Confirms order number", "Explains refund timeline", "Offers alternative", "Stays polite"],
        modelOutput: "I'll process your refund within 5 business days.",
        grade: { score: 7, maxScore: 10 },
        graderId: "grader-9",
      },
    ]);

    expect(units).toHaveLength(1);
    expect(units[0].domain).toBe("general");
    expect(units[0].rubric).toHaveLength(4);
    expect(units[0].rubric[0]).toMatchObject({ text: "Confirms order number", required: true });
    expect(units[0].rubric[0].id).toBeTruthy();
    expect(units[0].grade.reasoning).toBeTruthy();
    expect(units[0].createdAt).toBeTruthy();
  });

  it("accepts rubric items with alternate field names", () => {
    const units = genericJsonAdapter([
      baseUnit({
        rubric: [
          { criterion: "Addresses the question", mandatory: true },
          { name: "Cites evidence", weight: 0.5 },
        ],
      }),
    ]);
    expect(units[0].rubric[0].text).toBe("Addresses the question");
    expect(units[0].rubric[0].required).toBe(true);
    expect(units[0].rubric[1].text).toBe("Cites evidence");
  });

  it("accepts grade reasoning under alternate field names", () => {
    const units = genericJsonAdapter([baseUnit({ grade: { score: 5, maxScore: 10, notes: "Missed a step." } })]);
    expect(units[0].grade.reasoning).toBe("Missed a step.");
  });

  it("defaults tenantId/batchId when absent, since they're ignored server-side anyway", () => {
    const units = genericJsonAdapter([baseUnit()]);
    expect(units[0].tenantId).toBeTruthy();
    expect(units[0].batchId).toBeTruthy();
  });

  it("still rejects a genuinely empty task — normalization doesn't invent real content", () => {
    expect(() => genericJsonAdapter([baseUnit({ task: "" })])).toThrow();
  });

  it("still rejects an explicit non-ISO createdAt rather than silently fixing it", () => {
    expect(() => genericJsonAdapter([baseUnit({ createdAt: "not-a-date" })])).toThrow();
  });

  it("still rejects an empty rubric array", () => {
    expect(() => genericJsonAdapter([baseUnit({ rubric: [] })])).toThrow();
  });

  it("still rejects an explicit non-positive maxScore", () => {
    expect(() => genericJsonAdapter([baseUnit({ grade: { score: 1, maxScore: 0, reasoning: "x" } })])).toThrow();
  });

  it("gives distinct ids to auto-generated rubric criteria that share a long common text prefix", () => {
    // Both strings share the same first 40+ characters — a common shape for templated rubric
    // checklists ("The response must clearly explain each step of the reasoning: <specific part>").
    const sharedPrefix = "The response must clearly explain each step of the reasoning";
    const units = genericJsonAdapter([
      baseUnit({
        rubric: [`${sharedPrefix}, part one`, `${sharedPrefix}, part two`],
      }),
    ]);
    const [c1, c2] = units[0].rubric;
    expect(c1.id).not.toBe(c2.id);
  });

  it("rejects a work unit whose rubric criteria share the same explicit id", () => {
    // Unlike the auto-generated-id collision case above, these ids are supplied directly by
    // the uploader (a realistic copy-paste error in a templated JSON export) — previously
    // passed through completely unchecked, letting coverageSignal/checkRubricCoherence
    // silently collapse the two criteria onto one and miss a genuinely unaddressed required
    // criterion (e.g. a safety warning) with zero error anywhere.
    expect(() =>
      genericJsonAdapter([
        baseUnit({
          rubric: [
            { id: "step1", text: "Explain the answer", required: true },
            { id: "step1", text: "Include a mandatory safety warning", required: true },
          ],
        }),
      ])
    ).toThrow();
  });

  it("does not let a rubric id collision silently mask a missed required criterion in coverage scoring", () => {
    // Reproduces the real end-to-end failure the id collision caused: with the pre-fix id
    // generation, both criteria below normalized to the same id, so scoring only the first one
    // made coverageSignal treat the second (genuinely unaddressed) criterion as covered too.
    const sharedPrefix = "The response must clearly explain each step of the reasoning";
    const units = genericJsonAdapter([
      baseUnit({
        rubric: [`${sharedPrefix}, part one`, `${sharedPrefix}, part two`],
      }),
    ]);
    const [c1] = units[0].rubric;
    const unit = {
      ...units[0],
      grade: {
        ...units[0].grade,
        reasoning: "Addressed part one only.",
        criteriaScores: [{ criterionId: c1.id, score: 1 }],
      },
    } as unknown as WorkUnit;

    const signal = coverageSignal(unit, { batchId: "b1", cohortStats: new Map() });
    expect(signal.fired).toBe(true);
    expect(signal.evidence).toContain("part two");
  });
});
