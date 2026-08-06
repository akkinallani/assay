import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UploadBatch } from "./UploadBatch.js";
import { api, ApiError } from "../api/client.js";

vi.mock("../api/client.js", async () => {
  const actual = await vi.importActual<typeof import("../api/client.js")>("../api/client.js");
  return {
    ...actual,
    api: { ...actual.api, createBatch: vi.fn() },
  };
});

afterEach(cleanup);

function fileWith(units: unknown[]) {
  return new File([JSON.stringify(units)], "units.json", { type: "application/json" });
}

async function uploadFile(units: unknown[]) {
  render(
    <MemoryRouter>
      <UploadBatch />
    </MemoryRouter>
  );
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [fileWith(units)] } });
}

describe("UploadBatch", () => {
  it("retries with ids that are actually unique when two units in the same upload collided", async () => {
    const duplicateUnits = [
      { id: "unit-1", task: "t1" },
      { id: "unit-1", task: "t2" },
    ];

    vi.mocked(api.createBatch).mockRejectedValueOnce(
      new ApiError("Duplicate ids within this upload: unit-1", "duplicate_work_unit_id")
    );

    await uploadFile(duplicateUnits);

    await waitFor(() =>
      expect(screen.getByText("Duplicate ids within this upload: unit-1")).toBeInTheDocument()
    );

    vi.mocked(api.createBatch).mockResolvedValueOnce({ batchId: "b1", unitCount: 2 });

    fireEvent.click(screen.getByText("Retry with unique ids →"));

    await waitFor(() => expect(api.createBatch).toHaveBeenCalledTimes(2));

    const retriedUnits = vi.mocked(api.createBatch).mock.calls[1]![0] as Array<{ id: string }>;
    const retriedIds = retriedUnits.map((u) => u.id);
    expect(new Set(retriedIds).size).toBe(retriedIds.length);
  });

  it("shows the server's per-field validation issues instead of a generic message", async () => {
    vi.mocked(api.createBatch).mockRejectedValueOnce(
      new ApiError("Validation failed", "validation_failed", [
        { path: "[0].task", message: "Required" },
        { path: "[1].grade.score", message: "Expected number, received string" },
      ])
    );

    await uploadFile([
      { id: "unit-1", rubric: [] },
      { id: "unit-2", task: "t", grade: { score: "nine" } },
    ]);

    await waitFor(() => expect(screen.getByText("[0].task: Required")).toBeInTheDocument());
    expect(screen.getByText("[1].grade.score: Expected number, received string")).toBeInTheDocument();
  });
});
