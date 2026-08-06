import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { VerdictQueue } from "./VerdictQueue.js";
import { api, type VerdictRow } from "../api/client.js";

vi.mock("../api/client.js", async () => {
  const actual = await vi.importActual<typeof import("../api/client.js")>("../api/client.js");
  return {
    ...actual,
    api: { ...actual.api, getVerdicts: vi.fn() },
  };
});

afterEach(cleanup);

function makeVerdict(overrides: Partial<VerdictRow>): VerdictRow {
  return {
    id: overrides.id ?? "v1",
    workUnitId: overrides.workUnitId ?? "u1",
    risk: overrides.risk ?? 0.1,
    recommendation: overrides.recommendation ?? "clear",
    resolvedAt: overrides.resolvedAt ?? null,
    resolvedByEmail: overrides.resolvedByEmail ?? null,
    resolutionNote: overrides.resolutionNote ?? null,
    resolutionOutcome: overrides.resolutionOutcome ?? null,
    workUnit: overrides.workUnit ?? {
      id: overrides.workUnitId ?? "u1",
      domain: "code",
      task: "some task",
      rubric: [],
      modelOutput: "output",
      grade: { score: 8, maxScore: 10, reasoning: "ok" },
      graderId: "g1",
      signals: [],
    },
  };
}

function renderQueue() {
  render(
    <MemoryRouter initialEntries={["/app/batches/b1"]}>
      <Routes>
        <Route path="/app/batches/:batchId" element={<VerdictQueue />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("VerdictQueue", () => {
  it("excludes clear (never-flagged) items from the Needs Review tab, counting only actually-flagged unresolved items", async () => {
    vi.mocked(api.getVerdicts).mockResolvedValue([
      makeVerdict({ id: "clear-1", recommendation: "clear" }),
      makeVerdict({ id: "clear-2", recommendation: "clear" }),
      makeVerdict({ id: "flagged-1", recommendation: "re_review" }),
    ]);

    renderQueue();

    await waitFor(() => expect(screen.getByText("Needs Review (1)")).toBeInTheDocument());
    expect(screen.queryByText("Needs Review (3)")).not.toBeInTheDocument();
  });

  it("shows 'Nothing left to review' once every flagged item is resolved, even with unresolved clear items present", async () => {
    vi.mocked(api.getVerdicts).mockResolvedValue([
      makeVerdict({ id: "clear-1", recommendation: "clear", resolvedAt: null }),
      makeVerdict({
        id: "flagged-1",
        recommendation: "re_review",
        resolvedAt: new Date().toISOString(),
        resolutionOutcome: "confirmed_issue",
      }),
    ]);

    renderQueue();

    await waitFor(() => expect(screen.getByText("Needs Review (0)")).toBeInTheDocument());
    expect(screen.getByText("Nothing left to review.")).toBeInTheDocument();
  });
});
