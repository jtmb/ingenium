import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { MCPToolState } from "../schema.js";
import {
  MCP_TOOL_CATALOG,
  getAllToolNames as getStaticToolNames,
  getToolsByCategory,
  getCatalogMap as getStaticCatalogMap,
  getCategoryOrder,
} from "./mcp-tool-catalog.js";
import { listEffectiveChildMcpTools } from "./child-mcp-servers.js";
import { childMcpAuthorizationPolicy } from "./mcp-authorization-policy.js";

/**
 * MCP tool state — per-project enable/disable persistence for individual tools.
 *
 * The effective catalog determines each tool's default. Once a user explicitly
 * sets a state, it is stored in the mcp_tool_states table. Unknown tools fail
 * closed rather than inheriting an implicit enabled state.
 *
 * 🔴 All mutations use execTransaction() with checkpointAfterWrite() outside the txn.
 */

export { getToolsByCategory };
export type { McpToolCatalogEntry } from "./mcp-tool-catalog.js";

/**
 * Returns static catalog entries and, when a project is supplied, its eligible
 * persisted child-discovery metadata. This is metadata only: no child tool is
 * registered or forwarded by this function. Child entries remain present when
 * their server is disabled so the project can toggle them back on.
 */
export function getAllTools(projectId?: string) {
  const catalog = getStaticCatalogMap();
  if (!projectId) return catalog;

  for (const tool of listEffectiveChildMcpTools(projectId)) {
    catalog.set(tool.canonical_name, {
      name: tool.canonical_name,
      category: tool.category,
      description: tool.description,
      projectScope: tool.scope === "global" ? "global" : "per-project",
      defaultEnabled: true,
      apiEndpoints: [],
      authorization: childMcpAuthorizationPolicy(),
    });
  }
  return catalog;
}

/** Return static tool names, plus effective discovered child tool names when scoped to a project. */
export function getAllToolNames(projectId?: string): string[] {
  if (!projectId) return getStaticToolNames();
  return Array.from(getAllTools(projectId).keys());
}

/**
 * Read a tool's enabled state for a project.
 * Absence in the DB means the effective catalog default — this avoids populating
 * the table for every tool on every project; only explicitly toggled tools get rows.
 */
export function getToolState(projectId: string, toolName: string): boolean {
  const entry = getAllTools(projectId).get(toolName);
  if (!entry) return false;

  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const row = db.prepare("SELECT enabled FROM mcp_tool_states WHERE project_id = ? AND tool_name = ?").get(projectId, toolName) as { enabled: number } | undefined;
  if (!row) return entry.defaultEnabled;
  return row.enabled === 1;
}

export function setToolState(projectId: string, toolName: string, enabled: boolean): MCPToolState {
  if (!getAllTools(projectId).has(toolName)) {
    throw new Error("MCP_TOOL_NOT_REGISTERED");
  }

  const result = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    // Use UPSERT — table has UNIQUE(project_id, tool_name), no id column needed
    db.prepare(`
      INSERT INTO mcp_tool_states (project_id, tool_name, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id, tool_name) DO UPDATE SET enabled = ?, updated_at = ?
      WHERE mcp_tool_states.enabled IS NOT excluded.enabled
    `).run(projectId, toolName, enabled ? 1 : 0, now, now, enabled ? 1 : 0, now);
    const row = db.prepare(
      "SELECT * FROM mcp_tool_states WHERE project_id = ? AND tool_name = ?",
    ).get(projectId, toolName) as Omit<MCPToolState, "enabled"> & { enabled: number };
    return { ...row, enabled: row.enabled === 1 };
  });
  // 🔴 checkpointAfterWrite MUST be outside the transaction — calling it inside
  // the execTransaction callback causes SQLITE_LOCKED under concurrent access.
  checkpointAfterWrite();
  return result;
}

/**
 * List only explicitly-set tool states (tools with DB rows).
 * Tools not in the result use their catalog default. To get a complete view
 * with defaults filled in, use listToolStatesWithDefaults() instead.
 */
export function listToolStates(projectId: string): Array<{ tool_name: string; enabled: boolean }> {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const rows = db.prepare("SELECT tool_name, enabled FROM mcp_tool_states WHERE project_id = ? ORDER BY tool_name").all(projectId) as Array<{ tool_name: string; enabled: number }>;
  return rows.map(r => ({ tool_name: r.tool_name, enabled: r.enabled === 1 }));
}

/**
 * Return the complete tool state list for a project — every known tool from the
 * effective catalog with its enabled state. Tools that were never explicitly toggled
 * use their catalog default. This is the preferred function for UI rendering and
 * permission checks.
 */
export function listToolStatesWithDefaults(projectId: string): Array<{ tool_name: string; enabled: boolean }> {
  const states = listToolStates(projectId);
  const stateMap = new Map(states.map(s => [s.tool_name, s.enabled]));
  return Array.from(getAllTools(projectId).values(), (entry) => ({
    tool_name: entry.name,
    enabled: stateMap.get(entry.name) ?? entry.defaultEnabled,
  }));
}

/** Derived from catalog: category name → set of tool names in that category. */
export function getCategoryMap(projectId?: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const entry of getAllTools(projectId).values()) {
    if (!map.has(entry.category)) map.set(entry.category, []);
    map.get(entry.category)!.push(entry.name);
  }
  return map;
}

/**
 * Backward-compatible prefix→category map for tools not in the catalog.
 * Derives the prefix from the second underscore-separated segment of tool names
 * (e.g., "ingenium_skill_list" → prefix "skill" → category "Skills").
 * Also handles non-ingenium-prefixed tools like "synthesize_observations" and
 * "auto_observe_now" whose prefix is the first segment.
 */
export const CATEGORY_PREFIX: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const entry of MCP_TOOL_CATALOG) {
    const parts = entry.name.split("_");
    const prefix = parts[1];
    if (prefix && !map[prefix]) {
      map[prefix] = entry.category;
    }
  }
  // Handle non-ingenium-prefixed tools explicitly
  map["synthesize"] = "Synthesis";
  map["auto"] = "Extraction";
  return map;
})();

/**
 * Resolve the category for a tool name. Checks the catalog first (fast path),
 * then falls back to prefix-based lookup for any rogue tools not in the catalog.
 * Returns "Other" as a last resort.
 */
export function getCategory(toolName: string, projectId?: string): string {
  const catalogMap = getAllTools(projectId);
  const entry = catalogMap.get(toolName);
  if (entry) return entry.category;

  // Fallback for any tool not in the catalog (shouldn't happen, but guard).
  // If the tool name starts with "ingenium_", the category prefix is parts[1];
  // for unprefixed names, the prefix is parts[0].
  const parts = toolName.split("_");
  const prefix = toolName.startsWith("ingenium_") ? (parts.length > 1 ? parts[1] : parts[0]) : parts[0];
  if (prefix && CATEGORY_PREFIX[prefix]) {
    return CATEGORY_PREFIX[prefix];
  }
  return "Other";
}

export interface CategorizedTool {
  tool_name: string;
  enabled: boolean;
  category: string;
}

export function listCategorizedTools(projectId: string): Array<{
  category: string;
  enabled_count: number;
  total_count: number;
  tools: Array<{ tool_name: string; enabled: boolean }>;
}> {
  const tools = listToolStatesWithDefaults(projectId);
  const categorized = tools.map(t => ({ ...t, category: getCategory(t.tool_name, projectId) }));

  // Group by category
  const groups = new Map<string, Array<{ tool_name: string; enabled: boolean }>>();
  for (const t of categorized) {
    if (!groups.has(t.category)) groups.set(t.category, []);
    groups.get(t.category)!.push({ tool_name: t.tool_name, enabled: t.enabled });
  }

  // Return sorted categories in catalog order
  const categoryOrder = getCategoryOrder();
  return Array.from(groups.entries())
    .sort((a, b) => {
      const ai = categoryOrder.indexOf(a[0]);
      const bi = categoryOrder.indexOf(b[0]);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    })
    .map(([category, tools]) => ({
      category,
      enabled_count: tools.filter(t => t.enabled).length,
      total_count: tools.length,
      tools,
    }));
}

/**
 * Bulk-enable or bulk-disable all tools in a category. Every category change
 * commits atomically, so a constraint failure cannot leave a partial category
 * state. Returns the number of tools whose effective state changed.
 */
export function setCategoryState(projectId: string, category: string, enabled: boolean): number {
  const matchingTools = Array.from(getAllTools(projectId).values())
    .filter((entry) => entry.category === category);
  if (matchingTools.length === 0) return 0;

  const changed = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const existingStates = db.prepare(
      `SELECT tool_name, enabled
       FROM mcp_tool_states
       WHERE project_id = ?
         AND tool_name IN (${matchingTools.map(() => "?").join(", ")})`,
    ).all(projectId, ...matchingTools.map((entry) => entry.name)) as Array<{ tool_name: string; enabled: number }>;
    const stateMap = new Map(existingStates.map((state) => [state.tool_name, state.enabled === 1]));
    const now = new Date().toISOString();
    const upsert = db.prepare(`
      INSERT INTO mcp_tool_states (project_id, tool_name, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id, tool_name) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
      WHERE mcp_tool_states.enabled IS NOT excluded.enabled
    `);

    let changedCount = 0;
    for (const tool of matchingTools) {
      const current = stateMap.get(tool.name) ?? tool.defaultEnabled;
      if (current !== enabled) changedCount++;
      upsert.run(projectId, tool.name, enabled ? 1 : 0, now, now);
    }
    return changedCount;
  });
  checkpointAfterWrite();
  return changed;
}
