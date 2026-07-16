/**
 * MCP tool handler for the API health check.
 * No project param needed — this is a global endpoint.
 */
import { api } from "../client.js";

/** Health check — returns API status and uptime. */
export async function healthCheck() {
  const res = await api.get("/health");
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}
