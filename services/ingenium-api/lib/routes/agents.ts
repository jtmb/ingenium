import { Router } from "express";
import { agents } from "ingenium-core";
import { requireProject } from "../helpers.js";

/**
 * CRUD routes for per-project agent profiles.
 * All routes require a project context — set via ?project= or X-Project-Id header.
 *
 * Agents are project-scoped resources used for persona-driven automation.
 * The sync endpoint bridges disk-stored .md agent files with the DB.
 * enable/disable toggle the agent's active state in the loaded config.
 */
export const agentsRouter = Router();

agentsRouter.get("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const category = req.query.category as string | undefined;
  // Optional category filter — when omitted returns all agents for the project
  const list = category ? agents.listAgents(projectId, category) : agents.listAgents(projectId);
  res.json({ data: list, total: list.length });
});

agentsRouter.get("/:name", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const agent = agents.getAgent(projectId, req.params.name);
  if (!agent) { res.status(404).json({ error: { code: "NOT_FOUND", message: `Agent '${req.params.name}' not found` } }); return; }
  res.json({ data: agent });
});

agentsRouter.post("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const { name, content, description, category, mode, model } = req.body;
  if (!name || !content) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "name and content are required" } });
    return;
  }
  const agent = agents.createAgent(projectId, name, content, description, category, mode, model);
  res.status(201).json({ data: agent });
});

agentsRouter.put("/:name", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  // Accepts partial body — only provided fields are updated
  const agent = agents.updateAgent(projectId, req.params.name, req.body);
  if (!agent) { res.status(404).json({ error: { code: "NOT_FOUND", message: `Agent '${req.params.name}' not found` } }); return; }
  res.json({ data: agent });
});

agentsRouter.delete("/:name", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const deleted = agents.deleteAgent(projectId, req.params.name);
  if (!deleted) { res.status(404).json({ error: { code: "NOT_FOUND", message: `Agent '${req.params.name}' not found` } }); return; }
  res.status(204).send();
});

agentsRouter.post("/:name/enable", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const agent = agents.enableAgent(projectId, req.params.name);
  if (!agent) { res.status(404).json({ error: { code: "NOT_FOUND", message: `Agent '${req.params.name}' not found` } }); return; }
  res.json({ data: agent });
});

agentsRouter.post("/:name/disable", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const agent = agents.disableAgent(projectId, req.params.name);
  if (!agent) { res.status(404).json({ error: { code: "NOT_FOUND", message: `Agent '${req.params.name}' not found` } }); return; }
  res.json({ data: agent });
});

// Disk → DB sync: reads the .md file from disk and updates the DB. Reverse direction (DB→disk) happens on enable.
agentsRouter.post("/:name/sync", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const agent = agents.syncAgentFromDisk(projectId, req.params.name);
  if (!agent) { res.status(404).json({ error: { code: "NOT_FOUND", message: `Agent '${req.params.name}' not found on disk` } }); return; }
  res.json({ data: agent });
});
