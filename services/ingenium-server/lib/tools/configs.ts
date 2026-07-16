/**
 * MCP tool handlers for OpenCode config management (opencode.json/jsonc).
 * 🔴 DB ISOLATION: MCP tool wrapper — proxies to API via HTTP, no direct DB access.
 * Configs are stored in the DB and sync'd to disk; type distinguishes "project" vs "global".
 */
import { api } from "../client.js";

/** Get config (opencode.json/jsonc) content for a project. Type: "project" | "global". */
export async function configGet(project: string, type: string) {
  const res = await api.get("/config", { project, type });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Set config content (writes to DB + disk). Type: "project" | "global". */
export async function configSet(project: string, type: string, content: string) {
  const res = await api.put("/config", { content }, { project, type });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Sync config from disk to DB (disk → DB direction of the bidirectional sync model). */
export async function configSync(project: string, type: string) {
  const res = await api.post("/config/sync", {}, { project, type });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}
