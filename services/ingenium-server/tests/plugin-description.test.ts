import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { api } from "../lib/client.js";
import { pluginUpdate, pluginUpdateInputSchema } from "../lib/tools/plugins.js";
import { MCP_TOOL_CATALOG } from "../../../packages/ingenium-core/lib/tools/mcp-tool-catalog.js";
import { policyForRequest } from "../../ingenium-api/lib/authorization-policy.js";

vi.mock("../lib/client.js", () => ({ api: { put: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());

it("forwards only the description and exact project through the API", async () => {
  vi.mocked(api.put).mockResolvedValue({ data: { description: "Local notes" } });
  await pluginUpdate("ingenium", "plugin/name", { description: "Local notes" });
  expect(api.put).toHaveBeenCalledOnce();
  expect(api.put).toHaveBeenCalledWith("/plugins/plugin%2Fname", { description: "Local notes" }, { project: "ingenium" });
});

it("rejects invalid, mixed and unknown arguments before the API boundary", async () => {
  for (const updates of [{}, { description: null }, { description: 1 }, { description: "x".repeat(2001) }, { description: "bad\0text" },
    ...["file_path", "source_content", "enabled", "order"].map((field) => ({ description: "notes", [field]: "changed" }))]) {
    await expect(pluginUpdate("ingenium", "fixture", updates as never)).rejects.toThrow();
  }
  expect(api.put).not.toHaveBeenCalled();
  expect(pluginUpdateInputSchema.safeParse({ project: "ingenium", name: "fixture", description: "" }).success).toBe(true);
  expect(pluginUpdateInputSchema.safeParse({ project: "ingenium", name: "fixture", description: "x".repeat(2000) }).success).toBe(true);
});

it("advertises description and rejects mixed/unknown fields through the actual SDK registration", async () => {
  const source = readFileSync(new URL("../scripts/mcp-server.ts", import.meta.url), "utf8");
  const start = source.lastIndexOf("server.registerTool(", source.indexOf('  "plugin_update",'));
  const end = source.indexOf("server.registerTool(", start + 1);
  const server = new McpServer({ name: "plugin-description-test", version: "1" });
  const client = new Client({ name: "plugin-description-test", version: "1" });
  runInNewContext(source.slice(start, end), {
    server, pluginTools: { pluginUpdate, pluginUpdateInputSchema }, C: (name: string) => name,
    wrapHandler: (_name: string, handler: unknown) => handler,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const tool = (await client.listTools()).tools[0];
    expect(tool.inputSchema.properties).toHaveProperty("description");
    expect(tool.inputSchema.additionalProperties).toBe(false);
    for (const field of ["file_path", "source_content", "enabled", "order"]) {
      const result = await client.callTool({ name: "plugin_update", arguments: { project: "ingenium", name: "fixture", description: "notes", [field]: "changed" } });
      expect(result.isError).toBe(true);
    }
    expect(api.put).not.toHaveBeenCalled();
    vi.mocked(api.put).mockResolvedValue({ data: { description: "notes" } });
    const result = await client.callTool({ name: "plugin_update", arguments: { project: "ingenium", name: "fixture", description: "notes" } });
    expect(result.isError).not.toBe(true);
    expect(api.put).toHaveBeenCalledOnce();
  } finally {
    await client.close();
    await server.close();
  }
});

it("registers the strict schema under the existing project-scoped write policy and catalog entry", () => {
  const source = readFileSync(new URL("../scripts/mcp-server.ts", import.meta.url), "utf8");
  expect(source.slice(source.indexOf('  "plugin_update",'), source.indexOf('  "plugin_source",'))).toContain("inputSchema: pluginTools.pluginUpdateInputSchema");
  const tool = MCP_TOOL_CATALOG.find((entry) => entry.name === "ingenium_plugin_update")!;
  expect(tool.description).toContain("description alone");
  expect(tool.authorization).toMatchObject({ target: "project", permission: "write" });
  expect(policyForRequest({ method: "PUT", path: "/api/v1/plugins/fixture" })).toMatchObject({ target: "project", permission: "write", resource: "plugins" });
});
