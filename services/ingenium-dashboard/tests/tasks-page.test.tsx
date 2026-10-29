import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const { list, route, replace } = vi.hoisted(() => ({
  list: vi.fn(), replace: vi.fn(), route: { query: "", project: "active-project" },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(route.query),
  useRouter: () => ({ replace }),
}));
vi.mock("../src/lib/ProjectContext", () => ({ useProject: () => route.project }));
vi.mock("../src/lib/api", () => ({ api: { tasks: { list } } }));
vi.mock("../src/app/tasks/components/BoardView", () => ({
  default: ({ tasks }: { tasks: unknown[] }) => <div>Board tasks: {tasks.length}</div>,
}));
vi.mock("../src/app/tasks/components/ListView", () => ({ default: () => <div>List view</div> }));
vi.mock("../src/app/tasks/components/TimelineView", () => ({ default: () => <div>Timeline view</div> }));
vi.mock("../src/app/tasks/components/SpotlightSearch", () => ({ default: () => null }));
vi.mock("../src/app/tasks/components/NotificationBell", () => ({ default: () => null }));
vi.mock("../src/app/tasks/components/TaskDetail", () => ({
  default: ({ task, project, onClose }: { task: { id: string; title: string }; project: string; onClose: () => void }) =>
    <section role="dialog" aria-label={task.title}><p>{project}:{task.id}</p><button onClick={onClose}>Close task</button></section>,
}));
vi.mock("../src/app/tasks/components/TaskCreateModal", () => ({ default: () => null }));

import TasksPage from "../src/app/tasks/page";

beforeEach(() => { list.mockReset(); replace.mockReset(); route.query = ""; route.project = "active-project"; });
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

const firstTask = { id: "11111111-1111-4111-8111-111111111111", title: "First exact task" };
const secondTask = { id: "22222222-2222-4222-8222-222222222222", title: "Second exact task" };

describe("TasksPage exact work-item navigation", () => {
  it("opens the requested task only after the current project catalog loads", async () => {
    let complete!: (value: unknown) => void;
    list.mockReturnValue(new Promise(done => { complete = done; }));
    route.query = `project=active-project&task=${secondTask.id}`;
    render(<TasksPage />);
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => complete({ data: [firstTask, secondTask] }));
    expect(await screen.findByRole("dialog", { name: secondTask.title })).not.toBeNull();
    expect(screen.queryByRole("dialog", { name: firstTask.title })).toBeNull();
  });

  it.each(["unavailable-task", ""])("refuses unavailable task identifier %j without selecting another item", async id => {
    list.mockResolvedValue({ data: [firstTask] });
    route.query = `project=active-project&task=${id}`;
    render(<TasksPage />);
    expect((await screen.findByRole("alert")).textContent).toContain("That task is unavailable in this project");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("removes only the task parameter when its detail view closes", async () => {
    list.mockResolvedValue({ data: [firstTask] });
    route.query = `project=active-project&task=${firstTask.id}&view=list`;
    render(<TasksPage />);
    await screen.findByRole("dialog", { name: firstTask.title });
    fireEvent.click(screen.getByRole("button", { name: "Close task" }));
    expect(replace).toHaveBeenCalledWith("?project=active-project&view=list", { scroll: false });
  });

  it("does not open a retired project's delayed response under a new project", async () => {
    let completeOld!: (value: unknown) => void;
    list.mockReturnValueOnce(new Promise(done => { completeOld = done; }))
      .mockResolvedValueOnce({ data: [secondTask] });
    route.query = `project=active-project&task=${firstTask.id}`;
    const view = render(<TasksPage />);
    route.project = "next-project";
    route.query = `project=next-project&task=${firstTask.id}`;
    view.rerender(<TasksPage />);
    await screen.findByRole("alert");
    await act(async () => completeOld({ data: [firstTask] }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(list).toHaveBeenLastCalledWith("next-project");
  });
});
