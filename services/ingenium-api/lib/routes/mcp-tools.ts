import { Router } from "express";
import { mcpToolStates } from "ingenium-core";
import { requireProject } from "../helpers.js";

export const mcpToolsRouter = Router();

// GET /api/v1/mcp-tools — list all tools with their enabled/disabled state for a project
mcpToolsRouter.get("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const tools = mcpToolStates.listToolStatesWithDefaults(projectId);
  res.json({ data: tools, total: tools.length });
});

// GET /api/v1/mcp-tools/:name/state — get a single tool's state
mcpToolsRouter.get("/:name/state", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const enabled = mcpToolStates.getToolState(projectId, req.params.name!);
  res.json({ data: { tool_name: req.params.name, enabled } });
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
