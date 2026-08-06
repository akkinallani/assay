import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { llmCall } = await import("../src/llm/index.js");

// Reproduces the real shape of a connection failure from Node's native fetch(): the
// top-level error is always `TypeError: fetch failed`, with the actual cause (here,
// ECONNREFUSED) nested in `err.cause`, never in `err.message` itself.
function fetchFailedError(): TypeError {
  const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:11434"), {
    code: "ECONNREFUSED",
    errno: -111,
    syscall: "connect",
  });
  return new TypeError("fetch failed", { cause });
}

function okResponse(body: unknown) {
  return { ok: true, json: async () => body } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("llmCall — connection-refused retry", () => {
  it("retries on a real fetch()-shaped connection-refused error and eventually succeeds", async () => {
    fetchMock
      .mockRejectedValueOnce(fetchFailedError())
      .mockRejectedValueOnce(fetchFailedError())
      .mockResolvedValueOnce(okResponse({ message: { content: "ok" }, prompt_eval_count: 1, eval_count: 1 }));

    const resultPromise = llmCall({ model: "m", system: "s", messages: [] });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.content).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after the max attempts if the connection keeps refusing", async () => {
    fetchMock.mockRejectedValue(fetchFailedError());

    const resultPromise = llmCall({ model: "m", system: "s", messages: [] });
    const assertion = expect(resultPromise).rejects.toThrow("fetch failed");
    await vi.runAllTimersAsync();
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
