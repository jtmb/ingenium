import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ status: "ready", workspaceStatus: "ready", url: "https://workspace.example.test/", retry: vi.fn(), enabled: vi.fn() }));
vi.mock("../src/lib/RuntimeContext", () => ({ useRuntime: () => ({ workspace: { status: state.workspaceStatus } }) }));
vi.mock("../src/lib/use-runtime-launch", () => ({ useRuntimeLaunch: (_audience: string, _workspace: unknown, enabled: boolean) => {
  state.enabled(enabled); return { status: state.status, url: state.url, error: null, retry: state.retry };
} }));
import WorkWebFrame from "../src/app/components/veyra-work/WorkWebFrame";

beforeEach(() => { vi.clearAllMocks(); state.status = "ready"; state.workspaceStatus = "ready"; state.url = "https://workspace.example.test/"; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("unchanged upstream session frame", () => {
  it("does not launch an empty upstream page when no conversation is selected", () => {
    render(<WorkWebFrame sessionId={null} />);
    expect(state.enabled).toHaveBeenLastCalledWith(false);
    expect(screen.queryByTitle("OpenCode Web — selected conversation")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Select a conversation");
  });

  it("keeps the same frame and source on same-session rerender, without scripts or native IPC", () => {
    const view = render(<WorkWebFrame sessionId="ses-a" />);
    const frame = screen.getByTitle("OpenCode Web — selected conversation");
    expect(frame.getAttribute("src")).toContain("/session/ses-a");
    expect(frame.getAttribute("allow")).toBe("clipboard-write");
    expect(frame.getAttribute("srcdoc")).toBeNull();
    fireEvent.load(frame);
    view.rerender(<WorkWebFrame sessionId="ses-a" />);
    expect(screen.getByTitle("OpenCode Web — selected conversation")).toBe(frame);
  });

  it("preserves Work on timeout and retries only after explicit connection action", () => {
    vi.useFakeTimers();
    render(<WorkWebFrame sessionId="ses-a" />);
    act(() => vi.advanceTimersByTime(15_000));
    expect(state.retry).not.toHaveBeenCalled();
    expect(screen.queryByTitle("OpenCode Web — selected conversation")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("draft are retained");
    fireEvent.click(screen.getByRole("button", { name: "Retry Web connection" }));
    expect(state.retry).toHaveBeenCalledTimes(1);
  });

  it("removes the frame when the workspace becomes unavailable even if launch state is stale", () => {
    const view = render(<WorkWebFrame sessionId="ses-a" />);
    expect(screen.getByTitle("OpenCode Web — selected conversation")).toBeTruthy();
    state.workspaceStatus = "unavailable";
    view.rerender(<WorkWebFrame sessionId="ses-a" />);
    expect(screen.queryByTitle("OpenCode Web — selected conversation")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("selected runtime is unavailable");
  });
});
