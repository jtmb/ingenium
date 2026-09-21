import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const mocks = vi.hoisted(() => ({
  listSources: vi.fn(),
  captureTask: vi.fn(),
}));

vi.mock("../src/lib/ProjectContext", () => ({
  useProject: () => "active-project",
}));

vi.mock("../src/lib/api", () => ({
  api: {
    context: { sources: { list: mocks.listSources } },
    tasks: { capture: mocks.captureTask },
  },
}));

vi.mock("../src/app/components/Overlay", () => ({
  default: ({ children, isOpen, title }: { children: React.ReactNode; isOpen: boolean; title: string }) => (
    isOpen ? <div role="dialog" aria-label={title}>{children}</div> : null
  ),
}));

import ContextSourcesSection from "../src/app/context/components/ContextSourcesSection";

const source = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Release handoff",
  provenance: "direct_upload",
  createdAt: "2026-07-31T12:00:00.000Z",
};

const captured = {
  task: { id: "task-1", title: "Review handoff", column_id: "todo", created_at: "2026-07-31T12:01:00.000Z" },
  reference: {
    id: "reference-1",
    source_type: "context" as const,
    source_id: source.id,
    display_title: source.title,
    display_detail: null,
    source_timestamp: source.createdAt,
    created_at: "2026-07-31T12:01:00.000Z",
    availability: "available" as const,
  },
};

function sourcePage(data = [source], total = data.length, offset = 0) {
  return { data, total, limit: 20, offset };
}

beforeEach(() => {
  mocks.listSources.mockResolvedValue(sourcePage());
  mocks.captureTask.mockResolvedValue({ data: captured });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ContextSourcesSection", () => {
  it("requests bounded metadata for the active project and never renders content, metadata values, or source ids", async () => {
    render(<ContextSourcesSection project="active-project" />);

    expect(await screen.findByText("Release handoff")).toBeTruthy();
    expect(mocks.listSources).toHaveBeenCalledWith("active-project", { limit: 20, offset: 0 });
    expect(screen.getByText("direct_upload")).toBeTruthy();
    expect(screen.getByText(source.createdAt)).toBeTruthy();
    expect(screen.queryByText(source.id)).toBeNull();
    expect(screen.queryByText(/source content|secret metadata/i)).toBeNull();
  });

  it("paginates with the same bounded page size and merges duplicate source rows safely", async () => {
    mocks.listSources
      .mockResolvedValueOnce(sourcePage([source, { ...source, title: "Duplicate row" }], 3))
      .mockResolvedValueOnce(sourcePage([{ ...source, title: "Release handoff" }, { ...source, id: "00000000-0000-4000-8000-000000000002", title: "Second handoff" }], 3, 2));

    render(<ContextSourcesSection project="active-project" />);
    expect(await screen.findByText("Duplicate row")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Load more sources" }));

    expect(await screen.findByText("Second handoff")).toBeTruthy();
    expect(mocks.listSources).toHaveBeenLastCalledWith("active-project", { limit: 20, offset: 2 });
    expect(screen.getAllByRole("button", { name: /Create task for Release handoff/ })).toHaveLength(1);
  });

  it("opens an accessible title-only task capture with the exact context source UUID and project", async () => {
    render(<ContextSourcesSection project="active-project" />);
    fireEvent.click(await screen.findByRole("button", { name: "Create task for Release handoff" }));

    expect(screen.getByRole("dialog", { name: "Create Task" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Title" })).toBeTruthy();
    expect(screen.queryByLabelText("Description")).toBeNull();
    expect(screen.queryByText(source.id)).toBeNull();

    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Review handoff" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Task" }));

    await waitFor(() => expect(mocks.captureTask).toHaveBeenCalledWith({
      source_type: "context",
      source_id: source.id,
      title: "Review handoff",
    }, "active-project"));
    expect(JSON.stringify(mocks.captureTask.mock.calls[0])).not.toContain("content");
    expect(screen.queryByText(source.id)).toBeNull();
  });

  it("shows one success status for repeated duplicate-safe captures", async () => {
    render(<ContextSourcesSection project="active-project" />);
    const openCapture = async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Create task for Release handoff" }));
      fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Review handoff" } });
      fireEvent.click(screen.getByRole("button", { name: "Create Task" }));
      await screen.findByTestId("context-task-capture-success");
    };

    await openCapture();
    await openCapture();

    expect(mocks.captureTask).toHaveBeenCalledTimes(2);
    expect(screen.getAllByTestId("context-task-capture-success")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toContain("Task created: Review handoff");
  });

  it("renders accessible loading, empty, and error states", async () => {
    let resolveSources: ((value: ReturnType<typeof sourcePage>) => void) | undefined;
    mocks.listSources.mockReturnValueOnce(new Promise((resolve) => { resolveSources = resolve; }));
    render(<ContextSourcesSection project="active-project" />);

    expect(screen.getByText("Loading context sources…")).toBeTruthy();
    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");

    resolveSources?.(sourcePage([]));
    expect(await screen.findByTestId("context-sources-empty")).toBeTruthy();

    cleanup();
    mocks.listSources.mockRejectedValueOnce(new Error("Context source service unavailable"));
    render(<ContextSourcesSection project="active-project" />);

    expect((await screen.findByRole("alert")).textContent).toContain("Context source service unavailable");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
