/**
 * MCP usefulness report transport adapter.
 * DB ISOLATION: the API owns collection, filtering, and report validation.
 */
import { api, type QueryParameterValue } from "../client.js";

const MAX_REPORT_TOOLS = 1_000;
const MAX_REPORT_BYTES = 64 * 1024;

export interface McpReportFilters {
  q?: string;
  category?: string;
  enabled?: boolean;
  boundary?: "mcp-stdio" | "opencode-extension";
  visibility?: "reachable" | "unreachable" | "unknown" | "not-applicable";
  invocation?: "success" | "failed" | "not-run" | "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The API is authoritative; this only rejects error-shaped or unbounded payloads. */
function isReportPayload(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && value.schemaVersion === 1
    && (value.provenance === "fixture" || value.provenance === "live")
    && typeof value.generatedAt === "string"
    && isRecord(value.freshness)
    && isRecord(value.catalog)
    && Array.isArray(value.tools)
    && value.tools.length <= MAX_REPORT_TOOLS;
}

function reportError(code: "MCP_REPORT_UNAVAILABLE" | "MCP_REPORT_INVALID_RESPONSE") {
  const message = code === "MCP_REPORT_UNAVAILABLE"
    ? "The MCP usefulness report is unavailable."
    : "The MCP usefulness report response is invalid.";
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message } }) }],
  };
}

function queryFilters(filters: McpReportFilters): Record<string, QueryParameterValue | undefined> {
  return {
    q: filters.q,
    category: filters.category,
    enabled: filters.enabled === undefined ? undefined : String(filters.enabled),
    boundary: filters.boundary,
    visibility: filters.visibility,
    invocation: filters.invocation,
  };
}

/** Fetch one already-bounded report. The endpoint has no pagination contract. */
export async function mcpReportGet(project: string, filters: McpReportFilters = {}) {
  try {
    const response = await api.settled.getMcpReport(project, queryFilters(filters));
    if (!response.ok) return reportError("MCP_REPORT_UNAVAILABLE");
    if (!isReportPayload(response.data)) return reportError("MCP_REPORT_INVALID_RESPONSE");

    const text = JSON.stringify(response.data);
    if (Buffer.byteLength(text, "utf8") > MAX_REPORT_BYTES) {
      return reportError("MCP_REPORT_INVALID_RESPONSE");
    }
    return { content: [{ type: "text" as const, text }] };
  } catch {
    return reportError("MCP_REPORT_UNAVAILABLE");
  }
}
