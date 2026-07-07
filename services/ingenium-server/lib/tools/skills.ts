/**
 * MCP tool handlers for skill management.
 * Each function calls the Ingenium API via HTTP and returns MCP-formatted results.
 */
import { api } from "../client.js";

/** List all skills for a project. */
export async function skillList(project: string) {
  const res = await api.get("/skills", { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Load a single skill by name. */
export async function skillLoad(project: string, name: string) {
  const res = await api.get(`/skills/${encodeURIComponent(name)}`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Full-text search across skills. */
export async function skillSearch(project: string, query: string) {
  const res = await api.get("/skills/search", { project, q: query });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Create a new skill. */
export async function skillCreate(project: string, name: string, description: string, content: string, category?: string) {
  const res = await api.post("/skills", { name, description, content, category }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Update an existing skill's content. */
export async function skillUpdate(project: string, name: string, content: string) {
  const res = await api.patch(`/skills/${encodeURIComponent(name)}`, { content }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}
