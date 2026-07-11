/**
 * MCP tool handlers for command management.
 * Supports listing, creating, updating, and deleting commands on a per-project basis.
 */
import { api } from "../client.js";
/** List all commands for a project. */
export async function commandList(project) {
    const res = await api.get("/commands", { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Get a command by name. */
export async function commandGet(project, name) {
    const res = await api.get(`/commands/${encodeURIComponent(name)}?project=${project}`);
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Create a new command. */
export async function commandCreate(project, name, filePath, content) {
    const res = await api.post("/commands", { name, file_path: filePath, content: content ?? "" }, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Update an existing command. */
export async function commandUpdate(project, name, updates) {
    const res = await api.put(`/commands/${encodeURIComponent(name)}`, updates, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Delete a command. */
export async function commandDelete(project, name) {
    await api.del(`/commands/${encodeURIComponent(name)}`, { project });
    return { content: [{ type: "text", text: JSON.stringify({ deleted: true }) }] };
}
