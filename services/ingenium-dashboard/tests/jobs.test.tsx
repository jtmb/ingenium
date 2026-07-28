import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import type { Job } from "../src/lib/api";

const { listJobs, listRuns, updateJob, listAgents, getSetting } = vi.hoisted(() => ({
  listJobs: vi.fn(),
  listRuns: vi.fn(),
  updateJob: vi.fn(),
  listAgents: vi.fn(),
  getSetting: vi.fn(),
}));

vi.mock("../src/lib/api", () => ({
  api: {
    jobs: {
      list: listJobs,
      runs: listRuns,
      update: updateJob,
    },
    agents: {
      list: listAgents,
    },
    settings: {
      get: getSetting,
    },
  },
  dashboardFetch: vi.fn(),
  getApiBase: () => "http://dashboard.test/api/v1",
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

    await waitFor(() => expect(screen.getByText("Update failed")).toBeTruthy());
    expect(overlayHeading).toBeTruthy();
    expect((screen.getByRole("button", { name: "Update Job" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
