import { describe, it, expect } from "vitest";
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
});
