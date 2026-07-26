import { MCPToolState } from "../schema.js";
import { getAllToolNames, getToolsByCategory } from "./mcp-tool-catalog.js";
/**
 * MCP tool state — per-project enable/disable persistence for individual tools.
 *
 * All tools default to enabled. Once a user explicitly sets a state, it's stored
 * in the mcp_tool_states table. Tools not present in the table are implicitly enabled.
 * The catalog in mcp-tool-catalog.ts is the canonical list of all known tools;
 * this module provides the per-project toggle layer on top.
 *
 * 🔴 All mutations use execTransaction() with checkpointAfterWrite() outside the txn.
 */
export { getToolsByCategory, getAllToolNames };
export type { McpToolCatalogEntry } from "./mcp-tool-catalog.js";
/** Returns the full catalog map (name → entry). */
export declare function getAllTools(): Map<string, import("./mcp-tool-catalog.js").McpToolCatalogEntry>;
/**
 * Read a tool's enabled state for a project.
 * Absence in the DB means "default enabled" — this avoids populating the table
 * for every tool on every project; only explicitly toggled tools get rows.
 */
export declare function getToolState(projectId: string, toolName: string): boolean;
export declare function setToolState(projectId: string, toolName: string, enabled: boolean): MCPToolState;
/**
 * List only explicitly-set tool states (tools with DB rows).
 * Tools not in the result are implicitly enabled. To get a complete view
 * with defaults filled in, use listToolStatesWithDefaults() instead.
 */
export declare function listToolStates(projectId: string): Array<{
    tool_name: string;
    enabled: boolean;
}>;
/** Derived from the catalog — all known tool names. */
export declare const ALL_TOOLS: string[];
/**
 * Return the complete tool state list for a project — every known tool from the
 * catalog with its effective enabled state. Tools that were never explicitly toggled
 * default to true. This is the preferred function for UI rendering and permission checks.
 */
export declare function listToolStatesWithDefaults(projectId: string): Array<{
    tool_name: string;
    enabled: boolean;
}>;
/** Derived from catalog: category name → set of tool names in that category. */
export declare function getCategoryMap(): Map<string, string[]>;
/**
 * Backward-compatible prefix→category map for tools not in the catalog.
 * Derives the prefix from the second underscore-separated segment of tool names
 * (e.g., "ingenium_skill_list" → prefix "skill" → category "Skills").
 * Also handles non-ingenium-prefixed tools like "synthesize_observations" and
 * "auto_observe_now" whose prefix is the first segment.
 */
export declare const CATEGORY_PREFIX: Record<string, string>;
/**
 * Resolve the category for a tool name. Checks the catalog first (fast path),
 * then falls back to prefix-based lookup for any rogue tools not in the catalog.
 * Returns "Other" as a last resort.
 */
export declare function getCategory(toolName: string): string;
export interface CategorizedTool {
    tool_name: string;
    enabled: boolean;
    category: string;
}
export declare function listCategorizedTools(projectId: string): Array<{
    category: string;
    enabled_count: number;
    total_count: number;
    tools: Array<{
        tool_name: string;
        enabled: boolean;
    }>;
}>;
/**
 * Bulk-enable or bulk-disable all tools in a category.
 * Iterates through each tool individually (not a single UPDATE) to trigger
 * per-tool logging and side effects. Returns the number of tools toggled.
 */
export declare function setCategoryState(projectId: string, category: string, enabled: boolean): number;
//# sourceMappingURL=mcp-tool-states.d.ts.map