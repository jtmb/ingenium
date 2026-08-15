import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const retry = vi.hoisted(() => vi.fn());
const workspaceControl = vi.hoisted(() => vi.fn());

vi.mock("../src/lib/use-runtime-launch", () => ({
  useRuntimeWorkspace: () => ({
    mode: "compatibility",
    status: "ready",
    workspaces: [],
    selectedWorkspaceId: null,
    confirmedWorkspaceId: null,
    error: null,
    selectWorkspace: vi.fn(),
    start: vi.fn(),
    retry: vi.fn(),
  }),
  useRuntimeLaunch: () => ({
    status: "ready",
    url: "http://vscode.localhost:3000/",
    error: null,
    retry,
  }),
}));

vi.mock("../src/app/components/WorkspaceControl", () => ({
  default: ({ pageId }: { pageId: string }) => {
    workspaceControl(pageId);
    return <span data-testid="workspace-control" data-page-id={pageId} />;
  },
}));

import VSCodePage from "../src/app/vscode/page";
import VSCodeFrame, { VSCODE_FRAME_TIMEOUT_MS } from "../src/app/components/VSCodeFrame";

afterEach(() => {
  cleanup();
  retry.mockReset();
  workspaceControl.mockReset();
  vi.useRealTimers();
});

describe("VS Code route runtime profile", () => {
  it("renders the compatibility alias with the established iframe boundary", () => {
    render(<VSCodePage />);

    const frame = screen.getByTitle("VS Code");
    expect(frame.getAttribute("src")).toBe("http://vscode.localhost:3000/");
    expect(frame.getAttribute("allow")).toBe("clipboard-write");
    expect(frame.getAttribute("loading")).toBe("eager");
    expect(frame.getAttribute("sandbox")).toBeNull();
    expect(screen.getByTestId("workspace-control").getAttribute("data-page-id")).toBe("vscode");
    expect(workspaceControl).toHaveBeenCalledWith("vscode");
  });

  it("replaces a stalled iframe with a retryable error", () => {
    vi.useFakeTimers();
    render(<VSCodeFrame />);

    act(() => { vi.advanceTimersByTime(VSCODE_FRAME_TIMEOUT_MS); });

    expect(screen.getByRole("alert").textContent).toContain("VS Code could not be loaded");
    fireEvent.click(screen.getByRole("button", { name: "Retry VS Code" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
