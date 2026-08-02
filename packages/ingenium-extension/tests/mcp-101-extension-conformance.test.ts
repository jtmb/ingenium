import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const mockAssertExtensionToolEnabled = vi.hoisted(() => vi.fn());
const mockEnsureExtensionProject = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());
const mockTriggerSynthesis = vi.hoisted(() => vi.fn());

vi.mock("@opencode-ai/plugin", () => ({
  tool: (definition: unknown) => definition,
}));

vi.mock("../mcp-tool-state.js", () => ({
  assertExtensionToolEnabled: mockAssertExtensionToolEnabled,
}));

vi.mock("../project-resolver.js", () => ({
  ensureExtensionProject: mockEnsureExtensionProject,
  classifyExtensionProjectFailure: () => "unavailable",
}));

vi.mock("../api-auth.js", () => ({
  apiRequestHeaders: () => new Headers(),
}));

vi.mock("../observer-core.js", () => ({
  importObservationsFromFile: vi.fn(),
  logPipelineEvent: vi.fn(),
  triggerSynthesis: mockTriggerSynthesis,
}));

import { AutoObserverPlugin } from "../auto-observer.js";
import { ObserverPlugin } from "../observer.js";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalogSourcePath = resolve(extensionRoot, "../ingenium-core/lib/tools/mcp-tool-catalog.ts");
const worktree = "/worktree";

const EXTENSION_TOOL_CONTRACTS = [
  {
    name: "auto_observe_now",
    sourceFile: "auto-observer.ts",
    category: "Extraction",
    projectScope: "per-project",
    defaultEnabled: true,
    apiEndpoints: ["POST /api/v1/extraction/run"],
  },
  {
    name: "synthesize_observations",
    sourceFile: "observer.ts",
    category: "Synthesis",
    projectScope: "per-project",
    defaultEnabled: true,
    apiEndpoints: [
      "POST /api/v1/synthesis/run",
      "GET /api/v1/synthesis/status",
      "POST /api/v1/synthesis/cross-project",
    ],
  },
] as const;

type ExtensionToolName = (typeof EXTENSION_TOOL_CONTRACTS)[number]["name"];

interface ToolDefinition {
  args: Record<string, unknown>;
  description: string;
  execute: (args: unknown, context: { worktree: string }) => Promise<string>;
}

interface CanonicalCatalogEntry {
  name: string;
  category: string;
  description: string;
  projectScope: string;
  defaultEnabled: boolean;
  apiEndpoints: string[];
}

function response(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function extractSourceToolNames(sourceFile: string): string[] {
  const source = readFileSync(join(extensionRoot, sourceFile), "utf8");
  const registrations: string[] = [];
  const registrationPattern = /^\s*([A-Za-z_$][\w$]*)\s*:\s*tool\s*\(/gm;
  let match: RegExpExecArray | null;
  while ((match = registrationPattern.exec(source)) !== null) {
    registrations.push(match[1]!);
  }
  return registrations;
}

function readCanonicalCatalog(): CanonicalCatalogEntry[] {
  const source = readFileSync(catalogSourcePath, "utf8");
  const endpointDefinitions = new Map<string, string[]>();
  const endpointPattern = /const ([A-Z_]+_ENDPOINTS) = \[([\s\S]*?)\];/g;
  let endpointMatch: RegExpExecArray | null;
  while ((endpointMatch = endpointPattern.exec(source)) !== null) {
    endpointDefinitions.set(
      endpointMatch[1]!,
      [...endpointMatch[2]!.matchAll(/"([^"]+)"/g)].map((match) => match[1]!),
    );
  }

  const entries: CanonicalCatalogEntry[] = [];
  const entryPattern = /\{\s*name: "([^"]+)",\s*category: "([^"]+)",\s*description: "((?:\\.|[^"])*)",\s*projectScope: "(per-project|global)",\s*defaultEnabled: (true|false),\s*apiEndpoints: ([A-Z_]+_ENDPOINTS),\s*\}/g;
  let entryMatch: RegExpExecArray | null;
  while ((entryMatch = entryPattern.exec(source)) !== null) {
    const apiEndpoints = endpointDefinitions.get(entryMatch[6]!);
    if (!apiEndpoints) throw new Error(`Missing canonical endpoint definition: ${entryMatch[6]}`);
    entries.push({
      name: entryMatch[1]!,
      category: entryMatch[2]!,
      description: entryMatch[3]!,
      projectScope: entryMatch[4]!,
      defaultEnabled: entryMatch[5] === "true",
      apiEndpoints,
    });
  }
  return entries;
}

async function loadManualTools(): Promise<Record<ExtensionToolName, ToolDefinition>> {
  const [auto, observer] = await Promise.all([
    AutoObserverPlugin({ worktree, client: { app: { log: vi.fn() } } }),
    ObserverPlugin({ worktree, client: { app: { log: vi.fn() } } }),
  ]);

  return {
    auto_observe_now: auto.tool.auto_observe_now as ToolDefinition,
    synthesize_observations: observer.tool.synthesize_observations as ToolDefinition,
  };
}

describe("MCP-101 extension registration conformance", () => {
  beforeEach(() => {
    mockAssertExtensionToolEnabled.mockResolvedValue("extension-project");
    mockEnsureExtensionProject.mockResolvedValue("extension-project");
    mockFetch.mockResolvedValue(response({ data: { created: 0 } }));
    mockTriggerSynthesis.mockResolvedValue({ triggered: true, message: "ok" });
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("registers exactly the two approved tools and reconciles them with the canonical catalog", () => {
    const sourceNames = EXTENSION_TOOL_CONTRACTS.flatMap(({ sourceFile }) => extractSourceToolNames(sourceFile));
    const expectedNames = EXTENSION_TOOL_CONTRACTS.map(({ name }) => name);
    const catalogExtensionNames = readCanonicalCatalog()
      .filter(({ name }) => !name.startsWith("ingenium_"))
      .map(({ name }) => name);

    expect(sourceNames).toEqual(expectedNames);
    expect(new Set(sourceNames).size).toBe(sourceNames.length);
    expect([...catalogExtensionNames].sort()).toEqual([...expectedNames].sort());
    expect(new Set(catalogExtensionNames).size).toBe(catalogExtensionNames.length);
  });

  it("exposes empty schemas and exact canonical categories, defaults, descriptions, and endpoints", async () => {
    const tools = await loadManualTools();
    const catalog = new Map(readCanonicalCatalog().map((entry) => [entry.name, entry]));

    for (const contract of EXTENSION_TOOL_CONTRACTS) {
      const definition = tools[contract.name];
      const entry = catalog.get(contract.name);

      expect(entry).toEqual({
        name: contract.name,
        category: contract.category,
        description: definition.description,
        projectScope: contract.projectScope,
        defaultEnabled: contract.defaultEnabled,
        apiEndpoints: contract.apiEndpoints,
      });
      expect(definition.args).toEqual({});
      expect(Object.keys(definition.args)).toEqual([]);
    }
  });

  it("uses exact guard names and triggers only after the guard succeeds", async () => {
    const tools = await loadManualTools();

    await tools.auto_observe_now.execute({}, { worktree });
    await tools.synthesize_observations.execute({}, { worktree });

    expect(mockAssertExtensionToolEnabled.mock.calls.map(([name]) => name)).toEqual([
      "auto_observe_now",
      "synthesize_observations",
    ]);
    expect(mockAssertExtensionToolEnabled.mock.calls.every(([, guardedWorktree]) => guardedWorktree === worktree)).toBe(true);
    expect(mockAssertExtensionToolEnabled.mock.invocationCallOrder[0]).toBeLessThan(mockFetch.mock.invocationCallOrder[0]!);
    expect(mockAssertExtensionToolEnabled.mock.invocationCallOrder[1]).toBeLessThan(mockTriggerSynthesis.mock.invocationCallOrder[0]!);
  });

  it.each(["TOOL_DISABLED", "TOOL_STATE_UNAVAILABLE"] as const)(
    "fails closed with %s before either trigger",
    async (stateError) => {
      const tools = await loadManualTools();
      mockAssertExtensionToolEnabled.mockRejectedValue(new Error(stateError));

      for (const contract of EXTENSION_TOOL_CONTRACTS) {
        await expect(tools[contract.name].execute({}, { worktree })).rejects.toThrow(stateError);
      }

      expect(mockAssertExtensionToolEnabled.mock.calls.map(([name]) => name)).toEqual([
        "auto_observe_now",
        "synthesize_observations",
      ]);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockTriggerSynthesis).not.toHaveBeenCalled();
    },
  );
});
