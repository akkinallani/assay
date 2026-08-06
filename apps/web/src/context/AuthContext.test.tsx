import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "./AuthContext.js";
import { api, ApiError, setUnauthorizedHandler, type CurrentUser } from "../api/client.js";

vi.mock("../api/client.js", async () => {
  const actual = await vi.importActual<typeof import("../api/client.js")>("../api/client.js");
  return { ...actual, api: { ...actual.api, me: vi.fn(), logout: vi.fn() } };
});

const user: CurrentUser = { id: "u1", email: "a@example.com", tenantId: "t1", tenantName: "Acme" };

function Probe() {
  const { user, loading } = useAuth();
  if (loading) return <span>loading</span>;
  return <span>{user ? `signed in as ${user.email}` : "signed out"}</span>;
}

function LogoutProbe() {
  const { user, logout } = useAuth();
  return (
    <div>
      <span>{user ? `signed in as ${user.email}` : "signed out"}</span>
      <button
        onClick={() => {
          logout().catch(() => {});
        }}
      >
        Log out
      </button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
});

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

  it("clears the signed-in user when any later request comes back 401 (session invalidated mid-session)", async () => {
    vi.mocked(api.me).mockResolvedValue(user);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "unauthorized", message: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByText("signed in as a@example.com")).toBeInTheDocument());

    // Some other page's data fetch hits the now-invalid session — this is the real client
    // implementation, not a mock, so it exercises the actual throwForError -> handler wiring.
    await expect(api.getBatches()).rejects.toBeInstanceOf(ApiError);

    await waitFor(() => expect(screen.getByText("signed out")).toBeInTheDocument());
  });

  it("clears the user even when the logout request itself fails (e.g. session already invalid)", async () => {
    vi.mocked(api.me).mockResolvedValue(user);
    vi.mocked(api.logout).mockRejectedValue(new ApiError("Unauthorized", "unauthorized"));

    render(
      <AuthProvider>
        <LogoutProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByText("signed in as a@example.com")).toBeInTheDocument());

    screen.getByText("Log out").click();

    await waitFor(() => expect(screen.getByText("signed out")).toBeInTheDocument());
  });
});
