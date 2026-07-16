/**
 * MCP tool handlers for agent lifecycle management.
 * All functions proxy to the Ingenium API via HTTP — zero direct DB access.
 * Each returns an MCP-formatted {@link McpContentResult}.
 */
import { api } from "../client.js";

/**
 * List all agents for a project, optionally filtered by category.
 * @param category - When provided, filters agents by their assigned category (e.g., "primary", "qa").
 */
export async function agentList(project: string, category?: string) {
  const url = category
    ? `/agents?project=${project}&category=${encodeURIComponent(category)}`
    : `/agents?project=${project}`;
  const res = await api.get(url);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/**
 * Get a single agent by name.
 * Agents are YAML-frontmatter files; the full parsed content is returned.
 */
export async function agentGet(project: string, name: string) {
  const res = await api.get(`/agents/${encodeURIComponent(name)}?project=${project}`);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/**
 * Create a new agent with YAML-frontmatter content.
 * The `content` is the full agent .md body; metadata fields are stored separately in the DB.
 */
export async function agentCreate(
  project: string,
  name: string,
  content: string,
  description?: string,
  category?: string,
  mode?: string,
  model?: string,
) {
  const res = await api.post(`/agents?project=${project}`, { name, content, description, category, mode, model });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/**
 * Update an existing agent's metadata or content.
 * @param updates - Partial fields to merge. Accepts any subset of agent properties.
 */
export async function agentUpdate(project: string, name: string, updates: Record<string, any>) {
  const res = await api.put(`/agents/${encodeURIComponent(name)}?project=${project}`, updates);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/**
 * Delete an agent by name.
 * Returns a plain-text confirmation on 204 (no content) instead of JSON.
 */
export async function agentDelete(project: string, name: string) {
  const res = await api.del(`/agents/${encodeURIComponent(name)}?project=${project}`);
  if (res.status === 204) {
    return { content: [{ type: "text" as const, text: "Agent deleted" }] };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Enable an agent — writes its .md file to disk so MCP clients can reference it. */
export async function agentEnable(project: string, name: string) {
  const res = await api.post(`/agents/${encodeURIComponent(name)}/enable?project=${project}`);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Disable an agent and remove its .md file from disk. */
export async function agentDisable(project: string, name: string) {
  const res = await api.post(`/agents/${encodeURIComponent(name)}/disable?project=${project}`);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/**
 * Sync an agent from its .md file on disk to the DB — edits made directly to the file are persisted.
 * This enables the disk → DB direction of the bidirectional sync model.
 */
export async function agentSync(project: string, name: string) {
  const res = await api.post(`/agents/${encodeURIComponent(name)}/sync?project=${project}`);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}
