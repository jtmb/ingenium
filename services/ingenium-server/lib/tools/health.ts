/**
 * MCP tool handler for the API health check.
 * 🔴 DB ISOLATION: MCP tool wrapper — proxies to API via HTTP, no direct DB access.
 * No project param needed — this is a global endpoint that reports API availability and uptime.
 */
import { api } from "../client.js";

/** Health check — returns API status and uptime. */
export async function healthCheck() {
  const res = await api.get("/health");
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}
