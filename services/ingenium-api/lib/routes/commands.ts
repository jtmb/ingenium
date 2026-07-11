import { Router } from "express";
import { commands, logger } from "ingenium-core";
import { requireProject } from "../helpers.js";

export const commandsRouter = Router();

// GET / — list commands
commandsRouter.get("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const list = commands.listCommands(projectId);
  res.json({ data: list });
});

// POST / — create a new command
commandsRouter.post("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const { name, file_path, content } = req.body;
    if (!name || !file_path) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "name and file_path are required" } });
      return;
    }
    const cmd = commands.createCommand(projectId, name, file_path, content);
    res.status(201).json({ data: cmd });
  } catch (err: any) {
    logger.error("commands", `Command creation failed: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: err.message } });
  }
});

// GET /:name — get a single command
commandsRouter.get("/:name", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const cmd = commands.getCommand(projectId, req.params.name!);
  if (!cmd) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Command not found" } });
    return;
  }
  res.json({ data: cmd });
});

// PUT /:name — update a command
commandsRouter.put("/:name", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const updated = commands.updateCommand(projectId, req.params.name!, req.body);
    if (!updated) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Command not found" } });
      return;
    }
    res.json({ data: updated });
  } catch (err: any) {
    logger.error("commands", `Command update failed: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: err.message } });
  }
});

// DELETE /:name — delete a command
commandsRouter.delete("/:name", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const deleted = commands.deleteCommand(projectId, req.params.name!);
  if (!deleted) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Command not found" } });
    return;
  }
  res.status(204).send();
});
