import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { installToolVisibilityProjection, McpToolVisibilityController } from "../lib/tool-visibility.js";
import { TOOL_STATE_GATE_CODES, toolStateError } from "../lib/tool-state-gate.js";

const servers: McpServer[] = [];

function authoritativeStates(project: string, states: ReadonlyMap<string, boolean>, projectId = `${project}-id`) {
  return { states, attestation: { project, project_id: projectId } };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("McpToolVisibilityController", () => {
  it("prepares persisted visibility before connection without notifying, then notifies after connection", async () => {
    const state = new Map<string, boolean>([["ingenium_fixture_probe", false]]);
    const server = new McpServer(
      { name: "visibility-preparation", version: "1.0.0" },
      { capabilities: { tools: { listChanged: true } } },
    );
    servers.push(server);
    const sendToolListChanged = vi.spyOn(server.server, "sendToolListChanged");
    const controller = new McpToolVisibilityController(
      server,
      "visibility-project",
      { listToolStates: async () => authoritativeStates("visibility-project", state) },
    );
    const registration = server.registerTool(
      "fixture_probe",
      { description: "Safe MCP visibility fixture", inputSchema: { project: z.string() } },
      async () => ({ content: [{ type: "text", text: "fixture-called" }] }),
    );
    controller.track("ingenium_fixture_probe", registration);
    installToolVisibilityProjection(server, controller);

    await expect(controller.prepare()).resolves.toBeUndefined();
    expect(controller.isVisible("ingenium_fixture_probe")).toBe(false);
    expect(sendToolListChanged).not.toHaveBeenCalled();

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "visibility-preparation-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await controller.start();
    expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain("fixture_probe");

    state.set("ingenium_fixture_probe", true);
    await controller.refresh();
    expect(sendToolListChanged).toHaveBeenCalledTimes(1);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("fixture_probe");

    await controller.stop();
    await client.close();
  });

  it("removes disabled built-ins from tools/list, fails direct calls closed, and restores them", async () => {
    const state = new Map<string, boolean>([["ingenium_fixture_probe", true]]);
    const server = new McpServer(
      { name: "visibility-fixture", version: "1.0.0" },
      { capabilities: { tools: { listChanged: true } } },
    );
    servers.push(server);
    const controller = new McpToolVisibilityController(
      server,
      "visibility-project",
      { listToolStates: async () => authoritativeStates("visibility-project", state) },
    );
    const registration = server.registerTool(
      "fixture_probe",
      { description: "Safe MCP visibility fixture", inputSchema: { project: z.string() } },
      async () => state.get("ingenium_fixture_probe")
        ? ({ content: [{ type: "text", text: "fixture-called" }] })
        : toolStateError(TOOL_STATE_GATE_CODES.disabled, "This tool is disabled for the project."),
    );
    controller.track("ingenium_fixture_probe", registration);
    installToolVisibilityProjection(server, controller);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "visibility-test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await controller.start();

    await expect(client.listTools()).resolves.toMatchObject({ tools: [expect.objectContaining({ name: "fixture_probe" })] });

    state.set("ingenium_fixture_probe", false);
    await controller.refresh();
    const hidden = await client.listTools();
    expect(hidden.tools.map((tool) => tool.name)).not.toContain("fixture_probe");
    await expect(client.callTool({ name: "fixture_probe", arguments: { project: "visibility-project" } })).resolves.toMatchObject({
      isError: true,
      content: [{ type: "text", text: expect.stringContaining("disabled") }],
    });

    state.set("ingenium_fixture_probe", true);
    await controller.refresh();
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("fixture_probe");
    await expect(client.callTool({ name: "fixture_probe", arguments: { project: "visibility-project" } })).resolves.toMatchObject({
      content: [{ type: "text", text: "fixture-called" }],
    });

    await controller.stop();
    await client.close();
  });

  it("fails closed when the project identity or API state is unavailable", async () => {
    const server = new McpServer(
      { name: "visibility-fail-closed", version: "1.0.0" },
      { capabilities: { tools: { listChanged: true } } },
    );
    servers.push(server);
    const controller = new McpToolVisibilityController(
      server,
      null,
      { listToolStates: async () => { throw new Error("unavailable"); } },
    );
    const registration = server.registerTool(
      "fixture_probe",
      { description: "Safe MCP visibility fixture", inputSchema: { project: z.string() } },
      async () => ({ content: [{ type: "text", text: "must-not-run" }] }),
    );
    controller.track("ingenium_fixture_probe", registration);
    installToolVisibilityProjection(server, controller);
    await controller.start();
    expect(controller.isVisible("ingenium_fixture_probe")).toBe(false);
    await controller.stop();
  });

  it("emits one effective tools/list_changed notification for a multi-tool refresh", async () => {
    let enabled = true;
    const server = new McpServer(
      { name: "visibility-multi-refresh", version: "1.0.0" },
      { capabilities: { tools: { listChanged: true } } },
    );
    servers.push(server);
    const host = { sendToolListChanged: vi.fn(async () => undefined) };
    const controller = new McpToolVisibilityController(
      host,
      "visibility-project",
      { listToolStates: async () => authoritativeStates("visibility-project", new Map([
        ["ingenium_fixture_one", enabled],
        ["ingenium_fixture_two", enabled],
      ])) },
    );
    const one = server.registerTool(
      "fixture_one",
      { description: "First fixture", inputSchema: { project: z.string() } },
      async () => ({ content: [{ type: "text", text: "one" }] }),
    );
    const two = server.registerTool(
      "fixture_two",
      { description: "Second fixture", inputSchema: { project: z.string() } },
      async () => ({ content: [{ type: "text", text: "two" }] }),
    );
    controller.track("ingenium_fixture_one", one);
    controller.track("ingenium_fixture_two", two);
    installToolVisibilityProjection(server, controller);

    await controller.refresh();

    expect(controller.isVisible("ingenium_fixture_one")).toBe(true);
    expect(controller.isVisible("ingenium_fixture_two")).toBe(true);
    expect(host.sendToolListChanged).toHaveBeenCalledTimes(1);

    enabled = false;
    await controller.refresh();
    expect(controller.isVisible("ingenium_fixture_one")).toBe(false);
    expect(controller.isVisible("ingenium_fixture_two")).toBe(false);
    expect(host.sendToolListChanged).toHaveBeenCalledTimes(2);

    await controller.refresh();
    expect(host.sendToolListChanged).toHaveBeenCalledTimes(2);
    await controller.stop();
  });

  it("re-enables a toggled built-in once and rejects changed state attestations", async () => {
    const project = "attested-visibility-project";
    const state = new Map<string, boolean>([["ingenium_fixture_probe", false]]);
    let responseProject = project;
    let responseProjectId = "visibility-project-id";
    const server = new McpServer(
      { name: "visibility-attestation", version: "1.0.0" },
      { capabilities: { tools: { listChanged: true } } },
    );
    servers.push(server);
    const host = { sendToolListChanged: vi.fn(async () => undefined) };
    const controller = new McpToolVisibilityController(
      host,
      project,
      {
        listToolStates: async () => authoritativeStates(
          responseProject,
          state,
          responseProjectId,
        ),
      },
    );
    const registration = server.registerTool(
      "fixture_probe",
      { description: "Attested fixture", inputSchema: { project: z.string() } },
      async () => ({ content: [{ type: "text", text: "fixture-called" }] }),
    );
    controller.track("ingenium_fixture_probe", registration);
    installToolVisibilityProjection(server, controller);

    await controller.refresh();
    expect(controller.isVisible("ingenium_fixture_probe")).toBe(false);
    expect(host.sendToolListChanged).not.toHaveBeenCalled();

    state.set("ingenium_fixture_probe", true);
    await controller.refresh();
    await controller.refresh();
    expect(controller.isVisible("ingenium_fixture_probe")).toBe(true);
    expect(host.sendToolListChanged).toHaveBeenCalledTimes(1);

    responseProjectId = "changed-visibility-project-id";
    await controller.refresh();
    expect(controller.isVisible("ingenium_fixture_probe")).toBe(false);
    expect(host.sendToolListChanged).toHaveBeenCalledTimes(2);

    responseProject = "other-project";
    await controller.refresh();
    expect(host.sendToolListChanged).toHaveBeenCalledTimes(2);
    await controller.stop();
  });

  it("hides a disabled context upload and rejects a direct retained call", async () => {
    const state = new Map<string, boolean>([["ingenium_context_upload_file", false]]);
    const server = new McpServer(
      { name: "context-upload-visibility", version: "1.0.0" },
      { capabilities: { tools: { listChanged: true } } },
    );
    servers.push(server);
    const controller = new McpToolVisibilityController(
      server,
      "context-upload-project",
      { listToolStates: async () => authoritativeStates("context-upload-project", state) },
    );
    const registration = server.registerTool(
      "context_upload_file",
      { description: "Context upload fixture", inputSchema: { project: z.string() } },
      async () => toolStateError(TOOL_STATE_GATE_CODES.disabled, "This tool is disabled for the project."),
    );
    controller.track("ingenium_context_upload_file", registration);
    installToolVisibilityProjection(server, controller);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "context-upload-visibility-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await controller.start();

    expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain("context_upload_file");
    await expect(client.callTool({
      name: "context_upload_file",
      arguments: { project: "context-upload-project" },
    })).resolves.toMatchObject({ isError: true });

    await controller.stop();
    await client.close();
  });

  it("completes an overlapping refresh against the latest API state", async () => {
    const state = new Map<string, boolean>([["ingenium_fixture_probe", true]]);
    let firstRequest = true;
    let releaseFirstRequest!: () => void;
    let firstRequestStarted!: () => void;
    const firstRequestGate = new Promise<void>((resolve) => { releaseFirstRequest = resolve; });
    const firstRequestStartedSignal = new Promise<void>((resolve) => { firstRequestStarted = resolve; });
    const server = new McpServer(
      { name: "visibility-refresh-race", version: "1.0.0" },
      { capabilities: { tools: { listChanged: true } } },
    );
    servers.push(server);
    const controller = new McpToolVisibilityController(
      server,
      "visibility-project",
      {
        listToolStates: async () => {
          const snapshot = new Map(state);
          if (firstRequest) {
            firstRequest = false;
            firstRequestStarted();
            await firstRequestGate;
          }
          return authoritativeStates("visibility-project", snapshot);
        },
      },
    );
    const registration = server.registerTool(
      "fixture_probe",
      { description: "Safe MCP visibility fixture", inputSchema: { project: z.string() } },
      async () => ({ content: [{ type: "text", text: "fixture-called" }] }),
    );
    controller.track("ingenium_fixture_probe", registration);
    installToolVisibilityProjection(server, controller);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "visibility-race-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const starting = controller.start();
    await firstRequestStartedSignal;
    state.set("ingenium_fixture_probe", false);
    const refreshing = controller.refresh();
    releaseFirstRequest();
    await Promise.all([starting, refreshing]);

    expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain("fixture_probe");

    await controller.stop();
    await client.close();
  });
});
