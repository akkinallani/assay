import { describe, expect, it, vi, beforeEach } from "vitest";
import { z } from "zod";

const llmCallMock = vi.fn();
vi.mock("../src/llm/index.js", () => ({
  llmCall: (...args: unknown[]) => llmCallMock(...args),
}));

const { llmCallStructured, LlmParseError } = await import("../src/llm/structured.js");

const schema = z.object({ ok: z.boolean(), note: z.string() });

beforeEach(() => {
  llmCallMock.mockReset();
});

function baseParams() {
  return {
    model: "test-model",
    system: "system prompt",
    messages: [{ role: "user" as const, content: "hello" }],
    schema,
  };
}

describe("llmCallStructured", () => {
  it("returns parsed data when the first response is valid JSON matching the schema", async () => {
    llmCallMock.mockResolvedValueOnce({ content: '{"ok": true, "note": "fine"}', inputTokens: 1, outputTokens: 1, costUsd: 0 });

    const result = await llmCallStructured(baseParams());
    expect(result).toEqual({ ok: true, note: "fine" });
    expect(llmCallMock).toHaveBeenCalledTimes(1);
    expect(llmCallMock.mock.calls[0][0]).toMatchObject({ jsonMode: true });
  });

  it("retries once with a corrective message when the first response is invalid JSON, then succeeds", async () => {
    llmCallMock
      .mockResolvedValueOnce({ content: "not json at all", inputTokens: 1, outputTokens: 1, costUsd: 0 })
      .mockResolvedValueOnce({ content: '{"ok": false, "note": "fixed"}', inputTokens: 1, outputTokens: 1, costUsd: 0 });

    const result = await llmCallStructured(baseParams());
    expect(result).toEqual({ ok: false, note: "fixed" });
    expect(llmCallMock).toHaveBeenCalledTimes(2);
    const secondCallMessages = llmCallMock.mock.calls[1][0].messages;
    expect(secondCallMessages.at(-1).content).toContain("valid JSON");
  });

  it("retries once when JSON is valid syntax but fails schema validation, then succeeds", async () => {
    llmCallMock
      .mockResolvedValueOnce({ content: '{"ok": "not-a-boolean"}', inputTokens: 1, outputTokens: 1, costUsd: 0 })
      .mockResolvedValueOnce({ content: '{"ok": true, "note": "corrected"}', inputTokens: 1, outputTokens: 1, costUsd: 0 });

    const result = await llmCallStructured(baseParams());
    expect(result).toEqual({ ok: true, note: "corrected" });
  });

  it("throws LlmParseError after the second attempt still fails", async () => {
    llmCallMock
      .mockResolvedValueOnce({ content: "still not json", inputTokens: 1, outputTokens: 1, costUsd: 0 })
      .mockResolvedValueOnce({ content: "also not json", inputTokens: 1, outputTokens: 1, costUsd: 0 });

    await expect(llmCallStructured(baseParams())).rejects.toBeInstanceOf(LlmParseError);
    expect(llmCallMock).toHaveBeenCalledTimes(2);
  });
});
