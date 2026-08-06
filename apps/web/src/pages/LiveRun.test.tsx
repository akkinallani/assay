import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { LiveRun } from "./LiveRun.js";

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
});
