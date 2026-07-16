/**
 * MCP tool handler for OpenCode message access.
 * 🔴 DB ISOLATION: MCP tool wrapper — proxies to API via HTTP, no direct DB access.
 * Reads user messages from the host OpenCode SQLite DB via the API (used by the extraction engine).
 */
import { api } from "../client.js";

/** Read recent user messages from the OpenCode DB (used by the extraction engine). */
export async function opencodeMessages(project: string, limit?: number, offset?: number) {
  const params: Record<string, string> = { project };
  if (limit !== undefined) params.limit = String(limit);
  if (offset !== undefined) params.since = String(offset);
  const res = await api.get("/opencode/messages", params);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}
