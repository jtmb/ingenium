import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import MCPDrawer from "../src/app/chat/components/MCPDrawer";
import { normalizeMcpServer, normalizeMcpServers } from "../src/app/chat/components/mcp-status";

describe("MCPDrawer status contract", () => {
  afterEach(() => cleanup());

  it.each([
    ["connected", "Connected"],
    ["disabled", "Disabled"],
    ["failed", "Failed"],
    ["needs_auth", "Needs authentication"],
    ["needs_client_registration", "Needs client registration"],
  ] as const)("renders the %s state distinctly", (status, label) => {
    const server = normalizeMcpServer("alpha", { status });
    render(
      <MCPDrawer
        isOpen
        onClose={vi.fn()}
        servers={[server]}
        onRefresh={vi.fn()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
      />,
    );

    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByRole("button", { name: status === "connected" ? "Disconnect" : "Connect" })).toBeTruthy();
  });

  it("retains both legacy boolean states and never treats malformed data as connected", () => {
    const connected = normalizeMcpServer("legacy", { connected: true });
    const disabled = normalizeMcpServer("legacy-disabled", { connected: false });
    const malformed = normalizeMcpServer("broken", { status: 42, error: "provider token" });
    render(
      <MCPDrawer
        isOpen
        onClose={vi.fn()}
        servers={[connected, disabled, malformed]}
        onRefresh={vi.fn()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
      />,
    );

    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("Disabled")).toBeTruthy();
    expect(screen.getByText("Status unavailable")).toBeTruthy();
    expect(screen.getByText("MCP server returned an unrecognized status.")).toBeTruthy();
    expect(screen.queryByText("provider token")).toBeNull();
  });

  it("rejects a malformed root rather than rendering a misleading empty state", () => {
    expect(normalizeMcpServers([])).toBeNull();
    expect(normalizeMcpServers(null)).toBeNull();
  });

  it("uses modal dialog semantics, traps focus, and restores the triggering focus", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open MCP servers";
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const server = normalizeMcpServer("alpha", { status: "disabled" });
    const { rerender } = render(
      <MCPDrawer
        isOpen
        onClose={onClose}
        servers={[server]}
        onRefresh={vi.fn()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "MCP Servers" });
    const close = screen.getByRole("button", { name: "Close MCP drawer" });
    const connect = screen.getByRole("button", { name: "Connect" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(close);
    expect(dialog.className).toContain("w-full");
    expect(dialog.className).toContain("max-w-[360px]");
    expect(close.className).toContain("min-h-11");
    expect(connect.className).toContain("min-h-11");

    screen.getByRole("button", { name: "Refresh" }).focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <MCPDrawer
        isOpen={false}
        onClose={onClose}
        servers={[server]}
        onRefresh={vi.fn()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
      />,
    );
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("closes on the backdrop, retries a status load, and accepts touch-target actions", () => {
    const onClose = vi.fn();
    const onRefresh = vi.fn();
    const onConnect = vi.fn();
    const server = normalizeMcpServer("touch-server", { status: "disabled" });
    render(
      <MCPDrawer
        isOpen
        onClose={onClose}
        servers={[server]}
        error="Unable to refresh MCP server status. Try again."
        onRefresh={onRefresh}
        onConnect={onConnect}
        onDisconnect={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("mcp-drawer-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRefresh).toHaveBeenCalledTimes(2);

    const connect = screen.getByRole("button", { name: "Connect" });
    fireEvent.touchStart(connect);
    fireEvent.touchEnd(connect);
    fireEvent.click(connect);
    expect(onConnect).toHaveBeenCalledWith("touch-server");
  });
});
