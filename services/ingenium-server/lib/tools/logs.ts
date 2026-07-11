/**
 * MCP tool handlers for system logs.
 * Retrieves buffered log entries from the unified logger via the API.
 */
import { api } from "../client.js";

/** List recent log entries with optional filters */
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
  if (limit) params.limit = String(limit);

  const res = await api.get("/logs", params);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** List active log sources */
export async function logsSources(project: string) {
  const res = await api.get("/logs", { project, limit: "1" });
  const sources = (res.data as any)?.sources ?? [];
  return { content: [{ type: "text" as const, text: JSON.stringify({ sources, total: sources.length }) }] };
}
