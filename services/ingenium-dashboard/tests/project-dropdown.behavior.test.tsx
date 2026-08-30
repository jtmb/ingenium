import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const mocks = vi.hoisted(() => ({
  activeProject: "global-default",
  listProjects: vi.fn(),
  pathname: "/tasks",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

vi.mock("../src/lib/ProjectContext", () => ({
  useProject: () => mocks.activeProject,
  persistProject: vi.fn(),
}));

vi.mock("../src/lib/api", () => ({
  api: { projects: { list: mocks.listProjects } },
}));

import ProjectDropdown from "../src/app/components/ProjectDropdown";

describe("ProjectDropdown lazy loading", () => {
  beforeEach(() => {
    mocks.activeProject = "global-default";
    mocks.pathname = "/tasks";
    mocks.listProjects
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValue({ data: [{ name: "global-default" }, { name: "next-project" }] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loads from the stable open handler, exposes failure, and retries on reopen", async () => {
    render(<ProjectDropdown />);
    const trigger = screen.getByRole("button", { name: "Active project: global-default" });
    expect(mocks.listProjects).not.toHaveBeenCalled();

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect((await screen.findByRole("alert")).textContent).toContain("Unable to load projects");
    expect(mocks.listProjects).toHaveBeenCalledTimes(1);

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole("menuitem", { name: /next-project/ })).toBeTruthy());
    expect(mocks.listProjects).toHaveBeenCalledTimes(2);
  });

  it("shows the selected project on desktop triggers and preserves the compact Chat label", () => {
    const ordinaryView = render(<ProjectDropdown />);
    const ordinaryTrigger = screen.getByRole("button", { name: "Active project: global-default" });
    expect(ordinaryTrigger.textContent).toContain("global-default");
    expect(screen.queryByText("Context project:")).toBeNull();
    ordinaryView.unmount();

    mocks.pathname = "/chat";
    render(<ProjectDropdown />);

    const trigger = screen.getByRole("button", { name: "Context project: global-default" });
    expect(trigger.textContent).toContain("global-default");
    expect(trigger.className).toContain("min-w-0");
    expect(trigger.className).toContain("max-w-[calc(100vw-8rem)]");
    expect(trigger.parentElement?.className).toContain("min-w-0");
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId("project-context-prefix").className).toContain("hidden");
    expect(screen.getByTestId("project-context-prefix").className).toContain("sm:inline");
    expect(screen.getByText("global-default").className).toContain("truncate");
  });

  it("keeps a long project name accessible while bounding its visible trigger label", () => {
    mocks.pathname = "/chat";
    mocks.activeProject = "a".repeat(64);
    render(<ProjectDropdown />);

    const trigger = screen.getByRole("button", { name: `Context project: ${mocks.activeProject}` });
    expect(trigger.getAttribute("title")).toBe(`Context project: ${mocks.activeProject}`);
    expect(screen.getByText(mocks.activeProject).className).toContain("truncate");
  });

  it("keeps the selected project explicit in the manage-projects navigation href", () => {
    render(<ProjectDropdown />);
    fireEvent.click(screen.getByRole("button", { name: "Active project: global-default" }));
    expect(screen.getByRole("menuitem", { name: "Manage projects →" }).getAttribute("href"))
      .toBe("/projects?project=global-default");
  });
});
