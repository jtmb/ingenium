import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const mocks = vi.hoisted(() => ({
  listSpaces: vi.fn(),
  getPage: vi.fn(),
  captureTask: vi.fn(),
  updatePage: vi.fn(),
  publishPage: vi.fn(),
  deletePage: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  searchParams: "",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
  useSearchParams: () => new URLSearchParams(mocks.searchParams),
}));

vi.mock("../src/lib/ProjectContext", () => ({
  useProject: () => "active-project",
}));

vi.mock("../src/lib/api", () => ({
  dashboardFetch: vi.fn(),
  getApiBase: () => "/api/v1",
  api: {
    docs: {
      spaces: { list: mocks.listSpaces },
      pages: {
        get: mocks.getPage,
        update: mocks.updatePage,
        publish: mocks.publishPage,
        delete: mocks.deletePage,
      },
    },
    tasks: { capture: mocks.captureTask },
  },
}));

vi.mock("../src/app/docs/components/DocsShell", () => ({
  default: ({ main, topBarActions }: { main: React.ReactNode; topBarActions?: React.ReactNode }) => <>{topBarActions}{main}</>,
}));

vi.mock("../src/app/docs/components/DocsEditor", () => ({
  default: ({ onSave }: { onSave: (content: string) => Promise<void> }) => {
    const [status, setStatus] = React.useState("");
    return (
      <div data-testid="docs-editor">
        Editor
        <button
          type="button"
          onClick={async () => {
            try {
              await onSave("editor content");
              setStatus("saved");
            } catch {
              setStatus("failed");
            }
          }}
        >
          Save document
        </button>
        {status && <span>{status}</span>}
      </div>
    );
  },
}));

vi.mock("../src/app/components/Overlay", () => ({
  default: ({ children, isOpen, title }: { children: React.ReactNode; isOpen: boolean; title: string }) => (
    isOpen ? <div role="dialog" aria-label={title}>{children}</div> : null
  ),
}));

import DocsPage from "../src/app/docs/page";

describe("DocsPage empty workspace heading", () => {
  beforeEach(() => {
    mocks.listSpaces.mockReset().mockResolvedValue({ data: [] });
    mocks.getPage.mockReset();
    mocks.captureTask.mockReset();
    mocks.updatePage.mockReset();
    mocks.publishPage.mockReset();
    mocks.deletePage.mockReset();
    mocks.replace.mockReset();
    mocks.push.mockReset();
    mocks.searchParams = "";
  });

  afterEach(cleanup);

  it("uses one page-level h1 for the empty workspace state", async () => {
    render(<DocsPage />);

    expect(await screen.findByRole("heading", { level: 1, name: "Welcome to Docs" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });

  it("hides Create task when no page is selected", async () => {
    mocks.listSpaces.mockResolvedValue({ data: [{ id: 1, name: "Docs" }] });

    render(<DocsPage />);

    await screen.findByText("Welcome to Docs");
    expect(screen.queryByRole("button", { name: "Create task" })).toBeNull();
    expect(mocks.getPage).not.toHaveBeenCalled();
  });

  it("captures only the loaded page identity with the selected project and links the success toast", async () => {
    mocks.searchParams = "space=1&page=42";
    mocks.listSpaces.mockResolvedValue({ data: [{ id: 1, name: "Docs" }] });
    const page = {
      id: 42,
      spaceId: 1,
      parentPageId: null,
      title: "API handbook",
      slug: "api-handbook",
      content: "Do not send this page body.",
      revision: 7,
      status: "draft" as const,
      sortOrder: 0,
      isFavorite: 0,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    };
    mocks.getPage.mockResolvedValue({ data: page });
    mocks.captureTask.mockResolvedValue({
      data: { task: { id: "task-1", title: "Review API docs" }, reference: {} },
    });

    render(<DocsPage />);

    const createTask = await screen.findByRole("button", { name: "Create task" });
    expect(createTask).toBeTruthy();
    expect(createTask.className).toContain("min-h-11");
    expect(createTask.className).toContain("min-w-11");
    expect(createTask.className).toContain("shrink-0");
    expect(screen.getByTestId("docs-editor")).toBeTruthy();

    fireEvent.click(createTask);
    expect(screen.getByRole("dialog", { name: "Create Task" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Title" })).toBeTruthy();
    expect(screen.queryByLabelText("Description")).toBeNull();

    const title = screen.getByRole("textbox", { name: "Title" });
    fireEvent.change(title, { target: { value: "Review API docs" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Task" }));

    await waitFor(() => expect(mocks.captureTask).toHaveBeenCalledWith(
      { source_type: "docs", page_id: 42, title: "Review API docs" },
      "active-project",
    ));
    expect(JSON.stringify(mocks.captureTask.mock.calls)).not.toMatch(/API handbook|Do not send this page body|revision|draft|editor|project link/i);
    expect(mocks.updatePage).not.toHaveBeenCalled();
    expect(mocks.publishPage).not.toHaveBeenCalled();
    expect(mocks.deletePage).not.toHaveBeenCalled();

    const status = await screen.findByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toContain("Task created:");
    expect(screen.getByRole("link", { name: "Review API docs" }).getAttribute("href")).toBe("/tasks");
  });

  it("keeps the accessible capture form open and reports capture errors", async () => {
    mocks.searchParams = "space=1&page=42";
    mocks.listSpaces.mockResolvedValue({ data: [{ id: 1, name: "Docs" }] });
    mocks.getPage.mockResolvedValue({
      data: {
        id: 42,
        spaceId: 1,
        parentPageId: null,
        title: "Troubleshooting",
        slug: "troubleshooting",
        content: "Private body",
        revision: 3,
        status: "published",
        sortOrder: 0,
        isFavorite: 0,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    });
    mocks.captureTask.mockRejectedValue(new Error("Task service unavailable"));

    render(<DocsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Create task" }));
    const title = screen.getByRole("textbox", { name: "Title" });
    fireEvent.change(title, { target: { value: "Capture troubleshooting" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Task" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Task service unavailable");
    expect(screen.getByRole("dialog", { name: "Create Task" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Title" })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("rethrows a page update failure so the editor keeps its draft", async () => {
    mocks.searchParams = "space=1&page=42";
    mocks.listSpaces.mockResolvedValue({ data: [{ id: 1, name: "Docs" }] });
    mocks.getPage.mockResolvedValue({
      data: {
        id: 42,
        spaceId: 1,
        parentPageId: null,
        title: "Save failure",
        slug: "save-failure",
        content: "Original",
        revision: 7,
        status: "draft",
        sortOrder: 0,
        isFavorite: 0,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    });
    mocks.updatePage.mockRejectedValue(new Error("Update unavailable"));

    render(<DocsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Save document" }));

    expect(await screen.findByText("failed")).toBeTruthy();
    expect(mocks.updatePage).toHaveBeenCalledWith(42, { content: "editor content" }, 7);
  });
});
