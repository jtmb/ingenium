import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const mocks = vi.hoisted(() => ({
  listServers: vi.fn(),
  listDiscoveredTools: vi.fn(),
  createServer: vi.fn(),
  removeServer: vi.fn(),
  listCategories: vi.fn(),
  toggleTool: vi.fn(),
  toggleCategory: vi.fn(),
  mcpStatus: vi.fn(),
  mcpConnect: vi.fn(),
  mcpDisconnect: vi.fn(),
}));

vi.mock("../src/lib/api", () => ({
  api: {
    mcpServers: {
      list: mocks.listServers,
      listTools: mocks.listDiscoveredTools,
      create: mocks.createServer,
      remove: mocks.removeServer,
    },
    mcpTools: {
      list: mocks.listCategories,
      toggle: mocks.toggleTool,
      toggleCategory: mocks.toggleCategory,
    },
  },
}));

vi.mock("../src/lib/opencode", () => ({
  opencode: {
    mcp: {
      status: mocks.mcpStatus,
      connect: mocks.mcpConnect,
      disconnect: mocks.mcpDisconnect,
    },
  },
}));

vi.mock("../src/lib/ProjectContext", () => ({
  useProject: () => "mcp-dashboard-project",
}));

import McpServerManager, {
  getSafeDiscoveryMessage,
  getSafeMcpErrorMessage,
} from "../src/app/mcp-servers/components/McpServerManager";

const server = {
  id: "server-id",
  project_id: "project-id",
  name: "calendar",
  executable: "npx",
  args: ["--yes", "@example/calendar"],
  scope: "project" as const,
  enabled: true,
  discovery_status: "ready" as const,
  discovery_diagnostic: null,
  last_discovered_at: "2026-07-27T12:00:00.000Z",
  created_at: "2026-07-27T11:00:00.000Z",
  updated_at: "2026-07-27T12:00:00.000Z",
  environment: { CALENDAR_TOKEN: { vault_item_id: "12345678-1234-1234-1234-123456789abc" } },
};

beforeEach(() => {
  mocks.listServers.mockResolvedValue({ data: [server], total: 1 });
  mocks.listDiscoveredTools.mockResolvedValue({ data: [{ server_id: server.id }], total: 1 });
  mocks.listCategories.mockResolvedValue({
    data: [{
      category: "Child MCP / calendar",
      enabled_count: 1,
      total_count: 1,
      tools: [{ tool_name: "ingenium_calendar_list_events", enabled: true }],
    }],
    total: 1,
  });
  mocks.mcpStatus.mockResolvedValue({ calendar: { status: "connected", tools: 2 } });
  mocks.createServer.mockResolvedValue({ data: server });
  mocks.removeServer.mockResolvedValue(undefined);
  mocks.toggleTool.mockResolvedValue({ data: { tool_name: "ingenium_calendar_list_events", enabled: false } });
  mocks.toggleCategory.mockResolvedValue({ data: { category: "Child MCP / calendar", enabled: false, tools_changed: 1 } });
  mocks.mcpConnect.mockResolvedValue({ accepted: true });
  mocks.mcpDisconnect.mockResolvedValue({ accepted: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MCP-004 dashboard", () => {
  it("renders canonical command, vault references, discovery health/count, and lifecycle controls", async () => {
    render(<McpServerManager />);

    expect(await screen.findByText("calendar")).toBeTruthy();
    expect(screen.getByText("npx --yes @example/calendar")).toBeTruthy();
    expect(screen.getByText("Healthy")).toBeTruthy();
    expect(screen.getByText("CALENDAR_TOKEN = 12345678…9abc")).toBeTruthy();
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
    expect(screen.getByText("Discovered tools")).toBeTruthy();
    expect(screen.getByText("Runtime tools")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(mocks.mcpDisconnect).toHaveBeenCalledWith("calendar"));
  });

  it("submits executable arguments and vault references using the canonical input shape", async () => {
    render(<McpServerManager />);

    fireEvent.change(screen.getByRole("textbox", { name: "Server name" }), { target: { value: "weather" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Command / executable" }), { target: { value: "node" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Arguments" }), { target: { value: "server.js\n--stdio" } });
    fireEvent.click(screen.getByRole("button", { name: "Add variable" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Environment key 1" }), { target: { value: "WEATHER_TOKEN" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Vault item ID 1" }), { target: { value: "00000000-0000-0000-0000-000000000001" } });
    fireEvent.click(screen.getByRole("button", { name: "Register server" }));

    await waitFor(() => expect(mocks.createServer).toHaveBeenCalledWith({
      name: "weather",
      executable: "node",
      args: ["server.js", "--stdio"],
      environment: { WEATHER_TOKEN: { vault_item_id: "00000000-0000-0000-0000-000000000001" } },
      scope: "project",
    }, "mcp-dashboard-project"));
  });

  it("uses dynamic categories and per-tool toggles without assuming a static catalog", async () => {
    render(<McpServerManager />);
    fireEvent.click(screen.getByRole("button", { name: /Tools/ }));

    expect(await screen.findByRole("heading", { name: "Child MCP / calendar" })).toBeTruthy();
    expect(screen.getByText("ingenium_calendar_list_events")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Disable ingenium_calendar_list_events" }));

    await waitFor(() => expect(mocks.toggleTool).toHaveBeenCalledWith(
      "ingenium_calendar_list_events",
      false,
      "mcp-dashboard-project",
    ));
  });

  it("forwards the server-qualified category when toggling a child MCP category", async () => {
    render(<McpServerManager />);
    fireEvent.click(screen.getByRole("button", { name: /Tools/ }));

    fireEvent.click(await screen.findByRole("button", { name: "Disable all" }));

    await waitFor(() => expect(mocks.toggleCategory).toHaveBeenCalledWith(
      "Child MCP / calendar",
      false,
      "mcp-dashboard-project",
    ));
  });

  it("never exposes raw diagnostics or error messages", () => {
    const secret = "token=child-mcp-secret";
    expect(getSafeDiscoveryMessage(secret)).toBeNull();
    expect(getSafeMcpErrorMessage({ status: 502, message: secret }, "connect")).toBe("Unable to connect to the MCP server.");
    expect(getSafeMcpErrorMessage(new Error(secret), "create")).toBe("Unable to register the child MCP server.");
    expect(getSafeDiscoveryMessage("unauthorized")).toBe("The child server could not authenticate. Check its vault references.");
  });
});
