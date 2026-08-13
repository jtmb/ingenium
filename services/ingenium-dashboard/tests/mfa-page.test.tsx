import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ challenge: vi.fn(), assign: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("challenge=challenge-token&csrf=csrf-token&returnTo=%2F%2Fevil.example") }));
vi.mock("../src/lib/api", () => ({ api: { auth: { mfaChallenge: mocks.challenge } }, setSessionCsrfToken: vi.fn() }));
import MfaPage from "../src/app/(public)/mfa/page";

const originalLocation = window.location;

afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

describe("MFA completion", () => {
  it("rejects a protocol-relative return target", async () => {
    mocks.challenge.mockResolvedValue({ data: { csrfToken: "session-csrf" } });
    Object.defineProperty(window, "location", { configurable: true, value: { assign: mocks.assign } });
    render(<MfaPage />);
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith("/"));
  });
});
