import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const runtimeId = "11111111-1111-4111-8111-111111111111";
vi.mock("../src/lib/use-runtime-launch", () => ({
  useRuntimeLaunch: (audience: "web" | "cli" | "vscode", enabled = true) => ({
    status: enabled ? "ready" : "loading",
    url: enabled ? `https://${audience}--${runtimeId}.runtime.example.test/` : null,
    error: null,
    retry: vi.fn(),
  }),
}));
vi.mock("../src/app/components/WorkspaceControl", () => ({ default: () => <span data-testid="workspace-control" /> }));

import OpenCodePage from "../src/app/opencode/page";
import VSCodePage from "../src/app/vscode/page";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AUTH-109 protected runtime frames", () => {
  it("uses audience roots without sandbox expansion and launches the protected pop-out", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<OpenCodePage />);
    const web = screen.getByTitle("OpenCode Web");
    expect(web.getAttribute("src")).toBe(`https://web--${runtimeId}.runtime.example.test/`);
    expect(web.getAttribute("allow")).toBe("clipboard-write");
    expect(web.getAttribute("sandbox")).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/4098|4099|rbl_|Bearer/);

    fireEvent.click(screen.getByRole("button", { name: "Pop out to new window" }));
    expect(open).toHaveBeenCalledWith("/standalone?page=opencode", "_blank", "width=1280,height=900,noopener");
    fireEvent.click(screen.getByRole("button", { name: "Switch to CLI mode" }));
    expect(screen.getByTitle("OpenCode Terminal").getAttribute("src")).toBe(`https://cli--${runtimeId}.runtime.example.test/`);
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
