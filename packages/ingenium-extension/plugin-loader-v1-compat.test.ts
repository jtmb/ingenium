import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resetEnsuredProjects } from "./project-resolver.js";
import { resetProjectCache } from "./resource-sync.js";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = resolve(extensionRoot, "../..");
const wrapperSpecs = [
  "./packages/ingenium-extension/plugins/auto-observer.ts",
  "./packages/ingenium-extension/plugins/observer.ts",
  "./packages/ingenium-extension/plugins/resource-sync.ts",
] as const;
const OPENCODE_VERSION = "1.18.9";
const OPENCODE_PLUGIN_INTEGRITY = "sha512-0kFX9Usj+3N+WupIe9VnEdDNzMNbW4/C5GeIzdj02/t5kQoXsNrFpW3Br9aABebazcaYsQEWdlaLV0zQISy3OA==";
const OPENCODE_SDK_INTEGRITY = "sha512-oDJSmsmiGW+3lNLmZYj3EpUkpiT3ITZBKffH3mrmu2KMJXlkxQ/Nvv7jqPffSM7o8lCdBZS/aCE+2GkA3/92gQ==";

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

  afterEach(() => {
    vi.unstubAllGlobals();
    resetEnsuredProjects();
    resetProjectCache();
    if (originalProject === undefined) delete process.env.INGENIUM_PROJECT;
    else process.env.INGENIUM_PROJECT = originalProject;
  });

  it("uses explicit local wrapper specs and rejects bare package-like paths", () => {
    const config = JSON.parse(readFileSync(resolve(repositoryRoot, "opencode.json"), "utf8")) as { plugin: string[] };

    expect(config.plugin).toEqual(wrapperSpecs);
    for (const spec of config.plugin) {
      expect(isOpenCode1189PathPluginSpec(spec)).toBe(true);
      expect(resolveOpenCode1189PathPlugin(spec, repositoryRoot)).toBe(
        pathToFileURL(resolve(repositoryRoot, spec)).href,
      );
      expect(resolveOpenCode1189ServerEntrypoint(spec, repositoryRoot)).toBe(
        pathToFileURL(resolve(repositoryRoot, spec)).href,
      );
    }

    expect(() => resolveOpenCode1189PathPlugin("packages/ingenium-extension/resource-sync.ts", repositoryRoot))
      .toThrow("npm package spec");
    expect(resolveOpenCode1189ServerEntrypoint("./packages/ingenium-extension/resource-sync.ts", repositoryRoot)).toBe(
      pathToFileURL(resolve(extensionRoot, "dist/index.js")).href,
    );
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

  it("packages V1-only default wrappers and invokes only their server implementations", async () => {
    const [autoWrapper, observerWrapper, resourceWrapper, autoImplementation, observerImplementation, resourceImplementation] = await Promise.all([
      import("./plugins/auto-observer.js"),
      import("./plugins/observer.js"),
      import("./plugins/resource-sync.js"),
      import("./auto-observer.js"),
      import("./observer.js"),
      import("./resource-sync.js"),
    ]);
    const wrappers = [autoWrapper, observerWrapper, resourceWrapper];

    for (const wrapper of wrappers) {
      expect(Object.keys(wrapper)).toEqual(["default"]);
      expect(readOpenCode1189V1Server(wrapper, "wrapper")).toBeDefined();
    }
    expect([autoWrapper.default.id, observerWrapper.default.id, resourceWrapper.default.id]).toEqual([
      "ingenium-auto-observer",
      "ingenium-observer",
      "ingenium-resource-sync",
    ]);
    expect(new Set([autoWrapper.default.id, observerWrapper.default.id, resourceWrapper.default.id]).size).toBe(3);
    expect(autoWrapper.default.server).toBe(autoImplementation.AutoObserverPlugin);
    expect(observerWrapper.default.server).toBe(observerImplementation.ObserverPlugin);
    expect(resourceWrapper.default.server).toBe(resourceImplementation.ResourceSyncPlugin);

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

  it("publishes the V1 wrapper artifacts through package exports", () => {
    const packageJson = JSON.parse(readFileSync(resolve(extensionRoot, "package.json"), "utf8")) as {
      exports: Record<string, { types: string; import: string }>;
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
  });
});
