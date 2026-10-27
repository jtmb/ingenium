import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), create: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: { migration: { get: mocks.get, save: mocks.save }, backups: { create: mocks.create } } }));
import MigrationPanel, { migrationRunbook } from "../src/app/components/settings/panels/MigrationPanel";
const status = () => ({ plan: { revision: 1, target: { platform: "kubernetes" as const, origin: "https://prd.example.com" }, confirmed: ["models"], updatedAt: "2026-10-26T00:00:00Z" }, inventory: { sourceMode: "compatibility" as const, backup: null, requiredTransfers: [{ id: "bootstrap", label: "Protected deployment files", contents: "Original keys" }], automaticTransferSupported: false as const, cutoverPerformed: false as const } });
beforeEach(() => { vi.clearAllMocks(); mocks.get.mockResolvedValue({ data: status() }); mocks.save.mockImplementation(async (plan) => ({ data: { ...status(), plan: { ...plan, revision: plan.revision + 1 } } })); mocks.create.mockResolvedValue({}); });
afterEach(cleanup);
describe("PRD migration controls", () => {
  it("clears destination attestations on target change and requires saving before downloading", async () => {
    render(<MigrationPanel />); await screen.findByLabelText("PRD HTTPS origin");
    expect((screen.getByRole("checkbox", { name: /Same models/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText("PRD HTTPS origin"), { target: { value: "https://other.example.com" } });
    expect((screen.getByRole("checkbox", { name: /Same models/ }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("button", { name: "Download preparation runbook" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save migration plan" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ confirmed: [], target: { platform: "kubernetes", origin: "https://other.example.com" } })));
    expect(await screen.findByText(/Migration plan saved/)).toBeTruthy();
  });
  it("creates a real database checkpoint through the existing backup API and refreshes inventory", async () => {
    render(<MigrationPanel />); fireEvent.click(await screen.findByRole("button", { name: "Create database checkpoint" }));
    await screen.findByText(/A signed snapshot of both databases was created/);
    expect(mocks.create).toHaveBeenCalledOnce(); expect(mocks.get).toHaveBeenCalledTimes(2);
  });
  it("shows unavailable authorization without claiming a successful operation", async () => {
    mocks.create.mockRejectedValue(new Error("Recent step-up authentication is required"));
    render(<MigrationPanel />); fireEvent.click(await screen.findByRole("button", { name: "Create database checkpoint" }));
    expect((await screen.findByRole("alert")).textContent).toContain("step-up");
    expect(screen.queryByText(/snapshot of both databases was created/)).toBeNull();
  });
  it("exports an honest full-installation runbook without calling transfer or cutover APIs", () => {
    const text = migrationRunbook(status());
    expect(text).toContain("Protected deployment files"); expect(text).toContain("database backup alone");
    expect(text).toContain("No transfer or cutover has occurred"); expect(text).toContain("Same models and defaults");
    expect(text).toContain("local restore executor is not an off-host");
  });
});
