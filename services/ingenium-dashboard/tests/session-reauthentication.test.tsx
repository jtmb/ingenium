import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const { session, stepUp } = vi.hoisted(() => ({
  session: vi.fn().mockResolvedValue({ data: {
    user: { id: "operator", display_name: "Operator" },
    session: { id: "session", recentStepUp: false, mfaEnabled: false },
    installationAdmin: true,
  } }),
  stepUp: vi.fn().mockResolvedValue({ data: { recentStepUp: true } }),
}));
vi.mock("../src/lib/api", () => ({ api: { auth: { session, stepUp } }, setSessionCsrfToken: vi.fn() }));
import { AuthProvider } from "../src/lib/AuthContext";
import { requestSessionReauthentication } from "../src/lib/session-reauthentication";
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("global credential confirmation", () => {
  it("lets an existing signed-in user confirm and continue a protected action", async () => {
    render(<AuthProvider><p>Protected dashboard</p></AuthProvider>);
    await screen.findByText("Protected dashboard");
    const confirmed = requestSessionReauthentication();
    await screen.findByRole("dialog", { name: "Confirm it’s you" });
    fireEvent.change(screen.getByLabelText("Credential"), { target: { value: "existing operator password" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await expect(confirmed).resolves.toBe(true);
    expect(stepUp).toHaveBeenCalledWith("existing operator password");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes cleanly on cancellation without submitting credentials", async () => {
    render(<AuthProvider><p>Protected dashboard</p></AuthProvider>);
    await screen.findByText("Protected dashboard");
    const confirmed = requestSessionReauthentication();
    await screen.findByRole("dialog", { name: "Confirm it’s you" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(confirmed).resolves.toBe(false);
    expect(stepUp).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
