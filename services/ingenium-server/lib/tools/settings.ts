/**
 * MCP tool handlers for project-level settings.
 * Supports fetching and updating settings by key.
 */
import { api } from "../client.js";

export async function settingGet(project: string, key: string) {
  const res = await api.get(`/settings?project=${project}&key=${key}`);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

export async function settingSet(project: string, key: string, value: string) {
  const res = await api.post(`/settings?project=${project}`, { key, value });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Test the configured synthesis LLM connection. */
export async function settingTestLlm(project: string) {
  const res = await api.post("/settings/test-llm", {}, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}
