import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AcceptInvite } from "./AcceptInvite.js";
import { AuthProvider } from "../context/AuthContext.js";
import { api } from "../api/client.js";

vi.mock("../api/client.js", async () => {
  const actual = await vi.importActual<typeof import("../api/client.js")>("../api/client.js");
  return {
    ...actual,
    api: { ...actual.api, me: vi.fn() },
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
});
