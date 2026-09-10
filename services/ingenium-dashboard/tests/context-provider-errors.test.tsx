import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), organizations: vi.fn() }));
vi.mock("../src/lib/api", () => ({
  api: {
    auth: { session: mocks.session },
    organizations: { list: mocks.organizations },
  },
  setSessionCsrfToken: vi.fn(),
}));

import { AuthProvider } from "../src/lib/AuthContext";
import { OrganizationProvider } from "../src/lib/OrganizationContext";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("dashboard context request failures", () => {
  it("turns an account request failure into a bounded retry state", async () => {
    mocks.session.mockRejectedValueOnce(new Error("private diagnostic")).mockResolvedValueOnce({ data: { user: { id: "user" } } });
    render(<AuthProvider><p>Dashboard</p></AuthProvider>);
    expect((await screen.findByRole("alert")).textContent).toContain("Unable to load your account");
    expect(document.body.textContent).not.toContain("private diagnostic");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("Dashboard")).toBeTruthy());
  });

  it("turns an organization request failure into a bounded retry state", async () => {
    mocks.organizations.mockRejectedValueOnce(new Error("private diagnostic")).mockResolvedValueOnce({ data: [] });
    render(<OrganizationProvider><p>Dashboard</p></OrganizationProvider>);
    expect((await screen.findByRole("alert")).textContent).toContain("Unable to load your organizations");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("Dashboard")).toBeTruthy());
  });
});
