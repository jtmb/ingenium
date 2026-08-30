import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MCP_TOOL_CATALOG } from "../../packages/ingenium-core/lib/tools/mcp-tool-catalog";

const REPOSITORY_ROOT = resolve(__dirname, "../..");
const MCP_ENTRYPOINT = resolve(REPOSITORY_ROOT, "services/ingenium-server/scripts/mcp-server.ts");
const CHILD_MCP_ENTRYPOINT = resolve(REPOSITORY_ROOT, "services/ingenium-server/tests/fixtures/child-mcp-server.mjs");
const TSX = resolve(REPOSITORY_ROOT, "node_modules/.bin/tsx");
const PROJECT = "mcp-102-live-project";
const PROJECT_ID = "mcp-102-live-project-id";
const ORGANIZATION_ID = "mcp-102-live-organization-id";
const WORKSPACE_ID = "mcp-102-live-workspace";
const SCOPED_CREDENTIAL = "mcp_102_fixture_credential_0123456789abcdef";
const RUNTIME_CREDENTIAL = "mcp_102_runtime_credential_0123456789abcdef";
const TOOL_NAME = "ingenium_skill_list";
const TRANSPORT_TOOL_NAME = "skill_list";
const EXTENSION_TOOL_NAMES = ["auto_observe_now", "synthesize_observations"] as const;

interface ToolCallResult {
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
}

interface FixtureApi {
  origin: string;
  requests: string[];
  setToolEnabled(toolName: string, enabled: boolean): void;
  setPolicyValid(toolName: string, valid: boolean): void;
  setProjectIdTampered(tampered: boolean): void;
  setSkillListStatus(status: number): void;
  setChildEnabled(enabled: boolean): void;
  close(): Promise<void>;
}

interface McpConnection {
  client: Client;
  close(): Promise<void>;
}

const cleanups: Array<() => Promise<void>> = [];
const catalogByName = new Map(MCP_TOOL_CATALOG.map((tool) => [tool.name, tool]));

afterEach(async () => {
  const failures: unknown[] = [];
  while (cleanups.length > 0) {
    try {
      await cleanups.pop()!();
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

async function waitFor<T>(probe: () => Promise<T | undefined>, label: string, timeoutMs = 8_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result !== undefined) return result;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms`);
}

function authorized(request: IncomingMessage): boolean {
  const audience = request.headers["x-ingenium-audience"];
  const expectedCredential = audience === "runtime" ? RUNTIME_CREDENTIAL : SCOPED_CREDENTIAL;
  return request.headers.authorization === `Bearer ${expectedCredential}`
    && (audience === "mcp" || audience === "runtime")
    && request.headers["x-ingenium-workspace"] === WORKSPACE_ID
    && request.headers["x-ingenium-launcher-worktree"] === REPOSITORY_ROOT
    && request.headers["x-ingenium-internal-service"] === undefined;
}

function categorizedToolStates(enabled: ReadonlyMap<string, boolean>) {
  return [...Map.groupBy(MCP_TOOL_CATALOG, (tool) => tool.category)].map(([category, tools]) => ({
    category,
    tools: tools.map((tool) => ({ tool_name: tool.name, enabled: enabled.get(tool.name) ?? true })),
  }));
}

function childPolicy() {
  return {
    action: "child-mcp.execute",
    resource: "child-mcp",
    permission: "execute",
    target: "project",
    scopes: ["child-mcp:execute"],
    launcherBinding: "required",
  };
}

async function startFixtureApi(): Promise<FixtureApi> {
  const enabled = new Map<string, boolean>();
  const invalidPolicies = new Set<string>();
  const sockets = new Set<Socket>();
  const requests: string[] = [];
  let tamperedProjectId = false;
  let skillListStatus = 200;
  let childEnabled = false;

  const server = createServer((request, response) => {
    void (async () => {
      if (!authorized(request)) {
        json(response, 401, { error: { code: "UNAUTHORIZED" } });
        return;
      }

      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      requests.push(`${request.method ?? "GET"} ${url.pathname}${url.search}`);

      if (request.method === "GET" && url.pathname === "/api/v1/auth/preflight") {
        json(response, 200, { data: {
          scopes: ["*", "child-mcp:execute"],
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          projectIds: [PROJECT_ID],
          audience: "mcp",
          workspaceId: WORKSPACE_ID,
          launcherWorktree: REPOSITORY_ROOT,
          restartRequiredOnCredentialChange: true,
        } });
        return;
      }

      const project = url.searchParams.get("project");
      if (project !== PROJECT) {
        json(response, 404, { error: { code: "PROJECT_NOT_FOUND", message: "The project was not found." } });
        return;
      }
      const projectId = tamperedProjectId ? "tampered-project-id" : PROJECT_ID;

      if (request.method === "GET" && url.pathname === "/api/v1/mcp-tools") {
        json(response, 200, {
          project: PROJECT,
          project_id: projectId,
          data: categorizedToolStates(enabled),
        });
        return;
      }

      const stateMatch = url.pathname.match(/^\/api\/v1\/mcp-tools\/([^/]+)\/state$/);
      if (request.method === "GET" && stateMatch) {
        const toolName = decodeURIComponent(stateMatch[1]!);
        const catalogTool = catalogByName.get(toolName);
        const authorization = toolName.startsWith("ingenium_fixture_") ? childPolicy() : catalogTool?.authorization;
        json(response, 200, {
          project: PROJECT,
          project_id: projectId,
          data: {
            tool_name: toolName,
            enabled: enabled.get(toolName) ?? true,
            ...(invalidPolicies.has(toolName) ? {} : { authorization }),
          },
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/skills") {
        if (skillListStatus !== 200) {
          json(response, skillListStatus, { error: { code: "FORBIDDEN", message: "The operation is not permitted." } });
          return;
        }
        json(response, 200, { project: PROJECT, data: [] });
        return;
      }

      if (request.method === "GET" && url.pathname === "/_ingenium/child-mcp-runtime") {
        if (request.headers["x-ingenium-child-mcp-runtime"] !== "1") {
          json(response, 403, { error: { code: "FORBIDDEN" } });
          return;
        }
        json(response, 200, { data: {
          definitions: childEnabled ? [{
            name: "fixture",
            executable: process.execPath,
            args: [CHILD_MCP_ENTRYPOINT],
            environment: {},
            scope: "project",
            owned: true,
            revision: "fixture-revision-1",
          }] : [],
          unavailable: [],
        } });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/mcp-servers/fixture/discovery") {
        json(response, 200, { data: { recorded: true } });
        return;
      }

      if (request.method === "GET") {
        json(response, 200, { project: PROJECT, project_id: projectId, data: [] });
        return;
      }

      json(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "The fixture permits only safe reads." } });
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
    setToolEnabled(toolName, nextEnabled) { enabled.set(toolName, nextEnabled); },
    setPolicyValid(toolName, valid) { valid ? invalidPolicies.delete(toolName) : invalidPolicies.add(toolName); },
    setProjectIdTampered(tampered) { tamperedProjectId = tampered; },
    setSkillListStatus(status) { skillListStatus = status; },
    setChildEnabled(nextEnabled) { childEnabled = nextEnabled; },
    async close(): Promise<void> {
      for (const socket of sockets) socket.destroy();
      await within(new Promise<void>((resolveClosed, reject) => {
        server.close((error) => error ? reject(error) : resolveClosed());
      }), "MCP-102 fixture API cleanup");
    },
  };
}

async function connectMcp(fixture: FixtureApi): Promise<McpConnection> {
  const credentialDirectory = mkdtempSync(join(tmpdir(), "mcp-102-credential-"));
  chmodSync(credentialDirectory, 0o700);
  const credentialFile = join(credentialDirectory, ".ingenium-mcp-credential");
  writeFileSync(credentialFile, `${SCOPED_CREDENTIAL}\n`, { mode: 0o600 });
  chmodSync(credentialFile, 0o600);
  cleanups.push(async () => { rmSync(credentialDirectory, { recursive: true, force: true }); });
  const transport = new StdioClientTransport({
    command: TSX,
    args: [MCP_ENTRYPOINT],
    cwd: REPOSITORY_ROOT,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? REPOSITORY_ROOT,
      TMPDIR: process.env.TMPDIR ?? "/tmp",
      INGENIUM_API_URL: `${fixture.origin}/api/v1`,
      INGENIUM_API_URL_TRUSTED: "1",
      INGENIUM_MCP_CREDENTIAL_FILE: credentialFile,
      INGENIUM_MCP_CREDENTIAL_PURPOSE: "general",
      INGENIUM_MCP_AUDIENCE: "mcp",
      INGENIUM_RUNTIME_CREDENTIAL: RUNTIME_CREDENTIAL,
      INGENIUM_WORKSPACE_ID: WORKSPACE_ID,
      INGENIUM_WORKTREE: REPOSITORY_ROOT,
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

function transportName(canonicalName: string): string {
  return canonicalName.replace(/^ingenium_/, "");
}

const representativeByCategory: Record<string, { name: string; arguments: Record<string, unknown> }> = {
  "Repository Sync": { name: "ingenium_repository_sync", arguments: {} },
  Settings: { name: "ingenium_setting_get", arguments: { project: PROJECT } },
  Skills: { name: "ingenium_skill_list", arguments: { project: PROJECT } },
  Observe: { name: "ingenium_observe", arguments: {} },
  Observations: { name: "ingenium_observation_list", arguments: { project: PROJECT } },
  Personality: { name: "ingenium_personality", arguments: { project: PROJECT } },
  Synthesis: { name: "ingenium_synthesis_status", arguments: { project: PROJECT } },
  Extraction: { name: "ingenium_extraction_run", arguments: {} },
  Tasks: { name: "ingenium_task_list", arguments: { project: PROJECT } },
  Plans: { name: "ingenium_plan_list", arguments: { project: PROJECT } },
  Context: { name: "ingenium_context_conversation_list", arguments: { project: PROJECT } },
  Projects: { name: "ingenium_project_list", arguments: {} },
  Plugins: { name: "ingenium_plugin_list", arguments: { project: PROJECT } },
  Providers: { name: "ingenium_provider_list", arguments: { project: PROJECT } },
  Servers: { name: "ingenium_server_list", arguments: { project: PROJECT } },
  Agents: { name: "ingenium_agent_list", arguments: { project: PROJECT } },
  Commands: { name: "ingenium_command_list", arguments: { project: PROJECT } },
  Config: { name: "ingenium_config_get", arguments: { project: PROJECT } },
  Email: { name: "ingenium_email_list", arguments: { project: PROJECT } },
  Logs: { name: "ingenium_logs_list", arguments: { project: PROJECT } },
  Jobs: { name: "ingenium_job_list", arguments: { project: PROJECT } },
  Pipeline: { name: "ingenium_pipeline_timeline", arguments: { project: PROJECT } },
  Status: { name: "ingenium_service_status", arguments: { project: PROJECT } },
  Health: { name: "ingenium_health_check", arguments: {} },
  OpenCode: { name: "ingenium_opencode_messages", arguments: { project: PROJECT } },
  Dashboard: { name: "ingenium_dashboard_summary", arguments: { project: PROJECT } },
  Vault: { name: "ingenium_vault_status", arguments: { project: PROJECT } },
  Backups: { name: "ingenium_backup_list", arguments: { project: PROJECT } },
  RAG: { name: "ingenium_docs_rag_stats", arguments: { project: PROJECT } },
  Documentation: { name: "ingenium_docs_list_spaces", arguments: { project: PROJECT } },
};

async function callRepresentative(client: Client, representative: { name: string; arguments: Record<string, unknown> }) {
  try {
    return await client.callTool({ name: transportName(representative.name), arguments: representative.arguments });
  } catch (error) {
    return error;
  }
}

describe("MCP-102 provider-free live acceptance", () => {
  it("connects all 30 categories with exact catalog accounting and enforces policy, project, error, disabled, and child inheritance boundaries", async () => {
    expect(MCP_TOOL_CATALOG).toHaveLength(283);
    expect(MCP_TOOL_CATALOG.filter((tool) => tool.name.startsWith("ingenium_"))).toHaveLength(281);
    expect(MCP_TOOL_CATALOG.filter((tool) => !tool.name.startsWith("ingenium_")).map((tool) => tool.name).sort())
      .toEqual([...EXTENSION_TOOL_NAMES].sort());
    expect(new Set(MCP_TOOL_CATALOG.map((tool) => tool.category))).toHaveLength(30);
    expect(Object.keys(representativeByCategory).sort())
      .toEqual([...new Set(MCP_TOOL_CATALOG.map((tool) => tool.category))].sort());

    const fixture = await startFixtureApi();
    cleanups.push(() => fixture.close());
    const connection = await connectMcp(fixture);
    cleanups.push(() => connection.close());

    const expectedTransportNames = MCP_TOOL_CATALOG
      .filter((tool) => tool.name.startsWith("ingenium_"))
      .map((tool) => transportName(tool.name))
      .sort();
    expect(toolNames(await connection.client.listTools()).sort()).toEqual(expectedTransportNames);

    const categoryCalls = await Promise.all(Object.values(representativeByCategory).map((representative) => (
      callRepresentative(connection.client, representative)
    )));
    expect(categoryCalls).toHaveLength(30);
    expect(fixture.requests.filter((request) => /^POST \/api\/v1\/(?!mcp-servers\/fixture\/discovery)/.test(request))).toEqual([]);

    fixture.setPolicyValid("ingenium_setting_get", false);
    const invalidPolicy = await connection.client.callTool({
      name: "setting_get",
      arguments: { project: PROJECT, key: "safe-fixture-key" },
    }) as ToolCallResult;
    expect(errorCode(invalidPolicy)).toBe("TOOL_STATE_UNAVAILABLE");
    fixture.setPolicyValid("ingenium_setting_get", true);

    fixture.setSkillListStatus(403);
    const apiError = await connection.client.callTool({ name: TRANSPORT_TOOL_NAME, arguments: { project: PROJECT } }) as ToolCallResult;
    expect(apiError).toMatchObject({ isError: true });
    expect(errorCode(apiError)).toBe("FORBIDDEN");
    fixture.setSkillListStatus(200);

    fixture.setProjectIdTampered(true);
    const tampered = await connection.client.callTool({ name: TRANSPORT_TOOL_NAME, arguments: { project: PROJECT } }) as ToolCallResult;
    expect(errorCode(tampered)).toBe("TOOL_STATE_UNAVAILABLE");
    fixture.setProjectIdTampered(false);

    const wrongProject = await connection.client.callTool({ name: TRANSPORT_TOOL_NAME, arguments: { project: "other-project" } }) as ToolCallResult;
    expect(errorCode(wrongProject)).toBe("PROJECT_IDENTITY_REQUIRED");

    fixture.setToolEnabled(TOOL_NAME, false);
    const disabled = await connection.client.callTool({ name: TRANSPORT_TOOL_NAME, arguments: { project: PROJECT } }) as ToolCallResult;
    expect(errorCode(disabled)).toBe("TOOL_DISABLED");
    fixture.setToolEnabled(TOOL_NAME, true);

    fixture.setChildEnabled(true);
    let childTools: string[];
    try {
      childTools = await waitFor(async () => {
        const names = toolNames(await connection.client.listTools());
        return names.includes("fixture_echo") ? names : undefined;
      }, "child MCP discovery");
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : "child MCP discovery failed"}\n${fixture.requests.join("\n")}`);
    }
    expect(childTools).toEqual(expect.arrayContaining(["fixture_echo", "fixture_environment"]));

    const inherited = await connection.client.callTool({
      name: "fixture_echo",
      arguments: { project: PROJECT, arguments: { value: "inherited-scope" } },
    });
    expect(inherited).toMatchObject({ content: [{ type: "text", text: "inherited-scope" }] });

    fixture.setProjectIdTampered(true);
    const childTampered = await connection.client.callTool({
      name: "fixture_echo",
      arguments: { project: PROJECT, arguments: { value: "must-not-forward" } },
    }) as ToolCallResult;
    expect(errorCode(childTampered)).toBe("TOOL_STATE_UNAVAILABLE");
    fixture.setProjectIdTampered(false);

    expect(fixture.requests).toContain("GET /api/v1/auth/preflight");
    expect(fixture.requests.some((request) => request.startsWith("GET /_ingenium/child-mcp-runtime?project="))).toBe(true);
  }, 45_000);
});
