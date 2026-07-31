import { describe, it, expect } from "vitest";
import { checkRubricCoherence } from "../src/index.js";
import type { AgentCriterionScore, RubricCriterion } from "@quorum/schema";

const rubric: RubricCriterion[] = [
  { id: "r1", text: "Correct final answer", required: true, weight: 1 },
  { id: "r2", text: "Shows work", required: true, weight: 0.5 },
  { id: "r3", text: "Uses clear notation", required: false, weight: 0.2 },
];

function scores(overrides: Partial<AgentCriterionScore>[] = []): AgentCriterionScore[] {
  const base: AgentCriterionScore[] = [
    { criterionId: "r1", met: true, justification: "Answer is correct." },
    { criterionId: "r2", met: true, justification: "Work shown." },
  ];
  return overrides.length > 0 ? (overrides as AgentCriterionScore[]) : base;
}

describe("checkRubricCoherence", () => {
  it("is coherent when all required criteria are covered and consistent with the score", () => {
    const result = checkRubricCoherence(rubric, scores(), 9, 10);
    expect(result.coherent).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("flags a missing required criterion", () => {
    const result = checkRubricCoherence(rubric, [{ criterionId: "r1", met: true, justification: "ok" }], 9, 10);
    expect(result.coherent).toBe(false);
    expect(result.issues.some((i) => i.includes("Shows work"))).toBe(true);
  });

  it("does not flag a missing optional criterion", () => {
    const result = checkRubricCoherence(rubric, scores(), 9, 10);
    expect(result.issues.some((i) => i.includes("notation"))).toBe(false);
  });

  it("flags a criteria entry referencing an unknown id", () => {
    const result = checkRubricCoherence(
      rubric,
      [...scores(), { criterionId: "not-a-real-id", met: true, justification: "..." }],
      9,
      10
    );
    expect(result.coherent).toBe(false);
    expect(result.issues.some((i) => i.includes("not in the rubric"))).toBe(true);
  });

  it("flags a high score when a required criterion is marked unmet", () => {
    const result = checkRubricCoherence(
      rubric,
      [
        { criterionId: "r1", met: false, justification: "Answer is wrong." },
        { criterionId: "r2", met: true, justification: "Work shown." },
      ],
      9,
      10 // 90% — high score, but a required criterion failed
    );
    expect(result.coherent).toBe(false);
    expect(result.issues.some((i) => i.includes("90%"))).toBe(true);
  });

  it("does not flag a low score with an unmet required criterion (consistent)", () => {
    const result = checkRubricCoherence(
      rubric,
      [
        { criterionId: "r1", met: false, justification: "Answer is wrong." },
        { criterionId: "r2", met: true, justification: "Work shown." },
      ],
      3,
      10 // 30% — low score is consistent with a failed required criterion
    );
    expect(result.coherent).toBe(true);
  });
});
