/**
 * MCP tool handlers for project management.
 * Supports listing, initializing, and deleting projects.
 */
import { api } from "../client.js";
/** List all projects known to the Ingenium API. */
export async function projectList() {
    const res = await api.get("/projects");
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Initialise a new project on the Ingenium API. */
export async function projectInit(name) {
    const res = await api.post("/projects", { name });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Delete a project by name. */
export async function projectDelete(name) {
    const res = await api.del(`/projects/${encodeURIComponent(name)}`);
    return { content: [{ type: "text", text: JSON.stringify({ deleted: res.ok }) }] };
}
/** Restore a previously deleted project. */
export async function projectRestore(project, name) {
    const res = await api.post(`/projects/${name}/restore?project=${project}`);
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** List all archived (deleted) projects. */
export async function projectListArchived(project) {
    const res = await api.get(`/projects/archive?project=${project}`);
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Purge old projects based on retention period. */
export async function projectPurge(project, retentionDays) {
    const res = await api.post(`/projects/purge?project=${project}`, { retention_days: retentionDays });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
