import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { LiveRun } from "./LiveRun.js";
import { api, setUnauthorizedHandler } from "../api/client.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  close = vi.fn();

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
}

afterEach(() => {
  cleanup();
  FakeEventSource.instances = [];
});

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
});

function renderLiveRun() {
  render(
    <MemoryRouter initialEntries={["/app/batches/b1/live"]}>
      <Routes>
        <Route path="/app/batches/:batchId/live" element={<LiveRun />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("LiveRun", () => {
  it("shows a connection-lost banner when the stream errors", async () => {
    renderLiveRun();
    const source = FakeEventSource.instances[0]!;

    source.onerror?.();

    await waitFor(() =>
      expect(screen.getByText("Lost connection to the live stream. Refresh to reconnect.")).toBeInTheDocument()
    );
  });

  it("clears the connection-lost banner once the stream reconnects", async () => {
    renderLiveRun();
    const source = FakeEventSource.instances[0]!;

    source.onerror?.();
    await waitFor(() =>
      expect(screen.getByText("Lost connection to the live stream. Refresh to reconnect.")).toBeInTheDocument()
    );

    source.onopen?.();

    await waitFor(() =>
      expect(screen.queryByText("Lost connection to the live stream. Refresh to reconnect.")).not.toBeInTheDocument()
    );
  });

  it("clears the signed-in user when the stream error turns out to be an expired session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "unauthorized", message: "Unauthorized" }, 401));
    vi.stubGlobal("fetch", fetchMock);
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);

    renderLiveRun();
    const source = FakeEventSource.instances[0]!;

    source.onerror?.();

    // Real fetch()/api.me()/throwForError path — a genuine 401 fires the same
    // unauthorizedHandler every other api.get/post call already triggers.
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledTimes(1));

    setUnauthorizedHandler(null);
    vi.unstubAllGlobals();
  });

  it("only re-checks auth once per disconnect episode, not on every retry", async () => {
    const meSpy = vi.spyOn(api, "me").mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      tenantId: "t1",
      tenantName: "Acme",
    });

    renderLiveRun();
    const source = FakeEventSource.instances[0]!;

    source.onerror?.();
    source.onerror?.();
    source.onerror?.();

    await waitFor(() => expect(meSpy).toHaveBeenCalledTimes(1));

    source.onopen?.();
    source.onerror?.();

    await waitFor(() => expect(meSpy).toHaveBeenCalledTimes(2));

    meSpy.mockRestore();
  });
});
