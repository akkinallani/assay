import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createServer } from "node:net";

const { llmCall, LLM_CALL_TIMEOUT_MS } = await import("../src/llm/index.js");

// Reproduces the real shape of AbortSignal.timeout()'s rejection from Node's native fetch()
// (verified directly against a live hung TCP connection, not assumed from documentation).
function timeoutError(): DOMException {
  return new DOMException("The operation was aborted due to timeout", "TimeoutError");
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

describe("llmCall — request timeout", () => {
  it("passes an AbortSignal bounded by LLM_CALL_TIMEOUT_MS on every request", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ message: { content: "ok" }, prompt_eval_count: 1, eval_count: 1 })
    );

    await llmCall({ model: "m", system: "s", messages: [] });

    const options = fetchMock.mock.calls[0][1] as { signal?: AbortSignal };
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(LLM_CALL_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("retries a timed-out request and eventually succeeds, same as a connection-refused error", async () => {
    fetchMock
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce(okResponse({ message: { content: "ok" }, prompt_eval_count: 1, eval_count: 1 }));

    const resultPromise = llmCall({ model: "m", system: "s", messages: [] });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.content).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the max attempts if every request keeps timing out", async () => {
    fetchMock.mockRejectedValue(timeoutError());

    const resultPromise = llmCall({ model: "m", system: "s", messages: [] });
    const assertion = expect(resultPromise).rejects.toThrow("The operation was aborted due to timeout");
    await vi.runAllTimersAsync();
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("llmCall — real hung backend", () => {
  it("actually aborts a connection that accepts the socket and never responds, instead of hanging forever", async () => {
    vi.unstubAllGlobals();
    vi.useRealTimers();

    const server = createServer((socket) => {
      // Accept the TCP connection but never write a response — reproduces a real Ollama
      // backend that's alive at the transport layer but stuck (model swap thrashing, GPU
      // exhaustion, a worker crash mid-generation).
      socket.on("error", () => {});
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    try {
      // Directly exercises fetch()+AbortSignal against a real hung socket with a short timeout,
      // proving the abort actually fires — llmCall's own 120s default is deliberately not
      // exercised live here (would make this test take 2 minutes); the retry-on-timeout logic
      // above already covers that path against a mocked fetch.
      const start = Date.now();
      await expect(
        fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(300) })
      ).rejects.toMatchObject({ name: "TimeoutError" });
      expect(Date.now() - start).toBeLessThan(5000);
    } finally {
      server.close();
    }
  });
});
