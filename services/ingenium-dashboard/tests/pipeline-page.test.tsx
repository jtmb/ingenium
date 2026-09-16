import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import type { PipelineEvent } from "../src/lib/api";

const { getSchedule, getEvents } = vi.hoisted(() => ({
  getSchedule: vi.fn(),
  getEvents: vi.fn(),
}));

vi.mock("../src/lib/ProjectContext", () => ({
  useProject: () => "active-project",
  useGlobalProject: () => ({ project: "global-project", loading: false, error: null }),
}));

vi.mock("../src/lib/api", () => ({
  api: {
    settings: { get: getSchedule },
    pipeline: { events: getEvents },
  },
}));

import PipelinePage from "../src/app/pipeline/page";

function event(id: number, title: string, source = "agent"): PipelineEvent {
  return {
    id,
    project_id: "project-id",
    event_type: "observation_created",
    event_source: source,
    title,
    importance: 1,
    created_at: "2026-08-09T00:00:00.000Z",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  getSchedule.mockReset().mockResolvedValue({ data: { value: "900000" } });
  getEvents.mockReset();
});

afterEach(cleanup);

describe("PipelinePage event loading", () => {
  it("keeps a prior filter response from overwriting the latest filter", async () => {
    const allEvents = deferred<{ data: PipelineEvent[] }>();
    const agentEvents = deferred<{ data: PipelineEvent[] }>();
    getEvents
      .mockReturnValueOnce(allEvents.promise)
      .mockReturnValueOnce(agentEvents.promise);

    render(<PipelinePage />);

    expect(screen.getByText("Loading pipeline events...")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    await act(async () => allEvents.resolve({ data: [event(1, "Stale all-events response")] }));
    await vi.waitFor(() => expect(getEvents).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Stale all-events response")).toBeNull();

    await act(async () => agentEvents.resolve({ data: [event(2, "Current agent response")] }));

    expect(await screen.findByText("Current agent response")).not.toBeNull();
    expect(screen.queryByText("Stale all-events response")).toBeNull();
  });

  it("distinguishes an event loading failure from a successful empty timeline", async () => {
    getEvents.mockRejectedValueOnce(new Error("Pipeline service unavailable"));

    render(<PipelinePage />);

    expect((await screen.findByRole("alert")).textContent).toContain("Pipeline service unavailable");
    expect(screen.queryByText("No pipeline events yet. Events are logged automatically during agent interactions.")).toBeNull();

    getEvents.mockResolvedValue({ data: [] });
    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    expect(await screen.findByText("No pipeline events yet. Events are logged automatically during agent interactions.")).not.toBeNull();
  });

  it("opens a timeline event from its semantic control", async () => {
    getEvents.mockResolvedValue({ data: [event(3, "Keyboard-accessible event")] });

    render(<PipelinePage />);

    fireEvent.click(await screen.findByRole("button", { name: "View event Keyboard-accessible event" }));

    expect(screen.getByRole("dialog", { name: "Event #3" })).not.toBeNull();
  });

  it("keeps global schedule failures separate from project event loading", async () => {
    getSchedule.mockRejectedValue(new Error("Global settings unavailable"));
    getEvents.mockResolvedValue({ data: [] });

    render(<PipelinePage />);

    expect((await screen.findByRole("alert")).textContent).toContain("Synthesis schedule unavailable: Global settings unavailable");
    expect(await screen.findByText("No pipeline events yet. Events are logged automatically during agent interactions.")).not.toBeNull();
    expect(getSchedule).toHaveBeenCalledWith("synthesis_interval_ms", "global-project");
    expect(getEvents).toHaveBeenCalledWith("active-project", { limit: 500 });
  });
});
