import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { ApiError, type Job } from "../src/lib/api";

const { listJobs, listRuns, updateJob, listAgents, getSetting, runJob, cancelRun, runLogs, deleteJob, createJob, eventDeliveries, trustedEvents, suggestJob, vaultStatus, vaultItems, vaultAudit } = vi.hoisted(() => ({
  listJobs: vi.fn(),
  listRuns: vi.fn(),
  updateJob: vi.fn(),
  listAgents: vi.fn(),
  getSetting: vi.fn(),
  runJob: vi.fn(),
  cancelRun: vi.fn(),
  runLogs: vi.fn(),
  deleteJob: vi.fn(),
  createJob: vi.fn(),
  eventDeliveries: vi.fn(),
  trustedEvents: vi.fn(),
  suggestJob: vi.fn(),
  vaultStatus: vi.fn(),
  vaultItems: vi.fn(),
  vaultAudit: vi.fn(),
}));

vi.mock("../src/lib/api", () => ({
  api: {
    jobs: {
      list: listJobs,
      runs: listRuns,
      update: updateJob,
      run: runJob,
      cancelRun,
      runLogs,
      delete: deleteJob,
      create: createJob,
      eventDeliveries,
      trustedEvents,
      suggest: suggestJob,
    },
    agents: {
      list: listAgents,
    },
    settings: {
      get: getSetting,
    },
    vault: {
      status: vaultStatus,
      items: { list: vaultItems },
    },
  },
  dashboardFetch: vi.fn(),
  getApiBase: () => "http://dashboard.test/api/v1",
  sanitizeJobDisplayText: (value: unknown, fallback: string) => typeof value === "string" ? value : fallback,
  ApiError: class ApiError extends Error {
    status: number;
    retryAfterSeconds: number | null;
    code: string | null;
    currentRevision: number | null;
    constructor(status: number, message: string, retryAfterSeconds: number | null, code: string | null = null, currentRevision: number | null = null) {
      super(message);
      this.status = status;
      this.retryAfterSeconds = retryAfterSeconds;
      this.code = code;
      this.currentRevision = currentRevision;
    }
  },
  TRUSTED_JOB_EVENT_TYPES: [
    "context.conversation.archived",
    "context.conversation.unarchived",
    "context.checkpoint.restored_as_new",
  ],
}));

vi.mock("../src/lib/ProjectContext", () => ({
  useProject: () => "test-project",
}));

import JobsPage from "../src/app/jobs/page";

const JOB: Job = {
  id: "job-1",
  project_id: "project-1",
  name: "Nightly scan",
  description: "Run a nightly scan",
  agent: "security",
  prompt_template: "Scan {{input}}",
  schedule_cron: "0 2 * * *",
  trigger_event: null,
  enabled: true,
  timeout_minutes: 30,
  revision: 0,
  vault_references: [],
  created_at: "2026-07-28T00:00:00.000Z",
  updated_at: "2026-07-28T00:00:00.000Z",
};

function openEditOverlay() {
  fireEvent.click(screen.getByText(JOB.name, { exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
}

beforeEach(() => {
  listJobs.mockResolvedValue({ data: [JOB], total: 1 });
  listRuns.mockResolvedValue({ data: [], total: 0 });
  listAgents.mockResolvedValue({ data: [{ name: "security", category: "security" }], total: 1 });
  getSetting.mockResolvedValue({ data: { value: "" } });
  updateJob.mockReset();
  vaultStatus.mockResolvedValue({ data: { sealed: false, initialized: true } });
  vaultItems.mockResolvedValue({ data: [], total: 0 });
  vaultAudit.mockResolvedValue({ data: [], nextCursor: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Jobs edit mutation state", () => {
  it("updates the detail view immediately, closes the overlay, and refreshes safely", async () => {
    const updatedJob = { ...JOB, name: "Nightly scan (edited)" };
    let resolveRefresh!: (response: { data: Job[]; total: number }) => void;

    listJobs
      .mockResolvedValueOnce({ data: [JOB], total: 1 })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveRefresh = resolve;
      }));
    updateJob.mockResolvedValue({ data: updatedJob });

    render(<JobsPage />);
    await screen.findByText(JOB.name, { exact: true });
    openEditOverlay();

    await screen.findByRole("heading", { name: `Edit Job: ${JOB.name}` });
    fireEvent.change(screen.getByPlaceholderText("e.g., Nightly Security Scan"), {
      target: { value: updatedJob.name },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update Job" }));

    await waitFor(() => expect(updateJob).toHaveBeenCalledWith(
      JOB.id,
      expect.objectContaining({
        name: updatedJob.name,
        agent: JOB.agent,
        prompt_template: JOB.prompt_template,
        timeout_minutes: JOB.timeout_minutes,
        expected_revision: JOB.revision,
      }),
      "test-project",
    ));

    // The detail state comes from the successful PATCH response and does not
    // wait for a potentially slow list refresh.
    await waitFor(() => expect(screen.getByRole("heading", { name: updatedJob.name })).toBeTruthy());
    expect(screen.queryByRole("heading", { name: `Edit Job: ${JOB.name}` })).toBeNull();
    expect(listJobs).toHaveBeenCalledTimes(2);

    resolveRefresh({ data: [updatedJob], total: 1 });
    await waitFor(() => expect(listJobs).toHaveBeenCalledTimes(2));
  });

  it("keeps the overlay open and clears saving state when the update fails", async () => {
    updateJob.mockRejectedValue(new Error("Update failed"));

    render(<JobsPage />);
    await screen.findByText(JOB.name, { exact: true });
    openEditOverlay();

    const overlayHeading = await screen.findByRole("heading", { name: `Edit Job: ${JOB.name}` });
    fireEvent.click(screen.getByRole("button", { name: "Update Job" }));

    await waitFor(() => expect(screen.getByText(/Update failed/)).toBeTruthy());
    expect(overlayHeading).toBeTruthy();
    expect((screen.getByRole("button", { name: "Update Job" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("uses unsealed metadata checkboxes, confirms references, and sends CAS without a vault value", async () => {
    const vaultItem = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Deployment token",
      type: "api_key" as const,
      folder_id: null,
      version: 3,
      created_at: JOB.created_at,
      updated_at: JOB.updated_at,
    };
    vaultItems.mockResolvedValue({ data: [vaultItem], total: 1 });
    updateJob.mockResolvedValue({ data: { ...JOB, revision: 1, vault_references: [{ item_id: vaultItem.id, status: "authorized", authorized_item_version: 3, authorized_at: JOB.created_at }] } });

    render(<JobsPage />);
    await screen.findByText(JOB.name, { exact: true });
    openEditOverlay();
    const checkbox = await screen.findByRole("checkbox", { name: /Deployment token/ });
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Update Job" }));
    await screen.findByRole("heading", { name: "Confirm vault references" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm references" }));

    await waitFor(() => expect(updateJob).toHaveBeenCalledWith(
      JOB.id,
      expect.objectContaining({ expected_revision: 0, vault_item_ids: [vaultItem.id] }),
      "test-project",
    ));
    expect(JSON.stringify(updateJob.mock.calls)).not.toContain("value");
  });

  it("permits revoking an existing reference while sealed and keeps a CAS-conflicted draft open", async () => {
    const referencedJob: Job = {
      ...JOB,
      vault_references: [{
        item_id: "22222222-2222-4222-8222-222222222222",
        status: "version_stale",
        authorized_item_version: 1,
        authorized_at: JOB.created_at,
      }],
    };
    listJobs.mockResolvedValue({ data: [referencedJob], total: 1 });
    vaultStatus.mockResolvedValue({ data: { sealed: true, initialized: true } });
    updateJob.mockRejectedValue(new ApiError(409, "Job has changed", null, "JOB_REVISION_CONFLICT", 4));

    render(<JobsPage />);
    await screen.findByText(JOB.name, { exact: true });
    openEditOverlay();
    await screen.findByText(/Vault is sealed/);
    fireEvent.click(screen.getByRole("checkbox", { name: /Vault item ID/ }));
    fireEvent.click(screen.getByRole("button", { name: "Update Job" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm references" }));

    await screen.findByText(/Your draft is still open/);
    expect(screen.getByRole("button", { name: "Reload current job" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: `Edit Job: ${JOB.name}` })).toBeTruthy();
    expect(updateJob).toHaveBeenCalledWith(JOB.id, expect.objectContaining({ expected_revision: 0, vault_item_ids: [] }), "test-project");
  });
});
