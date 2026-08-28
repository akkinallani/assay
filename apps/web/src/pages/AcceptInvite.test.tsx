import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AcceptInvite } from "./AcceptInvite.js";
import { AuthProvider } from "../context/AuthContext.js";
import { api, ApiError } from "../api/client.js";

vi.mock("../api/client.js", async () => {
  const actual = await vi.importActual<typeof import("../api/client.js")>("../api/client.js");
  return {
    ...actual,
    api: { ...actual.api, me: vi.fn(), acceptInvite: vi.fn() },
  };
});

afterEach(cleanup);

describe("AcceptInvite", () => {
  it("caps the password field at 72 bytes, matching the server's bcrypt-truncation bound", async () => {
    vi.mocked(api.me).mockRejectedValue(new Error("not signed in"));

    render(
      <MemoryRouter initialEntries={["/accept-invite/tok-123"]}>
        <AuthProvider>
          <Routes>
            <Route path="/accept-invite/:token" element={<AcceptInvite />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    const password = screen.getByLabelText("Password") as HTMLInputElement;
    expect(password.maxLength).toBe(72);
    expect(screen.getByText("8-72 characters.")).toBeInTheDocument();
  });

  it("shows the server's specific validation message instead of a generic error, e.g. for a password over the byte cap (HTML maxLength counts UTF-16 code units, not bytes — a password of 72 accented characters passes the input's maxLength but still fails the server's 72-byte check)", async () => {
    vi.mocked(api.me).mockRejectedValue(new Error("not signed in"));
    vi.mocked(api.acceptInvite).mockRejectedValue(
      new ApiError("Validation failed", "validation_failed", [
        { path: ["password"], message: "Password must be at most 72 bytes" },
      ]),
    );

    render(
      <MemoryRouter initialEntries={["/accept-invite/tok-123"]}>
        <AuthProvider>
          <Routes>
            <Route path="/accept-invite/:token" element={<AcceptInvite />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "é".repeat(72) } });
    fireEvent.click(screen.getByRole("button", { name: /join/i }));

    await waitFor(() => {
      expect(screen.getByText("password: Password must be at most 72 bytes")).toBeInTheDocument();
    });
  });
});
