import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BatchList } from "./BatchList.js";
import { api, type BatchSummary } from "../api/client.js";

vi.mock("../api/client.js", async () => {
  const actual = await vi.importActual<typeof import("../api/client.js")>("../api/client.js");
  return {
    ...actual,
    api: { ...actual.api, getBatches: vi.fn() },
  };
});

afterEach(cleanup);

function makeBatch(overrides: Partial<BatchSummary>): BatchSummary {
  return {
    id: "b1",
    tenantId: "t1",
    status: "pending",
    createdAt: new Date().toISOString(),
    unitCount: 3,
    ...overrides,
  };
}

describe("BatchList status badge", () => {
  it("renders a distinct accent badge for a batch that is actively processing, not the same badge as a not-yet-started batch", async () => {
    vi.mocked(api.getBatches).mockResolvedValue([makeBatch({ status: "processing" })]);
    render(
      <MemoryRouter>
        <BatchList />
      </MemoryRouter>
    );

    const badge = await screen.findByText("processing");
    expect(badge.className).toContain("bg-accent-50");
    expect(badge.className).not.toContain("bg-quorum-100");
  });

  it("still renders the neutral badge for a batch that hasn't started processing yet", async () => {
    vi.mocked(api.getBatches).mockResolvedValue([makeBatch({ status: "pending" })]);
    render(
      <MemoryRouter>
        <BatchList />
      </MemoryRouter>
    );

    const badge = await screen.findByText("pending");
    expect(badge.className).toContain("bg-quorum-100");
  });

  it("still renders the success badge for a done batch", async () => {
    vi.mocked(api.getBatches).mockResolvedValue([makeBatch({ status: "done" })]);
    render(
      <MemoryRouter>
        <BatchList />
      </MemoryRouter>
    );

    const badge = await screen.findByText("done");
    expect(badge.className).toContain("bg-success-50");
  });
});
