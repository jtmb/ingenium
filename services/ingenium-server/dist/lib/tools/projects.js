/**
 * MCP tool handlers for project management.
 * 🔴 DB ISOLATION: MCP tool wrapper — proxies to API via HTTP, no direct DB access.
 * Supports listing, initializing, deleting, restoring, purging, and renaming projects.
 */
import { api } from "../client.js";
/** List all projects known to the Ingenium API. */
export async function projectList() {
    const res = await api.get("/projects");
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Initialise a new project on the Ingenium API. */
export async function projectInit(name, isGlobal) {
    const res = await api.post("/projects", { name, is_global: isGlobal ?? false });
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
/** Mark a project as global (or unmark). */
export async function projectSetGlobal(project, name, isGlobal) {
    const res = await api.patch(`/projects/${encodeURIComponent(name)}/global`, { is_global: isGlobal }, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Rename a project. */
// NOTE: `_project` is unused — the rename endpoint is global, not scoped to the caller's project.
// The param is required by the tool-registration shim for consistent handler signatures.
export async function projectRename(_project, name, newName) {
    const res = await api.patch(`/projects/${encodeURIComponent(name)}`, { name: newName });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Get detailed info about a project by name (no project param needed). */
export async function projectDetail(name) {
    const res = await api.get(`/projects/${encodeURIComponent(name)}/detail`);
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
