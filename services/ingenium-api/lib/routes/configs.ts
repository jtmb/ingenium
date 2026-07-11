import { Router } from "express";
import { configs } from "ingenium-core";
import { requireProject } from "../helpers.js";

export const configRouter = Router();

// GET /api/v1/config?type=project|global
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

// PUT /api/v1/config?type=project|global
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
  // Validate it's valid JSON/JSONC by attempting parse
  try { JSON.parse(content); } catch {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "content must be valid JSON" } });
    return;
  }
  const config = configs.saveConfig(projectId, type, content);
  res.json({ data: config });
});

// POST /api/v1/config/sync?type=project|global — sync from disk
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
