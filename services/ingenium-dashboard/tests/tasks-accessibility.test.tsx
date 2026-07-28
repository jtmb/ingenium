import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const apiMocks = vi.hoisted(() => ({
  activity: vi.fn(),
  agentsList: vi.fn(),
  boardConfig: vi.fn(),
  comments: vi.fn(),
  links: vi.fn(),
  list: vi.fn(),
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DragOverlay: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PointerSensor: class PointerSensor {},
  closestCorners: vi.fn(),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  verticalListSortingStrategy: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => undefined } },
}));

vi.mock("../src/lib/api", () => ({
  api: {
    agents: { list: apiMocks.agentsList },
    tasks: {
      activity: apiMocks.activity,
      boardConfig: apiMocks.boardConfig,
      comments: apiMocks.comments,
      links: apiMocks.links,
      list: apiMocks.list,
    },
  },
}));

vi.mock("../src/app/components/Overlay", () => ({
  default: ({ children, isOpen }: { children: React.ReactNode; isOpen: boolean }) =>
    isOpen ? <>{children}</> : null,
}));

import BoardView from "../src/app/tasks/components/BoardView";
import TaskCreateModal from "../src/app/tasks/components/TaskCreateModal";
import TaskDetail from "../src/app/tasks/components/TaskDetail";

const task = {
  id: "task-1",
  title: "Draft accessible form",
  column_id: "todo",
  created_at: "2026-07-28T00:00:00.000Z",
};

beforeEach(() => {
  apiMocks.activity.mockResolvedValue({ data: [] });
  apiMocks.agentsList.mockResolvedValue({ data: [] });
  apiMocks.boardConfig.mockResolvedValue({ data: { columns: [] } });
  apiMocks.comments.mockResolvedValue({ data: [] });
  apiMocks.links.mockResolvedValue({ data: [] });
  apiMocks.list.mockResolvedValue({ data: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Tasks accessibility", () => {
  it("associates create-form labels with unique controls", () => {
    const props = {
      isOpen: true,
      project: "test-project",
      onClose: vi.fn(),
      onCreated: vi.fn(),
    };
    const { rerender } = render(<TaskCreateModal {...props} />);

    for (const label of ["Title *", "Status", "Priority", "Due Date", "Issue Type"]) {
      expect(screen.getByLabelText(label).id).not.toBe("");
    }
    expect(screen.getByRole("combobox", { name: "Status" })).toBe(screen.getByLabelText("Status"));

    rerender(
      <>
        <TaskCreateModal {...props} />
        <TaskCreateModal {...props} />
      </>,
    );

    const titleIds = screen.getAllByLabelText("Title *").map((input) => input.id);
    expect(new Set(titleIds).size).toBe(titleIds.length);
  });

  it("names board grouping, bulk controls, and task-specific bulk selection", () => {
    render(
      <BoardView
        project="test-project"
        tasks={[task, { ...task, id: "task-2", title: "Review keyboard navigation" }]}
        onTasksChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Group tasks by" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Bulk Edit" }));
    const firstCheckbox = screen.getByRole("checkbox", { name: "Select task Draft accessible form" });
    expect(screen.getByRole("checkbox", { name: "Select task Review keyboard navigation" })).toBeTruthy();

    fireEvent.click(firstCheckbox);

    expect(screen.getByRole("combobox", { name: "Move selected tasks to status" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Set selected task priority" })).toBeTruthy();
  });

  it("associates detail and dependency controls, including safe custom-field ids", async () => {
    apiMocks.boardConfig.mockResolvedValue({
      data: {
        columns: [],
        custom_field_defs: [
          { name: "Release date / EMEA", type: "date" },
          { name: "Release date EMEA", type: "text" },
          { name: "Customer tier", type: "single_select", options: ["Gold"] },
          { name: "Delivery regions", type: "checkboxes", options: ["North America"] },
          { name: "Approval", type: "radio", options: ["Approved"] },
        ],
      },
    });

    render(
      <TaskDetail
        task={task}
        project="test-project"
        onClose={vi.fn()}
        onTaskUpdated={vi.fn()}
      />,
    );

    for (const label of ["Title", "Status", "Priority", "Due Date", "Issue Type", "Dependency type"]) {
      expect(screen.getByLabelText(label).id).not.toBe("");
    }
    expect(screen.getByRole("combobox", { name: "Dependency type" })).toBe(screen.getByLabelText("Dependency type"));

    const releaseDate = await screen.findByLabelText("Release date / EMEA");
    const releaseDateText = screen.getByLabelText("Release date EMEA");
    expect(screen.getByRole("combobox", { name: "Customer tier" })).toBeTruthy();
    expect(screen.getByLabelText("North America").getAttribute("type")).toBe("checkbox");
    expect(screen.getByRole("radio", { name: "Approved" })).toBeTruthy();

    expect(releaseDate.id).toMatch(/^task-detail-[a-z0-9-]+$/);
    expect(releaseDateText.id).toMatch(/^task-detail-[a-z0-9-]+$/);
    expect(releaseDate.id).not.toBe(releaseDateText.id);
  });
});
