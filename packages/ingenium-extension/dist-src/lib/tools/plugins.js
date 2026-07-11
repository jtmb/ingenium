/**
 * MCP tool handlers for plugin management.
 * Supports listing, enabling, and disabling plugins on a per-project basis.
 */
import { api } from "../client.js";
/** List all plugins available for a project. */
export async function pluginList(project) {
    const res = await api.get("/plugins", { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Enable a plugin for a project. */
export async function pluginEnable(project, name) {
    const res = await api.post(`/plugins/${encodeURIComponent(name)}/enable`, {}, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Disable a plugin for a project. */
export async function pluginDisable(project, name) {
    const res = await api.post(`/plugins/${encodeURIComponent(name)}/disable`, {}, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
export async function pluginCreate(project, name, filePath, sourceContent) {
    const res = await api.post("/plugins", { name, file_path: filePath, source_content: sourceContent ?? "" }, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
export async function pluginDelete(project, name) {
    await api.del(`/plugins/${encodeURIComponent(name)}`, { project });
    return { content: [{ type: "text", text: JSON.stringify({ deleted: true }) }] };
}
export async function pluginUpdate(project, name, updates) {
    const res = await api.put(`/plugins/${encodeURIComponent(name)}`, updates, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Get a plugin by name. */
export async function pluginGet(project, name) {
    const res = await api.get(`/plugins/${name}?project=${project}`);
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
