/**
 * McpToolCatalog — canonical single source of truth for all Ingenium MCP tools.
 *
 * Derived from services/ingenium-server/scripts/mcp-server.ts registerTool() calls
 * plus extension-registered tools (synthesize_observations, auto_observe_now).
 *
 * Every tool known to the system MUST be listed here. The ALL_TOOLS array and
 * CATEGORY_PREFIX map in mcp-tool-states.ts derive from this catalog.
 */
export interface McpToolCatalogEntry {
    name: string;
    category: string;
    description: string;
    projectScope: "per-project" | "global";
    defaultEnabled: boolean;
    apiEndpoints: string[];
}
export declare const MCP_TOOL_CATALOG: McpToolCatalogEntry[];
/** Builds the lookup map of tool name → catalog entry. */
export declare function getCatalogMap(): Map<string, McpToolCatalogEntry>;
/** Returns all tool names (in catalog order). */
export declare function getAllToolNames(): string[];
/** Returns catalog entries grouped by category. Categories are sorted by catalog order. */
export declare function getToolsByCategory(): Map<string, McpToolCatalogEntry[]>;
/** Returns the ordered list of categories as they appear in the catalog. */
export declare function getCategoryOrder(): string[];
//# sourceMappingURL=mcp-tool-catalog.d.ts.map