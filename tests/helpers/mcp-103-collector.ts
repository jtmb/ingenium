import {
  buildMcpToolUsefulnessEvidenceReport,
  MCP_TOOL_USEFULNESS_EXTENSION_TOOL_NAMES,
  type McpToolUsefulnessEffectiveState,
  type McpToolUsefulnessTransportSnapshot,
} from "../../packages/ingenium-core/lib/tools/mcp-usefulness-evidence.js";
import {
  MCP_TOOL_CATALOG,
  type McpToolCatalogEntry,
} from "../../packages/ingenium-core/lib/tools/mcp-tool-catalog.js";
import {
  MCP_TOOL_USEFULNESS_MAX_JSON_BYTES,
  type McpToolUsefulnessReport,
} from "../../packages/ingenium-core/lib/tools/mcp-usefulness-report.js";

export const MCP103_EXTENSION_TOOL_NAMES = MCP_TOOL_USEFULNESS_EXTENSION_TOOL_NAMES;
export const MCP103_CATALOG_SIZE = MCP_TOOL_CATALOG.length;
export const MCP103_FRESHNESS_DURATION_MS = 60_000;

const SAFE_TOOL_NAME = /^[a-z][a-z0-9_]{0,127}$/;
const SAFE_PROJECT_NAME = /^(?!\.{1,2}$)[^\s/\\\u0000-\u001f\u007f][^/\\\u0000-\u001f\u007f]{0,63}$/;
const SAFE_ENVIRONMENT_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FORBIDDEN_REPORT_KEYS = new Set([
  "args",
  "arguments",
  "command",
  "config",
  "cwd",
  "env",
  "environment",
  "error",
  "errors",
  "path",
  "project",
  "projectId",
  "project_id",
  "result",
  "results",
  "stderr",
  "url",
  "urls",
]);

type RecordValue = Record<string, unknown>;

export class Mcp103CollectorError extends Error {
  constructor() {
    super("MCP103_COLLECTOR_FAILURE");
    this.name = "Mcp103CollectorError";
  }
}

export interface Mcp103LocalEntry {
  command: readonly string[];
  environment: Readonly<Record<string, string>>;
  timeoutMs: number;
}

export type Mcp103SourceRegistrations =
  | { status: "known"; registrations: readonly string[] }
  | { status: "unknown" };

export type Mcp103TransportSnapshot = McpToolUsefulnessTransportSnapshot;

export type Mcp103HealthCheckOutcome = "success" | "failed" | "invalid";

export interface Mcp103ReportInput {
  provenance: "fixture" | "live";
  generatedAt: string;
  observedAt: string | null;
  freshnessDurationMs: number;
  sourceRegistrations: Mcp103SourceRegistrations;
  transport: Mcp103TransportSnapshot;
  effectiveState?: McpToolUsefulnessEffectiveState;
  catalog?: readonly McpToolCatalogEntry[];
}

function isPlainRecord(value: unknown): value is RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSafeString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
}

function isSafeProjectName(value: unknown): value is string {
  return typeof value === "string" && SAFE_PROJECT_NAME.test(value) && value.trim() === value;
}

/**
 * Pure adapter from bounded transport observations to the core report.
 * It retains no configuration, credentials, transport payloads, or errors.
 */
export function buildMcp103Report(input: Mcp103ReportInput): McpToolUsefulnessReport {
  const catalog = input.catalog ?? MCP_TOOL_CATALOG;

  try {
    return buildMcpToolUsefulnessEvidenceReport({
      provenance: input.provenance,
      generatedAt: input.generatedAt,
      observedAt: input.observedAt,
      freshnessDurationMs: input.freshnessDurationMs,
      catalog,
      // Source text and a tools/list probe cannot certify runtime registration,
      // category, or effective state. The API may provide evidence separately.
      conformance: { status: "unknown", issues: [] },
      effectiveState: input.effectiveState ?? {
        status: "known",
        states: catalog.map(({ name, defaultEnabled }) => ({ toolName: name, enabled: defaultEnabled })),
      },
      transport: input.transport,
    });
  } catch {
    throw new Mcp103CollectorError();
  }
}

/** Parse only the configured local `mcp.ingenium` object; callers never receive token material. */
export function parseMcp103LocalEntry(config: unknown): Mcp103LocalEntry | undefined {
  if (!isPlainRecord(config) || !isPlainRecord(config.mcp) || !isPlainRecord(config.mcp.ingenium)) return undefined;
  const entry = config.mcp.ingenium;
  if (entry.type !== "local" || entry.enabled !== true || !Array.isArray(entry.command) || entry.command.length === 0) {
    return undefined;
  }
  if (entry.command.length > 64) return undefined;
  const command: string[] = [];
  for (const value of entry.command) {
    if (!isSafeString(value) || value.length > 4_096) return undefined;
    command.push(value);
  }
  if (entry.environment !== undefined && !isPlainRecord(entry.environment)) return undefined;

  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(entry.environment ?? {})) {
    if (!SAFE_ENVIRONMENT_KEY.test(key) || !isSafeString(value) || value.length > 16_384) return undefined;
    environment[key] = value;
  }
  const timeout = entry.timeout;
  if (timeout !== undefined
    && (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout < 1 || timeout > 30_000)) return undefined;

  return {
    command,
    environment,
    timeoutMs: typeof timeout === "number" ? timeout : 10_000,
  };
}

/** Project identity is optional metadata and is never included in the pure report. */
export function configuredMcp103Project(entry: Mcp103LocalEntry): string | undefined {
  const project = entry.environment.INGENIUM_PROJECT;
  return isSafeProjectName(project) ? project : undefined;
}

/** A malformed tools/list payload deliberately collapses to unavailable evidence. */
export function mcp103ToolNamesFromList(value: unknown): string[] | undefined {
  if (!isPlainRecord(value) || !Array.isArray(value.tools)) return undefined;
  const names = new Set<string>();
  for (const tool of value.tools) {
    if (!isPlainRecord(tool) || typeof tool.name !== "string"
      || !isSafeString(tool.name) || tool.name.length > 256 || names.has(tool.name)) return undefined;
    names.add(tool.name);
  }
  return [...names].sort();
}

function isMcp103ContentBlock(value: unknown): boolean {
  if (!isPlainRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "text") return typeof value.text === "string";
  if (value.type === "image" || value.type === "audio") {
    return typeof value.data === "string" && typeof value.mimeType === "string";
  }
  if (value.type === "resource") {
    return isPlainRecord(value.resource)
      && typeof value.resource.uri === "string"
      && (typeof value.resource.text === "string" || typeof value.resource.blob === "string");
  }
  return value.type === "resource_link"
    && typeof value.uri === "string"
    && typeof value.name === "string";
}

/** Validate only the MCP envelope; content payload values stay opaque and unretained. */
export function mcp103HealthCheckOutcome(value: unknown): Mcp103HealthCheckOutcome {
  if (!isPlainRecord(value) || !Array.isArray(value.content)
    || value.content.some((content) => !isMcp103ContentBlock(content))
    || (value.isError !== undefined && typeof value.isError !== "boolean")) {
    return "invalid";
  }
  return value.isError === true ? "failed" : "success";
}

/** Derive current registrations from source files without exposing their paths or contents. */
export function readMcp103SourceRegistrations(repositoryRoot: string): Mcp103SourceRegistrations {
  try {
    const serverSource = readFileSync(join(repositoryRoot, "services/ingenium-server/scripts/mcp-server.ts"), "utf8");
    const observerSource = readFileSync(join(repositoryRoot, "packages/ingenium-extension/observer.ts"), "utf8");
    const autoObserverSource = readFileSync(join(repositoryRoot, "packages/ingenium-extension/auto-observer.ts"), "utf8");
    const server = Array.from(
      serverSource.matchAll(/server\.registerTool\(\s*"([^"]+)"\s*,/g),
      (match) => `ingenium_${match[1] ?? ""}`,
    );
    const extension = [observerSource, autoObserverSource].flatMap((source) => Array.from(
      source.matchAll(/tool:\s*\{\s*([a-z][\w]*):\s*tool\(/g),
      (match) => match[1] ?? "",
    ));
    const expectedExtension = new Set(MCP103_EXTENSION_TOOL_NAMES);
    if (new Set(server).size !== server.length
      || extension.length !== MCP103_EXTENSION_TOOL_NAMES.length
      || new Set(extension).size !== MCP103_EXTENSION_TOOL_NAMES.length
      || extension.some((name) => !expectedExtension.has(name as (typeof MCP103_EXTENSION_TOOL_NAMES)[number]))) {
      return { status: "unknown" };
    }
    return { status: "known", registrations: [...server, ...extension] };
  } catch {
    return { status: "unknown" };
  }
}

function hasUnsafeReportData(value: unknown): boolean {
  if (typeof value === "string") {
    return /(?:bearer\s|https?:\/\/|(?:^|[\\/])(?:home|tmp|workspace)(?:[\\/]|$))/i.test(value);
  }
  if (Array.isArray(value)) return value.some(hasUnsafeReportData);
  if (!isPlainRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => FORBIDDEN_REPORT_KEYS.has(key) || hasUnsafeReportData(child));
}

/** Deterministic compact JSON for the artifact writer. */
export function serializeMcp103Report(report: McpToolUsefulnessReport): string {
  if (hasUnsafeReportData(report)) throw new Mcp103CollectorError();
  const serialized = `${JSON.stringify(report)}\n`;
  if (Buffer.byteLength(serialized) > MCP_TOOL_USEFULNESS_MAX_JSON_BYTES) throw new Mcp103CollectorError();
  return serialized;
}
