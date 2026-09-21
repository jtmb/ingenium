import {
  MCP_TOOL_CONFORMANCE_ISSUE_CODES,
  type McpToolConformanceEvidence,
  type McpToolConformanceIssueCode,
} from "./mcp-tool-conformance.js";

export const MCP_TOOL_USEFULNESS_SCHEMA_VERSION = 1 as const;
export const MCP_TOOL_USEFULNESS_MAX_TOOLS = 1_000;
export const MCP_TOOL_USEFULNESS_MAX_JSON_BYTES = 64 * 1024;
export const MCP_TOOL_USEFULNESS_REASON_CODES = [
  "PROJECT_IDENTITY_REQUIRED",
  "TOOL_DISABLED",
  "TOOL_STATE_UNAVAILABLE",
  "transport-unavailable",
  "list-unavailable",
  "not-listed",
  "invocation-failed",
  "invalid-response",
  "unsafe-invocation",
  "not-requested",
] as const;

export type McpToolBoundary = "mcp-stdio" | "opencode-extension";
export type McpToolCatalogStatus = "conformant" | "nonconformant" | "unknown";
export type McpToolVisibilityStatus = "reachable" | "unreachable" | "unknown" | "not-applicable";
export type McpToolInvocationStatus = "success" | "failed" | "not-run" | "unknown";
export type McpToolFreshnessStatus = "fresh" | "stale" | "unknown";
export type McpToolUsefulnessReasonCode =
  (typeof MCP_TOOL_USEFULNESS_REASON_CODES)[number];

export interface McpToolUsefulnessCatalogEntry {
  name: string;
  boundary: McpToolBoundary;
}

export interface McpToolVisibilityEvidence {
  toolName: string;
  status: McpToolVisibilityStatus;
  reason: McpToolUsefulnessReasonCode | null;
}

export interface McpToolInvocationEvidence {
  toolName: string;
  status: McpToolInvocationStatus;
  reason: McpToolUsefulnessReasonCode | null;
}

export interface McpToolUsefulnessReportInput {
  provenance: "fixture" | "live";
  generatedAt: string;
  observedAt: string | null;
  freshnessDurationMs: number;
  catalog: readonly McpToolUsefulnessCatalogEntry[];
  conformance: McpToolConformanceEvidence;
  visibility: readonly McpToolVisibilityEvidence[];
  invocations: readonly McpToolInvocationEvidence[];
}

export interface McpToolUsefulnessReport {
  schemaVersion: typeof MCP_TOOL_USEFULNESS_SCHEMA_VERSION;
  provenance: "fixture" | "live";
  generatedAt: string;
  freshness: {
    status: McpToolFreshnessStatus;
    observedAt: string | null;
    durationMs: number;
  };
  catalog: {
    status: McpToolCatalogStatus;
    issues: Array<{ code: McpToolConformanceIssueCode; toolName: string }>;
  };
  tools: Array<{
    name: string;
    boundary: McpToolBoundary;
    visibility: { status: McpToolVisibilityStatus; reason: McpToolUsefulnessReasonCode | null };
    invocation: { status: McpToolInvocationStatus; reason: McpToolUsefulnessReasonCode | null };
  }>;
}

export class McpToolUsefulnessReportError extends Error {
  readonly code = "MCP_TOOL_USEFULNESS_REPORT_INVALID" as const;

  constructor() {
    super("MCP_TOOL_USEFULNESS_REPORT_INVALID");
    this.name = "McpToolUsefulnessReportError";
  }
}

type RecordValue = Record<string, unknown>;

const CONFORMANCE_CODES = new Set<string>(MCP_TOOL_CONFORMANCE_ISSUE_CODES);
const REASON_CODES = new Set<string>(MCP_TOOL_USEFULNESS_REASON_CODES);
const TOOL_NAME = /^[a-z][a-z0-9_]{0,127}$/;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_FRESHNESS_DURATION_MS = 31 * 24 * 60 * 60 * 1_000;

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

function readToolName(value: unknown): string {
  if (typeof value !== "string" || !TOOL_NAME.test(value)) invalid();
  return value;
}

function readUtcTimestamp(value: unknown): string {
  if (typeof value !== "string" || !UTC_TIMESTAMP.test(value)) invalid();
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== value) invalid();
  return value;
}

function readReason(value: unknown): McpToolUsefulnessReasonCode | null {
  if (value === null) return null;
  if (typeof value !== "string" || !REASON_CODES.has(value)) invalid();
  return value as McpToolUsefulnessReasonCode;
}

function readCatalog(value: unknown): McpToolUsefulnessCatalogEntry[] {
  if (!Array.isArray(value) || value.length > MCP_TOOL_USEFULNESS_MAX_TOOLS) invalid();
  const names = new Set<string>();
  return value.map((entry) => {
    if (!hasExactKeys(entry, ["name", "boundary"])) invalid();
    const name = readToolName(entry.name);
    if (names.has(name)) invalid();
    names.add(name);
    if (entry.boundary !== "mcp-stdio" && entry.boundary !== "opencode-extension") invalid();
    return { name, boundary: entry.boundary };
  });
}

function readConformance(
  value: unknown,
  catalog: readonly McpToolUsefulnessCatalogEntry[],
): McpToolConformanceEvidence {
  if (!hasExactKeys(value, ["status", "issues"])) invalid();
  if (value.status !== "known" && value.status !== "unknown") invalid();
  if (!Array.isArray(value.issues) || value.issues.length > MCP_TOOL_USEFULNESS_MAX_TOOLS) invalid();

  const seen = new Set<string>();
  const catalogByName = new Map(catalog.map((entry) => [entry.name, entry]));
  const issues = value.issues.map((issue) => {
    if (!hasExactKeys(issue, ["code", "toolName"])) invalid();
    if (typeof issue.code !== "string" || !CONFORMANCE_CODES.has(issue.code)) invalid();
    const toolName = readToolName(issue.toolName);
    const catalogEntry = catalogByName.get(toolName);
    if (!catalogEntry || seen.has(`${issue.code}\u0000${toolName}`)) invalid();
    if (catalogEntry.boundary === "opencode-extension" && issue.code === "missing-registration") invalid();
    seen.add(`${issue.code}\u0000${toolName}`);
    return { code: issue.code as McpToolConformanceIssueCode, toolName };
  });
  if (value.status === "unknown" && issues.length > 0) invalid();
  return { status: value.status, issues };
}

function validateVisibilityReason(status: McpToolVisibilityStatus, reason: McpToolUsefulnessReasonCode | null): void {
  if (status === "reachable" && reason === null) return;
  if (status === "unreachable" && (reason === "not-listed" || reason === "transport-unavailable" || reason === "list-unavailable" || reason === "TOOL_DISABLED" || reason === "TOOL_STATE_UNAVAILABLE")) return;
  if (status === "unknown" && (reason === "not-requested" || reason === "transport-unavailable" || reason === "list-unavailable" || reason === "TOOL_STATE_UNAVAILABLE")) return;
  if (status === "not-applicable" && (reason === "not-requested" || reason === "TOOL_DISABLED")) return;
  invalid();
}

function validateInvocationReason(status: McpToolInvocationStatus, reason: McpToolUsefulnessReasonCode | null): void {
  if (status === "success" && reason === null) return;
  if (status === "failed" && (reason === "invocation-failed" || reason === "PROJECT_IDENTITY_REQUIRED" || reason === "TOOL_DISABLED" || reason === "TOOL_STATE_UNAVAILABLE")) return;
  if (status === "not-run" && (reason === "not-requested" || reason === "unsafe-invocation" || reason === "PROJECT_IDENTITY_REQUIRED" || reason === "TOOL_DISABLED" || reason === "TOOL_STATE_UNAVAILABLE")) return;
  if (status === "unknown" && (reason === "not-requested" || reason === "transport-unavailable" || reason === "list-unavailable" || reason === "TOOL_STATE_UNAVAILABLE" || reason === "invalid-response")) return;
  invalid();
}

function readEvidence<T extends McpToolVisibilityEvidence | McpToolInvocationEvidence>(
  value: unknown,
  catalogNames: ReadonlySet<string>,
  kind: "visibility" | "invocation",
): Map<string, T> {
  if (!Array.isArray(value) || value.length > MCP_TOOL_USEFULNESS_MAX_TOOLS) invalid();
  const evidence = new Map<string, T>();
  for (const entry of value) {
    if (!hasExactKeys(entry, ["toolName", "status", "reason"])) invalid();
    const toolName = readToolName(entry.toolName);
    if (!catalogNames.has(toolName) || evidence.has(toolName)) invalid();
    const reason = readReason(entry.reason);
    if (kind === "visibility") {
      if (entry.status !== "reachable" && entry.status !== "unreachable" && entry.status !== "unknown" && entry.status !== "not-applicable") invalid();
      validateVisibilityReason(entry.status, reason);
    } else {
      if (entry.status !== "success" && entry.status !== "failed" && entry.status !== "not-run" && entry.status !== "unknown") invalid();
      validateInvocationReason(entry.status, reason);
    }
    evidence.set(toolName, { toolName, status: entry.status, reason } as T);
  }
  return evidence;
}

function freshnessStatus(
  generatedAt: string,
  observedAt: string | null,
  freshnessDurationMs: number,
): McpToolFreshnessStatus {
  if (observedAt === null) return "unknown";
  const elapsed = new Date(generatedAt).getTime() - new Date(observedAt).getTime();
  return elapsed <= freshnessDurationMs ? "fresh" : "stale";
}

/**
 * Builds a deterministic, bounded, evidence-only report. Project identity and
 * all raw transport data intentionally stay outside this pure report boundary.
 */
export function buildMcpToolUsefulnessReport(input: unknown): McpToolUsefulnessReport {
  if (!hasExactKeys(input, [
    "provenance",
    "generatedAt",
    "observedAt",
    "freshnessDurationMs",
    "catalog",
    "conformance",
    "visibility",
    "invocations",
  ])) invalid();
  if (input.provenance !== "fixture" && input.provenance !== "live") invalid();
  const generatedAt = readUtcTimestamp(input.generatedAt);
  const observedAt = input.observedAt === null ? null : readUtcTimestamp(input.observedAt);
  const freshnessDurationMs = input.freshnessDurationMs;
  if (typeof freshnessDurationMs !== "number"
    || !Number.isInteger(freshnessDurationMs)
    || freshnessDurationMs < 0
    || freshnessDurationMs > MAX_FRESHNESS_DURATION_MS) invalid();
  if (observedAt !== null && new Date(observedAt).getTime() > new Date(generatedAt).getTime()) invalid();

  const catalog = readCatalog(input.catalog);
  const catalogNames = new Set(catalog.map((entry) => entry.name));
  const conformance = readConformance(input.conformance, catalog);
  const visibility = readEvidence<McpToolVisibilityEvidence>(input.visibility, catalogNames, "visibility");
  const invocations = readEvidence<McpToolInvocationEvidence>(input.invocations, catalogNames, "invocation");
  const catalogIssues = [...conformance.issues]
    .sort((left, right) => left.code < right.code ? -1 : left.code > right.code ? 1 : left.toolName < right.toolName ? -1 : left.toolName > right.toolName ? 1 : 0)
    .map(({ code, toolName }) => ({ code, toolName }));
  const catalogStatus: McpToolCatalogStatus = conformance.status === "unknown"
    ? "unknown"
    : catalogIssues.length > 0 ? "nonconformant" : "conformant";

  const tools = [...catalog]
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    .map(({ name, boundary }) => {
      const toolVisibility = visibility.get(name) ?? { status: "unknown" as const, reason: "not-requested" as const };
      const invocation = invocations.get(name) ?? { status: "not-run" as const, reason: "not-requested" as const };
      return {
        name,
        boundary,
        visibility: { status: toolVisibility.status, reason: toolVisibility.reason },
        invocation: { status: invocation.status, reason: invocation.reason },
      };
    });

  const report: McpToolUsefulnessReport = {
    schemaVersion: MCP_TOOL_USEFULNESS_SCHEMA_VERSION,
    provenance: input.provenance,
    generatedAt,
    freshness: {
      status: freshnessStatus(generatedAt, observedAt, freshnessDurationMs),
      observedAt,
      durationMs: freshnessDurationMs,
    },
    catalog: { status: catalogStatus, issues: catalogIssues },
    tools,
  };
  if (Buffer.byteLength(JSON.stringify(report), "utf8") > MCP_TOOL_USEFULNESS_MAX_JSON_BYTES) invalid();
  return report;
}
