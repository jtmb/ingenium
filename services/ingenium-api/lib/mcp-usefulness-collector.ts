import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mcpUsefulnessEvidence } from "ingenium-core";
import { timingSafeEqual } from "node:crypto";
import { dirname, resolve } from "node:path";
import { config } from "../config/index.js";
import { isPackagedMcpLauncher, resolvePackagedMcpLauncher } from "./mcp-launcher.js";
import { readApiTokenFile } from "./middleware/api-token.js";

export const MCP_USEFULNESS_TIMEOUT_MS = 5_000;
export const MCP_USEFULNESS_CACHE_TTL_MS = 30_000;
export const MCP_USEFULNESS_MAX_CACHED_PROJECTS = 64;
export const MCP_USEFULNESS_MAX_CONCURRENT = 2;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_PROJECT_NAME = /^(?!\.{1,2}$)[^\s/\\\u0000-\u001f\u007f][^/\\\u0000-\u001f\u007f]{0,63}$/;
const SAFE_TOOL_NAME = /^[a-z][a-z0-9_]{0,255}$/;

type McpToolUsefulnessReport = ReturnType<typeof mcpUsefulnessEvidence.buildMcpToolUsefulnessEvidenceReport>;

export type McpUsefulnessTransportSnapshot =
  | { state: "transport-unavailable" }
  | { state: "list-unavailable" }
  | {
    state: "listed";
    transportNames: readonly string[];
    healthCheck: "success" | "failed" | "invalid" | "not-run";
  };

export interface McpUsefulnessObservation {
  generatedAt: string;
  observedAt: string | null;
  transport: McpUsefulnessTransportSnapshot;
}

export interface McpUsefulnessCatalogEntry {
  name: string;
  category: string;
  description: string;
  projectScope: "per-project" | "global";
  defaultEnabled: boolean;
  apiEndpoints: string[];
  enabled: boolean;
}

export interface McpUsefulnessConnection {
  connect(): Promise<void>;
  listTools(): Promise<unknown>;
  callHealthCheck(): Promise<unknown>;
  close(): Promise<void>;
}

export interface McpUsefulnessLaunchRequest {
  project: string;
  projectId: string;
}

export interface McpUsefulnessReportCollector {
  readonly provenance: "fixture" | "live";
  readonly freshnessDurationMs: number;
  collect(request: McpUsefulnessLaunchRequest): Promise<McpUsefulnessObservation>;
}

export interface McpUsefulnessFixtureCollectorOptions {
  launch: (request: McpUsefulnessLaunchRequest) => McpUsefulnessConnection;
  clock?: { now(): Date };
  timeoutMs?: number;
  cacheTtlMs?: number;
  maxCachedProjects?: number;
  maxConcurrent?: number;
}

export class McpUsefulnessCollectionError extends Error {
  constructor(readonly code: "MCP_REPORT_UNAVAILABLE" | "MCP_REPORT_BUSY") {
    super(code);
    this.name = "McpUsefulnessCollectionError";
  }
}

interface CollectorOptions {
  provenance: "fixture" | "live";
  launch: (request: McpUsefulnessLaunchRequest) => McpUsefulnessConnection;
  clock: { now(): Date };
  timeoutMs: number;
  cacheTtlMs: number;
  maxCachedProjects: number;
  maxConcurrent: number;
}

interface CacheEntry {
  expiresAt: number;
  observation: McpUsefulnessObservation;
}

function unavailable(): McpUsefulnessCollectionError {
  return new McpUsefulnessCollectionError("MCP_REPORT_UNAVAILABLE");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bounded<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(unavailable()), timeoutMs);
    Promise.resolve().then(operation).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        reject(unavailable());
      },
    );
  });
}

/** Retain only bounded tool names; schemas and other tools/list fields are discarded. */
function toolNamesFromList(value: unknown): string[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.tools) || value.tools.length > 1_000) return undefined;
  const names = new Set<string>();
  for (const tool of value.tools) {
    if (!isRecord(tool) || typeof tool.name !== "string" || !SAFE_TOOL_NAME.test(tool.name) || names.has(tool.name)) {
      return undefined;
    }
    names.add(tool.name);
  }
  return [...names].sort();
}

function isHealthContentBlock(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "text") return typeof value.text === "string";
  if (value.type === "image" || value.type === "audio") {
    return typeof value.data === "string" && typeof value.mimeType === "string";
  }
  if (value.type === "resource") {
    return isRecord(value.resource)
      && typeof value.resource.uri === "string"
      && (typeof value.resource.text === "string" || typeof value.resource.blob === "string");
  }
  return value.type === "resource_link" && typeof value.uri === "string" && typeof value.name === "string";
}

/** Validate the MCP result envelope while retaining none of its result content. */
function healthCheckOutcome(value: unknown): "success" | "failed" | "invalid" {
  if (!isRecord(value) || !Array.isArray(value.content)
    || value.content.some((content) => !isHealthContentBlock(content))
    || (value.isError !== undefined && typeof value.isError !== "boolean")) {
    return "invalid";
  }
  return value.isError === true ? "failed" : "success";
}

function timestamp(clock: { now(): Date }): string {
  try {
    return clock.now().toISOString();
  } catch {
    throw unavailable();
  }
}

function cacheNumber(value: number | undefined, fallback: number, maximum: number): number {
  return Number.isInteger(value) && value! > 0 ? Math.min(value!, maximum) : fallback;
}

function validRequest(request: McpUsefulnessLaunchRequest): boolean {
  return SAFE_PROJECT_NAME.test(request.project) && UUID.test(request.projectId);
}

function resolveProbeWorktree(launcherPath: string, runtimeToken: string): string {
  const packageRoot = resolve(dirname(launcherPath), "../../../..");
  for (const worktree of [packageRoot, "/workspace"]) {
    const tokenFile = resolve(worktree, ".opencode/.ingenium-api-token");
    try {
      const candidate = readApiTokenFile(tokenFile);
      const expectedBytes = Buffer.from(runtimeToken);
      const candidateBytes = Buffer.from(candidate);
      if (expectedBytes.length === candidateBytes.length && timingSafeEqual(expectedBytes, candidateBytes)) {
        return worktree;
      }
    } catch {
      // Try the next fixed server-owned worktree location.
    }
  }
  throw unavailable();
}

/**
 * The only production launcher. It deliberately constructs a closed environment
 * instead of inheriting a caller command, environment, working directory, or path.
 */
function createServerOwnedConnection(request: McpUsefulnessLaunchRequest): McpUsefulnessConnection {
  if (!validRequest(request)) throw unavailable();

  const launcherPath = resolvePackagedMcpLauncher(import.meta.url);
  if (!isPackagedMcpLauncher(launcherPath)) throw unavailable();

  const tokenFile = process.env.INGENIUM_API_TOKEN_FILE;
  if (!tokenFile) throw unavailable();
  let worktree: string;
  try {
    const runtimeToken = readApiTokenFile(tokenFile);
    worktree = resolveProbeWorktree(launcherPath, runtimeToken);
  } catch {
    throw unavailable();
  }

  if (!Number.isSafeInteger(config.port) || config.port < 1 || config.port > 65_535) throw unavailable();
  const options = {
    command: process.execPath,
    args: [launcherPath],
    cwd: worktree,
    env: {
      INGENIUM_API_TOKEN_FILE: ".opencode/.ingenium-api-token",
      INGENIUM_API_URL: `http://127.0.0.1:${config.port}/api/v1`,
      INGENIUM_API_TIMEOUT: String(MCP_USEFULNESS_TIMEOUT_MS),
      INGENIUM_MCP_REPORT_MODE: "1",
      INGENIUM_PROJECT: request.project,
    },
    stderr: "pipe" as const,
    shell: false,
  };
  const transport = new StdioClientTransport(
    options as ConstructorParameters<typeof StdioClientTransport>[0] & { shell: false },
  );
  // Do not buffer, log, or expose child diagnostics.
  (transport as unknown as { stderr?: NodeJS.ReadableStream }).stderr?.resume();
  const client = new Client({ name: "ingenium-mcp-usefulness-report", version: "1.0.0" });

  return {
    connect: () => client.connect(transport),
    listTools: () => client.listTools(),
    callHealthCheck: () => client.callTool({ name: "health_check", arguments: {} }),
    close: () => client.close(),
  };
}

class Collector implements McpUsefulnessReportCollector {
  readonly provenance: "fixture" | "live";
  readonly freshnessDurationMs: number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<McpUsefulnessObservation>>();
  private active = 0;

  constructor(private readonly options: CollectorOptions) {
    this.provenance = options.provenance;
    this.freshnessDurationMs = options.cacheTtlMs;
  }

  collect(request: McpUsefulnessLaunchRequest): Promise<McpUsefulnessObservation> {
    if (!validRequest(request)) return Promise.reject(unavailable());

    let now: number;
    try {
      now = this.options.clock.now().getTime();
    } catch {
      return Promise.reject(unavailable());
    }
    if (!Number.isFinite(now)) return Promise.reject(unavailable());

    const cached = this.cache.get(request.projectId);
    if (cached && cached.expiresAt > now) {
      // Map insertion order is a compact LRU queue.
      this.cache.delete(request.projectId);
      this.cache.set(request.projectId, cached);
      return Promise.resolve(cached.observation);
    }
    if (cached) this.cache.delete(request.projectId);

    const existing = this.inFlight.get(request.projectId);
    if (existing) return existing;
    if (this.active >= this.options.maxConcurrent) return Promise.reject(new McpUsefulnessCollectionError("MCP_REPORT_BUSY"));

    this.active += 1;
    const collection = this.collectFresh(request).then((observation) => {
      if (observation.transport.state === "listed") this.store(request.projectId, observation, now);
      return observation;
    }).finally(() => {
      this.active -= 1;
      this.inFlight.delete(request.projectId);
    });
    this.inFlight.set(request.projectId, collection);
    return collection;
  }

  private store(projectId: string, observation: McpUsefulnessObservation, now: number): void {
    this.cache.delete(projectId);
    while (this.cache.size >= this.options.maxCachedProjects) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    this.cache.set(projectId, { expiresAt: now + this.options.cacheTtlMs, observation });
  }

  private async collectFresh(request: McpUsefulnessLaunchRequest): Promise<McpUsefulnessObservation> {
    let connection: McpUsefulnessConnection | undefined;
    let transport: McpUsefulnessTransportSnapshot = { state: "list-unavailable" };
    let observedAt: string | null = null;
    let failed = false;

    try {
      connection = this.options.launch(request);
      await bounded(() => connection!.connect(), this.options.timeoutMs);
      try {
        const names = toolNamesFromList(await bounded(() => connection!.listTools(), this.options.timeoutMs));
        if (names === undefined) {
          transport = { state: "list-unavailable" };
        } else {
          observedAt = timestamp(this.options.clock);
          let healthCheck: "success" | "failed" | "invalid" | "not-run" = "not-run";
          if (names.includes("health_check")) {
            try {
              healthCheck = healthCheckOutcome(await bounded(
                () => connection!.callHealthCheck(),
                this.options.timeoutMs,
              ));
            } catch {
              healthCheck = "failed";
            }
          }
          transport = { state: "listed", transportNames: names, healthCheck };
        }
      } catch {
        transport = { state: "list-unavailable" };
      }
    } catch {
      failed = true;
    }

    if (connection) {
      try {
        await bounded(() => connection!.close(), this.options.timeoutMs);
      } catch {
        // A child that may still be alive is unavailable, never a partial report.
        failed = true;
      }
    }
    if (failed) throw unavailable();

    const generatedAt = timestamp(this.options.clock);
    if (observedAt !== null && new Date(observedAt).getTime() > new Date(generatedAt).getTime()) throw unavailable();
    return { generatedAt, observedAt, transport };
  }
}

/** Production collector: fixed launcher, live provenance, and no caller-controlled process inputs. */
export function createMcpUsefulnessCollector(): McpUsefulnessReportCollector {
  return new Collector({
    provenance: "live",
    launch: createServerOwnedConnection,
    clock: { now: () => new Date() },
    timeoutMs: MCP_USEFULNESS_TIMEOUT_MS,
    cacheTtlMs: MCP_USEFULNESS_CACHE_TTL_MS,
    maxCachedProjects: MCP_USEFULNESS_MAX_CACHED_PROJECTS,
    maxConcurrent: MCP_USEFULNESS_MAX_CONCURRENT,
  });
}

/** Fixture-only dependency injection; HTTP callers cannot select provenance or launch settings. */
export function createFixtureMcpUsefulnessCollector(
  options: McpUsefulnessFixtureCollectorOptions,
): McpUsefulnessReportCollector {
  return new Collector({
    provenance: "fixture",
    launch: options.launch,
    clock: options.clock ?? { now: () => new Date() },
    timeoutMs: cacheNumber(options.timeoutMs, MCP_USEFULNESS_TIMEOUT_MS, MCP_USEFULNESS_TIMEOUT_MS),
    cacheTtlMs: cacheNumber(options.cacheTtlMs, MCP_USEFULNESS_CACHE_TTL_MS, MCP_USEFULNESS_CACHE_TTL_MS),
    maxCachedProjects: cacheNumber(options.maxCachedProjects, MCP_USEFULNESS_MAX_CACHED_PROJECTS, MCP_USEFULNESS_MAX_CACHED_PROJECTS),
    maxConcurrent: cacheNumber(options.maxConcurrent, MCP_USEFULNESS_MAX_CONCURRENT, MCP_USEFULNESS_MAX_CONCURRENT),
  });
}

/** Build the core-owned report without claiming source or registration conformance. */
export function buildMcpUsefulnessReport(
  observation: McpUsefulnessObservation,
  tools: readonly McpUsefulnessCatalogEntry[],
  provenance: "fixture" | "live",
  freshnessDurationMs: number,
): McpToolUsefulnessReport {
  try {
    const names = new Set<string>();
    if (tools.length > 1_000) throw unavailable();
    for (const tool of tools) {
      if (!SAFE_TOOL_NAME.test(tool.name) || names.has(tool.name) || typeof tool.enabled !== "boolean") throw unavailable();
      names.add(tool.name);
    }
    return mcpUsefulnessEvidence.buildMcpToolUsefulnessEvidenceReport({
      provenance,
      generatedAt: observation.generatedAt,
      observedAt: observation.observedAt,
      freshnessDurationMs,
      catalog: tools.map(({ enabled: _enabled, ...tool }) => tool),
      // This transport probe cannot certify source registration or catalog parity.
      conformance: { status: "unknown", issues: [] },
      effectiveState: {
        status: "known",
        states: tools.map(({ name, enabled }) => ({ toolName: name, enabled })),
      },
      transport: observation.transport,
    });
  } catch {
    throw unavailable();
  }
}

/** Add the live category/toggle projection, rejecting stale or incomplete report/catalog joins. */
export function enrichMcpUsefulnessReport(
  report: McpToolUsefulnessReport,
  tools: readonly McpUsefulnessCatalogEntry[],
): McpToolUsefulnessReport & { tools: Array<McpToolUsefulnessReport["tools"][number] & { category: string; enabled: boolean }> } {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  if (byName.size !== tools.length || report.tools.length !== byName.size) throw unavailable();

  const enriched = report.tools.map((tool) => {
    const current = byName.get(tool.name);
    if (!current) throw unavailable();
    return { ...tool, category: current.category, enabled: current.enabled };
  });
  return { ...report, tools: enriched };
}
