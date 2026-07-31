import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "./AuthContext.js";
import { api, type CurrentUser } from "../api/client.js";

vi.mock("../api/client.js", async () => {
  const actual = await vi.importActual<typeof import("../api/client.js")>("../api/client.js");
  return { ...actual, api: { ...actual.api, me: vi.fn() } };
});

const user: CurrentUser = { id: "u1", email: "a@example.com", tenantId: "t1", tenantName: "Acme" };

function Probe() {
  const { user, loading } = useAuth();
  if (loading) return <span>loading</span>;
  return <span>{user ? `signed in as ${user.email}` : "signed out"}</span>;
}

describe("AuthContext", () => {
  it("resolves to the current user when /auth/me succeeds", async () => {
    vi.mocked(api.me).mockResolvedValue(user);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    expect(screen.getByText("loading")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("signed in as a@example.com")).toBeInTheDocument());
  });

  it("resolves to signed-out when /auth/me rejects", async () => {
    vi.mocked(api.me).mockRejectedValue(new Error("401"));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByText("signed out")).toBeInTheDocument());
  });
});
