import { describe, it, expect } from "vitest";
import { genericJsonAdapter, ValidationError } from "../src/ingestion/adapters/genericJson.js";

function validUnit(overrides: Record<string, unknown> = {}) {
  return {
    id: "unit-1",
    tenantId: "demo",
    batchId: "batch-1",
    domain: "math",
    task: "Evaluate 2 + 2.",
    rubric: [{ id: "r1", text: "Correct final answer", required: true, weight: 1 }],
    modelOutput: "4",
    grade: { score: 8, maxScore: 10, reasoning: "Correct." },
    graderId: "grader-1",
    createdAt: "2026-07-30T00:00:00.000Z",
    ...overrides,
  };
}

describe("genericJsonAdapter", () => {
  it("rejects non-array input", () => {
    expect(() => genericJsonAdapter({ not: "an array" })).toThrow(ValidationError);
  });

  it("rejects null and primitives", () => {
    expect(() => genericJsonAdapter(null)).toThrow(ValidationError);
    expect(() => genericJsonAdapter("a string")).toThrow(ValidationError);
  });

  it("accepts a valid array and returns parsed work units", () => {
    const units = genericJsonAdapter([validUnit()]);
    expect(units).toHaveLength(1);
    expect(units[0].id).toBe("unit-1");
    expect(units[0].domain).toBe("math");
  });

  it("accepts an empty array", () => {
    expect(genericJsonAdapter([])).toEqual([]);
  });

  it("throws ValidationError with issues for an invalid item", () => {
    try {
      genericJsonAdapter([validUnit({ task: "" })]);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const validationErr = err as ValidationError;
      expect(validationErr.issues.length).toBeGreaterThan(0);
      expect(validationErr.issues[0].path).toContain("[0]");
    }
  });

  it("aggregates issues across multiple invalid items, not just the first", () => {
    try {
      genericJsonAdapter([validUnit({ task: "" }), validUnit({ id: "unit-2", graderId: "" })]);
      expect.fail("should have thrown");
    } catch (err) {
      const validationErr = err as ValidationError;
      const paths = validationErr.issues.map((i) => i.path);
      expect(paths.some((p) => p.startsWith("[0]"))).toBe(true);
      expect(paths.some((p) => p.startsWith("[1]"))).toBe(true);
    }
  });

  it("rejects a rubric with zero criteria", () => {
    expect(() => genericJsonAdapter([validUnit({ rubric: [] })])).toThrow(ValidationError);
  });

  it("rejects a non-positive maxScore", () => {
    expect(() =>
      genericJsonAdapter([validUnit({ grade: { score: 1, maxScore: 0, reasoning: "x" } })])
    ).toThrow(ValidationError);
  });

  it("rejects a non-ISO createdAt", () => {
    expect(() => genericJsonAdapter([validUnit({ createdAt: "not-a-date" })])).toThrow(ValidationError);
  });

  it("accepts optional fields when present", () => {
    const units = genericJsonAdapter([
      validUnit({
        attachments: [{ id: "a1", name: "doc.txt", content: "hello" }],
        timeSpentSec: 120,
      }),
    ]);
    expect(units[0].attachments).toHaveLength(1);
    expect(units[0].timeSpentSec).toBe(120);
  });

  it("accepts units without optional fields", () => {
    const units = genericJsonAdapter([validUnit()]);
    expect(units[0].attachments).toBeUndefined();
    expect(units[0].timeSpentSec).toBeUndefined();
  });

  it("rejects a timeSpentSec that exceeds Postgres's 32-bit int column, instead of letting it crash the DB write", () => {
    expect(() => genericJsonAdapter([validUnit({ timeSpentSec: 99999999999 })])).toThrow(ValidationError);
  });

  it("rejects a non-integer timeSpentSec", () => {
    expect(() => genericJsonAdapter([validUnit({ timeSpentSec: 127.34 })])).toThrow(ValidationError);
  });
});
