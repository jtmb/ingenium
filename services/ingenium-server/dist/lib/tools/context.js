/**
 * MCP tool handlers for persistent context storage.
 * 🔴 DB ISOLATION: MCP tool wrapper — proxies to API via HTTP, no direct DB access.
 * Supports saving context entries with tags/priority and full-text search.
 */
import { api } from "../client.js";
/** Save a context entry with optional tags and priority. */
export async function planSave(project, content, tags, priority) {
    const res = await api.post("/context", { content, tags, priority }, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Full-text search across context entries. */
export async function planSearch(project, query) {
    const res = await api.get("/context/search", { project, q: query });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** List all context entries for a project. */
export async function planList(project) {
    const res = await api.get(`/context?project=${project}`);
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
export async function contextGet(project, id) { const res = await api.get(`/context/${id}`, { project }); return { content: [{ type: "text", text: JSON.stringify(res.data) }] }; }
export async function contextUpdate(project, id, fields) { const res = await api.patch(`/context/${id}`, fields, { project }); return { content: [{ type: "text", text: JSON.stringify(res.data) }] }; }
export async function contextDelete(project, id) { const res = await api.del(`/context/${id}`, { project }); return { content: [{ type: "text", text: res.status === 204 ? "Context entry deleted" : JSON.stringify(res.data) }] }; }
export async function contextBatch(project, ids) { const res = await api.post("/context/batch", { ids }, { project }); return { content: [{ type: "text", text: JSON.stringify(res.data) }] }; }
