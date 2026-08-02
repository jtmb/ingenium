import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { resolve } from "node:path";
import { MCP_TOOL_CATALOG } from "../../packages/ingenium-core/lib/tools/mcp-tool-catalog";

const REPOSITORY_ROOT = resolve(__dirname, "../..");
const MCP_ENTRYPOINT = resolve(REPOSITORY_ROOT, "services/ingenium-server/scripts/mcp-server.ts");
const TSX = resolve(REPOSITORY_ROOT, "node_modules/.bin/tsx");
const PROJECT = "mcp-102-live-project";
const PROJECT_ID = "mcp-102-live-project-id";
const API_TOKEN = "mcp-102-fixture-token";
const TOOL_NAME = "ingenium_skill_list";
const TRANSPORT_TOOL_NAME = "skill_list";

interface ToolCallResult {
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
}

interface FixtureApi {
  origin: string;
  requests: string[];
  setToolEnabled(enabled: boolean): Promise<void>;
  close(): Promise<void>;
}

interface McpConnection {
  client: Client;
  close(): Promise<void>;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  const failures: unknown[] = [];
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop()!;
    try {
      await cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw failures[0];
});

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(payload)),
  });
  response.end(payload);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  return JSON.parse(body) as unknown;
}

async function within<T>(work: Promise<T>, label: string, timeoutMs = 10_000): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function authorized(request: IncomingMessage): boolean {
  return request.headers.authorization === `Bearer ${API_TOKEN}`;
}

async function startFixtureApi(): Promise<FixtureApi> {
  let enabled = true;
  const sockets = new Set<Socket>();
  const requests: string[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      if (!authorized(request)) {
        json(response, 401, { error: { code: "UNAUTHORIZED" } });
        return;
      }

      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      requests.push(`${request.method ?? "GET"} ${url.pathname}${url.search}`);
      const project = url.searchParams.get("project");
      if (project !== PROJECT) {
        json(response, 404, { error: { code: "PROJECT_NOT_FOUND" } });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/mcp-tools") {
        json(response, 200, {
          project: PROJECT,
          project_id: PROJECT_ID,
          data: [{
            category: "Fixture",
            tools: MCP_TOOL_CATALOG.map((tool) => ({
              tool_name: tool.name,
              enabled: tool.name === TOOL_NAME ? enabled : true,
            })),
          }],
        });
        return;
      }

      if (url.pathname === `/api/v1/mcp-tools/${TOOL_NAME}/state` && request.method === "GET") {
        json(response, 200, {
          project: PROJECT,
          project_id: PROJECT_ID,
          data: { tool_name: TOOL_NAME, enabled },
        });
        return;
      }

      if (url.pathname === `/api/v1/mcp-tools/${TOOL_NAME}` && request.method === "PUT") {
        const body = await readJsonBody(request);
        const toolState = body && typeof body === "object" && !Array.isArray(body)
          ? body as { enabled?: unknown }
          : undefined;
        if (typeof toolState?.enabled !== "boolean") {
          json(response, 422, { error: { code: "VALIDATION_ERROR" } });
          return;
        }
        enabled = toolState.enabled;
        json(response, 200, {
          project: PROJECT,
          project_id: PROJECT_ID,
          data: { tool_name: TOOL_NAME, enabled },
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/skills") {
        json(response, 200, { project: PROJECT, data: [] });
        return;
      }

      if (request.method === "GET" && url.pathname === "/_ingenium/child-mcp-runtime") {
        json(response, 200, { data: { definitions: [], unavailable: [] } });
        return;
      }

      json(response, 404, { error: { code: "NOT_FOUND" } });
    })().catch(() => {
      if (!response.writableEnded) json(response, 500, { error: { code: "FIXTURE_FAILURE" } });
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  await within(new Promise<void>((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListening);
  }), "MCP-102 fixture API startup");
  const address = server.address() as AddressInfo | null;
  if (!address || typeof address === "string") throw new Error("MCP-102 fixture API did not bind TCP");

  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    async setToolEnabled(nextEnabled: boolean): Promise<void> {
      const response = await within(fetch(
        `http://127.0.0.1:${address.port}/api/v1/mcp-tools/${TOOL_NAME}?project=${encodeURIComponent(PROJECT)}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${API_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ enabled: nextEnabled }),
        },
      ), `MCP-102 fixture state update (${String(nextEnabled)})`);
      expect(response.status).toBe(200);
    },
    async close(): Promise<void> {
      for (const socket of sockets) socket.destroy();
      await within(new Promise<void>((resolveClosed, reject) => {
        server.close((error) => error ? reject(error) : resolveClosed());
      }), "MCP-102 fixture API cleanup");
    },
  };
}

async function connectMcp(fixture: FixtureApi): Promise<McpConnection> {
  const transport = new StdioClientTransport({
    command: TSX,
    args: [MCP_ENTRYPOINT],
    cwd: REPOSITORY_ROOT,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? REPOSITORY_ROOT,
      INGENIUM_API_URL: `${fixture.origin}/api/v1`,
      INGENIUM_API_TOKEN: API_TOKEN,
      INGENIUM_API_TIMEOUT: "3000",
      INGENIUM_PROJECT: PROJECT,
      LOG_LEVEL: "error",
      NODE_ENV: "test",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "mcp-102-live-acceptance", version: "1.0.0" });
  await within(client.connect(transport), "MCP-102 stdio connection");
  return {
    client,
    close: () => within(client.close(), "MCP-102 stdio cleanup"),
  };
}

function toolNames(result: Awaited<ReturnType<Client["listTools"]>>): string[] {
  return result.tools.map((tool) => tool.name);
}

function errorCode(result: ToolCallResult): string | undefined {
  const text = result.content.find((part) => part.type === "text")?.text;
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as { error?: { code?: unknown } };
    return typeof parsed.error?.code === "string" ? parsed.error.code : undefined;
  } catch {
    return undefined;
  }
}

describe("MCP-102 provider-free live acceptance", () => {
  it("projects enabled state through a connected MCP transport, rejects retained disabled calls, and restores after reconnect", async () => {
    const fixture = await startFixtureApi();
    cleanups.push(() => fixture.close());

    const initialConnection = await connectMcp(fixture);
    cleanups.push(() => initialConnection.close());

    expect(toolNames(await initialConnection.client.listTools())).toContain(TRANSPORT_TOOL_NAME);

    await fixture.setToolEnabled(false);
    await initialConnection.close();
    cleanups.pop();
    const disabledConnection = await connectMcp(fixture);
    cleanups.push(() => disabledConnection.close());

    expect(toolNames(await disabledConnection.client.listTools())).not.toContain(TRANSPORT_TOOL_NAME);
    const disabled = await disabledConnection.client.callTool({
      name: TRANSPORT_TOOL_NAME,
      arguments: { project: PROJECT },
    }) as ToolCallResult;
    expect(disabled, fixture.requests.join("\n")).toMatchObject({ isError: true });
    expect(errorCode(disabled), JSON.stringify(disabled)).toBe("TOOL_DISABLED");

    await fixture.setToolEnabled(true);
    await disabledConnection.close();
    cleanups.pop();
    const restoredConnection = await connectMcp(fixture);
    cleanups.push(() => restoredConnection.close());

    expect(toolNames(await restoredConnection.client.listTools())).toContain(TRANSPORT_TOOL_NAME);
    await expect(restoredConnection.client.callTool({
      name: TRANSPORT_TOOL_NAME,
      arguments: { project: PROJECT },
    })).resolves.toMatchObject({ content: [{ type: "text", text: "[]" }] });
  }, 30_000);
});
