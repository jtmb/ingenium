import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { MCPToolState } from "../schema.js";
import {
  MCP_TOOL_CATALOG,
  getAllToolNames,
  getToolsByCategory,
  getCatalogMap,
  getCategoryOrder,
} from "./mcp-tool-catalog.js";

export { getToolsByCategory, getAllToolNames };
export type { McpToolCatalogEntry } from "./mcp-tool-catalog.js";

/** Returns the full catalog map (name → entry). */
export function getAllTools() {
  return getCatalogMap();
}

export function getToolState(projectId: string, toolName: string): boolean {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const row = db.prepare("SELECT enabled FROM mcp_tool_states WHERE project_id = ? AND tool_name = ?").get(projectId, toolName) as { enabled: number } | undefined;
  if (!row) return true; // default enabled
  return row.enabled === 1;
}

export function setToolState(projectId: string, toolName: string, enabled: boolean): MCPToolState {
  const result = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    // Use UPSERT — table has UNIQUE(project_id, tool_name), no id column needed
    db.prepare(`
      INSERT INTO mcp_tool_states (project_id, tool_name, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id, tool_name) DO UPDATE SET enabled = ?, updated_at = ?
    `).run(projectId, toolName, enabled ? 1 : 0, now, now, enabled ? 1 : 0, now);
    return db.prepare("SELECT * FROM mcp_tool_states WHERE project_id = ? AND tool_name = ?").get(projectId, toolName) as MCPToolState;
  });
  // 🔴 checkpointAfterWrite MUST be outside the transaction — calling it inside
  // the execTransaction callback causes SQLITE_LOCKED under concurrent access.
  checkpointAfterWrite();
  return result;
}

export function listToolStates(projectId: string): Array<{ tool_name: string; enabled: boolean }> {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const rows = db.prepare("SELECT tool_name, enabled FROM mcp_tool_states WHERE project_id = ? ORDER BY tool_name").all(projectId) as Array<{ tool_name: string; enabled: number }>;
  return rows.map(r => ({ tool_name: r.tool_name, enabled: r.enabled === 1 }));
}

/** Derived from the catalog — all known tool names. */
export const ALL_TOOLS: string[] = MCP_TOOL_CATALOG.map(e => e.name);

export function listToolStatesWithDefaults(projectId: string): Array<{ tool_name: string; enabled: boolean }> {
  const states = listToolStates(projectId);
  const stateMap = new Map(states.map(s => [s.tool_name, s.enabled]));
  return getAllToolNames().map(name => ({
    tool_name: name,
    enabled: stateMap.has(name) ? stateMap.get(name)! : true,
  }));
}

/** Derived from catalog: category name → set of tool names in that category. */
export function getCategoryMap(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const entry of MCP_TOOL_CATALOG) {
    if (!map.has(entry.category)) map.set(entry.category, []);
    map.get(entry.category)!.push(entry.name);
  }
  return map;
}

/** Backward-compatible: prefix → category name. */
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

export function getCategory(toolName: string): string {
  const catalogMap = getCatalogMap();
  const entry = catalogMap.get(toolName);
  if (entry) return entry.category;

  // Fallback for any tool not in the catalog (shouldn't happen, but guard)
  const parts = toolName.split("_");
  const prefix = parts.length > 1 ? parts[1] : parts[0];
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
  const categorized = tools.map(t => ({ ...t, category: getCategory(t.tool_name) }));

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

export function setCategoryState(projectId: string, category: string, enabled: boolean): number {
  const categoryMap = getCategoryMap();
  const matchingTools = categoryMap.get(category);
  if (!matchingTools || matchingTools.length === 0) return 0;

  let changed = 0;
  for (const toolName of matchingTools) {
    setToolState(projectId, toolName, enabled);
    changed++;
  }
  return changed;
}
