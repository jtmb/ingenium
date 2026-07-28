import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpToolVisibilityController } from "../lib/tool-visibility.js";

const mockApi = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
};

vi.mock("../lib/client.js", () => ({ api: mockApi }));

const contextTools = await import("../lib/tools/context.js");
const servers: McpServer[] = [];

const project = "context-import-project";
const sessionId = "session-import-001";
const directory = "/workspaces/context-import-project";

function apiSuccess(data: unknown = { ok: true }) {
  return { ok: true, status: 200, data };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  vi.clearAllMocks();
});

describe("OpenCode session import MCP tool", () => {
  it("proxies the exact authenticated API import endpoint and preserves its response", async () => {
    mockApi.post.mockResolvedValue(apiSuccess({ upload: { provenance: "opencode_session" } }));

    const result = await contextTools.contextOpenCodeSessionImport(
      project,
      sessionId,
      directory,
      "Imported OpenCode session",
      25,
    );

    expect(mockApi.post).toHaveBeenCalledWith(
      "/context/imports/opencode-session",
      {
        sessionId,
        directory,
        title: "Imported OpenCode session",
        limit: 25,
      },
      { project },
    );
    expect(JSON.parse(result.content[0].text)).toEqual({ upload: { provenance: "opencode_session" } });
  });

  it("omits an unspecified limit so the API applies its bounded default", async () => {
    mockApi.post.mockResolvedValue(apiSuccess({ upload: { provenance: "opencode_session" } }));

    await contextTools.contextOpenCodeSessionImport(
      project,
      sessionId,
      directory,
      "Imported OpenCode session",
    );

    expect(mockApi.post).toHaveBeenCalledWith(
      "/context/imports/opencode-session",
      {
        sessionId,
        directory,
        title: "Imported OpenCode session",
      },
      { project },
    );
  });

  it("accepts only a launcher-bound project, safe session import inputs, and an optional bounded integer limit", () => {
    const schema = contextTools.createOpenCodeSessionImportInputSchema(project);
    const valid = schema.safeParse({
      project,
      sessionId,
      directory,
      title: "  Imported OpenCode session  ",
      limit: 100,
    });
    expect(valid.success).toBe(true);
    if (valid.success) expect(valid.data.title).toBe("Imported OpenCode session");

    const defaultLimit = schema.safeParse({ project, sessionId, directory });
    expect(defaultLimit.success).toBe(true);
    if (defaultLimit.success) expect(defaultLimit.data.limit).toBeUndefined();

    for (const unsafeDirectory of [
      "relative/context-import-project",
      "/workspaces/./context-import-project",
      "/workspaces/../context-import-project",
      "/workspaces/context\u0000-import-project",
      "C:\\workspaces\\..\\context-import-project",
    ]) {
      expect(schema.safeParse({ project, sessionId, directory: unsafeDirectory, limit: 1 }).success).toBe(false);
    }
    expect(schema.safeParse({ project: "another-project", sessionId, directory, limit: 1 }).success).toBe(false);
    expect(schema.safeParse({ project, sessionId: "../unsafe", directory, limit: 1 }).success).toBe(false);
    expect(schema.safeParse({ project, sessionId, directory, limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ project, sessionId, directory, limit: 101 }).success).toBe(false);
    expect(schema.safeParse({ project, sessionId, directory, limit: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ project, sessionId, directory, title: "   ", limit: 1 }).success).toBe(false);
    expect(contextTools.createOpenCodeSessionImportInputSchema(null)
      .safeParse({ project, sessionId, directory, limit: 1 }).success).toBe(false);
  });

  it("registers the unprefixed transport name with canonical visibility state and launcher binding", () => {
    const registration = mcpSource.slice(
      mcpSource.indexOf('"context_opencode_session_import"'),
      mcpSource.indexOf("// Immutable conversation context"),
    );

    expect(registration).toContain("inputSchema: openCodeSessionImportInputSchema.shape");
    expect(registration).toContain('C("context_opencode_session_import")');
    expect(registration).toContain("contextTools.contextOpenCodeSessionImport");
    expect(registration).toContain("{ requiredProject: launcherProject }");
    expect(mcpSource).toContain('const C = (name: string) => `ingenium_${name}`;');
  });

  it("hides the canonical tool and rejects a direct call while disabled", async () => {
    const state = new Map<string, boolean>([["ingenium_context_opencode_session_import", false]]);
    const server = new McpServer(
      { name: "context-import-visibility", version: "1.0.0" },
      { capabilities: { tools: { listChanged: true } } },
    );
    servers.push(server);
    const controller = new McpToolVisibilityController(
      server,
      project,
      { listToolStates: async () => state },
    );
    const handler = vi.fn(async () => ({ content: [{ type: "text" as const, text: "must-not-import" }] }));
    const registration = server.registerTool(
      "context_opencode_session_import",
      {
        description: "OpenCode session import visibility fixture",
        inputSchema: contextTools.createOpenCodeSessionImportInputSchema(project).shape,
      },
      handler,
    );
    controller.track("ingenium_context_opencode_session_import", registration);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "context-import-visibility-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await controller.start();

    expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain("context_opencode_session_import");
    await expect(client.callTool({
      name: "context_opencode_session_import",
      arguments: { project, sessionId, directory, limit: 1 },
    })).resolves.toMatchObject({
      isError: true,
      content: [{ type: "text", text: expect.stringContaining("disabled") }],
    });
    expect(handler).not.toHaveBeenCalled();

    await controller.stop();
    await client.close();
  });
});

let mcpSource = "";

beforeAll(async () => {
  const { readFileSync } = await import("node:fs");
  const filePath = new URL("../scripts/mcp-server.ts", import.meta.url).pathname;
  mcpSource = readFileSync(filePath, "utf-8");
});
