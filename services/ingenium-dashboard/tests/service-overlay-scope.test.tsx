import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import ServiceOverlay from "../src/app/status/ServiceOverlay";

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function response(data: Record<string, unknown>) { return { ok: true, json: async () => ({ data }) }; }

describe("ServiceOverlay activity contracts", () => {
  it("requests the selected project and labels the real processing timestamp", async () => {
    fetchMock.mockResolvedValue(response({ name: "synthesis-engine", state: "idle", description: "Synthesis pipeline",
      scope: { kind: "project", projectId: "project-id", projectName: "fixture project" }, intervalMs: 600000,
      lastProcessedAt: "2026-10-27T18:17:11.026Z", lastRunAt: "2026-10-27T18:17:11.026Z", nextEstimate: null,
      stats: { totalObservations: 193, pendingCount: 0, processedCount: 193, traitCount: 126 } }));
    render(<ServiceOverlay name="synthesis-engine" type="application" project="fixture project" onClose={vi.fn()} />);
    expect(await screen.findByText("Project: fixture project")).toBeTruthy();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/services/applications/synthesis-engine?project=fixture%20project");
    expect(screen.getByText("Last observation processed")).toBeTruthy();
    expect(screen.getByText("Pipeline Stats")).toBeTruthy();
    expect(screen.getAllByText("193")).toHaveLength(2);
    expect(screen.queryByText("Next Run (est.)")).toBeNull();
  });

  it("shows documentation statistics instead of empty pipeline fields", async () => {
    fetchMock.mockResolvedValue(response({ name: "docs-workspace", state: "healthy", description: "Documentation workspace",
      scope: { kind: "installation" }, stats: { spaces: 5, pages: 73, drafts: 0 } }));
    render(<ServiceOverlay name="docs-workspace" type="application" project="fixture" onClose={vi.fn()} />);
    expect(await screen.findByText("Documentation Stats")).toBeTruthy();
    for (const value of ["Installation", "Spaces", "Pages", "Drafts", "73"]) expect(screen.getByText(value)).toBeTruthy();
    expect(screen.queryByText("Pipeline Stats")).toBeNull();
    expect(screen.queryByText("Total Observations")).toBeNull();
  });

  it("shows selected-project task statistics and column counts", async () => {
    fetchMock.mockResolvedValue(response({ name: "tasks-board", state: "healthy", description: "Task board",
      scope: { kind: "project", projectId: "fixture-id", projectName: "fixture" },
      stats: { total: 2, byColumn: { todo: 1, done: 1 } } }));
    render(<ServiceOverlay name="tasks-board" type="application" project="fixture" onClose={vi.fn()} />);
    expect(await screen.findByText("Task Stats")).toBeTruthy();
    for (const value of ["Project: fixture", "Total tasks", "To do", "In progress", "In review", "Done", "2"]) expect(screen.getByText(value)).toBeTruthy();
    expect(screen.queryByText("Pipeline Stats")).toBeNull();
  });

  it("aborts and ignores an older project's detail response", async () => {
    let oldResponse!: (value: ReturnType<typeof response>) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { oldResponse = resolve; }));
    const view = render(<ServiceOverlay name="synthesis-engine" type="application" project="first" onClose={vi.fn()} />);
    const oldSignal = fetchMock.mock.calls[0]?.[1].signal as AbortSignal;
    fetchMock.mockResolvedValueOnce(response({ name: "synthesis-engine", state: "idle", description: "Current",
      scope: { kind: "project", projectId: "second-id", projectName: "second" },
      stats: { totalObservations: 7, processedCount: 7, pendingCount: 0, traitCount: 1 } }));
    view.rerender(<ServiceOverlay name="synthesis-engine" type="application" project="second" onClose={vi.fn()} />);
    await screen.findByText("Project: second");
    expect(oldSignal.aborted).toBe(true);
    await act(async () => oldResponse(response({ name: "synthesis-engine", state: "healthy", description: "Stale",
      scope: { kind: "project", projectId: "first-id", projectName: "first" } })));
    expect(screen.queryByText("Project: first")).toBeNull();
    expect(screen.queryByText("Stale")).toBeNull();
  });
});
