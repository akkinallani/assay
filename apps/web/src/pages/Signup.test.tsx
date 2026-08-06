import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Signup } from "./Signup.js";
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

describe("Signup", () => {
  it("caps the password field at 72 bytes, matching the server's bcrypt-truncation bound", async () => {
    vi.mocked(api.me).mockRejectedValue(new Error("not signed in"));

    render(
      <MemoryRouter>
        <AuthProvider>
          <Signup />
        </AuthProvider>
      </MemoryRouter>,
    );

    const password = screen.getByLabelText("Password") as HTMLInputElement;
    expect(password.maxLength).toBe(72);
    expect(screen.getByText("8-72 characters.")).toBeInTheDocument();
  });
});
