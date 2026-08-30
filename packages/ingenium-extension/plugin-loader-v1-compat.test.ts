import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resetEnsuredProjects } from "./project-resolver.js";
import { resetProjectCache } from "./resource-sync.js";
// @ts-expect-error This runtime ESM manifest intentionally has no TypeScript declaration file.
import { CANONICAL_PLUGIN_SPECS } from "./plugin-specs.mjs";

const { mockCallMcpTool, mockOpenMcpToolClient, MockMcpBridgeError } = vi.hoisted(() => ({
  mockCallMcpTool: vi.fn(),
  mockOpenMcpToolClient: vi.fn(),
  MockMcpBridgeError: class extends Error {
    constructor(readonly failure: string) {
      super("bridge");
    }
  },
}));

vi.mock("./mcp-client.js", () => ({
  callMcpTool: mockCallMcpTool,
  openMcpToolClient: mockOpenMcpToolClient,
  mcpToolData: (result: { content: Array<{ text: string }> }) => JSON.parse(result.content[0]!.text),
  McpBridgeError: MockMcpBridgeError,
}));

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = resolve(extensionRoot, "../..");
const wrapperSpecs = [
  "file://{env:PWD}/packages/ingenium-extension/plugins/auto-observer.ts",
  "file://{env:PWD}/packages/ingenium-extension/plugins/observer.ts",
  "file://{env:PWD}/packages/ingenium-extension/plugins/resource-sync.ts",
  "file://{env:PWD}/packages/ingenium-extension/plugins/session-coordinator.ts",
] as const;
const ponytailPluginSpec = "file://{env:PWD}/packages/ingenium-extension/ponytail/.opencode/plugins/ponytail.mjs";
const OPENCODE_VERSION = "1.18.9";
const OPENCODE_PLUGIN_INTEGRITY = "sha512-0kFX9Usj+3N+WupIe9VnEdDNzMNbW4/C5GeIzdj02/t5kQoXsNrFpW3Br9aABebazcaYsQEWdlaLV0zQISy3OA==";
const OPENCODE_SDK_INTEGRITY = "sha512-oDJSmsmiGW+3lNLmZYj3EpUkpiT3ITZBKffH3mrmu2KMJXlkxQ/Nvv7jqPffSM7o8lCdBZS/aCE+2GkA3/92gQ==";
const OPENCODE_HOOK_SOURCES = ["1.18.9", "1.18.22"].map((version) => ({
  version,
  plugin: `https://unpkg.com/@opencode-ai/plugin@${version}/dist/index.d.ts`,
  sdk: `https://unpkg.com/@opencode-ai/sdk@${version}/dist/gen/types.gen.d.ts`,
}));
const OPENCODE_HOOK_MATRIX = {
  sessionCreated: { event: { type: "session.created", properties: { info: { id: "session-fixture" } } } },
  toolBefore: { input: { tool: "write", sessionID: "session-fixture", callID: "call-fixture" }, output: { args: { path: "src/file.ts" } } },
  toolAfter: { input: { tool: "write", sessionID: "session-fixture", callID: "call-fixture", args: { path: "src/file.ts" } }, output: { title: "", output: "", metadata: {} } },
  toolCompleted: { event: { type: "message.part.updated", properties: { part: { type: "tool", sessionID: "session-fixture", callID: "call-fixture", state: { status: "completed" } } } } },
  toolError: { event: { type: "message.part.updated", properties: { part: { type: "tool", sessionID: "session-fixture", callID: "call-fixture", state: { status: "error" } } } } },
  sessionIdle: { event: { type: "session.idle", properties: { sessionID: "session-fixture" } } },
  sessionError: { event: { type: "session.error", properties: { sessionID: "session-fixture" } } },
  systemTransform: { input: { sessionID: "session-fixture", model: {} }, output: { system: [] as string[] } },
} as const;

type V1Plugin = {
  id: string;
  server: (input: unknown) => Promise<unknown> | unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Mirrors OpenCode 1.18.9's path-plugin classification. */
function isOpenCode1189PathPluginSpec(spec: string): boolean {
  return spec.startsWith("file://") || spec.startsWith(".") || isAbsolute(spec);
}

/** Mirrors the local-file branch of OpenCode 1.18.9's resolvePathPluginTarget(). */
function resolveOpenCode1189PathPlugin(spec: string, cwd: string): string {
  if (!isOpenCode1189PathPluginSpec(spec)) {
    throw new TypeError(`OpenCode would treat ${spec} as an npm package spec`);
  }
  const path = spec.startsWith("file://") ? fileURLToPath(spec) : resolve(cwd, spec);
  return spec.startsWith("file://") ? spec : pathToFileURL(path).href;
}

function substituteOpenCodeConfigEnvironment(spec: string, environment: Record<string, string>): string {
  return spec.replace(/\{env:([^}]+)\}/g, (_token, name: string) => environment[name] ?? "");
}

function deduplicateOpenCodePluginUrls(specs: string[]): string[] {
  const seen = new Set<string>();
  return [...specs].reverse().filter((spec: string) => {
    if (seen.has(spec)) return false;
    seen.add(spec);
    return true;
  }).reverse();
}

/**
 * Mirrors the server-entry selection OpenCode performs after resolving a local
 * path. It only probes `package.json` adjacent to the target, so wrapper files
 * must not sit alongside the extension package manifest (whose `main` points
 * to the broad named-export entrypoint).
 */
function resolveOpenCode1189ServerEntrypoint(spec: string, cwd: string): string {
  const target = resolveOpenCode1189PathPlugin(spec, cwd);
  const targetPath = fileURLToPath(target);
  const packagePath = resolve(dirname(targetPath), "package.json");
  if (!existsSync(packagePath)) return target;

  const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { main?: unknown };
  if (typeof packageJson.main !== "string" || packageJson.main.trim().length === 0) return target;
  return pathToFileURL(resolve(dirname(targetPath), packageJson.main)).href;
}

/**
 * Mirrors OpenCode 1.18.9's readV1Plugin(..., "server", "detect") and the
 * following server invocation. Named exports deliberately remain untouched.
 */
function readOpenCode1189V1Server(mod: Record<string, unknown>, spec: string): V1Plugin | undefined {
  const value = mod.default;
  if (!isRecord(value)) return undefined;
  if (!("id" in value) && !("server" in value) && !("tui" in value)) return undefined;
  if (typeof value.id !== "string" || value.id.trim().length === 0) {
    throw new TypeError(`Path plugin ${spec} must export a stable id`);
  }
  if (typeof value.server !== "function") {
    throw new TypeError(`Plugin ${spec} must default export an object with server()`);
  }
  if ("tui" in value) {
    throw new TypeError(`Plugin ${spec} must default export either server() or tui(), not both`);
  }
  return value as V1Plugin;
}

async function applyOpenCode1189V1Server(mod: Record<string, unknown>, spec: string, input: unknown): Promise<unknown> {
  const plugin = readOpenCode1189V1Server(mod, spec);
  if (!plugin) throw new TypeError(`Plugin ${spec} is not a V1 server plugin`);
  return plugin.server(input);
}

describe.sequential("OpenCode 1.18.9 plugin-loader compatibility", () => {
  const originalProject = process.env.INGENIUM_PROJECT;
  const originalToken = process.env.INGENIUM_API_TOKEN;
  const originalWorkspace = process.env.INGENIUM_WORKSPACE_ID;
  const originalStorageMappingHash = process.env.INGENIUM_STORAGE_MAPPING_HASH;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    mockCallMcpTool.mockReset();
    mockOpenMcpToolClient.mockReset();
    resetEnsuredProjects();
    resetProjectCache();
    if (originalProject === undefined) delete process.env.INGENIUM_PROJECT;
    else process.env.INGENIUM_PROJECT = originalProject;
    if (originalToken === undefined) delete process.env.INGENIUM_API_TOKEN;
    else process.env.INGENIUM_API_TOKEN = originalToken;
    if (originalWorkspace === undefined) delete process.env.INGENIUM_WORKSPACE_ID;
    else process.env.INGENIUM_WORKSPACE_ID = originalWorkspace;
    if (originalStorageMappingHash === undefined) delete process.env.INGENIUM_STORAGE_MAPPING_HASH;
    else process.env.INGENIUM_STORAGE_MAPPING_HASH = originalStorageMappingHash;
  });

  it("uses explicit local wrapper specs and rejects bare package-like paths", () => {
    const config = JSON.parse(readFileSync(resolve(repositoryRoot, "opencode.json"), "utf8")) as { plugin: string[] };

    expect(config.plugin).toEqual(CANONICAL_PLUGIN_SPECS);
    expect(config.plugin).toEqual([...wrapperSpecs, ponytailPluginSpec]);
    for (const spec of config.plugin) {
      const substituted = substituteOpenCodeConfigEnvironment(spec, { PWD: repositoryRoot });
      expect(isOpenCode1189PathPluginSpec(substituted)).toBe(true);
      expect(resolveOpenCode1189PathPlugin(substituted, repositoryRoot)).toBe(substituted);
      expect(resolveOpenCode1189ServerEntrypoint(substituted, repositoryRoot)).toBe(substituted);
    }

    expect(() => resolveOpenCode1189PathPlugin("packages/ingenium-extension/resource-sync.ts", repositoryRoot))
      .toThrow("npm package spec");
    expect(resolveOpenCode1189ServerEntrypoint("./packages/ingenium-extension/resource-sync.ts", repositoryRoot)).toBe(
      pathToFileURL(resolve(extensionRoot, "dist/index.js")).href,
    );
  });

  it("deduplicates global, project, and managed declarations to five exact file URLs on 1.18.9 and 1.18.22", () => {
    for (const version of OPENCODE_HOOK_SOURCES.map((source) => source.version)) {
      const resolved = CANONICAL_PLUGIN_SPECS.map((spec: string) =>
        resolveOpenCode1189PathPlugin(substituteOpenCodeConfigEnvironment(spec, { PWD: "/app" }), "/workspace"));
      expect(deduplicateOpenCodePluginUrls([...resolved, ...resolved, ...resolved]), version).toEqual(resolved);
      expect(resolved).toHaveLength(5);
      expect(new Set(resolved).size).toBe(5);
    }
  });

  it("pins every direct plugin declaration and its locked SDK transitively to 1.18.9", () => {
    const rootManifest = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8")) as {
      devDependencies: Record<string, string>;
    };
    const extensionManifest = JSON.parse(readFileSync(resolve(extensionRoot, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    const localManifest = JSON.parse(readFileSync(resolve(repositoryRoot, ".opencode/package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    const rootLock = JSON.parse(readFileSync(resolve(repositoryRoot, "package-lock.json"), "utf8")) as {
      packages: Record<string, { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; version?: string; integrity?: string }>;
    };
    const localLock = JSON.parse(readFileSync(resolve(repositoryRoot, ".opencode/package-lock.json"), "utf8")) as {
      packages: Record<string, { dependencies?: Record<string, string>; version?: string; integrity?: string }>;
    };

    expect(rootManifest.devDependencies["@opencode-ai/plugin"]).toBe(OPENCODE_VERSION);
    expect(extensionManifest.dependencies["@opencode-ai/plugin"]).toBe(OPENCODE_VERSION);
    expect(localManifest.dependencies["@opencode-ai/plugin"]).toBe(OPENCODE_VERSION);
    expect(rootLock.packages[""]?.devDependencies?.["@opencode-ai/plugin"]).toBe(OPENCODE_VERSION);
    expect(rootLock.packages["packages/ingenium-extension"]?.dependencies?.["@opencode-ai/plugin"]).toBe(OPENCODE_VERSION);
    expect(localLock.packages[""]?.dependencies?.["@opencode-ai/plugin"]).toBe(OPENCODE_VERSION);

    for (const lock of [rootLock, localLock]) {
      const plugin = lock.packages["node_modules/@opencode-ai/plugin"];
      const sdk = lock.packages["node_modules/@opencode-ai/sdk"];
      expect(plugin).toMatchObject({
        version: OPENCODE_VERSION,
        integrity: OPENCODE_PLUGIN_INTEGRITY,
        dependencies: { "@opencode-ai/sdk": OPENCODE_VERSION },
      });
      expect(sdk).toMatchObject({
        version: OPENCODE_VERSION,
        integrity: OPENCODE_SDK_INTEGRITY,
      });
    }
  });

  it("covers the source-backed 1.18.9 and 1.18.22 lifecycle hook matrix without changing the pin", () => {
    expect(OPENCODE_HOOK_SOURCES).toEqual([
      {
        version: "1.18.9",
        plugin: "https://unpkg.com/@opencode-ai/plugin@1.18.9/dist/index.d.ts",
        sdk: "https://unpkg.com/@opencode-ai/sdk@1.18.9/dist/gen/types.gen.d.ts",
      },
      {
        version: "1.18.22",
        plugin: "https://unpkg.com/@opencode-ai/plugin@1.18.22/dist/index.d.ts",
        sdk: "https://unpkg.com/@opencode-ai/sdk@1.18.22/dist/gen/types.gen.d.ts",
      },
    ]);
    for (const source of OPENCODE_HOOK_SOURCES) {
      expect(source.plugin).toContain(`@${source.version}/`);
      expect(source.sdk).toContain(`@${source.version}/`);
      expect(OPENCODE_HOOK_MATRIX.sessionCreated.event.type).toBe("session.created");
      expect(Object.keys(OPENCODE_HOOK_MATRIX.toolBefore)).toEqual(["input", "output"]);
      expect(Object.keys(OPENCODE_HOOK_MATRIX.toolAfter)).toEqual(["input", "output"]);
      expect(OPENCODE_HOOK_MATRIX.toolCompleted.event.properties.part.state.status).toBe("completed");
      expect(OPENCODE_HOOK_MATRIX.toolError.event.properties.part.state.status).toBe("error");
      expect(OPENCODE_HOOK_MATRIX.sessionIdle.event.type).toBe("session.idle");
      expect(OPENCODE_HOOK_MATRIX.sessionError.event.type).toBe("session.error");
      expect(Object.keys(OPENCODE_HOOK_MATRIX.systemTransform)).toEqual(["input", "output"]);
    }
  });

  it("packages V1-only default wrappers and invokes only their server implementations", async () => {
    const [autoWrapper, observerWrapper, resourceWrapper, coordinatorWrapper, autoImplementation, observerImplementation, resourceImplementation, coordinatorImplementation] = await Promise.all([
      import("./plugins/auto-observer.js"),
      import("./plugins/observer.js"),
      import("./plugins/resource-sync.js"),
      import("./plugins/session-coordinator.js"),
      import("./auto-observer.js"),
      import("./observer.js"),
      import("./resource-sync.js"),
      import("./session-coordinator.js"),
    ]);
    const wrappers = [autoWrapper, observerWrapper, resourceWrapper, coordinatorWrapper];

    for (const wrapper of wrappers) {
      expect(Object.keys(wrapper)).toEqual(["default"]);
      expect(readOpenCode1189V1Server(wrapper, "wrapper")).toBeDefined();
    }
    expect([autoWrapper.default.id, observerWrapper.default.id, resourceWrapper.default.id, coordinatorWrapper.default.id]).toEqual([
      "ingenium-auto-observer",
      "ingenium-observer",
      "ingenium-resource-sync",
      "ingenium-session-coordinator",
    ]);
    expect(new Set(wrappers.map((wrapper) => wrapper.default.id)).size).toBe(4);
    expect(autoWrapper.default.server).toBe(autoImplementation.AutoObserverPlugin);
    expect(observerWrapper.default.server).toBe(observerImplementation.ObserverPlugin);
    expect(resourceWrapper.default.server).toBe(resourceImplementation.ResourceSyncPlugin);
    expect(coordinatorWrapper.default.server).toBe(coordinatorImplementation.SessionCoordinatorPlugin);

    const server = vi.fn().mockResolvedValue({ loaded: true });
    const callableNamedExport = vi.fn();
    await expect(applyOpenCode1189V1Server({
      default: { id: "v1-server-only", server },
      callableNamedExport,
    }, "./fixture.ts", {})).resolves.toEqual({ loaded: true });
    expect(server).toHaveBeenCalledOnce();
    expect(callableNamedExport).not.toHaveBeenCalled();
  });

  it("registers existing lifecycle hooks through the V1 wrappers", async () => {
    process.env.INGENIUM_PROJECT = "plugin-loader-v1-test";
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const path = new URL(String(url)).pathname;
      return {
        ok: true,
        status: path.endsWith("/auth/preflight") ? 200 : 201,
        json: async () => ({ data: {} }),
      } as Response;
    }));

    const [autoWrapper, observerWrapper, resourceWrapper] = await Promise.all([
      import("./plugins/auto-observer.js"),
      import("./plugins/observer.js"),
      import("./plugins/resource-sync.js"),
    ]);
    const input = {
      worktree: "/safe/plugin-loader-v1-worktree",
      client: {
        app: { log: vi.fn() },
        session: { messages: vi.fn() },
      },
    };

    const autoHooks = await applyOpenCode1189V1Server(autoWrapper, wrapperSpecs[0], input) as {
      event: unknown;
      tool: Record<string, unknown>;
    };
    const observerHooks = await applyOpenCode1189V1Server(observerWrapper, wrapperSpecs[1], input) as {
      event: unknown;
      tool: Record<string, unknown>;
    };
    const resourceSyncHooks = await applyOpenCode1189V1Server(resourceWrapper, wrapperSpecs[2], input) as {
      event: unknown;
      tool?: Record<string, unknown>;
    };

    expect(typeof autoHooks.event).toBe("function");
    expect(typeof observerHooks.event).toBe("function");
    expect(typeof resourceSyncHooks.event).toBe("function");
    expect(Object.keys(autoHooks.tool)).toEqual(["auto_observe_now"]);
    expect(Object.keys(observerHooks.tool)).toEqual(["synthesize_observations"]);
    expect(resourceSyncHooks.tool).toBeUndefined();
  });

  it("starts resource sync without resolver stderr when the parent plugin environment has no project", async () => {
    delete process.env.INGENIUM_PROJECT;
    const worktree = mkdtempSync(join(tmpdir(), "ingenium-plugin-fallback-"));
    execFileSync("git", ["init", "--quiet", worktree]);
    process.env.INGENIUM_WORKSPACE_ID = "plugin-fallback-workspace";
    process.env.INGENIUM_STORAGE_MAPPING_HASH = "a".repeat(64);
    mkdirSync(join(worktree, ".opencode"));
    writeFileSync(
      join(worktree, ".opencode", ".ingenium-mcp-credential"),
      `${"m".repeat(32)}\n`,
      { mode: 0o600 },
    );
    writeFileSync(
      join(worktree, ".opencode", ".ingenium-repository-sync-credential"),
      `${"r".repeat(32)}\n`,
      { mode: 0o600 },
    );
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let revision = 0;
    const response = (value: unknown) => ({ content: [{ text: JSON.stringify(value) }] });
    const session = () => ({ actorId: `actor-${"b".repeat(64)}`, revision: revision++, fence: 1, state: "active" });
    mockOpenMcpToolClient.mockImplementation(async (boundWorktree: string) => ({
      callTool: (name: string, args: Record<string, unknown>) => mockCallMcpTool(boundWorktree, name, args),
      close: vi.fn(async () => undefined),
    }));
    mockCallMcpTool.mockImplementation(async (_worktree: string, name: string, args: Record<string, unknown>) => {
      if (name === "coordination_update" && args.operation === "register") return response({
        session: session(),
        memory: {
          conversationId: "00000000-0000-4000-8000-000000000001",
          revision: 0,
          entries: [],
          throughRevision: 0,
          acknowledgementRequired: false,
        },
      });
      if (name === "coordination_claim" && args.action === undefined) return response({
        session: session(), acceptedEpoch: 1, manifestGeneration: 0,
        operationId: "00000000-0000-4000-8000-000000000002",
      });
      if (name === "coordination_claim") return response({ session: session() });
      if (name === "repository_sync") return response({
        docs: { summary: {} },
        resources: { summary: { skill: {}, agent: {}, plugin: {} } },
        generation: 1,
        manifestHash: "c".repeat(64),
      });
      throw new Error(`Unexpected MCP tool: ${name}`);
    });

    try {
      const resourceWrapper = await import("./plugins/resource-sync.js");
      const hooks = await applyOpenCode1189V1Server(resourceWrapper, wrapperSpecs[2], {
        worktree,
        client: { app: { log: vi.fn() } },
      }) as { event: (input: unknown) => Promise<void> };

      await expect(hooks.event(OPENCODE_HOOK_MATRIX.sessionCreated)).resolves.toBeUndefined();
      expect(mockCallMcpTool).toHaveBeenCalledWith(worktree, "repository_sync", expect.objectContaining({
        project: basename(worktree),
      }));
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("keeps unavailable binding failures from every V1 lifecycle wrapper off stdio", async () => {
    process.env.INGENIUM_PROJECT = "plugin-loader-v1-failure";
    process.env.INGENIUM_API_TOKEN = "a".repeat(32);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockCallMcpTool.mockImplementation(async () => {
      expect(process.env.INGENIUM_API_TOKEN).toBe("a".repeat(32));
      throw new MockMcpBridgeError("authentication");
    });

    const [autoWrapper, observerWrapper, resourceWrapper] = await Promise.all([
      import("./plugins/auto-observer.js"),
      import("./plugins/observer.js"),
      import("./plugins/resource-sync.js"),
    ]);
    const log = vi.fn().mockRejectedValue(new Error("logger rejected Bearer secret-token"));
    const input = { worktree: "/safe/plugin-loader-v1-failure", client: { app: { log } } };

    const autoHooks = await applyOpenCode1189V1Server(autoWrapper, wrapperSpecs[0], input) as { event: (input: unknown) => Promise<void> };
    const observerHooks = await applyOpenCode1189V1Server(observerWrapper, wrapperSpecs[1], input) as { event: (input: unknown) => Promise<void> };
    const resourceHooks = await applyOpenCode1189V1Server(resourceWrapper, wrapperSpecs[2], input) as { event: (input: unknown) => Promise<void> };

    await expect(autoHooks.event({ event: { type: "session.idle" } })).resolves.toBeUndefined();
    await expect(observerHooks.event({ event: { type: "session.created" } })).resolves.toBeUndefined();
    await expect(resourceHooks.event({ event: { type: "session.created" } })).resolves.toBeUndefined();
    await Promise.resolve();

    const output = JSON.stringify(log.mock.calls);
    expect(output).toContain("trigger_extraction: request_failed");
    expect(output).toContain("resource_sync: request_failed");
    expect(output).not.toContain("extension_project_init");
    expect(output).not.toContain("secret-token");
    expect(output).not.toContain("private.example");
    expect(output).not.toContain("stack");
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  it("publishes the V1 wrapper artifacts through package exports", () => {
    const packageJson = JSON.parse(readFileSync(resolve(extensionRoot, "package.json"), "utf8")) as {
      exports: Record<string, { types: string; import: string } | string>;
      files: string[];
    };

    expect(packageJson.exports["./plugins/auto-observer"]).toEqual({
      types: "./dist/plugins/auto-observer.d.ts",
      import: "./dist/plugins/auto-observer.js",
    });
    expect(packageJson.exports["./plugins/observer"]).toEqual({
      types: "./dist/plugins/observer.d.ts",
      import: "./dist/plugins/observer.js",
    });
    expect(packageJson.exports["./plugins/resource-sync"]).toEqual({
      types: "./dist/plugins/resource-sync.d.ts",
      import: "./dist/plugins/resource-sync.js",
    });
    expect(packageJson.exports["./plugins/session-coordinator"]).toEqual({
      types: "./dist/plugins/session-coordinator.d.ts",
      import: "./dist/plugins/session-coordinator.js",
    });
    expect(packageJson.exports["./plugins/ponytail"]).toBe("./ponytail/.opencode/plugins/ponytail.mjs");
    expect(packageJson.exports["./plugin-specs"]).toBe("./plugin-specs.mjs");
    expect(packageJson.files).toEqual(expect.arrayContaining(["plugin-specs.mjs", "ponytail/"]));
  });
});
