import type { McpToolConformanceEvidence } from "./mcp-tool-conformance.js";
import type { McpToolCatalogEntry } from "./mcp-tool-catalog.js";
import {
  buildMcpToolUsefulnessReport,
  MCP_TOOL_USEFULNESS_MAX_TOOLS,
  McpToolUsefulnessReportError,
  type McpToolInvocationEvidence,
  type McpToolUsefulnessReport,
  type McpToolVisibilityEvidence,
} from "./mcp-usefulness-report.js";

export const MCP_TOOL_USEFULNESS_EXTENSION_TOOL_NAMES = [
  "auto_observe_now",
  "synthesize_observations",
] as const;

const HEALTH_CHECK_TOOL_NAME = "ingenium_health_check";

export type McpToolUsefulnessEffectiveState =
  | { status: "unknown" }
  | {
    status: "known";
    states: ReadonlyArray<{ toolName: string; enabled: boolean }>;
  };

export type McpToolUsefulnessTransportSnapshot =
  | { state: "transport-unavailable" }
  | { state: "list-unavailable" }
  | {
    state: "listed";
    transportNames: readonly string[];
    healthCheck: "success" | "failed" | "invalid" | "not-run";
  };

export interface McpToolUsefulnessEvidenceInput {
  provenance: "fixture" | "live";
  generatedAt: string;
  observedAt: string | null;
  freshnessDurationMs: number;
  catalog: readonly McpToolCatalogEntry[];
  conformance?: McpToolConformanceEvidence;
  effectiveState: McpToolUsefulnessEffectiveState;
  transport: McpToolUsefulnessTransportSnapshot;
}

type RecordValue = Record<string, unknown>;

function invalid(): never {
  throw new McpToolUsefulnessReportError();
}

function isPlainRecord(value: unknown): value is RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is RecordValue {
  if (!isPlainRecord(value)) return false;
  const actual = Object.getOwnPropertyNames(value);
  return Object.getOwnPropertySymbols(value).length === 0
    && actual.length === keys.length
    && actual.every((key) => keys.includes(key));
}

function hasAllowedKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
): value is RecordValue {
  if (!isPlainRecord(value)) return false;
  const actual = Object.getOwnPropertyNames(value);
  return Object.getOwnPropertySymbols(value).length === 0
    && required.every((key) => actual.includes(key))
    && actual.every((key) => required.includes(key) || optional.includes(key));
}

function readCatalog(value: unknown): Array<{ name: string; boundary: "mcp-stdio" | "opencode-extension" }> {
  if (!Array.isArray(value) || value.length > MCP_TOOL_USEFULNESS_MAX_TOOLS) invalid();
  const names = new Set<string>();
  return value.map((entry) => {
    if (!isPlainRecord(entry) || typeof entry.name !== "string" || names.has(entry.name)) invalid();
    names.add(entry.name);
    const boundary = (MCP_TOOL_USEFULNESS_EXTENSION_TOOL_NAMES as readonly string[]).includes(entry.name)
      ? "opencode-extension"
      : "mcp-stdio";
    if (boundary === "mcp-stdio" && !entry.name.startsWith("ingenium_")) invalid();
    return {
      name: entry.name,
      boundary,
    };
  });
}

function readEffectiveState(value: unknown, catalogNames: ReadonlySet<string>): Map<string, boolean> | undefined {
  if (hasExactKeys(value, ["status"]) && value.status === "unknown") return undefined;
  if (!hasExactKeys(value, ["status", "states"]) || value.status !== "known" || !Array.isArray(value.states)) invalid();
  if (value.states.length !== catalogNames.size || value.states.length > MCP_TOOL_USEFULNESS_MAX_TOOLS) invalid();

  const states = new Map<string, boolean>();
  for (const state of value.states) {
    if (!hasExactKeys(state, ["toolName", "enabled"])
      || typeof state.toolName !== "string"
      || typeof state.enabled !== "boolean"
      || !catalogNames.has(state.toolName)
      || states.has(state.toolName)) invalid();
    states.set(state.toolName, state.enabled);
  }
  return states;
}

function readTransport(value: unknown): McpToolUsefulnessTransportSnapshot {
  if (hasExactKeys(value, ["state"])
    && (value.state === "transport-unavailable" || value.state === "list-unavailable")) {
    return { state: value.state };
  }
  if (!hasExactKeys(value, ["state", "transportNames", "healthCheck"])
    || value.state !== "listed"
    || !Array.isArray(value.transportNames)
    || value.transportNames.length > MCP_TOOL_USEFULNESS_MAX_TOOLS
    || (value.healthCheck !== "success"
      && value.healthCheck !== "failed"
      && value.healthCheck !== "invalid"
      && value.healthCheck !== "not-run")) invalid();

  const names = new Set<string>();
  for (const name of value.transportNames) {
    if (typeof name !== "string" || name.length === 0 || name.length > 256
      || /[\u0000-\u001f\u007f]/.test(name) || names.has(name)) invalid();
    names.add(name);
  }
  return { state: "listed", transportNames: [...names], healthCheck: value.healthCheck };
}

function visibilityFor(
  name: string,
  boundary: "mcp-stdio" | "opencode-extension",
  enabled: boolean | undefined,
  transport: McpToolUsefulnessTransportSnapshot,
): McpToolVisibilityEvidence {
  if (enabled === false) return { toolName: name, status: "not-applicable", reason: "TOOL_DISABLED" };
  if (enabled === undefined) return { toolName: name, status: "unknown", reason: "TOOL_STATE_UNAVAILABLE" };
  if (boundary === "opencode-extension") return { toolName: name, status: "not-applicable", reason: "not-requested" };
  if (transport.state === "transport-unavailable") return { toolName: name, status: "unknown", reason: "transport-unavailable" };
  if (transport.state === "list-unavailable") return { toolName: name, status: "unknown", reason: "list-unavailable" };
  return transport.transportNames.includes(name.slice("ingenium_".length))
    ? { toolName: name, status: "reachable", reason: null }
    : { toolName: name, status: "unreachable", reason: "not-listed" };
}

function invocationFor(
  name: string,
  boundary: "mcp-stdio" | "opencode-extension",
  enabled: boolean | undefined,
  transport: McpToolUsefulnessTransportSnapshot,
): McpToolInvocationEvidence {
  if (enabled === false) return { toolName: name, status: "not-run", reason: "TOOL_DISABLED" };
  if (enabled === undefined) return { toolName: name, status: "unknown", reason: "TOOL_STATE_UNAVAILABLE" };
  if (boundary === "opencode-extension") return { toolName: name, status: "not-run", reason: "not-requested" };
  if (transport.state === "transport-unavailable") return { toolName: name, status: "unknown", reason: "transport-unavailable" };
  if (transport.state === "list-unavailable") return { toolName: name, status: "unknown", reason: "list-unavailable" };
  if (name !== HEALTH_CHECK_TOOL_NAME || !transport.transportNames.includes("health_check") || transport.healthCheck === "not-run") {
    return { toolName: name, status: "not-run", reason: "unsafe-invocation" };
  }
  if (transport.healthCheck === "invalid") return { toolName: name, status: "unknown", reason: "invalid-response" };
  return transport.healthCheck === "success"
    ? { toolName: name, status: "success", reason: null }
    : { toolName: name, status: "failed", reason: "invocation-failed" };
}

/**
 * Purely maps a caller-sanitized catalog, state, conformance choice, and transport
 * snapshot into the bounded report. It never discovers or certifies runtime state.
 */
export function buildMcpToolUsefulnessEvidenceReport(input: unknown): McpToolUsefulnessReport {
  if (!hasAllowedKeys(input,
    ["provenance", "generatedAt", "observedAt", "freshnessDurationMs", "catalog", "effectiveState", "transport"],
    ["conformance"],
  )) invalid();

  const catalog = readCatalog(input.catalog);
  const effectiveState = readEffectiveState(input.effectiveState, new Set(catalog.map((entry) => entry.name)));
  const transport = readTransport(input.transport);
  return buildMcpToolUsefulnessReport({
    provenance: input.provenance,
    generatedAt: input.generatedAt,
    observedAt: input.observedAt,
    freshnessDurationMs: input.freshnessDurationMs,
    catalog,
    conformance: input.conformance ?? { status: "unknown", issues: [] },
    visibility: catalog.map(({ name, boundary }) => visibilityFor(name, boundary, effectiveState?.get(name), transport)),
    invocations: catalog.map(({ name, boundary }) => invocationFor(name, boundary, effectiveState?.get(name), transport)),
  });
}
