import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const mocks = vi.hoisted(() => ({
  listServers: vi.fn(),
  listDiscoveredTools: vi.fn(),
  createServer: vi.fn(),
  removeServer: vi.fn(),
  listCategories: vi.fn(),
  report: vi.fn(),
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
      report: mocks.report,
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
  getSafeMcpReportErrorMessage,
  hasMcpToolAuthorityConflict,
  hasMcpToolProjectMismatch,
  isExtensionPluginTool,
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

function reportResponse(overrides: Record<string, unknown> = {}) {
  return {
    project: "mcp-dashboard-project",
    project_id: "project-id",
    total: 1,
    data: {
      schemaVersion: 1 as const,
      provenance: "live" as const,
      generatedAt: "2026-07-31T12:00:00.000Z",
      freshness: { status: "fresh" as const, observedAt: "2026-07-31T11:59:30.000Z", durationMs: 30_000 },
      catalog: { status: "conformant" as const, issues: [] },
      tools: [{
        name: "ingenium_calendar_list_events",
        category: "Child MCP / calendar",
        enabled: true,
        boundary: "mcp-stdio" as const,
        visibility: { status: "reachable" as const, reason: null },
        invocation: { status: "not-run" as const, reason: "unsafe-invocation" as const },
      }],
    },
    ...overrides,
  };
}

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
    project: "mcp-dashboard-project",
    project_id: "project-id",
  });
  mocks.report.mockResolvedValue(reportResponse());
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

  it("loads the project-scoped report only when Tools opens, then renders live per-tool report fields", async () => {
    let resolveReport: ((value: ReturnType<typeof reportResponse>) => void) | undefined;
    mocks.report.mockImplementationOnce(() => new Promise((resolve) => { resolveReport = resolve; }));

    render(<McpServerManager />);
    expect(mocks.report).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Tools/ }));
    expect(await screen.findByText("Loading MCP report…")).toBeTruthy();
    expect(mocks.report).toHaveBeenCalledWith("mcp-dashboard-project");

    resolveReport?.(reportResponse());
    expect((await screen.findByTestId("mcp-report-summary")).textContent).toContain("Live");
    expect(screen.getByTestId("mcp-report-summary").textContent).toContain("Fresh");
    expect(screen.getByTestId("mcp-report-summary").textContent).toContain("Conformant · 0 issues");
    expect(screen.getByTestId("mcp-report-tool-ingenium_calendar_list_events").textContent).toContain("Category: Child MCP / calendar");
    expect(screen.getByTestId("mcp-report-tool-ingenium_calendar_list_events").textContent).toContain("State: Enabled");
    expect(screen.getByTestId("mcp-report-tool-ingenium_calendar_list_events").textContent).toContain("Boundary: MCP stdio");
    expect(screen.getByTestId("mcp-report-tool-ingenium_calendar_list_events").textContent).toContain("Visibility: Reachable — No reason reported");
    expect(screen.getByTestId("mcp-report-tool-ingenium_calendar_list_events").textContent).toContain("Invocation: Not run — Not run safely");
  });

  it("uses stale and unknown wording without inventing report certainty", async () => {
    mocks.report.mockResolvedValueOnce(reportResponse({
      data: {
        ...reportResponse().data,
        freshness: { status: "stale", observedAt: "2026-07-31T11:00:00.000Z", durationMs: 30_000 },
        catalog: { status: "unknown", issues: [] },
        tools: [{
          ...reportResponse().data.tools[0],
          visibility: { status: "unknown", reason: "not-requested" },
          invocation: { status: "unknown", reason: "invalid-response" },
          prompt: "never render this prompt",
          result: "never render this result",
        }],
      },
    }));

    render(<McpServerManager />);
    fireEvent.click(screen.getByRole("button", { name: /Tools/ }));

    expect((await screen.findByTestId("mcp-report-summary")).textContent).toContain("Stale");
    expect(screen.getByTestId("mcp-report-summary").textContent).toContain("Unknown");
    expect(screen.getByTestId("mcp-report-tool-ingenium_calendar_list_events").textContent).toContain("Visibility: Unknown — Not requested");
    expect(screen.getByTestId("mcp-report-tool-ingenium_calendar_list_events").textContent).toContain("Invocation: Unknown — Invalid response");
    expect(screen.queryByText("never render this prompt")).toBeNull();
    expect(screen.queryByText("never render this result")).toBeNull();
  });

  it("renders an empty report and keeps the existing tool filters functional", async () => {
    mocks.report.mockResolvedValueOnce(reportResponse({ data: { ...reportResponse().data, tools: [] }, total: 0 }));

    render(<McpServerManager />);
    fireEvent.click(screen.getByRole("button", { name: /Tools/ }));

    expect(await screen.findByTestId("mcp-report-empty")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Search tools" }), { target: { value: "absent" } });
    expect(screen.getByText("No tools match the current filters.")).toBeTruthy();
  });

  it("uses fixed report errors and retries without exposing raw error content", async () => {
    const secret = "Bearer report-secret https://private.invalid/payload";
    mocks.report
      .mockRejectedValueOnce({ status: 503, message: secret, prompt: secret, result: secret })
      .mockResolvedValueOnce(reportResponse());

    render(<McpServerManager />);
    fireEvent.click(screen.getByRole("button", { name: /Tools/ }));

    expect((await screen.findByTestId("mcp-report-error")).textContent).toBe("The MCP report is temporarily unavailable.");
    expect(screen.queryByText(secret)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry report" }));
    await waitFor(() => expect(mocks.report).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId("mcp-report-summary")).toBeTruthy();
    expect(getSafeMcpReportErrorMessage({ status: 413 })).toBe("The MCP report is too large to display.");
    expect(getSafeMcpReportErrorMessage({ status: 422 })).toBe("The MCP report request was rejected.");
    expect(getSafeMcpReportErrorMessage(new Error(secret))).toBe("Unable to refresh the MCP report.");
  });

  it("disables tool controls when report project authority conflicts with catalog state", async () => {
    mocks.report.mockResolvedValueOnce(reportResponse({ project_id: "different-project-id" }));

    render(<McpServerManager />);
    fireEvent.click(screen.getByRole("button", { name: /Tools/ }));

    expect((await screen.findByRole("alert")).textContent).toContain("disagree on project identity");
    expect((screen.getByRole("switch", { name: "Disable ingenium_calendar_list_events" }) as HTMLButtonElement).disabled).toBe(true);
    expect(hasMcpToolAuthorityConflict(
      { project: "mcp-dashboard-project", projectId: "project-id" },
      { project: "mcp-dashboard-project", projectId: "different-project-id" },
    )).toBe(true);
  });

  it("warns and disables tool controls when the API verifies a different project", async () => {
    mocks.listCategories.mockResolvedValueOnce({
      data: [{
        category: "Synthesis",
        enabled_count: 1,
        total_count: 1,
        tools: [{ tool_name: "synthesize_observations", enabled: true }],
      }],
      total: 1,
      project: "authoritative-project",
    });

    render(<McpServerManager />);
    fireEvent.click(screen.getByRole("button", { name: /Tools/ }));

    expect((await screen.findByRole("alert")).textContent).toContain("authoritative-project");
    expect((screen.getByRole("switch", { name: "Disable synthesize_observations" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Disable all" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("switch", { name: "Disable synthesize_observations" }));
    expect(mocks.toggleTool).not.toHaveBeenCalled();
  });

  it("labels extension plugin tools as statically visible and execution-gated", async () => {
    mocks.listCategories.mockResolvedValueOnce({
      data: [{
        category: "Extraction",
        enabled_count: 1,
        total_count: 1,
        tools: [{ tool_name: "auto_observe_now", enabled: true }],
      }],
      total: 1,
    });
    mocks.report.mockResolvedValueOnce(reportResponse({
      data: {
        ...reportResponse().data,
        tools: [{
          name: "auto_observe_now",
          category: "Extraction",
          enabled: true,
          boundary: "opencode-extension",
          visibility: { status: "not-applicable", reason: "not-requested" },
          invocation: { status: "not-run", reason: "not-requested" },
        }],
      },
    }));

    render(<McpServerManager />);
    fireEvent.click(screen.getByRole("button", { name: /Tools/ }));

    expect((await screen.findByTestId("extension-tool-label-auto_observe_now")).textContent).toContain(
      "Extension plugin · static visibility / execution-gated",
    );
    expect(screen.getByTestId("mcp-report-tool-auto_observe_now").textContent).toContain("Boundary: OpenCode extension");
    expect(screen.getByTestId("mcp-report-tool-auto_observe_now").textContent).toContain("Visibility: Not applicable — Not requested");
    expect(isExtensionPluginTool("auto_observe_now")).toBe(true);
    expect(isExtensionPluginTool("ingenium_task_list")).toBe(false);
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

  it("only reports a project mismatch when the state API supplies an authoritative project", () => {
    expect(hasMcpToolProjectMismatch("mcp-dashboard-project", null)).toBe(false);
    expect(hasMcpToolProjectMismatch("mcp-dashboard-project", "mcp-dashboard-project")).toBe(false);
    expect(hasMcpToolProjectMismatch("mcp-dashboard-project", "other-project")).toBe(true);
  });
});
