import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Team } from "./Team.js";
import { api } from "../api/client.js";

vi.mock("../api/client.js", async () => {
  const actual = await vi.importActual<typeof import("../api/client.js")>("../api/client.js");
  return {
    ...actual,
    api: { ...actual.api, listTeamMembers: vi.fn(), listInvites: vi.fn() },
  };
});

afterEach(cleanup);

describe("Team", () => {
  it("renders members and invites once both requests resolve", async () => {
    vi.mocked(api.listTeamMembers).mockResolvedValue([
      { id: "u1", email: "a@example.com", createdAt: new Date().toISOString() },
    ]);
    vi.mocked(api.listInvites).mockResolvedValue([]);

    render(<Team />);

    await waitFor(() => expect(screen.getByText("a@example.com")).toBeInTheDocument());
  });

  it("shows an error instead of a silent empty list when the initial load fails", async () => {
    vi.mocked(api.listTeamMembers).mockRejectedValue(new Error("Session expired"));
    vi.mocked(api.listInvites).mockResolvedValue([]);

    render(<Team />);

    await waitFor(() => expect(screen.getByText("Error: Session expired")).toBeInTheDocument());
    expect(screen.queryByText("Members")).not.toBeInTheDocument();
  });
});
