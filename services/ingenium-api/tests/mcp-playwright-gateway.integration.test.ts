import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { projects, resetDbForTest } from "ingenium-core";
import {
  ChildMcpGateway,
  type ChildMcpGatewayApi,
  type ChildMcpRuntimeDefinitionResponse,
  type ChildMcpToolHost,
} from "../../ingenium-server/lib/child-mcp-gateway.js";
import { ChildMcpRuntimeManager } from "../../ingenium-server/lib/proxy.js";
import {
  CHILD_MCP_RUNTIME_HANDOFF_HEADER,
  CHILD_MCP_RUNTIME_HANDOFF_PATH,
  childMcpRuntimeRouter,
  mcpServersRouter,
} from "../lib/routes/mcp-servers.js";
import { mcpToolsRouter } from "../lib/routes/mcp-tools.js";

const repositoryRoot = new URL("../../../", import.meta.url);
const opencodeConfigPath = new URL("opencode.json", repositoryRoot);
const projectName = "mcp-playwright-gateway-project";
const childName = "playwright";
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;

interface PlaywrightMcpConfig {
  command: string[];
  enabled: boolean;
  environment?: Record<string, string>;
}

interface RegisteredTool {
  handler: (args: Record<string, unknown>) => Promise<unknown>;
  remove(): void;
}

interface JsonResponse {
  data?: unknown;
  error?: unknown;
}

const gateways: ChildMcpGateway[] = [];
const managers: ChildMcpRuntimeManager[] = [];
let apiServer: Server | undefined;
let fixtureServer: Server | undefined;
let temporaryDirectory = "";

function configuredPlaywrightMcp(): PlaywrightMcpConfig {
  const config = JSON.parse(readFileSync(opencodeConfigPath, "utf8")) as {
    mcp?: { playwright?: PlaywrightMcpConfig };
  };
  const playwright = config.mcp?.playwright;
  if (!playwright?.enabled || !Array.isArray(playwright.command) || playwright.command.length < 2) {
    throw new Error("MCP-005 configured Playwright MCP server is missing or disabled in opencode.json");
  }
  return playwright;
}

function verifyConfiguredExecutable(config: PlaywrightMcpConfig): void {
  const [launcher, executable] = config.command;
  if (!launcher || !executable) {
    throw new Error("MCP-005 configured Playwright MCP command is incomplete");
  }

  const environment = {
    ...process.env,
    ...config.environment,
  };
  try {
    execFileSync(launcher, [executable, "--version"], {
      env: environment,
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(
      `MCP-005 configured Playwright MCP executable is unavailable: ${config.command.join(" ")}`,
    );
  }
}

function jsonRequest(baseUrl: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

async function jsonBody(response: Response): Promise<JsonResponse> {
  return await response.json() as JsonResponse;
}

function query(project: string): string {
  return `?project=${encodeURIComponent(project)}`;
}

function createHost() {
  const tools = new Map<string, RegisteredTool>();
  const host: ChildMcpToolHost = {
    registerTool(localName, _configuration, handler) {
      // This is the same namespace boundary used by the parent McpServer: the
      // configured `ingenium` server key is added after local registration.
      const exposedName = `ingenium_${localName}`;
      const registration: RegisteredTool = {
        handler,
        remove: () => {
          tools.delete(exposedName);
        },
      };
      tools.set(exposedName, registration);
      return registration;
    },
    sendToolListChanged: async () => undefined,
  };
  return { host, tools };
}

async function startHttpServer(app: express.Express): Promise<string> {
  apiServer = createServer(app);
  return await new Promise<string>((resolve) => {
    apiServer!.listen(0, "127.0.0.1", () => {
      const address = apiServer!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function startFixtureServer(): Promise<string> {
  fixtureServer = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
      <html>
        <head><title>MCP gateway fixture</title></head>
        <body>
          <main>
            <h1>Playwright gateway fixture</h1>
            <p>This page is local, deterministic, and safe to navigate.</p>
          </main>
        </body>
      </html>`);
  });
  return await new Promise<string>((resolve) => {
    fixtureServer!.listen(0, "127.0.0.1", () => {
      const address = fixtureServer!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}/fixture`);
    });
  });
}

function createGatewayApi(baseUrl: string): ChildMcpGatewayApi {
  return {
    async listRuntimeDefinitions(project) {
      const response = await jsonRequest(
        baseUrl,
        `${CHILD_MCP_RUNTIME_HANDOFF_PATH}${query(project)}`,
        { headers: { [CHILD_MCP_RUNTIME_HANDOFF_HEADER]: "1" } },
      );
      const body = await jsonBody(response);
      const data = body.data as {
        definitions?: ChildMcpRuntimeDefinitionResponse[];
        unavailable?: unknown[];
      } | undefined;
      if (!response.ok || !data) throw new Error("MCP-005 runtime handoff failed");
      return {
        definitions: data.definitions ?? [],
        unavailableCount: data.unavailable?.length ?? 0,
      };
    },
    async recordDiscovery(project, server, report) {
      const response = await jsonRequest(
        baseUrl,
        `/api/v1/mcp-servers/${encodeURIComponent(server)}/discovery${query(project)}`,
        { method: "POST", body: JSON.stringify(report) },
      );
      return response.ok;
    },
    async toolEnabled(project, toolName) {
      const response = await jsonRequest(
        baseUrl,
        `/api/v1/mcp-tools/${encodeURIComponent(toolName)}/state${query(project)}`,
      );
      const body = await jsonBody(response);
      const enabled = (body.data as { enabled?: unknown } | undefined)?.enabled;
      if (!response.ok || typeof enabled !== "boolean") return "unavailable";
      return enabled ? "enabled" : "disabled";
    },
  };
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function serializedToolResult(result: unknown): string {
  return JSON.stringify(result);
}

async function waitForToolPresence(
  tools: Map<string, RegisteredTool>,
  toolName: string,
  present: boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const started = Date.now();
  while (tools.has(toolName) !== present) {
    if (Date.now() - started >= timeoutMs) {
      throw new Error(`Timed out waiting for ${toolName} to become ${present ? "visible" : "hidden"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function waitForProcessExit(pid: number, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (true) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    if (Date.now() - started >= timeoutMs) throw new Error(`Timed out waiting for child process ${pid} to exit`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

afterEach(async () => {
  await Promise.all(gateways.splice(0).map((gateway) => gateway.shutdown()));
  await Promise.all(managers.splice(0).map((manager) => manager.stopAll()));
  await closeServer(apiServer);
  await closeServer(fixtureServer);
  apiServer = undefined;
  fixtureServer = undefined;
  resetDbForTest();
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
});

describe("MCP-005 real Playwright child gateway", () => {
  it("registers through the API, discovers canonical tools, forwards fixture navigation/snapshot, toggles, reconnects, and leaves no child", async () => {
    const playwright = configuredPlaywrightMcp();
    verifyConfiguredExecutable(playwright);

    temporaryDirectory = mkdtempSync(join(tmpdir(), "ingenium-mcp-playwright-gateway-"));
    process.env.INGENIUM_CORE_DB_PATH = join(temporaryDirectory, "data.db");
    projects.createProject(projectName);

    const app = express();
    app.use(express.json());
    app.use(CHILD_MCP_RUNTIME_HANDOFF_PATH, childMcpRuntimeRouter);
    app.use("/api/v1/mcp-servers", mcpServersRouter);
    app.use("/api/v1/mcp-tools", mcpToolsRouter);
    const baseUrl = await startHttpServer(app);
    const fixtureUrl = await startFixtureServer();

    const [launcher, ...configuredArgs] = playwright.command;
    if (!launcher) throw new Error("MCP-005 configured Playwright MCP launcher is empty");
    const registered = await jsonRequest(baseUrl, `/api/v1/mcp-servers${query(projectName)}`, {
      method: "POST",
      body: JSON.stringify({
        name: childName,
        executable: launcher,
        args: configuredArgs,
        environment: {},
      }),
    });
    expect(registered.status).toBe(201);
    await expect(jsonBody(registered)).resolves.toMatchObject({
      data: { name: childName, executable: launcher, args: configuredArgs },
    });
    const listed = await jsonRequest(baseUrl, `/api/v1/mcp-servers${query(projectName)}`);
    expect(listed.status).toBe(200);
    await expect(jsonBody(listed)).resolves.toMatchObject({
      data: [expect.objectContaining({ name: childName, enabled: true })],
    });

    const { host, tools } = createHost();
    const manager = new ChildMcpRuntimeManager({ startupMs: 30_000, requestMs: 15_000, shutdownMs: 5_000 });
    managers.push(manager);
    const gateway = new ChildMcpGateway(host, projectName, createGatewayApi(baseUrl), manager, 50);
    gateways.push(gateway);
    await gateway.start();

    const navigate = "ingenium_playwright_browser_navigate";
    const snapshot = "ingenium_playwright_browser_snapshot";
    const close = "ingenium_playwright_browser_close";
    expect(tools.has(navigate)).toBe(true);
    expect(tools.has(snapshot)).toBe(true);
    expect(tools.has(close)).toBe(true);
    expect([...tools.keys()]).not.toContain("browser_navigate");
    expect([...tools.keys()]).not.toContain("playwright_browser_navigate");

    const discovered = await jsonRequest(baseUrl, `/api/v1/mcp-servers/tools${query(projectName)}`);
    const discoveredBody = await jsonBody(discovered);
    expect(discovered.status).toBe(200);
    expect(discoveredBody.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ canonical_name: navigate, category: "Child MCP / playwright" }),
      expect.objectContaining({ canonical_name: snapshot, category: "Child MCP / playwright" }),
    ]));
    const status = await jsonRequest(baseUrl, `/api/v1/mcp-servers/status${query(projectName)}`);
    expect(status.status).toBe(200);
    await expect(jsonBody(status)).resolves.toMatchObject({
      data: [expect.objectContaining({
        name: childName,
        enabled: true,
        discovery_status: "ready",
      })],
    });
    const catalog = await jsonRequest(baseUrl, `/api/v1/mcp-tools/catalog${query(projectName)}`);
    const catalogBody = await jsonBody(catalog);
    const catalogNames = (catalogBody.data as Array<{ name?: string }>).map((entry) => entry.name);
    expect(catalogNames).toContain(navigate);
    expect(catalogNames).not.toContain("browser_navigate");
    expect(catalogNames).not.toContain("playwright_browser_navigate");

    const navigation = await tools.get(navigate)!.handler({
      project: projectName,
      arguments: { url: fixtureUrl },
    });
    expect(serializedToolResult(navigation)).toContain(fixtureUrl);

    const snapshotResult = await tools.get(snapshot)!.handler({
      project: projectName,
      arguments: {},
    });
    expect(serializedToolResult(snapshotResult)).toContain("Playwright gateway fixture");

    const disabledTool = await jsonRequest(
      baseUrl,
      `/api/v1/mcp-tools/${encodeURIComponent(navigate)}${query(projectName)}`,
      { method: "PUT", body: JSON.stringify({ enabled: false }) },
    );
    expect(disabledTool.status).toBe(200);
    const blockedNavigation = await tools.get(navigate)!.handler({
      project: projectName,
      arguments: { url: fixtureUrl },
    });
    expect(serializedToolResult(blockedNavigation)).toContain("TOOL_DISABLED");
    await gateway.refresh();
    await waitForToolPresence(tools, navigate, false);

    const enabledTool = await jsonRequest(
      baseUrl,
      `/api/v1/mcp-tools/${encodeURIComponent(navigate)}${query(projectName)}`,
      { method: "PUT", body: JSON.stringify({ enabled: true }) },
    );
    expect(enabledTool.status).toBe(200);
    await gateway.refresh();
    await waitForToolPresence(tools, navigate, true);
    await expect(tools.get(navigate)!.handler({
      project: projectName,
      arguments: { url: fixtureUrl },
    })).resolves.toMatchObject({ content: expect.any(Array) });

    const category = "Child MCP / playwright";
    const disabledCategory = await jsonRequest(
      baseUrl,
      `/api/v1/mcp-tools/category/${encodeURIComponent(category)}${query(projectName)}`,
      { method: "PUT", body: JSON.stringify({ enabled: false }) },
    );
    expect(disabledCategory.status).toBe(200);
    const blockedSnapshot = await tools.get(snapshot)!.handler({
      project: projectName,
      arguments: {},
    });
    expect(serializedToolResult(blockedSnapshot)).toContain("TOOL_DISABLED");
    await gateway.refresh();
    await waitForToolPresence(tools, navigate, false);
    await waitForToolPresence(tools, snapshot, false);

    const enabledCategory = await jsonRequest(
      baseUrl,
      `/api/v1/mcp-tools/category/${encodeURIComponent(category)}${query(projectName)}`,
      { method: "PUT", body: JSON.stringify({ enabled: true }) },
    );
    expect(enabledCategory.status).toBe(200);
    await gateway.refresh();
    await waitForToolPresence(tools, navigate, true);
    await waitForToolPresence(tools, snapshot, true);
    await expect(tools.get(snapshot)!.handler({
      project: projectName,
      arguments: {},
    })).resolves.toMatchObject({ content: expect.any(Array) });

    const firstPid = manager.getStatus(childName).pid;
    expect(firstPid).toEqual(expect.any(Number));
    const staleNavigateHandler = tools.get(navigate)!.handler;
    const disconnected = await jsonRequest(
      baseUrl,
      `/api/v1/mcp-servers/${childName}/disconnect${query(projectName)}`,
      { method: "POST" },
    );
    expect(disconnected.status).toBe(200);
    await gateway.refresh();
    await waitForToolPresence(tools, navigate, false);
    await waitForToolPresence(tools, snapshot, false);
    await expect(staleNavigateHandler({
      project: projectName,
      arguments: { url: fixtureUrl },
    })).resolves.toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("CHILD_MCP_UNAVAILABLE") }],
    });
    await waitForProcessExit(firstPid!);

    const connected = await jsonRequest(
      baseUrl,
      `/api/v1/mcp-servers/${childName}/connect${query(projectName)}`,
      { method: "POST" },
    );
    expect(connected.status).toBe(200);
    await gateway.refresh();
    await waitForToolPresence(tools, navigate, true);
    await waitForToolPresence(tools, snapshot, true);
    const reconnected = manager.getStatus(childName);
    expect(reconnected).toMatchObject({ state: "ready", toolCount: expect.any(Number) });
    expect(reconnected.pid).toEqual(expect.any(Number));
    expect(reconnected.pid).not.toBe(firstPid);
    expect(() => process.kill(firstPid!, 0)).toThrow();
    await expect(staleNavigateHandler({
      project: projectName,
      arguments: { url: fixtureUrl },
    })).resolves.toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("CHILD_MCP_UNAVAILABLE") }],
    });

    const closed = await tools.get(close)!.handler({ project: projectName, arguments: {} });
    expect(serializedToolResult(closed)).not.toContain("error");

    const removedHandler = tools.get(navigate)!.handler;
    const removed = await jsonRequest(
      baseUrl,
      `/api/v1/mcp-servers/${childName}${query(projectName)}`,
      { method: "DELETE" },
    );
    expect(removed.status).toBe(204);
    await gateway.refresh();
    await waitForToolPresence(tools, navigate, false);
    await waitForToolPresence(tools, snapshot, false);
    await expect(removedHandler({
      project: projectName,
      arguments: { url: fixtureUrl },
    })).resolves.toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("TOOL_STATE_UNAVAILABLE") }],
    });

    const reconnectedPid = reconnected.pid!;
    await gateway.shutdown();
    expect(tools.has(navigate)).toBe(false);
    expect(tools.has(snapshot)).toBe(false);
    expect(tools.has(close)).toBe(false);
    expect(() => manager.getStatus(childName)).toThrow();
    expect(() => process.kill(reconnectedPid, 0)).toThrow();
  }, 60_000);
});
