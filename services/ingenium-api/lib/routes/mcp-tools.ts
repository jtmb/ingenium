import { Router } from "express";
import { mcpToolStates } from "ingenium-core";
import { requireProject } from "../helpers.js";

/** Handles /api/v1/mcp-tools — tool catalog queries and per-project enable/disable state. */
export const mcpToolsRouter = Router();

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

// NOTE: Catalog sub-routes (/catalog, /catalog/:name) MUST be registered before
// the /:name wildcard to avoid Express route capture.

mcpToolsRouter.get("/catalog", (_req, res) => {
  const catalog = mcpToolStates.getAllTools();
  const entries = Array.from(catalog.values());
  res.json({
    data: entries,
    total: entries.length,
  });
});

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

// GET /api/v1/mcp-tools — list all tools with enabled/disabled state for a project.
//   ?include_categories=true — returns categorized groups instead of flat list.
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

mcpToolsRouter.get("/:name/state", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const toolName = req.params.name!;

  if (!isKnownToolName(toolName)) {
    res.status(404).json({
      error: { code: "TOOL_NOT_REGISTERED", message: `Tool '${toolName}' is not registered in the catalog` },
    });
    return;
  }

  // Returns default-enabled (true) if no explicit state row exists for this tool
  const enabled = mcpToolStates.getToolState(projectId, toolName);
  res.json({ data: { tool_name: toolName, enabled } });
});

// NOTE: /category/:category must be registered before /:name so "category" is not captured as :name
mcpToolsRouter.put("/category/:category", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const category = req.params.category!;
  const { enabled } = req.body;
  if (typeof enabled !== "boolean") {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "enabled (boolean) is required" } });
    return;
  }

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

mcpToolsRouter.put("/:name", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const toolName = req.params.name!;
  const { enabled } = req.body;
  if (typeof enabled !== "boolean") {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "enabled (boolean) is required" } });
    return;
  }

  if (!isKnownToolName(toolName)) {
    res.status(404).json({
      error: { code: "TOOL_NOT_REGISTERED", message: `Tool '${toolName}' is not registered in the catalog` },
    });
    return;
  }

  const state = mcpToolStates.setToolState(projectId, toolName, enabled);
  res.json({ data: state });
});
