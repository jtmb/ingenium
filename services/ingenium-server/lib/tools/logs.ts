/**
 * MCP tool handlers for system logs.
 * Retrieves buffered log entries from the unified logger via the API.
 * Enforces a hard cap of 1000 on log entries to prevent oversized responses.
 */
import { api } from "../client.js";

const DEFAULT_LOG_LIMIT = 100;
const MAX_LOG_LIMIT = 1000;

/** List recent log entries with optional filters. Limit is capped at 1000. */
export async function logsList(
  project: string,
  source?: string,
  level?: string,
  since?: string,
  limit?: number,
) {
  const params: Record<string, string> = { project };
  if (source) params.source = source;
  if (level) params.level = level;
  if (since) params.since = since;
  // Enforce configurable limit with a hard cap
  const effectiveLimit = Math.min(limit ?? DEFAULT_LOG_LIMIT, MAX_LOG_LIMIT);
  params.limit = String(effectiveLimit);

  const res = await api.get("/logs", params);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** List active log sources */
export async function logsSources(project: string) {
  const res = await api.get("/logs", { project, limit: "1" });
  const sources = (res.data as any)?.sources ?? [];
  return { content: [{ type: "text" as const, text: JSON.stringify({ sources, total: sources.length }) }] };
}
