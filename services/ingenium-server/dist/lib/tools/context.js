/**
 * MCP tool handlers for persistent context storage (Thread-like).
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
