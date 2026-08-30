import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const { list, listArchived, detail, archive, restore, stepUp } = vi.hoisted(() => ({
  list: vi.fn(),
  listArchived: vi.fn(),
  detail: vi.fn(),
  archive: vi.fn(),
  restore: vi.fn(),
  stepUp: vi.fn(),
}));

vi.mock("../src/lib/ProjectContext", () => ({
  useProject: () => "active-project",
  persistProject: vi.fn(),
}));

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      auth: { ...actual.api.auth, stepUp },
      projects: { ...actual.api.projects, list, listArchived, detail, archive, restore },
    },
  };
});

import ProjectsPage from "../src/app/projects/page";

const activeProject = {
  id: "active-id",
  name: "active-project",
  created_at: "2026-08-09T00:00:00.000Z",
  updated_at: "2026-08-09T00:00:00.000Z",
};

beforeEach(() => {
  list.mockReset();
  listArchived.mockReset();
  detail.mockReset().mockResolvedValue({ data: { skills_count: 0, observation_stats: { total: 0, pending: 0 }, pipeline: [] } });
  archive.mockReset();
  restore.mockReset();
  stepUp.mockReset();
});

afterEach(cleanup);

describe("ProjectsPage collection states", () => {
  it("keeps active projects available when archived projects fail to load", async () => {
    list.mockResolvedValue({ data: [activeProject] });
    listArchived.mockRejectedValue(new Error("Archive list unavailable"));

    render(<ProjectsPage />);

    expect(await screen.findByRole("button", { name: "View details for active-project" })).not.toBeNull();
    expect(screen.queryByText("Unable to load archived projects: Archive list unavailable")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Archived" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Unable to load archived projects: Archive list unavailable");
  });

  it("keeps archived projects available when active projects fail to load", async () => {
    list.mockRejectedValue(new Error("Active list unavailable"));
    listArchived.mockResolvedValue({ data: [{ ...activeProject, id: "archived-id", name: "archived-project", archived_at: "2026-08-08T00:00:00.000Z" }] });

    render(<ProjectsPage />);

    expect((await screen.findByRole("alert")).textContent).toContain("Unable to load active projects: Active list unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));

    expect(await screen.findByRole("button", { name: "View details for archived-project" })).not.toBeNull();
    expect(screen.queryByText("Unable to load active projects: Active list unavailable")).toBeNull();
  });

  it("requests step-up and retries an owner archive instead of swallowing the rejection", async () => {
    const { ApiError } = await import("../src/lib/api");
    list.mockResolvedValue({ data: [activeProject] });
    listArchived.mockResolvedValue({ data: [] });
    archive
      .mockRejectedValueOnce(new ApiError(403, "Recent step-up authentication is required", null, "STEP_UP_REQUIRED"))
      .mockResolvedValueOnce({ data: { archived: true } });
    stepUp.mockResolvedValue({ data: { verified: true } });

    render(<ProjectsPage />);
    await screen.findByRole("button", { name: "View details for active-project" });
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive project" }));

    expect(await screen.findByRole("dialog", { name: "Confirm it’s you" })).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Credential"), { target: { value: "account credential" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(archive).toHaveBeenCalledTimes(2));
    expect(stepUp).toHaveBeenCalledWith("account credential");
  });

  it("refreshes active and archived collections across archive and restore", async () => {
    let active = [activeProject];
    let archivedProjects: Array<typeof activeProject & { archived_at: string }> = [];
    list.mockImplementation(async () => ({ data: active }));
    listArchived.mockImplementation(async () => ({ data: archivedProjects }));
    archive.mockImplementation(async () => {
      archivedProjects = [{ ...activeProject, archived_at: "2026-08-15T00:00:00.000Z" }];
      active = [];
      return { data: { archived: true } };
    });
    restore.mockImplementation(async () => {
      active = [activeProject];
      archivedProjects = [];
      return { data: { restored: true } };
    });

    render(<ProjectsPage />);
    await screen.findByRole("button", { name: "View details for active-project" });
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(screen.getByRole("dialog", { name: "Archive Project" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Archive project" }));
    expect(await screen.findByText("No active projects.")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    await screen.findByRole("button", { name: "View details for active-project" });
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(await screen.findByText("No archived projects.")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Active" }));
    expect(await screen.findByRole("button", { name: "View details for active-project" })).not.toBeNull();
  });

  it("shows an actionable protected-project rejection instead of swallowing it", async () => {
    const { ApiError } = await import("../src/lib/api");
    list.mockResolvedValue({ data: [{ ...activeProject, is_global: true }] });
    listArchived.mockResolvedValue({ data: [] });
    archive.mockRejectedValue(new ApiError(403, "Global lifecycle is protected", null, "GLOBAL_PROJECT_LIFECYCLE_FORBIDDEN"));

    render(<ProjectsPage />);
    await screen.findByRole("button", { name: "View details for active-project" });
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive project" }));

    expect((await screen.findByRole("alert")).textContent).toContain("global organization home project is protected");
  });

  it("renders a bounded error when archive fails unexpectedly", async () => {
    list.mockResolvedValue({ data: [activeProject] });
    listArchived.mockResolvedValue({ data: [] });
    archive.mockRejectedValue(new Error("private upstream detail"));

    render(<ProjectsPage />);
    await screen.findByRole("button", { name: "View details for active-project" });
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive project" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The project could not be archived.");
    expect(alert.textContent).not.toContain("private upstream detail");
  });
});
