/**
 * MCP tool handlers for project-level settings (key-value store).
 * 🔴 DB ISOLATION: MCP tool wrapper — proxies to API via HTTP, no direct DB access.
 * Settings are per-project and persist across sessions.
 */
import { api } from "../client.js";

/** Get a setting value by key. Returns null if the key has not been set. */
export async function settingGet(project: string, key: string) {
  const res = await api.get(`/settings?project=${project}&key=${key}`);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Set a setting value by key (upserts: creates if missing, updates if exists). */
export async function settingSet(project: string, key: string, value: string) {
  const res = await api.post(`/settings?project=${project}`, { key, value });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Test the configured synthesis LLM connection (validates API key + endpoint). */
export async function settingTestLlm(project: string) {
  const res = await api.post("/settings/test-llm", {}, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}
