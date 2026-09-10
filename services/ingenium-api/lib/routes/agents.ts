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

function invalidAgentInput(res: import("express").Response, message: string): void {
  res.status(400).json({ error: { code: "VALIDATION_ERROR", message } });
}

function validName(name: unknown): name is string {
  return agents.isSafeAgentName(name);
}

function validCategory(category: unknown): boolean {
  return category === undefined || agents.isAgentCategory(category);
}

function rejectReservedAgentMutation(res: import("express").Response): void {
  res.status(403).json({
    error: {
      code: "RESERVED_AGENT",
      message: "The system LLM broker is always enabled and immutable.",
    },
  });
}

agentsRouter.get("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const category = req.query.category as string | undefined;
  if (!validCategory(category)) { invalidAgentInput(res, "Invalid agent category"); return; }
  // Optional category filter — when omitted returns all agents for the project
  const list = category ? agents.listAgents(projectId, category) : agents.listAgents(projectId);
  res.json({ data: list, total: list.length });
});

agentsRouter.get("/:name", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!validName(req.params.name)) { invalidAgentInput(res, "Invalid agent name"); return; }
  const agent = agents.getAgent(projectId, req.params.name);
  if (!agent) { res.status(404).json({ error: { code: "NOT_FOUND", message: `Agent '${req.params.name}' not found` } }); return; }
  res.json({ data: agent });
});

agentsRouter.post("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const { name, content, description, category, mode, model, enabled, permissions, metadata } = req.body;
  if (agents.isReservedAgentName(name)) {
    rejectReservedAgentMutation(res);
    return;
  }
  if (!validName(name) || !content || !validCategory(category)
    || (permissions !== undefined && !agents.isSerializedAgentObject(permissions))
    || (metadata !== undefined && !agents.isSerializedAgentObject(metadata))) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "name and content are required" } });
    return;
  }
  const agent = agents.createAgent(
    projectId,
    name,
    content,
    description,
    category,
    mode,
    model,
    enabled !== false,
    permissions,
    metadata,
  );
  res.status(201).json({ data: agent });
});

agentsRouter.put("/:name", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!validName(req.params.name)) {
    invalidAgentInput(res, "Invalid agent name");
    return;
  }
  if (agents.isReservedAgentName(req.params.name)) {
    rejectReservedAgentMutation(res);
    return;
  }
  if (!validCategory(req.body.category)
    || (req.body.permissions !== undefined && !agents.isSerializedAgentObject(req.body.permissions))
    || (req.body.metadata !== undefined && !agents.isSerializedAgentObject(req.body.metadata))) {
    invalidAgentInput(res, "Invalid agent name, category, permissions, or metadata");
    return;
  }
  // Accepts partial body — only provided fields are updated
  const agent = agents.updateAgent(projectId, req.params.name, req.body);
  if (!agent) { res.status(404).json({ error: { code: "NOT_FOUND", message: `Agent '${req.params.name}' not found` } }); return; }
  res.json({ data: agent });
});

agentsRouter.delete("/:name", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!validName(req.params.name)) { invalidAgentInput(res, "Invalid agent name"); return; }
  if (agents.isReservedAgentName(req.params.name)) {
    res.status(403).json({
      error: {
        code: "RESERVED_AGENT",
        message: "The system LLM broker cannot be deleted.",
      },
    });
    return;
  }
  const deleted = agents.deleteAgent(projectId, req.params.name);
  if (!deleted) { res.status(404).json({ error: { code: "NOT_FOUND", message: `Agent '${req.params.name}' not found` } }); return; }
  res.status(204).send();
});

agentsRouter.post("/:name/enable", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!validName(req.params.name)) { invalidAgentInput(res, "Invalid agent name"); return; }
  if (agents.isReservedAgentName(req.params.name)) {
    rejectReservedAgentMutation(res);
    return;
  }
  const agent = agents.enableAgent(projectId, req.params.name);
  if (!agent) { res.status(404).json({ error: { code: "NOT_FOUND", message: `Agent '${req.params.name}' not found` } }); return; }
  res.json({ data: agent });
});

agentsRouter.post("/:name/disable", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!validName(req.params.name)) { invalidAgentInput(res, "Invalid agent name"); return; }
  if (agents.isReservedAgentName(req.params.name)) {
    rejectReservedAgentMutation(res);
    return;
  }
  const agent = agents.disableAgent(projectId, req.params.name);
  if (!agent) { res.status(404).json({ error: { code: "NOT_FOUND", message: `Agent '${req.params.name}' not found` } }); return; }
  res.json({ data: agent });
});

// Disk → DB sync: reads the .md file from disk and updates the DB. Reverse direction (DB→disk) happens on enable.
agentsRouter.post("/:name/sync", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!validName(req.params.name)) { invalidAgentInput(res, "Invalid agent name"); return; }
  const agent = agents.syncAgentFromDisk(projectId, req.params.name);
  if (!agent) { res.status(404).json({ error: { code: "NOT_FOUND", message: `Agent '${req.params.name}' not found on disk` } }); return; }
  res.json({ data: agent });
});
