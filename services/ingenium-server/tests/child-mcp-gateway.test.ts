import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChildMcpGateway,
  resolveChildMcpProjectIdentity,
  type ChildMcpDiscoveryReport,
  type ChildMcpGatewayApi,
  type ChildMcpRuntimeDefinitionResponse,
  type ChildMcpToolHost,
} from "../lib/child-mcp-gateway.js";
import { ChildMcpRuntimeManager } from "../lib/proxy.js";

const fixture = new URL("./fixtures/child-mcp-server.mjs", import.meta.url).pathname;
const gateways: ChildMcpGateway[] = [];

interface RegisteredTool {
  handler: (args: Record<string, unknown>) => Promise<unknown>;
  remove: ReturnType<typeof vi.fn>;
}

function runtimeDefinition(): ChildMcpRuntimeDefinitionResponse {
  return {
    name: "fixture",
    executable: process.execPath,
    args: [fixture],
    environment: {},
    scope: "project",
    owned: true,
    revision: "2026-07-27T00:00:00.000Z",
  };
}

function createHost() {
  const tools = new Map<string, RegisteredTool>();
  const host: ChildMcpToolHost = {
    registerTool(name, _configuration, handler) {
      const remove = vi.fn(() => tools.delete(name));
      tools.set(name, { handler, remove });
      return { remove };
    },
    sendToolListChanged: vi.fn(async () => undefined),
  };
  return { host, tools };
}

function createApi(definitions: ChildMcpRuntimeDefinitionResponse[]) {
  let toolState: "enabled" | "disabled" | "unavailable" = "enabled";
  const reports: ChildMcpDiscoveryReport[] = [];
  const api: ChildMcpGatewayApi = {
    async listRuntimeDefinitions() {
      return { definitions, unavailableCount: 0 };
    },
    async recordDiscovery(_project, _server, report) {
      reports.push(report);
      return true;
    },
    async toolEnabled() {
      return toolState;
    },
  };
  return {
    api,
    reports,
    setToolState: (next: typeof toolState) => { toolState = next; },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_500): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) throw new Error("Timed out waiting for gateway reconciliation");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

afterEach(async () => {
  await Promise.all(gateways.splice(0).map((gateway) => gateway.shutdown()));
});

describe("ChildMcpGateway", () => {
  it("discovers, persists, dynamically registers, forwards, and removes canonical child tools", async () => {
    const definitions = [runtimeDefinition()];
    const { host, tools } = createHost();
    const api = createApi(definitions);
    const manager = new ChildMcpRuntimeManager({ startupMs: 750, requestMs: 250, shutdownMs: 750 });
    const gateway = new ChildMcpGateway(host, "child-gateway-project", api.api, manager);
    gateways.push(gateway);

    await gateway.start();

    // OpenCode prepends the configured `ingenium` server key to this local
    // registration, exposing exactly `ingenium_fixture_echo` to callers.
    const transportName = "fixture_echo";
    expect(tools.has(transportName)).toBe(true);
    expect(api.reports).toHaveLength(1);
    expect(api.reports[0]).toMatchObject({ status: "ready" });
    expect(api.reports[0]!.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "echo" }),
    ]));
    expect(host.sendToolListChanged).toHaveBeenCalledTimes(1);

    const forwarded = await tools.get(transportName)!.handler({
      project: "child-gateway-project",
      arguments: { value: "forwarded" },
    });
    expect(forwarded).toMatchObject({ content: [{ type: "text", text: "forwarded" }] });

    api.setToolState("disabled");
    const disabled = await tools.get(transportName)!.handler({
      project: "child-gateway-project",
      arguments: { value: "must-not-forward" },
    });
    expect(disabled).toEqual({
      content: [{ type: "text", text: JSON.stringify({ error: { code: "TOOL_DISABLED", message: "This child MCP tool is disabled for the project." } }) }],
    });

    const wrongProject = await tools.get(transportName)!.handler({
      project: "other-project",
      arguments: { value: "must-not-forward" },
    });
    expect(wrongProject).toEqual({
      content: [{ type: "text", text: JSON.stringify({ error: { code: "PROJECT_IDENTITY_REQUIRED", message: "A valid explicit project identity is required for this child MCP tool." } }) }],
    });

    definitions.splice(0);
    await gateway.refresh();
    expect(tools.has(transportName)).toBe(false);
    expect(host.sendToolListChanged).toHaveBeenCalledTimes(2);
  });

  it("fails closed for an unavailable toggle state and rejects invalid session identity", async () => {
    const { host, tools } = createHost();
    const api = createApi([runtimeDefinition()]);
    api.setToolState("unavailable");
    const manager = new ChildMcpRuntimeManager({ startupMs: 750, requestMs: 250, shutdownMs: 750 });
    const gateway = new ChildMcpGateway(host, "child-gateway-project", api.api, manager);
    gateways.push(gateway);

    await gateway.refresh();
    const unavailable = await tools.get("fixture_echo")!.handler({
      project: "child-gateway-project",
      arguments: { value: "must-not-forward" },
    });
    expect(unavailable).toEqual({
      content: [{ type: "text", text: JSON.stringify({ error: { code: "TOOL_STATE_UNAVAILABLE", message: "The child MCP tool state could not be verified." } }) }],
    });

    expect(resolveChildMcpProjectIdentity(undefined)).toBeNull();
    expect(resolveChildMcpProjectIdentity("../unsafe")).toBeNull();
    expect(resolveChildMcpProjectIdentity("child-gateway-project")).toBe("child-gateway-project");
  });

  it("reconciles definitions added and removed after the parent transport starts without a restart", async () => {
    const definitions: ChildMcpRuntimeDefinitionResponse[] = [];
    const { host, tools } = createHost();
    const api = createApi(definitions);
    const manager = new ChildMcpRuntimeManager({ startupMs: 750, requestMs: 250, shutdownMs: 750 });
    const gateway = new ChildMcpGateway(host, "child-gateway-project", api.api, manager, 50);
    gateways.push(gateway);

    await gateway.start();
    definitions.push(runtimeDefinition());
    await waitFor(() => tools.has("fixture_echo"));

    definitions.splice(0);
    await waitFor(() => !tools.has("fixture_echo"));
    await waitFor(() => host.sendToolListChanged!.mock.calls.length === 2);
    expect(host.sendToolListChanged).toHaveBeenCalledTimes(2);
  });
});
