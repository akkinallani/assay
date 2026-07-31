import { describe, expect, it, vi, beforeEach } from "vitest";

const llmCallMock = vi.fn();
vi.mock("../src/llm/index.js", () => ({
  llmCall: (...args: unknown[]) => llmCallMock(...args),
}));

const { checkFacts } = await import("../src/llm/tools/factCheck.js");

beforeEach(() => {
  llmCallMock.mockReset();
});

describe("checkFacts", () => {
  it("returns classified claims on success", async () => {
    llmCallMock.mockResolvedValueOnce({
      content: JSON.stringify({
        claims: [
          { claim: "The capital of France is Paris", verdict: "supported", evidence: "Stated directly in the task." },
          { claim: "The population is 10 million", verdict: "unsupported", evidence: "No population figure given." },
        ],
      }),
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0,
    });

    const result = await checkFacts("Paris is the capital of France, population 10 million.", "Describe Paris", []);
    expect(result.claims).toHaveLength(2);
    expect(result.claims[0].verdict).toBe("supported");
    expect(result.claims[1].verdict).toBe("unsupported");
  });

  it("includes attachment content in the reference context sent to the model", async () => {
    llmCallMock.mockResolvedValueOnce({ content: '{"claims": []}', inputTokens: 1, outputTokens: 1, costUsd: 0 });

    await checkFacts("some claim", "some task", [{ id: "a1", name: "source.txt", content: "The sky is blue." }]);

    const sentMessages = llmCallMock.mock.calls[0][0].messages;
    expect(sentMessages[0].content).toContain("The sky is blue.");
  });

  it("returns no claims (fails closed) rather than fabricating a verdict when parsing fails", async () => {
    llmCallMock.mockResolvedValue({ content: "not json", inputTokens: 1, outputTokens: 1, costUsd: 0 });

    const result = await checkFacts("some claim", "some task", []);
    expect(result.claims).toEqual([]);
  });
});
