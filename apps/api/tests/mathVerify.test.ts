import { describe, expect, it, vi, beforeEach } from "vitest";

const llmCallMock = vi.fn();
vi.mock("../src/llm/index.js", () => ({
  llmCall: (...args: unknown[]) => llmCallMock(...args),
}));

const { verifyMathClaim } = await import("../src/llm/tools/mathVerify.js");

beforeEach(() => {
  llmCallMock.mockReset();
});

describe("verifyMathClaim", () => {
  it("returns the parsed verification result on success", async () => {
    llmCallMock.mockResolvedValueOnce({
      content: '{"correct": true, "explanation": "2+2=4 is correct"}',
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0,
    });

    const result = await verifyMathClaim("2+2=4", "basic arithmetic");
    expect(result).toEqual({ correct: true, explanation: "2+2=4 is correct" });
  });

  it("fails closed (correct: false) when the model never returns valid output", async () => {
    llmCallMock.mockResolvedValue({ content: "I cannot help with that", inputTokens: 1, outputTokens: 1, costUsd: 0 });

    const result = await verifyMathClaim("2+2=5", "basic arithmetic");
    expect(result.correct).toBe(false);
    expect(result.explanation).toMatch(/could not be completed/i);
  });
});
