import { describe, it, expect } from "vitest";
import { generateFixtures } from "../../../fixtures/data.js";
import {
  consistencySignal,
  coverageSignal,
  cohortSignal,
  computeCohortStats,
  buildVerdict,
} from "../src/index.js";
import type { BatchContext } from "../src/index.js";

const PLANTED_IDS = new Set([
  "math_003", "math_007", "math_012",
  "code_043", "code_047",
  "law_083", "law_087",
  "safety_123", "safety_127", "safety_132",
  "general_163", "general_167",
]);

describe("golden set", () => {
  const units = generateFixtures();
  const cohortStats = computeCohortStats(units);
  const ctx: BatchContext = { batchId: "seed", cohortStats };

  const verdicts = units.map((unit) => {
    const signals = [
      consistencySignal(unit, ctx),
      coverageSignal(unit, ctx),
      cohortSignal(unit, ctx),
    ];
    return { unit, verdict: buildVerdict(unit.id, signals) };
  });

  it("all planted bad grades are flagged (spot_check or re_review)", () => {
    const planted = verdicts.filter(({ unit }) => PLANTED_IDS.has(unit.id));
    expect(planted.length).toBe(PLANTED_IDS.size);
    for (const { unit, verdict } of planted) {
      expect(
        verdict.recommendation,
        `${unit.id} should be flagged but got ${verdict.recommendation}`
      ).not.toBe("clear");
    }
  });

  it("false-flag rate is below 9% on clean items", () => {
    const clean = verdicts.filter(({ unit }) => !PLANTED_IDS.has(unit.id));
    const flagged = clean.filter(({ verdict }) => verdict.recommendation !== "clear");
    const falseRate = flagged.length / clean.length;
    expect(falseRate, `False-flag rate ${(falseRate * 100).toFixed(1)}% exceeds 9%`).toBeLessThan(0.09);
  });

  it("every fired signal has non-empty evidence", () => {
    for (const { verdict } of verdicts) {
      for (const signal of verdict.signals) {
        if (signal.fired) {
          expect(signal.evidence.length, `Empty evidence for ${signal.key}`).toBeGreaterThan(0);
        }
      }
    }
  });
});
