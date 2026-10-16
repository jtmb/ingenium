import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const runtimeId = "11111111-1111-4111-8111-111111111111";
const { ownerRequest, ownerStepUp, runtimeWorkspace } = vi.hoisted(() => ({
  ownerRequest: vi.fn(), ownerStepUp: vi.fn(),
  runtimeWorkspace: { mode: "isolated", confirmedWorkspaceId: "workspace-one" },
}));
const runtimeLaunch = vi.hoisted(() => vi.fn((audience: "web" | "cli" | "vscode", _workspace: unknown, enabled = true) => ({
  status: enabled ? "ready" : "loading",
  url: enabled ? `https://${audience}--11111111-1111-4111-8111-111111111111.runtime.example.test/` : null,
  error: null,
  retry: vi.fn(),
})));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("../src/lib/use-runtime-launch", () => ({
  useRuntimeLaunch: runtimeLaunch,
}));
vi.mock("../src/lib/api", () => ({
  request: ownerRequest,
  api: { auth: { stepUp: ownerStepUp } },
}));
vi.mock("../src/lib/RuntimeContext", () => ({
  useRuntime: () => ({ workspace: {
    mode: runtimeWorkspace.mode,
    status: "ready",
    workspaces: [],
    selectedWorkspaceId: "workspace-one",
    confirmedWorkspaceId: runtimeWorkspace.confirmedWorkspaceId,
    confirmedRuntimeId: runtimeId,
    error: null,
    selectWorkspace: vi.fn(),
    start: vi.fn(),
    retry: vi.fn(),
  } }),
}));
vi.mock("../src/app/components/WorkspaceControl", () => ({ default: () => <span data-testid="workspace-control" /> }));

import OpenCodePageClient from "../src/app/opencode/OpenCodePageClient";
import VSCodePage from "../src/app/vscode/page";
import { parseOpenCodeMode } from "../src/lib/open-code-mode";

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/opencode");
  runtimeLaunch.mockClear();
  runtimeWorkspace.mode = "isolated";
  runtimeWorkspace.confirmedWorkspaceId = "workspace-one";
  ownerRequest.mockReset().mockResolvedValue({ data: { status: "ready" } });
  ownerStepUp.mockReset().mockResolvedValue({ data: {} });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AUTH-109 protected runtime frames", () => {
  it("exposes background learning only to an explicitly confirmed compatibility workspace after step-up", async () => {
    const { rerender } = render(<OpenCodePageClient initialMode="web" restoreStoredMode />);
    expect(screen.queryByRole("button", { name: "Enable background learning" })).toBeNull();
    runtimeWorkspace.mode = "compatibility";
    rerender(<OpenCodePageClient initialMode="web" restoreStoredMode />);
    expect(ownerRequest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Enable background learning" }));
    expect(screen.getByRole("dialog", { name: "Confirm it’s you" })).toBeTruthy();
    expect(ownerRequest).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Credential"), { target: { value: "fixture-only" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(ownerRequest).toHaveBeenCalledWith(
      "/runtimes/browser/workspaces/workspace-one/automation", { method: "POST", body: "{}" },
    ));
    expect(ownerStepUp).toHaveBeenCalledWith("fixture-only");
    await screen.findByText("Background learning enabled for this runtime.");
  });

  it("does not claim a failed owner authorization succeeded", async () => {
    runtimeWorkspace.mode = "compatibility";
    ownerRequest.mockRejectedValue(new Error("Denied"));
    render(<OpenCodePageClient initialMode="web" restoreStoredMode />);
    fireEvent.click(screen.getByRole("button", { name: "Enable background learning" }));
    fireEvent.change(screen.getByLabelText("Credential"), { target: { value: "fixture-only" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Background learning could not be enabled. Confirm the runtime is active and try again.");
  });

  it("uses audience roots without sandbox expansion and launches the protected pop-out", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<OpenCodePageClient initialMode="web" restoreStoredMode />);
    const web = screen.getByTitle("OpenCode Web");
    expect(web.getAttribute("src")).toBe(`https://web--${runtimeId}.runtime.example.test/`);
    expect(web.getAttribute("allow")).toBe("clipboard-write");
    expect(web.getAttribute("sandbox")).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/4098|4099|rbl_|Bearer/);

    fireEvent.click(screen.getByRole("button", { name: "Pop out to new window" }));
    expect(open).toHaveBeenCalledWith("/standalone?page=opencode&mode=web", "_blank", "width=1280,height=900,noopener");
    fireEvent.click(screen.getByRole("button", { name: "Switch to CLI mode" }));
    expect(screen.getByTitle("OpenCode Terminal").getAttribute("src")).toBe(`https://cli--${runtimeId}.runtime.example.test/`);
  });

  it("initializes an exact CLI query ahead of stored Web state and preserves it in pop-out navigation", () => {
    localStorage.setItem("opencode-mode", "web");
    window.history.replaceState(null, "", "/opencode?mode=cli");
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    render(<OpenCodePageClient initialMode="cli" restoreStoredMode={false} />);

    expect(screen.getByRole("button", { name: "Switch to CLI mode" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Switch to Web mode" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTitle("OpenCode Terminal").getAttribute("src")).toBe(`https://cli--${runtimeId}.runtime.example.test/`);
    expect(runtimeLaunch).toHaveBeenCalledWith("cli", expect.anything(), true);

    fireEvent.click(screen.getByRole("button", { name: "Pop out to new window" }));
    expect(open).toHaveBeenCalledWith("/standalone?page=opencode&mode=cli", "_blank", "width=1280,height=900,noopener");
  });

  it("canonicalizes an invalid query to Web instead of restoring stored CLI state", async () => {
    localStorage.setItem("opencode-mode", "cli");
    window.history.replaceState(null, "", "/opencode?mode=%25");

    render(<OpenCodePageClient initialMode={parseOpenCodeMode("%")} restoreStoredMode={false} />);

    expect(screen.getByRole("button", { name: "Switch to Web mode" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Switch to CLI mode" }).getAttribute("aria-pressed")).toBe("false");
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("mode")).toBe("web"));
    expect(localStorage.getItem("opencode-mode")).toBe("web");
  });

  it("uses the distinct VS Code audience in the same runtime identity", () => {
    render(<VSCodePage />);
    const frame = screen.getByTitle("VS Code");
    expect(frame.getAttribute("src")).toBe(`https://vscode--${runtimeId}.runtime.example.test/`);
    expect(frame.getAttribute("allow")).toBe("clipboard-write");
    expect(frame.getAttribute("sandbox")).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/4100|rbl_|Bearer/);
  });
});
