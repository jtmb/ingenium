/**
 * MCP tool handlers for skill management.
 * Each function calls the Ingenium API via HTTP and returns MCP-formatted results.
 */
import { api } from "../client.js";
/** List all skills for a project. */
export async function skillList(project) {
    const res = await api.get("/skills", { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Load a single skill by name. */
export async function skillLoad(project, name) {
    const res = await api.get(`/skills/${encodeURIComponent(name)}`, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Full-text search across skills. */
export async function skillSearch(project, query) {
    const res = await api.get("/skills/search", { project, q: query });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Create a new skill. */
export async function skillCreate(project, name, description, content, category) {
    const res = await api.post("/skills", { name, description, content, category }, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Update an existing skill's content. */
export async function skillUpdate(project, name, content) {
    const res = await api.patch(`/skills/${encodeURIComponent(name)}`, { content }, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
