/**
 * MCP tool handlers for LLM provider management.
 * 🔴 DB ISOLATION: MCP tool wrapper — proxies to API via HTTP, no direct DB access.
 * Manages OpenCode provider listing, API key connection, disconnection, and status.
 */
import { api } from "../client.js";

/** List all available LLM providers from OpenCode. */
export async function providerList(project: string) {
  const res = await api.get("/opencode/providers", { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Connect a provider with an API key. */
export async function providerConnect(project: string, providerId: string, key: string, metadata?: string) {
  const body: Record<string, unknown> = { type: "api", key };
  if (metadata) {
    try {
      body.metadata = JSON.parse(metadata);
    } catch {
      body.metadata = metadata;
    }
  }
  const res = await api.post(`/opencode/auth/${providerId}`, body, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Disconnect a provider. */
export async function providerDisconnect(project: string, providerId: string) {
  await api.del(`/opencode/auth/${providerId}`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify({ disconnected: providerId }) }] };
}

/** Get provider connection status (keys redacted by API). */
export async function providerStatus(project: string) {
  const res = await api.get("/opencode/auth/status", { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}
