import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const apiMocks = vi.hoisted(() => ({
  activity: vi.fn(),
  agentsList: vi.fn(),
  boardConfig: vi.fn(),
  comments: vi.fn(),
  links: vi.fn(),
  list: vi.fn(),
  references: vi.fn(),
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
      references: { list: apiMocks.references },
    },
  },
}));

vi.mock("../src/app/components/Overlay", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../src/app/components/MarkdownViewer", () => ({
  default: () => null,
}));

import TaskDetail from "../src/app/tasks/components/TaskDetail";

const task = {
  id: "task-1",
  title: "Review source references",
  column_id: "todo",
  created_at: "2026-07-31T00:00:00.000Z",
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

describe("TaskDetail source references", () => {
  it("reloads metadata-only references after remount and explains missing/unavailable sources", async () => {
    apiMocks.references.mockResolvedValue({
      data: [
        {
          id: "reference-docs",
          source_type: "docs",
          source_id: "opaque-source-id",
          display_title: "Release plan",
          display_detail: "Documentation page",
          source_timestamp: "2026-08-01T00:00:00.000Z",
          created_at: "2026-08-01T00:00:00.000Z",
          availability: "available",
        },
        {
          id: "reference-missing",
          source_type: "chat",
          source_id: "chat-source-id",
          display_title: "OpenCode chat",
          display_detail: "OpenCode chat",
          source_timestamp: null,
          created_at: "2026-08-01T00:00:00.000Z",
          availability: "missing",
        },
        {
          id: "reference-unavailable",
          source_type: "context",
          source_id: "context-source-id",
          display_title: "Context source",
          display_detail: "Context source",
          source_timestamp: null,
          created_at: "2026-08-01T00:00:00.000Z",
          availability: "unavailable",
        },
      ],
    });

    const props = {
      task,
      project: "project-1",
      onClose: vi.fn(),
      onTaskUpdated: vi.fn(),
    };
    const first = render(<TaskDetail {...props} />);

    expect(await screen.findByRole("heading", { name: "Source references" })).toBeTruthy();
    const layout = screen.getByTestId("task-detail-layout");
    expect(layout.className).toContain("min-w-0");
    expect(layout.className).toContain("flex-col");
    expect(layout.className).toContain("lg:flex-row");
    const main = screen.getByTestId("task-detail-main");
    expect(main.className).toContain("min-w-0");
    expect(main.className).toContain("min-h-0");
    expect(main.className).toContain("pr-0");
    expect(main.className).toContain("lg:pr-4");
    const activity = screen.getByTestId("task-detail-activity");
    expect(activity.className).toContain("w-full");
    expect(activity.className).toContain("border-t");
    expect(activity.className).toContain("mt-4");
    expect(activity.className).toContain("pt-4");
    expect(activity.className).toContain("lg:w-64");
    expect(activity.className).toContain("lg:border-l");
    fireEvent.click(screen.getByRole("button", { name: "◀ Hide" }));
    expect(activity.className).toContain("w-0");
    expect(screen.getByRole("button", { name: "▶" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "▶" }));
    expect(activity.className).toContain("w-full");
    const section = screen.getByTestId("task-detail-source-references");
    expect(section.getAttribute("aria-labelledby")).toBe(section.querySelector("h3")?.id);
    expect(section.querySelector("h3")?.className).toContain("text-[var(--color-text-primary)]");
    expect(section.querySelector("ul")?.className).toContain("min-w-0");
    expect(screen.getByText("Release plan")).toBeTruthy();
    expect(screen.getByText("Release plan").className).toContain("break-words");
    expect(screen.getByText("Documentation page").className).toContain("break-words");
    expect(screen.getByText("Type: docs").className).toContain("break-words");
    expect(screen.getByText("Type: docs").className).toContain("text-[var(--color-text-muted)]");
    expect(screen.getByText("Timestamp: 2026-08-01T00:00:00.000Z").className).toContain("break-words");
    expect(screen.getByText("Available").className).toContain("text-[var(--color-success-text)]");
    expect(screen.getByText("This source is no longer available. Update the task details if you need replacement context.").className).toContain("text-[var(--color-error-text)]");
    expect(screen.getByText("Source availability could not be checked. Try again later.").className).toContain("text-[var(--color-warning-text)]");
    expect(screen.queryByText("opaque-source-id")).toBeNull();

    first.unmount();
    render(<TaskDetail {...props} />);
    await waitFor(() => expect(apiMocks.references).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Release plan")).toBeTruthy();
    expect(apiMocks.references).toHaveBeenLastCalledWith("task-1", "project-1");
  });
});
