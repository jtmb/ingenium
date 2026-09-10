import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

/**
 * Board overflow regression coverage.
 *
 * The grid keeps desktop Kanban column sizing, while the bounded region owns
 * horizontal scrolling on narrow screens. This prevents the grid's intrinsic
 * width from widening the Tasks page and clipping its controls.
 */

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
    tasks: {
      boardConfig: vi.fn().mockResolvedValue({ data: null }),
    },
  },
}));

vi.mock("../src/app/tasks/components/TaskDetail", () => ({
  default: () => null,
}));

import BoardView from "../src/app/tasks/components/BoardView";

afterEach(() => {
  cleanup();
});

describe("BoardView responsive overflow", () => {
  it("bounds the board and exposes a keyboard-focusable horizontal scroll region", () => {
    render(<BoardView project="test-project" tasks={[]} onTasksChange={vi.fn()} />);

    const board = screen.getByRole("region", { name: "Kanban board" });
    const grid = board.querySelector(".grid");

    expect(board.className).toContain("min-w-0");
    expect(board.className).toContain("max-w-full");
    expect(board.className).toContain("overflow-x-auto");
    expect(board.getAttribute("tabindex")).toBe("0");
    expect(grid).not.toBeNull();
    expect(grid?.className).toContain("w-max");
    expect(grid?.className).toContain("min-w-full");
  });
});
