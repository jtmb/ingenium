import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

const { listProjects } = vi.hoisted(() => ({
  listProjects: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("../src/lib/api", () => ({
  api: {
    projects: {
      list: listProjects,
    },
  },
}));

import {
  ProjectProvider,
  resolveGlobalProjectName,
  resolveInitialProject,
  resolveProjectSelection,
} from "../src/lib/ProjectContext";

describe("project initialization precedence", () => {
  it("uses an explicit project query parameter before stored and global values", () => {
    expect(resolveInitialProject(
      "external-worktree",
      "last-selected-project",
      "global-default",
    )).toBe("external-worktree");
  });

  it("uses the stored project before a cached global fallback", () => {
    expect(resolveInitialProject(
      null,
      "last-selected-project",
      "global-default",
    )).toBe("last-selected-project");
  });

  it("uses the cached global project only when no explicit or stored project exists", () => {
    expect(resolveInitialProject(null, null, "resolved-global")).toBe("resolved-global");
    expect(resolveInitialProject(null, null, null)).toBeNull();
  });
});

describe("project resolution failures", () => {
  it("preserves a validated explicit project even when no canonical global exists", () => {
    expect(resolveProjectSelection([
      { name: "external-worktree", is_global: false },
    ], "external-worktree")).toEqual({ project: "external-worktree", error: null });
  });

  it("returns an explicit unresolved state instead of selecting the first available project", () => {
    const resolution = resolveProjectSelection([
      { name: "external-worktree", is_global: false },
      { name: "another-worktree", is_global: false },
    ], null);

    expect(resolution.project).toBeNull();
    expect(resolution.error?.message).toBe("No active global project is configured");
  });

  it("returns an unresolved state when canonical global resolution is ambiguous", () => {
    const resolution = resolveProjectSelection([
      { name: "global-a", is_global: true },
      { name: "global-b", is_global: true },
    ], null);

    expect(resolution.project).toBeNull();
    expect(resolution.error?.message).toBe("Multiple active global projects are configured");
  });

  it("does not mount project-scoped content when the canonical global is unresolved", async () => {
    listProjects.mockResolvedValueOnce({
      data: [{ name: "external-worktree", is_global: false }],
    });

    render(createElement(
      ProjectProvider,
      null,
      createElement("p", null, "Project-scoped dashboard content"),
    ));

    expect(screen.queryByText("Project-scoped dashboard content")).toBeNull();
    expect((await screen.findByTestId("project-resolution-error")).textContent).toContain(
      "No active global project is configured",
    );
    expect(screen.queryByText("Project-scoped dashboard content")).toBeNull();
  });
});

describe("canonical global project resolution", () => {
  it("uses the active is_global project name rather than a hardcoded default", () => {
    expect(resolveGlobalProjectName([
      { name: "worktree", is_global: false },
      { name: "server-shared", is_global: true },
    ])).toBe("server-shared");
  });

  it("ignores archived global rows and returns null when none is active", () => {
    expect(resolveGlobalProjectName([
      { name: "old-global", is_global: true, archived_at: "2026-07-27T00:00:00Z" },
    ])).toBeNull();
  });

  it("fails closed when the API reports ambiguous active globals", () => {
    expect(() => resolveGlobalProjectName([
      { name: "global-a", is_global: true },
      { name: "global-b", is_global: true },
    ])).toThrow("Multiple active global projects");
  });
});
