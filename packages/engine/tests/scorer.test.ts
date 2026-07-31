import { describe, it, expect } from "vitest";
import { scoreSignals, riskToRecommendation, buildVerdict } from "../src/index.js";
import type { Signal } from "@quorum/schema";

function signal(key: Signal["key"], fired: boolean, weight: number): Signal {
  return { key, fired, weight, evidence: `${key} evidence` };
}

describe("scoreSignals", () => {
  it("returns 0 for an empty signal set", () => {
    expect(scoreSignals([])).toBe(0);
  });

  it("returns 0 when no signals fired, regardless of weight", () => {
    const signals = [signal("consistency", false, 0.9), signal("coverage", false, 0.5)];
    expect(scoreSignals(signals)).toBe(0);
  });

  it("returns the weight of a single fired signal", () => {
    const signals = [signal("coverage", true, 0.5)];
    expect(scoreSignals(signals)).toBeCloseTo(0.5);
  });

  it("ignores unfired signals mixed with fired ones", () => {
    const signals = [signal("coverage", true, 0.5), signal("consistency", false, 0.9)];
    expect(scoreSignals(signals)).toBeCloseTo(0.5);
  });

  it("combines multiple fired signals via noisy-OR, not simple addition", () => {
    // 1 - (1-0.5)(1-0.5) = 0.75, not 1.0
    const signals = [signal("coverage", true, 0.5), signal("consistency", true, 0.5)];
    expect(scoreSignals(signals)).toBeCloseTo(0.75);
  });

  it("never exceeds 1 even with many high-weight fired signals", () => {
    const signals = [
      signal("coverage", true, 0.9),
      signal("consistency", true, 0.9),
      signal("cohort", true, 0.9),
      signal("regrade", true, 0.9),
    ];
    expect(scoreSignals(signals)).toBeLessThanOrEqual(1);
    expect(scoreSignals(signals)).toBeGreaterThan(0.99);
  });
});

describe("riskToRecommendation", () => {
  it("classifies risk below 0.25 as clear", () => {
    expect(riskToRecommendation(0)).toBe("clear");
    expect(riskToRecommendation(0.24)).toBe("clear");
  });

  it("classifies risk from 0.25 up to (not including) 0.6 as spot_check", () => {
    expect(riskToRecommendation(0.25)).toBe("spot_check");
    expect(riskToRecommendation(0.59)).toBe("spot_check");
  });

  it("classifies risk of 0.6 and above as re_review", () => {
    expect(riskToRecommendation(0.6)).toBe("re_review");
    expect(riskToRecommendation(1)).toBe("re_review");
  });
});

describe("buildVerdict", () => {
  it("combines score and recommendation and preserves the signal list", () => {
    const signals = [signal("coverage", true, 0.9)];
    const verdict = buildVerdict("unit-42", signals);

    expect(verdict.workUnitId).toBe("unit-42");
    expect(verdict.risk).toBeCloseTo(0.9);
    expect(verdict.recommendation).toBe("re_review");
    expect(verdict.signals).toBe(signals);
  });

  it("produces a clear verdict when nothing fires", () => {
    const signals = [signal("coverage", false, 0.9), signal("cohort", false, 0.5)];
    const verdict = buildVerdict("unit-1", signals);

    expect(verdict.risk).toBe(0);
    expect(verdict.recommendation).toBe("clear");
  });
});
