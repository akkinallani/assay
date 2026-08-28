import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Signup } from "./Signup.js";
import { AuthProvider } from "../context/AuthContext.js";
import { api, ApiError } from "../api/client.js";

vi.mock("../api/client.js", async () => {
  const actual = await vi.importActual<typeof import("../api/client.js")>("../api/client.js");
  return {
    ...actual,
    api: { ...actual.api, me: vi.fn(), signup: vi.fn() },
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

  it("shows the server's specific validation message instead of a generic error, e.g. for a password over the byte cap (HTML maxLength counts UTF-16 code units, not bytes — a password of 72 accented characters passes the input's maxLength but still fails the server's 72-byte check)", async () => {
    vi.mocked(api.me).mockRejectedValue(new Error("not signed in"));
    vi.mocked(api.signup).mockRejectedValue(
      new ApiError("Validation failed", "validation_failed", [
        { path: ["password"], message: "Password must be at most 72 bytes" },
      ]),
    );

    render(
      <MemoryRouter>
        <AuthProvider>
          <Signup />
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Organization name"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "é".repeat(72) } });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText("password: Password must be at most 72 bytes")).toBeInTheDocument();
    });
  });
});
