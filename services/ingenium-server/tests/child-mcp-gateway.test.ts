import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import * as filesystem from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
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
import {
  ManagedPlaywrightRuntime,
  PLAYWRIGHT_CHILD_MCP_ARGS,
  PLAYWRIGHT_CHILD_MCP_BROWSER_PATH,
  PLAYWRIGHT_CHILD_MCP_EXECUTABLE,
} from "../lib/child-mcp-playwright.js";
import type { LauncherAuthorizationBinding } from "../lib/tool-state-gate.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rm: vi.fn(actual.rm) };
});

const fixture = new URL("./fixtures/child-mcp-server.mjs", import.meta.url).pathname;
const TEST_CHILD_MCP_STARTUP_TIMEOUT_MS = 3_000;
const gateways: ChildMcpGateway[] = [];
const runtimeDirectories: string[] = [];

describe("compatibility runtime MCP launcher handoff", () => {
  const launcher = readFileSync(new URL("../../../scripts/start-opencode-web.sh", import.meta.url), "utf8")
    .replace("node /app/scripts/probe-api.mjs", "true")
    .replace("opencode serve --port 4098 --hostname 127.0.0.1", `${process.execPath} -e 'console.log(JSON.stringify(process.env))'`);
  const identity = {
    INGENIUM_PROJECT: "ingenium",
    INGENIUM_PROJECT_ID: "11111111-1111-4111-8111-111111111111",
    INGENIUM_ORGANIZATION_ID: "22222222-2222-4222-8222-222222222222",
    INGENIUM_RUNTIME_ID: "33333333-3333-4333-8333-333333333333",
    INGENIUM_RUNTIME_OWNER_ID: "44444444-4444-4444-8444-444444444444",
    INGENIUM_WORKSPACE_ID: "shared-memory-ingenium",
    INGENIUM_STORAGE_MAPPING_HASH: "a".repeat(64),
  };

  it("passes provisioned identity and an enabled runtime MCP entry instead of the persistent global-default entry", () => {
    const result = spawnSync("/bin/sh", ["-c", launcher], { env: identity, encoding: "utf8" });
    expect(result.status).toBe(0);
    const environment = JSON.parse(result.stdout.trim().split("\n").at(-1)!);
    expect(environment).toMatchObject(identity);
    expect(environment.INGENIUM_MCP_AUDIENCE).toBe("runtime");
    const config = JSON.parse(environment.OPENCODE_CONFIG_CONTENT.replace(/\{env:([^}]+)\}/g,
      (_match: string, key: string) => environment[key]));
    expect(config.mcp.ingenium).toMatchObject({
      enabled: true,
      command: ["node", "/app/packages/ingenium-extension/dist/scripts/mcp-server.js"],
      environment: { INGENIUM_MCP_AUDIENCE: "runtime", INGENIUM_MCP_CREDENTIAL_PURPOSE: "runtime",
        INGENIUM_RUNTIME_CREDENTIAL_FILE: "/run/ingenium-runtime/capability",
        INGENIUM_PROJECT: "ingenium", INGENIUM_WORKSPACE_ID: "shared-memory-ingenium", INGENIUM_WORKTREE: "/workspace" },
    });
  });

  it("rejects incomplete runtime identity before starting OpenCode", () => {
    const result = spawnSync("/bin/sh", ["-c", launcher], { env: { ...identity, INGENIUM_PROJECT_ID: "" }, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("compatibility runtime identity is incomplete");
    expect(result.stdout).not.toContain("OPENCODE_CONFIG_CONTENT");
  });

  it("does not manufacture empty runtime identity fields for a legacy compatibility launch", () => {
    const result = spawnSync("/bin/sh", ["-c", launcher], { env: {}, encoding: "utf8" });
    expect(result.status).toBe(0);
    const environment = JSON.parse(result.stdout.trim().split("\n").at(-1)!);
    expect(environment.INGENIUM_MCP_AUDIENCE).toBe("mcp");
    expect(environment.INGENIUM_RUNTIME_ID).toBeUndefined();
    expect(environment.INGENIUM_PROJECT_ID).toBeUndefined();
    expect(environment.OPENCODE_CONFIG_CONTENT).toBeUndefined();
  });
});

function createPlaywrightRuntime(browser = process.execPath) {
  const directory = mkdtempSync(join(tmpdir(), "ingenium-playwright-test-"));
  runtimeDirectories.push(directory);
  return new ManagedPlaywrightRuntime(browser, PLAYWRIGHT_CHILD_MCP_EXECUTABLE, directory);
}

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

function playwrightDefinition(): ChildMcpRuntimeDefinitionResponse {
  return {
    name: "playwright",
    executable: PLAYWRIGHT_CHILD_MCP_EXECUTABLE,
    args: [...PLAYWRIGHT_CHILD_MCP_ARGS],
    environment: {},
    scope: "project",
    owned: true,
    revision: "2026-09-05T00:00:00.000Z",
  };
}

function launcherBinding(): LauncherAuthorizationBinding {
  return {
    project: "child-gateway-project",
    projectId: "child-gateway-project-id",
    organizationId: "child-gateway-organization-id",
    workspaceId: "child-gateway-workspace-id",
    launcherWorktree: "/workspace/child-gateway-project",
    scopes: ["child-mcp:execute"],
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
      return {
        state: toolState,
        attestation,
        policy: {
          action: "child-mcp.execute",
          resource: "child-mcp",
          permission: "execute",
          target: "project",
          scopes: ["child-mcp:execute"],
          launcherBinding: "required",
        },
      };
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

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(gateways.splice(0).map((gateway) => gateway.shutdown()));
  for (const directory of runtimeDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("ChildMcpGateway", () => {
  it.each([
    { executable: "npx" },
    { args: [...PLAYWRIGHT_CHILD_MCP_ARGS, "--no-sandbox"] },
    { scope: "global" as const },
    { owned: false },
    { environment: { TOKEN: "secret" } },
  ])("rejects non-canonical Playwright runtime definitions: %j", async (override) => {
    const runtime = createPlaywrightRuntime();
    await expect(runtime.materialize(
      { ...playwrightDefinition(), ...override }, launcherBinding(), launcherBinding().project!,
    )).rejects.toThrow("PLAYWRIGHT_CHILD_MCP_DEFINITION_INVALID");
    await expect(runtime.materialize(runtimeDefinition(), undefined, "project"))
      .resolves.toEqual(runtimeDefinition());
  });

  it("persists ownership and cancellation, retains failed cleanup evidence, and resolves it on retry", async () => {
    const runtime = createPlaywrightRuntime();
    const definition = await runtime.materialize(playwrightDefinition(), launcherBinding(), launcherBinding().project!);
    const output = definition.args.at(-1)!.slice("--output-dir=".length);
    const ownership = join(dirname(output), "ownership.json");
    const failure = join(dirname(output), "failed-cleanup.json");
    expect(JSON.parse(readFileSync(ownership, "utf8"))).toMatchObject({
      version: 1, serverName: "playwright", ownerPid: process.pid,
      projectId: launcherBinding().projectId, organizationId: launcherBinding().organizationId,
      workspaceId: launcherBinding().workspaceId, launcherWorktree: launcherBinding().launcherWorktree,
      outputDirectory: output,
    });
    expect(statSync(ownership).mode & 0o777).toBe(0o600);
    await expect(runtime.materialize(playwrightDefinition(), launcherBinding(), launcherBinding().project!))
      .rejects.toThrow("PLAYWRIGHT_CHILD_MCP_CLEANUP_REQUIRED");
    vi.mocked(filesystem.rm).mockRejectedValueOnce(new Error("private diagnostic"));
    await expect(runtime.cleanup("playwright")).rejects.toThrow("private diagnostic");
    expect(existsSync(output)).toBe(true);
    expect(JSON.parse(readFileSync(ownership, "utf8"))).toHaveProperty("cancellationRequestedAt");
    expect(JSON.parse(readFileSync(failure, "utf8"))).toMatchObject({
      code: "PLAYWRIGHT_CHILD_MCP_CLEANUP_FAILED", outputDirectory: output,
      cancellationRequestedAt: expect.any(String),
    });
    expect(readFileSync(failure, "utf8")).not.toContain("private diagnostic");
    await runtime.cleanupAll();
    expect(existsSync(output)).toBe(false);
    expect(existsSync(failure)).toBe(false);
    expect(JSON.parse(readFileSync(ownership, "utf8"))).toMatchObject({
      cancellationRequestedAt: expect.any(String), cleanedAt: expect.any(String),
    });
    await expect(runtime.cleanupAll()).resolves.toBeUndefined();
  });

  it("materializes the pinned Playwright preset with isolated output, redacts it, and removes owned state on disable", async () => {
    const definitions = [playwrightDefinition()];
    const { host, tools } = createHost();
    const api = createApi(definitions);
    const manager = new ChildMcpRuntimeManager();
    let materialized: ChildMcpRuntimeDefinitionResponse | undefined;
    vi.spyOn(manager, "registerServer").mockImplementation((definition) => {
      materialized = definition as ChildMcpRuntimeDefinitionResponse;
    });
    vi.spyOn(manager, "startServer").mockResolvedValue({
      name: "playwright",
      state: "ready",
      pid: 123,
      toolCount: 1,
      diagnostic: null,
      lastExit: null,
      stderrBytes: 0,
    });
    vi.spyOn(manager, "listTools").mockResolvedValue([{
      name: "browser_snapshot",
      description: "Capture a snapshot.",
      inputSchema: { type: "object" },
    }]);
    vi.spyOn(manager, "callTool").mockImplementation(async () => ({
      content: [{ type: "text", text: `saved ${materialized?.args.at(-1)?.slice("--output-dir=".length)}/snapshot.md` }],
    }) as never);
    vi.spyOn(manager, "unregisterServer").mockResolvedValue(undefined);
    vi.spyOn(manager, "stopAll").mockResolvedValue(undefined);
    const gateway = new ChildMcpGateway(
      host,
      "child-gateway-project",
      api.api,
      manager,
      5_000,
      undefined,
      launcherBinding(),
      createPlaywrightRuntime(),
    );
    gateways.push(gateway);

    await gateway.start();

    expect(materialized?.args.slice(0, -1)).toEqual(
      PLAYWRIGHT_CHILD_MCP_ARGS.map((argument) => argument === PLAYWRIGHT_CHILD_MCP_BROWSER_PATH
        ? process.execPath
        : argument),
    );
    const outputArgument = materialized?.args.at(-1);
    expect(outputArgument).toContain("--output-dir=");
    const outputDirectory = outputArgument!.slice("--output-dir=".length);
    expect(existsSync(outputDirectory)).toBe(true);
    const result = await tools.get("playwright_browser_snapshot")!.handler({
      project: "child-gateway-project",
      arguments: {},
    });
    expect(JSON.stringify(result)).toContain("[playwright-output]/snapshot.md");
    expect(JSON.stringify(result)).not.toContain(outputDirectory);

    definitions.splice(0);
    await gateway.refresh();

    expect(manager.unregisterServer).toHaveBeenCalledWith("playwright");
    expect(existsSync(outputDirectory)).toBe(false);
    expect(tools.has("playwright_browser_snapshot")).toBe(false);
  });

  it("contains Playwright startup and reporter failures and cleans its owned output during shutdown", async () => {
    const { host, tools } = createHost();
    const api = createApi([playwrightDefinition()]);
    api.api.recordDiscovery = vi.fn(async () => { throw new Error("reporter unavailable"); });
    const manager = new ChildMcpRuntimeManager();
    let outputDirectory = "";
    vi.spyOn(manager, "registerServer").mockImplementation((definition) => {
      outputDirectory = definition.args.at(-1)!.slice("--output-dir=".length);
    });
    vi.spyOn(manager, "startServer").mockRejectedValue(new Error("child crashed"));
    vi.spyOn(manager, "stopAll").mockResolvedValue(undefined);
    const gateway = new ChildMcpGateway(
      host,
      "child-gateway-project",
      api.api,
      manager,
      5_000,
      undefined,
      launcherBinding(),
      createPlaywrightRuntime(),
    );
    gateways.push(gateway);

    await expect(gateway.start()).resolves.toBeUndefined();
    expect(api.api.recordDiscovery).toHaveBeenCalledTimes(1);
    expect(tools.size).toBe(0);
    expect(existsSync(outputDirectory)).toBe(true);

    const ownership = join(dirname(outputDirectory), "ownership.json");
    const failure = join(dirname(outputDirectory), "failed-cleanup.json");
    vi.mocked(manager.stopAll).mockImplementationOnce(async () => {
      expect(JSON.parse(readFileSync(ownership, "utf8"))).toHaveProperty("cancellationRequestedAt");
      throw new Error("stop failed");
    });
    await expect(gateway.shutdown()).rejects.toThrow("stop failed");
    expect(existsSync(outputDirectory)).toBe(true);
    expect(JSON.parse(readFileSync(failure, "utf8"))).toMatchObject({
      code: "PLAYWRIGHT_CHILD_MCP_CLEANUP_FAILED", outputDirectory,
    });
    await gateway.shutdown();
    expect(existsSync(outputDirectory)).toBe(false);
    expect(existsSync(failure)).toBe(false);
  });

  it("reports a missing managed browser as unavailable without starting a child", async () => {
    const { host, tools } = createHost();
    const api = createApi([playwrightDefinition()]);
    const manager = new ChildMcpRuntimeManager();
    const register = vi.spyOn(manager, "registerServer");
    vi.spyOn(manager, "stopAll").mockResolvedValue(undefined);
    const gateway = new ChildMcpGateway(
      host,
      "child-gateway-project",
      api.api,
      manager,
      5_000,
      undefined,
      launcherBinding(),
      createPlaywrightRuntime("/missing/ingenium-playwright/chromium"),
    );
    gateways.push(gateway);

    await expect(gateway.start()).resolves.toBeUndefined();

    expect(register).not.toHaveBeenCalled();
    expect(tools.size).toBe(0);
    expect(api.reports).toEqual([{ status: "failed", diagnostic: "unavailable" }]);
  });

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
    await vi.waitFor(
      () => expect(tools.has("fixture_echo")).toBe(true),
      { timeout: 1_500, interval: 20 },
    );

    definitions.splice(0);
    await vi.waitFor(
      () => expect(tools.has("fixture_echo")).toBe(false),
      { timeout: 1_500, interval: 20 },
    );
    await vi.waitFor(
      () => expect(host.sendToolListChanged).toHaveBeenCalledTimes(2),
      { timeout: 1_500, interval: 20 },
    );
    expect(host.sendToolListChanged).toHaveBeenCalledTimes(2);
  });

  it("contains a rejected failure reporter so optional child discovery cannot reject parent startup", async () => {
    const { host, tools } = createHost();
    const api = createApi([runtimeDefinition()]);
    api.api.recordDiscovery = vi.fn(async () => { throw new Error("reporter unavailable"); });
    const gateway = new ChildMcpGateway(
      host,
      "child-gateway-project",
      api.api,
      createManager(),
    );
    gateways.push(gateway);

    await expect(gateway.start()).resolves.toBeUndefined();
    expect(tools.has("fixture_echo")).toBe(false);
    expect(api.api.recordDiscovery).toHaveBeenCalledTimes(2);
  });
});
