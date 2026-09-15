import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const { list } = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("../src/lib/ProjectContext", () => ({ useProject: () => "active-project" }));
vi.mock("../src/lib/api", () => ({ api: { tasks: { list } } }));
vi.mock("../src/app/tasks/components/BoardView", () => ({
  default: ({ tasks }: { tasks: unknown[] }) => <div>Board tasks: {tasks.length}</div>,
}));
vi.mock("../src/app/tasks/components/ListView", () => ({ default: () => <div>List view</div> }));
vi.mock("../src/app/tasks/components/TimelineView", () => ({ default: () => <div>Timeline view</div> }));
vi.mock("../src/app/tasks/components/SpotlightSearch", () => ({ default: () => null }));
vi.mock("../src/app/tasks/components/NotificationBell", () => ({ default: () => null }));
vi.mock("../src/app/tasks/components/TaskDetail", () => ({ default: () => null }));
vi.mock("../src/app/tasks/components/TaskCreateModal", () => ({ default: () => null }));

import TasksPage from "../src/app/tasks/page";

beforeEach(() => list.mockReset());
afterEach(cleanup);

describe("TasksPage loading states", () => {
  it("shows a retryable error instead of rendering an empty task board", async () => {
    list
      .mockRejectedValueOnce(new Error("Task API unavailable"))
      .mockResolvedValueOnce({ data: [] });

    render(<TasksPage />);

    expect((await screen.findByRole("alert")).textContent).toContain("Unable to load tasks: Task API unavailable");
    expect(screen.queryByText("Board tasks: 0")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Board tasks: 0")).not.toBeNull();
  });
});
