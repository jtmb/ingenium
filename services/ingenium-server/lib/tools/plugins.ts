/**
 * MCP tool handlers for plugin management.
 * Supports listing, enabling, and disabling plugins on a per-project basis.
 */
import { api } from "../client.js";

/** List all plugins available for a project. */
export async function pluginList(project: string) {
  const res = await api.get("/plugins", { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Enable a plugin for a project. */
export async function pluginEnable(project: string, name: string) {
  const res = await api.post(`/plugins/${encodeURIComponent(name)}/enable`, {}, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Disable a plugin for a project. */
export async function pluginDisable(project: string, name: string) {
  const res = await api.post(`/plugins/${encodeURIComponent(name)}/disable`, {}, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}
