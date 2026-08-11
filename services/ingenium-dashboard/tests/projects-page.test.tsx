import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const { list, listArchived, detail } = vi.hoisted(() => ({
  list: vi.fn(),
  listArchived: vi.fn(),
  detail: vi.fn(),
}));

vi.mock("../src/lib/ProjectContext", () => ({
  useProject: () => "active-project",
  persistProject: vi.fn(),
}));

vi.mock("../src/lib/api", () => ({
  api: {
    projects: { list, listArchived, detail },
  },
}));

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
});
