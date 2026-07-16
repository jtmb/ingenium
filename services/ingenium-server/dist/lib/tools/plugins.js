/**
 * MCP tool handlers for plugin lifecycle management.
 * 🔴 DB ISOLATION: MCP tool wrapper — proxies to API via HTTP, no direct DB access.
 * Plugins are auto-synced to disk on lifecycle changes per the plugin convention.
 */
import { api } from "../client.js";
/** List all plugins available for a project. */
export async function pluginList(project) {
    const res = await api.get("/plugins", { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Enable a plugin for a project. Synced to disk + opencode.json plugin array. */
export async function pluginEnable(project, name) {
    const res = await api.post(`/plugins/${encodeURIComponent(name)}/enable`, {}, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Disable a plugin for a project. Synced to disk + opencode.json plugin array. */
export async function pluginDisable(project, name) {
    const res = await api.post(`/plugins/${encodeURIComponent(name)}/disable`, {}, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Create a new plugin. Auto-populates sourceContent from disk if empty. */
export async function pluginCreate(project, name, filePath, sourceContent) {
    const res = await api.post("/plugins", { name, file_path: filePath, source_content: sourceContent ?? "" }, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Delete a plugin from a project. */
export async function pluginDelete(project, name) {
    await api.del(`/plugins/${encodeURIComponent(name)}`, { project });
    return { content: [{ type: "text", text: JSON.stringify({ deleted: true }) }] };
}
/** Update a plugin's file path or source content. */
export async function pluginUpdate(project, name, updates) {
    const res = await api.put(`/plugins/${encodeURIComponent(name)}`, updates, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Get a plugin by name. */
// FIXME: `name` is not URI-encoded here (unlike pluginDelete, pluginUpdate, pluginSource).
// Will fail for plugin names with special characters.
export async function pluginGet(project, name) {
    const res = await api.get(`/plugins/${name}?project=${project}`);
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Get a plugin's source content directly from disk (not from DB cache). */
export async function pluginSource(project, name) {
    const res = await api.get(`/plugins/${encodeURIComponent(name)}/source?project=${project}`);
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
