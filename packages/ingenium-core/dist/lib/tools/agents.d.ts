import { Agent } from "../schema.js";
export declare const AGENT_CATEGORIES: readonly ["primary", "execution", "research", "security", "chat"];
export type AgentCategory = typeof AGENT_CATEGORIES[number];
export declare function isSafeAgentName(name: unknown): name is string;
export declare function isAgentCategory(category: unknown): category is AgentCategory;
/**
 * List agents for a project, optionally filtered by category.
 * Results are ordered by category then name (or just name if category is specified).
 */
export declare function listAgents(projectId: string, category?: string): Agent[];
/** Get a single agent by project and name. Returns undefined if not found. */
export declare function getAgent(projectId: string, name: string): Agent | undefined;
/**
 * Create a new agent for a project.
 * Persists to DB and writes the agent `.md` file to `.opencode/agents/<category>/`.
 *
 * Defaults: category="execution", mode="subagent", model=null (no model override).
 */
export declare function createAgent(projectId: string, name: string, content: string, description?: string, category?: string, mode?: string, model?: string, enabled?: boolean): Agent;
/**
 * Update an existing agent's metadata and/or content.
 * Handles category changes by removing the old `.md` file and writing to the new category directory.
 *
 * NOTE: null model explicitly removes the model override; undefined preserves the existing value.
 */
export declare function updateAgent(projectId: string, name: string, updates: {
    description?: string;
    category?: string;
    mode?: string;
    model?: string | null;
    content?: string;
}): Agent | undefined;
/** Delete an agent: removes from DB and deletes the `.md` file from disk. Returns false if not found. */
export declare function deleteAgent(projectId: string, name: string): boolean;
/** Enable an agent and write its `.md` file to disk. */
export declare function enableAgent(projectId: string, name: string): Agent | undefined;
/** Disable an agent and remove its `.md` file from disk. */
export declare function disableAgent(projectId: string, name: string): Agent | undefined;
/**
 * Sync an agent from its `.md` file on disk into the DB.
 * Used by the bidirectional agent sync engine to reconcile disk → DB changes.
 *
 * If the agent exists in DB, its category from the DB is used to locate the file.
 * If not, all four category directories (primary, execution, research, security) are searched.
 *
 * Parses the full YAML frontmatter structure including:
 * - Basic fields: name, description, mode, reasoning_effort
 * - Permission blocks: read/write/bash, plus nested task/mcp/skill permissions
 * - Skills list
 */
export declare function syncAgentFromDisk(projectId: string, name: string): Agent | undefined;
//# sourceMappingURL=agents.d.ts.map