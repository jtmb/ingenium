/**
 * MCP tool handlers for command management.
 * 🔴 DB ISOLATION: MCP tool wrapper — proxies to API via HTTP, no direct DB access.
 * Supports listing, creating, updating, and deleting commands on a per-project basis.
 */
import { api } from "../client.js";

/** List all commands for a project. */
export async function commandList(project: string) {
  const res = await api.get("/commands", { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get a command by name. */
export async function commandGet(project: string, name: string) {
  const res = await api.get(`/commands/${encodeURIComponent(name)}?project=${project}`);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Create a new command. */
export async function commandCreate(project: string, name: string, filePath: string, content?: string) {
  const res = await api.post("/commands", { name, file_path: filePath, content: content ?? "" }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Update an existing command. */
export async function commandUpdate(project: string, name: string, updates: { file_path?: string; content?: string }) {
  const res = await api.put(`/commands/${encodeURIComponent(name)}`, updates, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Delete a command. */
export async function commandDelete(project: string, name: string) {
  await api.del(`/commands/${encodeURIComponent(name)}`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: true }) }] };
}
