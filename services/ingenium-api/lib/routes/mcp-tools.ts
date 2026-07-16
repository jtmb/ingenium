import { Router } from "express";
import { mcpToolStates } from "ingenium-core";
import { requireProject } from "../helpers.js";

export const mcpToolsRouter = Router();

// ── Helpers ───────────────────────────────────────────

/**
 * Returns true if the tool name exists in the catalog.
 * Uses the catalog map from mcp-tool-states for O(1) lookup.
 */
function isKnownToolName(name: string): boolean {
  const catalog = mcpToolStates.getAllTools();
  return catalog.has(name);
}

/**
 * Returns the set of known category names from the catalog.
 */
function getKnownCategories(): Set<string> {
  const categoryMap = mcpToolStates.getCategoryMap();
  return new Set(categoryMap.keys());
}

// ── Catalog endpoints (MUST be before /:name to avoid capturing) ──

// GET /api/v1/mcp-tools/catalog — return the full tool catalog
mcpToolsRouter.get("/catalog", (_req, res) => {
  const catalog = mcpToolStates.getAllTools();
  const entries = Array.from(catalog.values());
  res.json({
    data: entries,
    total: entries.length,
  });
});

// GET /api/v1/mcp-tools/catalog/:name — single tool lookup from catalog
mcpToolsRouter.get("/catalog/:name", (req, res) => {
  const catalog = mcpToolStates.getAllTools();
  const entry = catalog.get(req.params.name!);
  if (!entry) {
    res.status(404).json({
      error: { code: "TOOL_NOT_REGISTERED", message: `Tool '${req.params.name}' is not registered in the catalog` },
    });
    return;
  }
  res.json({ data: entry });
});

// ── Tool state endpoints ──────────────────────────────

// GET /api/v1/mcp-tools — list all tools with their enabled/disabled state for a project
//   ?include_categories=true — returns categorized groups instead of flat list
mcpToolsRouter.get("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const includeCategories = req.query.include_categories === "true";
  if (includeCategories) {
    const tools = mcpToolStates.listCategorizedTools(projectId);
    res.json({ data: tools, total: tools.reduce((s, g) => s + g.total_count, 0) });
  } else {
    const tools = mcpToolStates.listToolStatesWithDefaults(projectId);
    res.json({ data: tools, total: tools.length });
  }
});

// GET /api/v1/mcp-tools/:name/state — get a single tool's state
mcpToolsRouter.get("/:name/state", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const toolName = req.params.name!;

  // If the tool is not in the catalog at all, reject with an explicit error
  if (!isKnownToolName(toolName)) {
    res.status(404).json({
      error: { code: "TOOL_NOT_REGISTERED", message: `Tool '${toolName}' is not registered in the catalog` },
    });
    return;
  }

  // Tool is known — return its current state (or default-enabled if no state row exists)
  const enabled = mcpToolStates.getToolState(projectId, toolName);
  res.json({ data: { tool_name: toolName, enabled } });
});

// PUT /api/v1/mcp-tools/category/:category — bulk enable/disable an entire category
// NOTE: must be registered before /:name so "category" is not captured as :name
mcpToolsRouter.put("/category/:category", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const category = req.params.category!;
  const { enabled } = req.body;
  if (typeof enabled !== "boolean") {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "enabled (boolean) is required" } });
    return;
  }

  // Validate category exists in catalog
  const knownCategories = getKnownCategories();
  if (!knownCategories.has(category)) {
    res.status(404).json({
      error: { code: "CATEGORY_NOT_FOUND", message: `Category '${category}' does not exist in the tool catalog` },
    });
    return;
  }

  const changed = mcpToolStates.setCategoryState(projectId, category, enabled);
  res.json({ data: { category, enabled, tools_changed: changed } });
});

// PUT /api/v1/mcp-tools/:name — toggle a tool's enabled state
mcpToolsRouter.put("/:name", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const toolName = req.params.name!;
  const { enabled } = req.body;
  if (typeof enabled !== "boolean") {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "enabled (boolean) is required" } });
    return;
  }

  // Validate tool exists in catalog
  if (!isKnownToolName(toolName)) {
    res.status(404).json({
      error: { code: "TOOL_NOT_REGISTERED", message: `Tool '${toolName}' is not registered in the catalog` },
    });
    return;
  }

  const state = mcpToolStates.setToolState(projectId, toolName, enabled);
  res.json({ data: state });
});
