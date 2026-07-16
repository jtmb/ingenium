/**
 * MCP tool handlers for system logs.
 * 🔴 DB ISOLATION: MCP tool wrapper — proxies to API via HTTP, no direct DB access.
 * Retrieves buffered log entries from the unified logger via the API.
 * Enforces a hard cap of 1000 on log entries to prevent oversized MCP responses.
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
// NOTE: Uses limit=1 as a lightweight probe — the API returns source metadata
// alongside the log entries, so a minimal fetch avoids transferring log bodies.
export async function logsSources(project: string) {
  const res = await api.get("/logs", { project, limit: "1" });
  const sources = (res.data as any)?.sources ?? [];
  return { content: [{ type: "text" as const, text: JSON.stringify({ sources, total: sources.length }) }] };
}
