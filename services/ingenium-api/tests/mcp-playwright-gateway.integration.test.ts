import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { projects, resetDbForTest } from "ingenium-core";
import {
  PLAYWRIGHT_CHILD_MCP_ARGS,
  PLAYWRIGHT_CHILD_MCP_EXECUTABLE,
} from "../../../packages/ingenium-core/lib/tools/child-mcp-presets.js";
import {
  ChildMcpGateway,
  type ChildMcpGatewayApi,
  type ChildMcpRuntimeDefinitionResponse,
  type ChildMcpToolHost,
} from "../../ingenium-server/lib/child-mcp-gateway.js";
import { ChildMcpRuntimeManager } from "../../ingenium-server/lib/proxy.js";
import { ManagedPlaywrightRuntime, resolveManagedPlaywright } from "../../ingenium-server/lib/child-mcp-playwright.js";
import { getProjectStateAttestation, getToolAuthorizationPolicy } from "../../ingenium-server/lib/tool-state-gate.js";
import {
  CHILD_MCP_RUNTIME_HANDOFF_HEADER,
  CHILD_MCP_RUNTIME_HANDOFF_PATH,
  childMcpRuntimeRouter,
  mcpServersRouter,
} from "../lib/routes/mcp-servers.js";
import { mcpToolsRouter } from "../lib/routes/mcp-tools.js";
import { runtimeServicePrincipal } from "./http-fixtures.js";

const projectName = "mcp-playwright-gateway-project";
const childName = "playwright";
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;

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
      const attestation = getProjectStateAttestation(body, project);
      if (!response.ok || !attestation || typeof enabled !== "boolean") {
        return { state: "unavailable", attestation: null, policy: null };
      }
      const policy = getToolAuthorizationPolicy((body.data as { authorization?: unknown }).authorization);
      return { state: enabled ? "enabled" : "disabled", attestation, policy };
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

describe("MCP-005 gateway API fixture", () => {
  it("maps an enabled tool state only when the API attests the project", async () => {
    const app = express();
    app.get("/api/v1/mcp-tools/:name/state", (_req, res) => {
      res.json({
        project: projectName,
        project_id: "mcp-playwright-gateway-project-id",
        data: { enabled: true },
      });
    });
    const baseUrl = await startHttpServer(app);

    await expect(createGatewayApi(baseUrl).toolEnabled(projectName, "ingenium_playwright_browser_navigate"))
      .resolves.toEqual({
        state: "enabled",
        attestation: { project: projectName, project_id: "mcp-playwright-gateway-project-id" },
        policy: null,
      });
  });

  it("fails closed for a legacy tool-state response without project attestation", async () => {
    const app = express();
    app.get("/api/v1/mcp-tools/:name/state", (_req, res) => {
      res.json({ data: { enabled: true } });
    });
    const baseUrl = await startHttpServer(app);

    await expect(createGatewayApi(baseUrl).toolEnabled(projectName, "ingenium_playwright_browser_navigate"))
      .resolves.toEqual({ state: "unavailable", attestation: null, policy: null });
  });
});

describe("MCP-005 real Playwright child gateway", () => {
  it("registers through the API, discovers canonical tools, forwards fixture navigation/snapshot, toggles, reconnects, and leaves no child", async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "ingenium-mcp-playwright-gateway-"));
    process.env.INGENIUM_CORE_DB_PATH = join(temporaryDirectory, "data.db");
    const project = projects.createProject(projectName);

    const app = express();
    app.use(express.json());
    app.use(CHILD_MCP_RUNTIME_HANDOFF_PATH, (req, _res, next) => {
      req.principal = runtimeServicePrincipal(project.id);
      next();
    }, childMcpRuntimeRouter);
    app.use("/api/v1/mcp-servers", mcpServersRouter);
    app.use("/api/v1/mcp-tools", mcpToolsRouter);
    const baseUrl = await startHttpServer(app);
    const fixtureUrl = await startFixtureServer();
    const resolved = resolveManagedPlaywright();
    accessSync(resolved.browserExecutablePath, constants.X_OK);
    accessSync(resolved.cliPath, constants.R_OK);
    accessSync(resolved.executablePath, constants.X_OK);
    const stateDirectory = join(temporaryDirectory, "playwright-runtime");
    const pids = new Set<number>();
    const hosts: ReturnType<typeof createHost>[] = [];

    const createManagedGateway = () => {
      const hostState = createHost();
      hosts.push(hostState);
      const { host, tools } = hostState;
      const manager = new ChildMcpRuntimeManager({ startupMs: 30_000, requestMs: 15_000, shutdownMs: 5_000 });
      managers.push(manager);
      const gateway = new ChildMcpGateway(
        host,
        projectName,
        createGatewayApi(baseUrl),
        manager,
        100,
        undefined,
        {
          project: projectName,
          projectId: project.id,
          organizationId: project.organization_id,
          workspaceId: "mcp-playwright-gateway-workspace",
          launcherWorktree: "/workspace",
          scopes: ["child-mcp:execute", "child-mcp:runtime", "memory:read"],
        },
        new ManagedPlaywrightRuntime(resolved.browserExecutablePath, resolved.executablePath, stateDirectory),
      );
      gateways.push(gateway);
      return { gateway, manager, tools };
    };
    const navigate = "ingenium_playwright_browser_navigate";
    const snapshot = "ingenium_playwright_browser_snapshot";
    const close = "ingenium_playwright_browser_close";

    try {
      let { gateway, manager, tools } = createManagedGateway();
      await gateway.start();
      expect(tools.size).toBe(0);
      const presetPath = `/api/v1/mcp-servers/presets/playwright${query(projectName)}`;
      const registered = await jsonRequest(baseUrl, presetPath, { method: "POST" });
      expect(registered.status).toBe(201);
      await expect(jsonBody(registered)).resolves.toMatchObject({
        data: { name: childName, executable: PLAYWRIGHT_CHILD_MCP_EXECUTABLE, args: [...PLAYWRIGHT_CHILD_MCP_ARGS] },
      });
      const duplicate = await jsonRequest(baseUrl, presetPath, { method: "POST" });
      expect(duplicate.status).toBe(409);
      await expect(jsonBody(duplicate)).resolves.toMatchObject({ error: { code: "MCP_SERVER_NAME_CONFLICT" } });

      await waitForToolPresence(tools, close, true, 30_000);
      expect(manager.getStatus(childName).state).toBe("ready");
      pids.add(manager.getStatus(childName).pid!);
      for (const name of [navigate, snapshot, close]) expect(tools.has(name)).toBe(true);
      expect([...tools.keys()]).not.toContain("browser_navigate");
      expect([...tools.keys()]).not.toContain("playwright_browser_navigate");

      const discovered = await jsonRequest(baseUrl, `/api/v1/mcp-servers/tools${query(projectName)}`);
      expect(discovered.status).toBe(200);
      await expect(jsonBody(discovered)).resolves.toMatchObject({ data: expect.arrayContaining([
        expect.objectContaining({ canonical_name: navigate, category: "Child MCP / playwright" }),
        expect.objectContaining({ canonical_name: snapshot, category: "Child MCP / playwright" }),
      ]) });
      const status = await jsonRequest(baseUrl, `/api/v1/mcp-servers/status${query(projectName)}`);
      expect(status.status).toBe(200);
      await expect(jsonBody(status)).resolves.toMatchObject({
        data: [expect.objectContaining({ name: childName, enabled: true, discovery_status: "ready" })],
      });
      const catalog = await jsonRequest(baseUrl, `/api/v1/mcp-tools/catalog${query(projectName)}`);
      const catalogBody = await jsonBody(catalog);
      const catalogNames = (catalogBody.data as Array<{ name?: string }>).map((entry) => entry.name);
      expect(catalogNames).toContain(navigate);
      expect(catalogNames).not.toContain("browser_navigate");
      expect(catalogNames).not.toContain("playwright_browser_navigate");

      const navigation = await tools.get(navigate)!.handler({ project: projectName, arguments: { url: fixtureUrl } });
      expect(serializedToolResult(navigation)).toContain(fixtureUrl);
      expect(navigation).not.toMatchObject({ isError: true });
      const snapshotResult = await tools.get(snapshot)!.handler({ project: projectName, arguments: {} });
      expect(serializedToolResult(snapshotResult)).toContain("Playwright gateway fixture");
      const closed = await tools.get(close)!.handler({ project: projectName, arguments: {} });
      expect(serializedToolResult(closed)).not.toContain("error");

      const disabledTool = await jsonRequest(
        baseUrl,
        `/api/v1/mcp-tools/${encodeURIComponent(navigate)}${query(projectName)}`,
        { method: "PUT", body: JSON.stringify({ enabled: false }) },
      );
      expect(disabledTool.status).toBe(200);
      await gateway.refresh();
      await waitForToolPresence(tools, navigate, false);

      await gateway.shutdown();
      await waitForProcessExit([...pids][0]!);
      ({ gateway, manager, tools } = createManagedGateway());
      await gateway.start();
      pids.add(manager.getStatus(childName).pid!);
      expect(tools.has(navigate)).toBe(false);
      expect(tools.has(snapshot)).toBe(true);

      const enabledTool = await jsonRequest(
        baseUrl,
        `/api/v1/mcp-tools/${encodeURIComponent(navigate)}${query(projectName)}`,
        { method: "PUT", body: JSON.stringify({ enabled: true }) },
      );
      expect(enabledTool.status).toBe(200);
      await gateway.refresh();
      await waitForToolPresence(tools, navigate, true);

      for (const enabled of [false, true]) {
        const category = await jsonRequest(
          baseUrl,
          `/api/v1/mcp-tools/category/${encodeURIComponent("Child MCP / playwright")}${query(projectName)}`,
          { method: "PUT", body: JSON.stringify({ enabled }) },
        );
        expect(category.status).toBe(200);
        await gateway.refresh();
        for (const name of [navigate, snapshot, close]) await waitForToolPresence(tools, name, enabled);
      }

      const firstPid = manager.getStatus(childName).pid!;
      const disconnected = await jsonRequest(
        baseUrl, `/api/v1/mcp-servers/${childName}/disconnect${query(projectName)}`, { method: "POST" },
      );
      expect(disconnected.status).toBe(200);
      await gateway.refresh();
      for (const name of [navigate, snapshot, close]) await waitForToolPresence(tools, name, false);
      await waitForProcessExit(firstPid);

      const connected = await jsonRequest(
        baseUrl, `/api/v1/mcp-servers/${childName}/connect${query(projectName)}`, { method: "POST" },
      );
      expect(connected.status).toBe(200);
      await gateway.refresh();
      for (const name of [navigate, snapshot, close]) await waitForToolPresence(tools, name, true);
      const reconnected = manager.getStatus(childName);
      pids.add(reconnected.pid!);
      expect(reconnected).toMatchObject({ state: "ready", pid: expect.any(Number), toolCount: expect.any(Number) });
      expect(reconnected.pid).not.toBe(firstPid);
      expect(readdirSync(stateDirectory)).toHaveLength(3);
    } finally {
      for (const manager of managers) {
        try {
          const pid = manager.getStatus(childName).pid;
          if (pid) pids.add(pid);
        } catch { /* A disconnected child is already unregistered. */ }
      }
      try {
        const removed = await jsonRequest(
          baseUrl, `/api/v1/mcp-servers/${childName}${query(projectName)}`, { method: "DELETE" },
        );
        expect([204, 404]).toContain(removed.status);
        await Promise.all(gateways.map((gateway) => gateway.refresh()));
        const listed = await jsonRequest(baseUrl, `/api/v1/mcp-servers${query(projectName)}`);
        await expect(jsonBody(listed)).resolves.toMatchObject({ data: [] });
      } finally {
        await Promise.all(gateways.map((gateway) => gateway.shutdown()));
        await Promise.all(managers.map((manager) => manager.stopAll()));
        for (const pid of pids) await waitForProcessExit(pid);
        for (const { tools } of hosts) expect(tools.size).toBe(0);
        if (existsSync(stateDirectory)) {
          for (const directory of readdirSync(stateDirectory)) {
            const record = JSON.parse(readFileSync(join(stateDirectory, directory, "ownership.json"), "utf8"));
            expect(record).toMatchObject({
              ownerPid: process.pid,
              project: projectName,
              cleanedAt: expect.any(String),
              cancellationRequestedAt: expect.any(String),
            });
            expect(existsSync(record.outputDirectory)).toBe(false);
            expect(existsSync(join(stateDirectory, directory, "failed-cleanup.json"))).toBe(false);
          }
        }
      }
    }
  }, 60_000);
});
