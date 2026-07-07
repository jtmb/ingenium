/**
 * MCP tool handlers for child MCP server management.
 * Supports listing, adding, and removing child servers (Kaban, Thread, etc.).
 */
import { api } from "../client.js";
/** List all registered child MCP servers for a project. */
export async function serverList(project) {
    const res = await api.get("/servers", { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Add a new child MCP server definition. */
export async function serverAdd(project, name, command, args, env) {
    const res = await api.post("/servers", { name, command, args, env }, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Remove a child MCP server definition. */
export async function serverRemove(project, name) {
    const res = await api.del(`/servers/${encodeURIComponent(name)}`, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data ?? "ok") }] };
}
