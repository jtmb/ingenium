import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const runtimeId = "11111111-1111-4111-8111-111111111111";
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
  useRuntimeWorkspace: () => ({
    mode: "isolated",
    status: "ready",
    workspaces: [],
    selectedWorkspaceId: "workspace-one",
    confirmedWorkspaceId: "workspace-one",
    error: null,
    selectWorkspace: vi.fn(),
    start: vi.fn(),
    retry: vi.fn(),
  }),
  useRuntimeLaunch: runtimeLaunch,
}));
vi.mock("../src/app/components/WorkspaceControl", () => ({ default: () => <span data-testid="workspace-control" /> }));

import OpenCodePageClient from "../src/app/opencode/OpenCodePageClient";
import VSCodePage from "../src/app/vscode/page";
import { parseOpenCodeMode } from "../src/lib/open-code-mode";

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/opencode");
  runtimeLaunch.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AUTH-109 protected runtime frames", () => {
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
