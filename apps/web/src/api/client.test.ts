import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, setUnauthorizedHandler } from "./client.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
  });

  it("sends credentials and the CSRF header on every request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await api.getBatches();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/batches",
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({ "X-Requested-With": "quorum" }),
      })
    );
  });

  it("parses a structured error response into ApiError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ error: "validation_failed", message: "Validation failed", issues: [{ path: "email" }] }, 400)
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.login({ email: "bad", password: "x" })).rejects.toMatchObject({
      message: "Validation failed",
      code: "validation_failed",
      issues: [{ path: "email" }],
    });
  });

  it("wraps a malformed error response instead of throwing during parsing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("not json", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.getBatches()).rejects.toBeInstanceOf(ApiError);
  });

  it("posts JSON bodies for mutating calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await api.logout();

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({}));
  });

  it("invokes the registered unauthorized handler on a 401 response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "unauthorized", message: "Unauthorized" }, 401));
    vi.stubGlobal("fetch", fetchMock);
    const handler = vi.fn();
    setUnauthorizedHandler(handler);

    await expect(api.getBatches()).rejects.toBeInstanceOf(ApiError);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not invoke the unauthorized handler on a non-401 error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "not_found", message: "Not found" }, 404));
    vi.stubGlobal("fetch", fetchMock);
    const handler = vi.fn();
    setUnauthorizedHandler(handler);

    await expect(api.getBatches()).rejects.toBeInstanceOf(ApiError);

    expect(handler).not.toHaveBeenCalled();
  });
});
