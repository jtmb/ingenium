import { Router } from "express";
import { servers } from "ingenium-core";
import { resolveProjectId } from "../helpers.js";

export const serversRouter = Router();

serversRouter.get("/", (req, res) => {
  const projectId = resolveProjectId((req.query.project as string) ?? "default");
  const list = servers.listServers(projectId);
  res.json({ data: list });
});

serversRouter.post("/", (req, res) => {
  const projectId = resolveProjectId((req.query.project as string) ?? "default");
  const { name, command, args, env } = req.body;
  const server = servers.registerServer(projectId, name, command, args, env);
  res.status(201).json({ data: server });
});

serversRouter.delete("/:name", (req, res) => {
  const projectId = resolveProjectId((req.query.project as string) ?? "default");
  servers.removeServer(projectId, req.params.name!);
  res.status(204).send();
});
