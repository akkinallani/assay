import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { fetchGoogleUserinfo } = await import("../src/plugins/googleOAuth.js");

// Reproduces the real shape of AbortSignal.timeout()'s rejection from Node's native fetch()
// (verified directly against a live hung TCP connection in this session's llmCallTimeout.test.ts).
function timeoutError(): DOMException {
  return new DOMException("The operation was aborted due to timeout", "TimeoutError");
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Node's fetch() has no default timeout — without an AbortSignal attached, a Google userinfo
// response that's slow or never comes back would otherwise leave /auth/google/callback (and the
// user's browser mid-redirect from Google) hanging for minutes, the same gap this session already
// found and fixed for the Ollama calls in llm/index.ts and llm/embeddings.ts.
describe("fetchGoogleUserinfo — request timeout", () => {
  it("passes an AbortSignal on the userinfo request", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sub: "1", email: "a@example.com", email_verified: true }),
    } as Response);

    await fetchGoogleUserinfo("token");

    const options = fetchMock.mock.calls[0][1] as { signal?: AbortSignal };
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("fails fast (instead of hanging forever) when Google never responds", async () => {
    fetchMock.mockRejectedValueOnce(timeoutError());

    await expect(fetchGoogleUserinfo("token")).rejects.toThrow("The operation was aborted due to timeout");
  });
});
