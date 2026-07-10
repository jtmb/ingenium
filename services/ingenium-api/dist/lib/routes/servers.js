import { Router } from "express";
import { servers } from "ingenium-core";
import { requireProject } from "../helpers.js";
export const serversRouter = Router();
serversRouter.get("/", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const list = servers.listServers(projectId);
    res.json({ data: list });
});
serversRouter.post("/", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const { name, command, args, env } = req.body;
    const server = servers.registerServer(projectId, name, command, args, env);
    res.status(201).json({ data: server });
});
serversRouter.patch("/:name", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const { running } = req.body;
    servers.updateServer(projectId, req.params.name, { running });
    res.json({ data: { name: req.params.name, running } });
});
serversRouter.delete("/:name", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    servers.removeServer(projectId, req.params.name);
    res.status(204).send();
});
