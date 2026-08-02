import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChildMcpGateway,
  resolveChildMcpProjectIdentity,
  type ChildMcpDiscoveryReport,
  type ChildMcpGatewayApi,
  type ChildMcpRuntimeDefinitionResponse,
  type ChildMcpToolHost,
} from "../lib/child-mcp-gateway.js";
import type { ProjectStateAttestation } from "../lib/tool-state-gate.js";
import { ChildMcpRuntimeManager } from "../lib/proxy.js";

const fixture = new URL("./fixtures/child-mcp-server.mjs", import.meta.url).pathname;
const TEST_CHILD_MCP_STARTUP_TIMEOUT_MS = 3_000;
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

function createManager(): ChildMcpRuntimeManager {
  return new ChildMcpRuntimeManager({
    startupMs: TEST_CHILD_MCP_STARTUP_TIMEOUT_MS,
    requestMs: 250,
    shutdownMs: 750,
  });
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
  let attestation: ProjectStateAttestation = {
    project: "child-gateway-project",
    project_id: "child-gateway-project-id",
  };
  const reports: ChildMcpDiscoveryReport[] = [];
  const checkedTools: string[] = [];
  const api: ChildMcpGatewayApi = {
    async listRuntimeDefinitions() {
      return { definitions, unavailableCount: 0 };
    },
    async recordDiscovery(_project, _server, report) {
      reports.push(report);
      return true;
    },
    async toolEnabled(_project, toolName) {
      checkedTools.push(toolName);
      return { state: toolState, attestation };
    },
  };
  return {
    api,
    reports,
    checkedTools,
    setToolState: (next: typeof toolState) => { toolState = next; },
    setAttestation: (next: ProjectStateAttestation) => { attestation = next; },
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
    const manager = createManager();
    const gateway = new ChildMcpGateway(host, "child-gateway-project", api.api, manager);
    gateways.push(gateway);

    await gateway.start();

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

    const disabledGenerationHandler = tools.get(transportName)!.handler;
    api.setToolState("disabled");
    const disabled = await tools.get(transportName)!.handler({
      project: "child-gateway-project",
      arguments: { value: "must-not-forward" },
    });
    expect(disabled).toEqual({
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ error: { code: "TOOL_DISABLED", message: "This child MCP tool is disabled for the project." } }) }],
    });

    await gateway.refresh();
    expect(tools.has(transportName)).toBe(false);

    api.setToolState("enabled");
    await gateway.refresh();
    expect(tools.has(transportName)).toBe(true);
    await expect(tools.get(transportName)!.handler({
      project: "child-gateway-project",
      arguments: { value: "restored" },
    })).resolves.toMatchObject({ content: [{ type: "text", text: "restored" }] });
    await expect(disabledGenerationHandler({
      project: "child-gateway-project",
      arguments: { value: "must-not-forward-from-old-generation" },
    })).resolves.toEqual({
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ error: { code: "CHILD_MCP_UNAVAILABLE", message: "The child MCP server is unavailable." } }) }],
    });

    const wrongProject = await tools.get(transportName)!.handler({
      project: "other-project",
      arguments: { value: "must-not-forward" },
    });
    expect(wrongProject).toEqual({
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ error: { code: "PROJECT_IDENTITY_REQUIRED", message: "A valid explicit project identity is required for this child MCP tool." } }) }],
    });

    const staleHandler = tools.get(transportName)!.handler;
    definitions.splice(0);
    await gateway.refresh();
    expect(tools.has(transportName)).toBe(false);
    await expect(staleHandler({
      project: "child-gateway-project",
      arguments: { value: "must-not-forward-after-remove" },
    })).resolves.toEqual({
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ error: { code: "CHILD_MCP_UNAVAILABLE", message: "The child MCP server is unavailable." } }) }],
    });
    expect(host.sendToolListChanged).toHaveBeenCalledTimes(4);
  });

  it("fails closed for an unavailable toggle state and rejects invalid session identity", async () => {
    const { host, tools } = createHost();
    const api = createApi([runtimeDefinition()]);
    const manager = createManager();
    const gateway = new ChildMcpGateway(host, "child-gateway-project", api.api, manager);
    gateways.push(gateway);

    api.setToolState("enabled");
    await gateway.refresh();
    expect(tools.has("fixture_echo")).toBe(true);
    api.setToolState("unavailable");
    const unavailable = await tools.get("fixture_echo")!.handler({
      project: "child-gateway-project",
      arguments: { value: "must-not-forward" },
    });
    expect(unavailable).toEqual({
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ error: { code: "TOOL_STATE_UNAVAILABLE", message: "The child MCP tool state could not be verified." } }) }],
    });
    await gateway.refresh();
    expect(tools.has("fixture_echo")).toBe(false);

    expect(resolveChildMcpProjectIdentity(undefined)).toBeNull();
    expect(resolveChildMcpProjectIdentity("../unsafe")).toBeNull();
    expect(resolveChildMcpProjectIdentity("child-gateway-project")).toBe("child-gateway-project");
  });

  it("rejects a changed child-state attestation before a retained tool call can cross projects", async () => {
    const { host, tools } = createHost();
    const api = createApi([runtimeDefinition()]);
    const manager = createManager();
    const gateway = new ChildMcpGateway(host, "child-gateway-project", api.api, manager);
    gateways.push(gateway);

    await gateway.start();
    const retainedHandler = tools.get("fixture_echo")!.handler;
    api.setAttestation({
      project: "child-gateway-project",
      project_id: "other-project-id",
    });

    await expect(retainedHandler({
      project: "child-gateway-project",
      arguments: { value: "must-not-forward" },
    })).resolves.toEqual({
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ error: { code: "TOOL_STATE_UNAVAILABLE", message: "The child MCP tool state could not be verified." } }) }],
    });

    await gateway.refresh();
    expect(tools.has("fixture_echo")).toBe(false);
  });

  it("reconciles definitions added and removed after the parent transport starts without a restart", async () => {
    const definitions: ChildMcpRuntimeDefinitionResponse[] = [];
    const { host, tools } = createHost();
    const api = createApi(definitions);
    const manager = createManager();
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
