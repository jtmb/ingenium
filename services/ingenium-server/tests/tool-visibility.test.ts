import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { McpToolVisibilityController } from "../lib/tool-visibility.js";

const servers: McpServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("McpToolVisibilityController", () => {
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
      { listToolStates: async () => state },
    );
    const registration = server.registerTool(
      "fixture_probe",
      { description: "Safe MCP visibility fixture", inputSchema: { project: z.string() } },
      async () => ({ content: [{ type: "text", text: "fixture-called" }] }),
    );
    controller.track("ingenium_fixture_probe", registration);

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
    await controller.start();
    expect(registration.enabled).toBe(false);
    await controller.stop();
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
          return snapshot;
        },
      },
    );
    const registration = server.registerTool(
      "fixture_probe",
      { description: "Safe MCP visibility fixture", inputSchema: { project: z.string() } },
      async () => ({ content: [{ type: "text", text: "fixture-called" }] }),
    );
    controller.track("ingenium_fixture_probe", registration);

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
