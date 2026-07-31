import { describe, it, expect } from "vitest";
import { regradeSignal } from "../src/index.js";
import type { AgentRegradeResult, WorkUnit } from "@quorum/schema";

function makeUnit(score: number, maxScore = 10): WorkUnit {
  return {
    id: "unit-1",
    tenantId: "demo",
    batchId: "batch-1",
    domain: "math",
    task: "Evaluate 2 + 2.",
    rubric: [{ id: "r1", text: "Correct final answer", required: true, weight: 1 }],
    modelOutput: "4",
    grade: { score, maxScore, reasoning: "Looks right." },
    graderId: "grader-1",
    createdAt: new Date().toISOString(),
  };
}

function makeAgentResult(agentScore: number, agentMaxScore = 10, reasoning = "Agent reasoning."): AgentRegradeResult {
  return {
    agentScore,
    agentMaxScore,
    agentReasoning: reasoning,
    toolOutputs: [],
    divergence: 0, // regradeSignal recomputes divergence itself from unit + result; this input value is unused
  };
}

describe("regradeSignal", () => {
  it("does not fire when agent and human scores closely agree", () => {
    const unit = makeUnit(8, 10); // 80%
    const result = makeAgentResult(7, 10); // 70% — 10% divergence, under the 20% threshold
    const signal = regradeSignal(unit, result);

    expect(signal.key).toBe("regrade");
    expect(signal.fired).toBe(false);
    expect(signal.weight).toBe(0.8);
    expect(signal.evidence).toContain("agrees with human grade");
  });

  it("fires when divergence exceeds 20%", () => {
    const unit = makeUnit(9, 10); // 90%
    const result = makeAgentResult(3, 10); // 30% — 60% divergence
    const signal = regradeSignal(unit, result);

    expect(signal.fired).toBe(true);
    expect(signal.evidence).toContain("90%");
    expect(signal.evidence).toContain("30%");
    expect(signal.evidence).toContain("60%");
  });

  it("does not fire exactly at the 20% boundary", () => {
    const unit = makeUnit(7, 10); // 70%
    const result = makeAgentResult(5, 10); // 50% — exactly 20% divergence
    const signal = regradeSignal(unit, result);

    expect(signal.fired).toBe(false);
  });

  it("fires just above the 20% boundary", () => {
    const unit = makeUnit(7, 10); // 70%
    const result = makeAgentResult(4.9, 10); // 49% — 21% divergence
    const signal = regradeSignal(unit, result);

    expect(signal.fired).toBe(true);
  });

  it("includes agent reasoning in the evidence when fired", () => {
    const unit = makeUnit(9, 10);
    const result = makeAgentResult(2, 10, "The response contains a critical factual error.");
    const signal = regradeSignal(unit, result);

    expect(signal.evidence).toContain("critical factual error");
  });

  it("truncates long agent reasoning in the evidence", () => {
    const unit = makeUnit(9, 10);
    const longReasoning = "x".repeat(500);
    const result = makeAgentResult(2, 10, longReasoning);
    const signal = regradeSignal(unit, result);

    expect(signal.evidence.length).toBeLessThan(longReasoning.length);
  });

  it("carries the full agent result through as detail", () => {
    const unit = makeUnit(5, 10);
    const result = makeAgentResult(1, 10);
    const signal = regradeSignal(unit, result);

    expect(signal.detail).toEqual(result);
  });

  it("handles different maxScore scales between human and agent grades", () => {
    const unit = makeUnit(45, 50); // 90%
    const result = makeAgentResult(3, 10); // 30% — 60% divergence, despite different scales
    const signal = regradeSignal(unit, result);

    expect(signal.fired).toBe(true);
  });

  it("fires when coherence issues are present, even at low divergence", () => {
    const unit = makeUnit(8, 10); // 80%
    const result = makeAgentResult(7, 10); // 70% — 10% divergence, under threshold on its own
    result.coherenceIssues = ["Agent's breakdown skipped 1 required criterion"];
    const signal = regradeSignal(unit, result);

    expect(signal.fired).toBe(true);
    expect(signal.evidence).toContain("Agent's own reasoning may be unreliable");
    expect(signal.evidence).toContain("skipped 1 required criterion");
  });

  it("does not mention coherence in evidence when there are no issues", () => {
    const unit = makeUnit(8, 10);
    const result = makeAgentResult(7, 10);
    const signal = regradeSignal(unit, result);

    expect(signal.evidence).not.toContain("unreliable");
  });
});
