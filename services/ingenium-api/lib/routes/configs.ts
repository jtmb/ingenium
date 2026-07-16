import { Router } from "express";
import { configs } from "ingenium-core";
import { requireProject } from "../helpers.js";

/**
 * Config read/write routes for project-level (opencode.json) and global (opencode.jsonc) OpenCode configs.
 * All routes require a project context for the project-level config; the global config uses
 * the global-default project internally.
 *
 * The `type` query param discriminates between "project" and "global" scopes.
 * The sync endpoint reads config from disk into DB (disk → DB direction).
 */
export const configRouter = Router();

configRouter.get("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const type = (req.query.type as string) || "project";
  if (type !== "project" && type !== "global") {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "type must be 'project' or 'global'" } });
    return;
  }
  const config = configs.getConfig(projectId, type);
  res.json({ data: config || null });
});

configRouter.put("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const type = (req.query.type as string) || "project";
  if (type !== "project" && type !== "global") {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "type must be 'project' or 'global'" } });
    return;
  }
  const { content } = req.body;
  if (!content) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "content is required" } });
    return;
  }
  // Validate JSON before persisting — the DB stores raw text but downstream consumers (OpenCode) expect valid JSON/JSONC
  try { JSON.parse(content); } catch {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "content must be valid JSON" } });
    return;
  }
  const config = configs.saveConfig(projectId, type, content);
  res.json({ data: config });
});

// Disk → DB sync: reads config file from disk and upserts into the settings table
configRouter.post("/sync", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const type = (req.query.type as string) || "project";
  if (type !== "project" && type !== "global") {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "type must be 'project' or 'global'" } });
    return;
  }
  const result = configs.syncConfigFromDisk(projectId, type);
  res.json({ data: result || null });
});
