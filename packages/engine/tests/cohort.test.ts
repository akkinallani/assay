import { describe, it, expect } from "vitest";
import { cohortKey, computeCohortStats, cohortSignal } from "../src/index.js";
import type { BatchContext } from "../src/index.js";
import type { WorkUnit } from "@quorum/schema";

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

// A shared preamble longer than the old 60-char truncation window, so tasks A and B are
// identical for the first 60+ characters but diverge afterward.
const SHARED_PREAMBLE =
  "Summarize the following support ticket and identify the primary issue described by the customer: ";
const TASK_A = `${SHARED_PREAMBLE}the customer was billed twice for the same subscription.`;
const TASK_B = `${SHARED_PREAMBLE}the customer's shipment never arrived after three weeks.`;

describe("cohort key", () => {
  it("keeps two different tasks that share a long common prefix in separate cohorts", () => {
    expect(SHARED_PREAMBLE.length).toBeGreaterThan(60);
    const keyA = cohortKey(unit({ task: TASK_A }));
    const keyB = cohortKey(unit({ task: TASK_B }));
    expect(keyA).not.toBe(keyB);
  });

  it("still groups genuinely identical tasks (modulo whitespace/case) into the same cohort", () => {
    const keyA = cohortKey(unit({ task: TASK_A }));
    const keyA2 = cohortKey(unit({ task: `  ${TASK_A.toUpperCase()}  ` }));
    expect(keyA).toBe(keyA2);
  });

  it("does not dilute outlier detection by pooling unrelated tasks that share a prefix", () => {
    // Task A's true distribution: consistently ~90%, with one genuine outlier at 30%. Task B's
    // true distribution: consistently ~40% (a genuinely different, harder task). With the old
    // 60-char-prefix key these pool into one inflated-variance cohort and the real outlier in A
    // never crosses the z-score threshold.
    const taskAUnits = [0.9, 0.91, 0.89, 0.9, 0.92, 0.88, 0.91, 0.3].map((pct, i) =>
      unit({ id: `a${i}`, task: TASK_A, grade: { score: pct * 10, maxScore: 10, reasoning: "r" } })
    );
    const taskBUnits = [0.4, 0.42, 0.38, 0.41].map((pct, i) =>
      unit({ id: `b${i}`, task: TASK_B, grade: { score: pct * 10, maxScore: 10, reasoning: "r" } })
    );
    const units = [...taskAUnits, ...taskBUnits];
    const cohortStats = computeCohortStats(units);
    const ctx: BatchContext = { batchId: "seed", cohortStats };

    // The 30% item is a real outlier within task A's own ~90% distribution.
    const outlier = taskAUnits[7];
    const signal = cohortSignal(outlier, ctx);
    expect(signal.fired).toBe(true);
  });
});
