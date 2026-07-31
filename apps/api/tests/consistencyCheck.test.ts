import { describe, expect, it, vi, beforeEach } from "vitest";
import type { WorkUnit } from "@quorum/schema";

const llmCallMock = vi.fn();
vi.mock("../src/llm/index.js", () => ({
  llmCall: (...args: unknown[]) => llmCallMock(...args),
}));

const { checkConsistencyWithLLM } = await import("../src/llm/tools/consistencyCheck.js");

beforeEach(() => {
  llmCallMock.mockReset();
});

function makeUnit(): WorkUnit {
  return {
    id: "unit-1",
    tenantId: "demo",
    batchId: "batch-1",
    domain: "general",
    task: "Summarize the article",
    rubric: [{ id: "r1", text: "Accurate summary", required: true }],
    modelOutput: "The article says X.",
    grade: { score: 9, maxScore: 10, reasoning: "Accurate and complete." },
    graderId: "grader-1",
    createdAt: new Date().toISOString(),
  };
}

describe("checkConsistencyWithLLM", () => {
  it("returns the parsed audit result on success", async () => {
    llmCallMock.mockResolvedValueOnce({
      content: '{"consistent": false, "evidence": "Reasoning does not match the score"}',
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0,
    });

    const result = await checkConsistencyWithLLM(makeUnit());
    expect(result).toEqual({ consistent: false, evidence: "Reasoning does not match the score" });
  });

  it("does not fail open with a misleading 'consistent' claim when parsing fails", async () => {
    llmCallMock.mockResolvedValue({ content: "unparseable garbage", inputTokens: 1, outputTokens: 1, costUsd: 0 });

    const result = await checkConsistencyWithLLM(makeUnit());
    // Doesn't flag on a technical failure (avoids noise from model hiccups)...
    expect(result.consistent).toBe(true);
    // ...but the evidence must be honest that the audit didn't actually run to a conclusion,
    // not claim it verified consistency.
    expect(result.evidence).toMatch(/could not be completed/i);
    expect(result.evidence).not.toMatch(/^Reasoning/);
  });
});
