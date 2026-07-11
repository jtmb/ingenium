/**
 * MCP tool handlers for child MCP server management.
 * Supports listing, adding, and removing child servers (Kaban, Thread, etc.).
 */
import { api } from "../client.js";

/** List all registered child MCP servers for a project. */
export async function serverList(project: string) {
  const res = await api.get("/servers", { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Add a new child MCP server definition. */
export async function serverAdd(project: string, name: string, command: string, args?: string, env?: string, source?: string) {
  const res = await api.post("/servers", { name, command, args, env, source }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Remove a child MCP server definition. */
export async function serverRemove(project: string, name: string) {
  const res = await api.del(`/servers/${encodeURIComponent(name)}`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data ?? "ok") }] };
}
