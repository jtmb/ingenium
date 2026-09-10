import { Router } from "express";
import { servers, projects } from "ingenium-core";
import { requireProject } from "../helpers.js";

/** Handles /api/v1/mcp-servers — child MCP server definitions (add, remove, update running state, bulk sync). */
export const serversRouter = Router();

serversRouter.get("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const list = servers.listServers(projectId);
  // Query the project record for is_global flag
  const projectName = req.query.project as string;
  const project = projects.getProject(projectName);
  res.json({ data: list, is_global: project?.is_global ?? false });
});

serversRouter.post("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const { name, command, args, env, source } = req.body;
  const server = servers.registerServer(projectId, name, command, args, env, source);
  res.status(201).json({ data: server });
});

serversRouter.patch("/:name", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const { running } = req.body;
  servers.updateServer(projectId, req.params.name!, { running });
  res.json({ data: { name: req.params.name, running } });
});

// Bulk-upserts the full server list — used by opencode.json config sync to reconcile disk state with DB
serversRouter.post("/sync-all", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const { servers: serverList } = req.body;
  if (!Array.isArray(serverList)) {
    res.status(400).json({ error: "servers array required" });
    return;
  }
  const results = serverList.map(
    (s: { name: string; command: string; args?: string; env?: string; source?: string }) =>
      servers.upsertServer(projectId, s.name, s.command, s.args, s.env, s.source)
  );
  res.json({ data: results });
});

serversRouter.delete("/:name", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  servers.removeServer(projectId, req.params.name!);
  res.status(204).send();
});
