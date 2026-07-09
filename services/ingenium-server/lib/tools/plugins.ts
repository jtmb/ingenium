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

export async function pluginCreate(project: string, name: string, filePath: string, sourceContent?: string) {
  const res = await api.post("/plugins", { name, file_path: filePath, source_content: sourceContent ?? "" }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

export async function pluginDelete(project: string, name: string) {
  await api.del(`/plugins/${encodeURIComponent(name)}`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: true }) }] };
}

export async function pluginUpdate(project: string, name: string, updates: { file_path?: string; source_content?: string }) {
  const res = await api.put(`/plugins/${encodeURIComponent(name)}`, updates, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get a plugin by name. */
export async function pluginGet(project: string, name: string) {
  const res = await api.get(`/plugins/${name}?project=${project}`);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}
