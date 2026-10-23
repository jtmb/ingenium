import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ContextUploadSettings from "../src/app/context/components/ContextUploadSettings";

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: { settings: mocks } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe("Context upload settings", () => {
  it("defaults off, shows last sync and persists opt-in and opt-out for the exact project", async () => {
    mocks.get.mockImplementation(async (key: string) => ({ data: { value: key === "context_upload_last_sync"
      ? JSON.stringify({ status: "synced", at: "2026-09-10T01:00:00.000Z" }) : undefined } }));
    mocks.set.mockResolvedValue({ data: {} });
    render(<ContextUploadSettings project="exact-project" />);
    const toggle = screen.getByRole("checkbox") as HTMLInputElement;
    await waitFor(() => expect(toggle.disabled).toBe(false));
    expect(toggle.checked).toBe(false);
    expect(screen.getByRole("status").textContent).toContain("Last sync:");
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.checked).toBe(true));
    expect(mocks.set).toHaveBeenLastCalledWith("context_auto_upload_enabled", "true", "exact-project");
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.checked).toBe(false));
    expect(mocks.set).toHaveBeenLastCalledWith("context_auto_upload_enabled", "false", "exact-project");
    expect(mocks.get).toHaveBeenCalledWith("context_upload_last_sync", "exact-project");
  });
  it("fails closed when settings cannot be read", async () => {
    mocks.get.mockRejectedValue(new Error("unavailable"));
    render(<ContextUploadSettings project="exact-project" />);
    await screen.findByRole("alert");
    const toggle = screen.getByRole("checkbox") as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(true);
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
