import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ItemDetail } from "./ItemDetail.js";
import { api, type VerdictRow, type WorkUnitRow, type SignalRow } from "../api/client.js";

vi.mock("../api/client.js", async () => {
  const actual = await vi.importActual<typeof import("../api/client.js")>("../api/client.js");
  return {
    ...actual,
    api: { ...actual.api, getUnit: vi.fn() },
  };
});

afterEach(cleanup);

function makeSignal(overrides: Partial<SignalRow>): SignalRow {
  return {
    id: overrides.id ?? "s1",
    workUnitId: "u1",
    key: overrides.key ?? "regrade",
    fired: overrides.fired ?? false,
    weight: overrides.weight ?? 0,
    evidence: overrides.evidence ?? "",
    detail: overrides.detail ?? null,
  };
}

function makeUnit(signals: SignalRow[]): WorkUnitRow & { verdict: VerdictRow } {
  const base: WorkUnitRow = {
    id: "u1",
    domain: "general",
    task: "Summarize the article",
    rubric: [],
    modelOutput: "The article is about X.",
    grade: { score: 7, maxScore: 10, reasoning: "Adequate summary." },
    graderId: "g1",
    signals,
  };
  return {
    ...base,
    verdict: {
      id: "v1",
      workUnitId: "u1",
      risk: 0.5,
      recommendation: "re_review",
      resolvedAt: null,
      resolvedByEmail: null,
      resolutionNote: null,
      resolutionOutcome: null,
      workUnit: base,
    },
  };
}

function renderItemDetail() {
  render(
    <MemoryRouter initialEntries={["/app/batches/b1/units/u1"]}>
      <Routes>
        <Route path="/app/batches/:batchId/units/:unitId" element={<ItemDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ItemDetail — agent re-grade panel", () => {
  it("shows a distinct failure message when the regrade permanently failed (fired:false, no detail)", async () => {
    vi.mocked(api.getUnit).mockResolvedValue(
      makeUnit([
        makeSignal({
          key: "regrade",
          fired: false,
          detail: null,
          evidence: "Agent regrade failed on every retry — needs manual review",
        }),
      ])
    );

    renderItemDetail();

    await waitFor(() => expect(screen.getByText("Agent re-grade failed")).toBeInTheDocument());
    // The evidence text also appears in the left-column unfired-signals list (existing,
    // unrelated behavior) — just confirm the new failure panel surfaces it too.
    expect(screen.getAllByText("Agent regrade failed on every retry — needs manual review").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Agent re-grade pending or not triggered")).not.toBeInTheDocument();
  });

  it("still shows the 'pending or not triggered' placeholder when no regrade was ever queued", async () => {
    vi.mocked(api.getUnit).mockResolvedValue(makeUnit([]));

    renderItemDetail();

    await waitFor(() => expect(screen.getByText("Agent re-grade pending or not triggered")).toBeInTheDocument());
  });
});
