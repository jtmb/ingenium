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
export async function skillCreate(project: string, name: string, description: string, content: string, category?: string, tags?: string, always_apply?: number, files?: string) {
  const res = await api.post("/skills", { name, description, content, category, tags, always_apply, files }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Update an existing skill's content. */
export async function skillUpdate(project: string, name: string, content: string, description?: string, tags?: string, always_apply?: number, files?: string) {
  const res = await api.patch(`/skills/${encodeURIComponent(name)}`, { content, description, tags, always_apply, files }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Delete a skill by name. */
export async function skillDelete(project: string, name: string) {
  const res = await api.del(`/skills/${name}?project=${project}`);
  // 204 returns empty body
  if (res.status === 204) {
    return { content: [{ type: "text" as const, text: "Skill deleted" }] };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Enable a skill and sync to disk. */
export async function skillEnable(project: string, name: string) {
  const res = await api.post(`/skills/${name}/enable?project=${project}`);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Disable a skill and remove from disk. */
export async function skillDisable(project: string, name: string) {
  const res = await api.post(`/skills/${name}/disable?project=${project}`);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Sync a skill from its .md file on disk to the DB — edits made directly to the file are persisted. */
export async function skillSync(project: string, name: string) {
  const res = await api.post(`/skills/${encodeURIComponent(name)}/sync?project=${project}`);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Trigger LLM-driven skill audit — merges redundant skills to ≤20 total. */
export async function skillConsolidate(project: string) {
  const res = await api.post("/skills/consolidate", {}, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}
