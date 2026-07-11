import { Router } from "express";
import { mcpToolStates } from "ingenium-core";
import { requireProject } from "../helpers.js";

export const mcpToolsRouter = Router();

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
  const enabled = mcpToolStates.getToolState(projectId, req.params.name!);
  res.json({ data: { tool_name: req.params.name, enabled } });
});

// PUT /api/v1/mcp-tools/category/:category — bulk enable/disable an entire category
// NOTE: must be registered before /:name so "category" is not captured as :name
mcpToolsRouter.put("/category/:category", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const { enabled } = req.body;
  if (typeof enabled !== "boolean") {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "enabled (boolean) is required" } });
    return;
  }
  const changed = mcpToolStates.setCategoryState(projectId, req.params.category!, enabled);
  res.json({ data: { category: req.params.category, enabled, tools_changed: changed } });
});

// PUT /api/v1/mcp-tools/:name — toggle a tool's enabled state
mcpToolsRouter.put("/:name", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const { enabled } = req.body;
  if (typeof enabled !== "boolean") {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "enabled (boolean) is required" } });
    return;
  }
  const state = mcpToolStates.setToolState(projectId, req.params.name!, enabled);
  res.json({ data: state });
});
