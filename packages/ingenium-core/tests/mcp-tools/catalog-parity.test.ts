import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MCP_TOOL_CATALOG, McpToolCatalogEntry, getCatalogMap } from "../../lib/tools/mcp-tool-catalog.js";
import { ALL_TOOLS, getCategoryMap } from "../../lib/tools/mcp-tool-states.js";

// ── Helpers ───────────────────────────────────────────

/**
 * Extracts tool names registered in mcp-server.ts by parsing the source.
 * Looks for patterns like: server.registerTool("ingenium_skill_list", ...)
 * Also handles extension-registered tools (synthesize_observations, auto_observe_now).
 */
function extractServerToolNames(): string[] {
  // Relative from packages/ingenium-core/tests/mcp-tools/ to services/ingenium-server/scripts/mcp-server.ts
  const serverPath = join(__dirname, "..", "..", "..", "..", "services", "ingenium-server", "scripts", "mcp-server.ts");
  const source = readFileSync(serverPath, "utf-8");

  // Match: server.registerTool("ingenium_*", ...)
  // Also capture the tool name from the first argument
  const toolNameRegex = /server\.registerTool\(\s*"([^"]+)"\s*,/g;
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = toolNameRegex.exec(source)) !== null) {
    names.push(match[1]);
  }
  return names;
}

// Known extension-registered tools (not in mcp-server.ts but still part of the system)
const EXTENSION_TOOLS = [
  "synthesize_observations",  // observer.ts
  "auto_observe_now",         // auto-observer.ts
];

// ── Tests ─────────────────────────────────────────────

describe("MCP Tool Catalog Parity", () => {
  // 1. Every registered tool in mcp-server.ts exists in the catalog
  it("every tool registered in mcp-server.ts exists in the catalog", () => {
    const serverToolNames = extractServerToolNames();
    const catalogMap = getCatalogMap();

    expect(serverToolNames.length, "should find at least 140 tools in mcp-server.ts").toBeGreaterThanOrEqual(140);

    const missingFromCatalog: string[] = [];
    for (const name of serverToolNames) {
      if (!catalogMap.has(name)) {
        missingFromCatalog.push(name);
      }
    }

    if (missingFromCatalog.length > 0) {
      console.error(`Tools in mcp-server.ts but NOT in catalog: ${missingFromCatalog.join(", ")}`);
    }
    expect(missingFromCatalog, "all mcp-server.ts tools must be in the catalog").toEqual([]);
  });

  // 2. Extension tools are in the catalog
  it("extension-registered tools are in the catalog", () => {
    const catalogMap = getCatalogMap();
    const missing: string[] = [];
    for (const name of EXTENSION_TOOLS) {
      if (!catalogMap.has(name)) {
        missing.push(name);
      }
    }
    expect(missing, "extension tools must be in the catalog").toEqual([]);
  });

  // 3. Every ALL_TOOLS entry exists in the catalog
  it("every ALL_TOOLS entry has a corresponding catalog entry", () => {
    const catalogMap = getCatalogMap();
    const missingFromCatalog: string[] = [];
    for (const name of ALL_TOOLS) {
      if (!catalogMap.has(name)) {
        missingFromCatalog.push(name);
      }
    }
    if (missingFromCatalog.length > 0) {
      console.error(`Tools in ALL_TOOLS but NOT in catalog: ${missingFromCatalog.join(", ")}`);
    }
    expect(missingFromCatalog, "ALL_TOOLS entries must exist in catalog").toEqual([]);
  });

  // 4. Every catalog entry must be in ALL_TOOLS
  it("every catalog entry is represented in ALL_TOOLS", () => {
    const allToolsSet = new Set(ALL_TOOLS);
    const missingFromAllTools: string[] = [];
    for (const entry of MCP_TOOL_CATALOG) {
      if (!allToolsSet.has(entry.name)) {
        missingFromAllTools.push(entry.name);
      }
    }
    if (missingFromAllTools.length > 0) {
      console.error(`Tools in catalog but NOT in ALL_TOOLS: ${missingFromAllTools.join(", ")}`);
    }
    expect(missingFromAllTools, "catalog entries must be in ALL_TOOLS").toEqual([]);
  });

  // 5. Every catalog entry has a unique name
  it("every catalog entry has a unique name", () => {
    const names = MCP_TOOL_CATALOG.map(e => e.name);
    const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
    expect(duplicates, "catalog must have unique tool names").toEqual([]);
  });

  // 6. Category counts should be consistent with catalog
  it("category counts are consistent with catalog", () => {
    const categoryMap = getCategoryMap();
    const catalogByCategory = new Map<string, McpToolCatalogEntry[]>();
    for (const entry of MCP_TOOL_CATALOG) {
      if (!catalogByCategory.has(entry.category)) {
        catalogByCategory.set(entry.category, []);
      }
      catalogByCategory.get(entry.category)!.push(entry);
    }

    // Every category in categoryMap should match catalog grouping
    for (const [category, toolNames] of categoryMap) {
      const catalogTools = catalogByCategory.get(category);
      expect(catalogTools, `category '${category}' must exist in catalog`).toBeDefined();
      if (catalogTools) {
        expect(
          toolNames.length,
          `category '${category}' count: categoryMap=${toolNames.length}, catalog=${catalogTools.length}`
        ).toBe(catalogTools.length);
        // All tool names in categoryMap should be in the catalog for this category
        for (const name of toolNames) {
          const inCatalog = catalogTools.some(e => e.name === name);
          expect(inCatalog, `tool '${name}' in categoryMap['${category}'] must be in catalog`).toBe(true);
        }
      }
    }

    // Every catalog category should exist in categoryMap
    for (const [category, catalogTools] of catalogByCategory) {
      const mapTools = categoryMap.get(category);
      expect(mapTools, `catalog category '${category}' must exist in categoryMap`).toBeDefined();
      if (mapTools) {
        expect(
          mapTools.length,
          `category '${category}' count: catalog=${catalogTools.length}, categoryMap=${mapTools.length}`
        ).toBe(catalogTools.length);
      }
    }
  });

  // 7. No duplicate endpoint mappings *within* the same tool entry
  it("no duplicate endpoints within any catalog entry", () => {
    const violations: string[] = [];
    for (const entry of MCP_TOOL_CATALOG) {
      const seen = new Set<string>();
      for (const ep of entry.apiEndpoints) {
        if (seen.has(ep)) {
          violations.push(`${entry.name}: duplicate endpoint '${ep}'`);
        }
        seen.add(ep);
      }
    }
    expect(violations, "no duplicate endpoints in any catalog entry").toEqual([]);
  });

  // 8. Verify catalog total count
  it("catalog has the expected number of tools", () => {
    // 148 from mcp-server.ts + 2 extension tools = 150
    expect(MCP_TOOL_CATALOG.length, "catalog should contain 148 server + 2 extension tools = 150 total").toBe(150);
  });

  // 9. Every tool name starts with "ingenium_" (except extension tools)
  it("all server tools have the ingenium_ prefix", () => {
    const nonPrefix: string[] = [];
    for (const entry of MCP_TOOL_CATALOG) {
      if (!EXTENSION_TOOLS.includes(entry.name) && !entry.name.startsWith("ingenium_")) {
        nonPrefix.push(entry.name);
      }
    }
    expect(nonPrefix, "server tools must have ingenium_ prefix").toEqual([]);
  });

  // 10. Category, description, and projectScope are populated for all entries
  it("every catalog entry has required fields", () => {
    const violations: string[] = [];
    for (const entry of MCP_TOOL_CATALOG) {
      if (!entry.name) violations.push(`${entry.name}: missing name`);
      if (!entry.category) violations.push(`${entry.name}: missing category`);
      if (!entry.description) violations.push(`${entry.name}: missing description`);
      if (entry.projectScope !== "per-project" && entry.projectScope !== "global") {
        violations.push(`${entry.name}: invalid projectScope '${entry.projectScope}'`);
      }
    }
    expect(violations, "all entries must have required fields").toEqual([]);
  });
});
