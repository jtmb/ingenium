/**
 * MCP tool handlers for persistent context storage (Thread-like).
 * Supports saving context entries and full-text search.
 */
import { api } from "../client.js";

/** Save a context entry with optional tags and priority. */
export async function contextSave(project: string, content: string, tags?: string, priority?: number) {
  const res = await api.post("/context", { content, tags, priority }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Full-text search across context entries. */
export async function contextSearch(project: string, query: string) {
  const res = await api.get("/context/search", { project, q: query });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}
