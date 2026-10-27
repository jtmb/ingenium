import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import type { DocPage } from "../src/lib/docs-types";

const { dashboardFetch } = vi.hoisted(() => ({ dashboardFetch: vi.fn() }));

vi.mock("../src/lib/api", () => ({
  dashboardFetch,
  getApiBase: () => "/api/v1",
}));

vi.mock("../src/app/components/MarkdownDocument", () => ({ default: () => null }));
vi.mock("../src/app/docs/components/EditorToolbar", () => ({ default: () => null }));
vi.mock("../src/app/docs/components/AIActions", () => ({ default: () => null }));
vi.mock("../src/app/docs/components/DictationButton", () => ({ default: () => null }));

import DocsEditor from "../src/app/docs/components/DocsEditor";

const page: DocPage = {
  id: 7,
  spaceId: 1,
  parentPageId: null,
  title: "Save behavior",
  slug: "save-behavior",
  content: "Original content",
  revision: 1,
  status: "draft",
  sortOrder: 0,
  isFavorite: 0,
  createdAt: "2026-08-09T00:00:00.000Z",
  updatedAt: "2026-08-09T00:00:00.000Z",
};

beforeEach(() => {
  dashboardFetch.mockReset();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: null }) }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("DocsEditor save behavior", () => {
  it("keeps the draft when the page update fails", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("Page update failed"));
    render(<DocsEditor page={page} mode="edit" onSave={onSave} />);

    fireEvent.change(screen.getByPlaceholderText("Write your documentation in Markdown..."), {
      target: { value: "Updated content" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Updated content"));
    expect(dashboardFetch).not.toHaveBeenCalled();
    expect(await screen.findByText("Page update failed")).not.toBeNull();
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("reports a failed draft deletion instead of claiming the page was saved", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    dashboardFetch.mockResolvedValue({ ok: false, status: 503 });
    render(<DocsEditor page={page} mode="edit" onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(dashboardFetch).toHaveBeenCalledWith(
      "/api/v1/docs/pages/7/draft",
      expect.objectContaining({ method: "DELETE" }),
    ));
    expect(await screen.findByText("Draft delete failed (503)")).not.toBeNull();
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("saves a new page before an autosave draft exists", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    dashboardFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: "NOT_FOUND", message: "No draft found for page 7" } }),
    });
    render(<DocsEditor page={page} mode="edit" onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved")).not.toBeNull();
    expect(screen.queryByText("Draft delete failed (404)")).toBeNull();
  });

  it.each([
    { code: "NOT_FOUND", message: "Page not found" },
    { code: "FORBIDDEN", message: "Not authorized" },
  ])("keeps an unexpected draft cleanup failure visible: $code", async (error) => {
    dashboardFetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error }) });
    render(<DocsEditor page={page} mode="edit" onSave={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Draft delete failed (404)")).not.toBeNull();
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("reports an autosave failure when the draft endpoint returns a non-OK response", async () => {
    vi.useFakeTimers();
    dashboardFetch.mockResolvedValue({ ok: false, status: 500 });
    render(<DocsEditor page={page} mode="edit" onSave={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("Write your documentation in Markdown..."), {
      target: { value: "Autosaved content" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(dashboardFetch).toHaveBeenCalledWith(
      "/api/v1/docs/pages/7/draft",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(screen.getByText("Error saving")).not.toBeNull();
  });
});
