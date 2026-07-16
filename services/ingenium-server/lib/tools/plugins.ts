/**
 * MCP tool handlers for plugin lifecycle management.
 * 🔴 DB ISOLATION: MCP tool wrapper — proxies to API via HTTP, no direct DB access.
 * Plugins are auto-synced to disk on lifecycle changes per the plugin convention.
 */
import { api } from "../client.js";

/** List all plugins available for a project. */
export async function pluginList(project: string) {
  const res = await api.get("/plugins", { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Enable a plugin for a project. Synced to disk + opencode.json plugin array. */
export async function pluginEnable(project: string, name: string) {
  const res = await api.post(`/plugins/${encodeURIComponent(name)}/enable`, {}, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Disable a plugin for a project. Synced to disk + opencode.json plugin array. */
export async function pluginDisable(project: string, name: string) {
  const res = await api.post(`/plugins/${encodeURIComponent(name)}/disable`, {}, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Create a new plugin. Auto-populates sourceContent from disk if empty. */
export async function pluginCreate(project: string, name: string, filePath: string, sourceContent?: string) {
  const res = await api.post("/plugins", { name, file_path: filePath, source_content: sourceContent ?? "" }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Delete a plugin from a project. */
export async function pluginDelete(project: string, name: string) {
  await api.del(`/plugins/${encodeURIComponent(name)}`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: true }) }] };
}

/** Update a plugin's file path or source content. */
export async function pluginUpdate(project: string, name: string, updates: { file_path?: string; source_content?: string }) {
  const res = await api.put(`/plugins/${encodeURIComponent(name)}`, updates, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get a plugin by name. */
// FIXME: `name` is not URI-encoded here (unlike pluginDelete, pluginUpdate, pluginSource).
// Will fail for plugin names with special characters.
export async function pluginGet(project: string, name: string) {
  const res = await api.get(`/plugins/${name}?project=${project}`);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get a plugin's source content directly from disk (not from DB cache). */
export async function pluginSource(project: string, name: string) {
  const res = await api.get(`/plugins/${encodeURIComponent(name)}/source?project=${project}`);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}
