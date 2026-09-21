import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const SERVER_SOURCE_PATH = fileURLToPath(new URL("../scripts/mcp-server.ts", import.meta.url));
const RETIRED_TRANSPORT_NAMES = [
  "coordination_status",
  "coordination_memory_read",
  "coordination_update",
  "coordination_claim",
  "coordination_release",
  "coordination_handoff",
] as const;

const connections: Array<{ client: Client; server: McpServer }> = [];

afterEach(async () => {
  await Promise.all(connections.splice(0).map(async ({ client, server }) => {
    await client.close();
    await server.close();
  }));
});

describe("retired coordination MCP tools", () => {
  it("does not expose coordination registrations or server adapters", () => {
    const source = readFileSync(SERVER_SOURCE_PATH, "utf8");
    const registered = [...source.matchAll(/server\.registerTool\(\s*"([^"]+)"/g)].map((match) => match[1]);

    expect(registered).not.toEqual(expect.arrayContaining(RETIRED_TRANSPORT_NAMES));
    expect(source).not.toContain("coordinationTools");
    expect(source).not.toContain("coordinationOwnershipToken");
    expect(source).not.toContain("getCoordinationSnapshot");
  });

  it("returns the MCP unknown-tool error for stale coordination callers", async () => {
    const server = new McpServer(
      { name: "coordination-retirement", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );
    const client = new Client({ name: "coordination-retirement-client", version: "1.0.0" });
    connections.push({ client, server });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server.registerTool(
      "retained_probe",
      { description: "Retained MCP fixture", inputSchema: { project: z.string() } },
      async () => ({ content: [{ type: "text", text: "retained" }] }),
    );

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    await expect(client.callTool({ name: "coordination_status", arguments: {} }))
      .resolves.toMatchObject({
        isError: true,
        content: [{ type: "text", text: "MCP error -32602: Tool coordination_status not found" }],
      });
  });
});
