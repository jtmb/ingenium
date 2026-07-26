import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

/**
 * Regression coverage for the mobile Tasks layout.
 *
 * The page must let the search and create controls wrap at narrow widths, and
 * the board must expose its intentional horizontal scroll region instead of
 * widening the page and clipping controls off-screen.
 */

const navigationMock = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => navigationMock.searchParams,
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("../src/lib/ProjectContext", () => ({
  useProject: () => "test-project",
}));

vi.mock("../src/lib/api", () => ({
  api: {
    tasks: {
      list: vi.fn().mockResolvedValue({ data: [] }),
    },
  },
}));

vi.mock("../src/app/tasks/components/BoardView", () => ({
  default: () => <div data-testid="board-view" />,
}));
vi.mock("../src/app/tasks/components/ListView", () => ({
  default: () => <div data-testid="list-view" />,
}));
vi.mock("../src/app/tasks/components/TimelineView", () => ({
  default: () => <div data-testid="timeline-view" />,
}));
vi.mock("../src/app/tasks/components/SpotlightSearch", () => ({
  default: () => null,
}));
vi.mock("../src/app/tasks/components/NotificationBell", () => ({
  default: () => null,
}));
vi.mock("../src/app/tasks/components/TaskDetail", () => ({
  default: () => null,
}));
vi.mock("../src/app/tasks/components/TaskCreateModal", () => ({
  default: () => null,
}));

import TasksPage from "../src/app/tasks/page";

afterEach(() => {
  cleanup();
  navigationMock.searchParams = new URLSearchParams();
});

describe("Tasks route responsive controls", () => {
  it("wraps search and create controls for narrow viewports", () => {
    render(<TasksPage />);

    const search = screen.getByPlaceholderText("Search tasks...");
    const addTask = screen.getByRole("button", { name: "+ Add Task" });

    expect(search.className).toContain("min-w-0");
    expect(search.className).toContain("w-full");
    expect(search.className).toContain("sm:flex-1");
    expect(addTask.className).toContain("w-full");
    expect(addTask.className).toContain("sm:w-auto");
    expect(addTask.className).toContain("shrink-0");
    expect(search.parentElement?.className).toContain("flex-col");
    expect(search.parentElement?.className).toContain("sm:flex-row");
  });
});
