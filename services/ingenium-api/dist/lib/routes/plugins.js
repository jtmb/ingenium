import { Router } from "express";
import { plugins } from "ingenium-core";
import { resolveProjectId } from "../helpers.js";
export const pluginsRouter = Router();
pluginsRouter.get("/", (req, res) => {
    const projectId = resolveProjectId(req.query.project ?? "default");
    const list = plugins.listPlugins(projectId);
    res.json({ data: list });
});
pluginsRouter.post("/:name/enable", (req, res) => {
    const projectId = resolveProjectId(req.query.project ?? "default");
    const updated = plugins.enablePlugin(projectId, req.params.name);
    if (!updated) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Plugin not found" } });
        return;
    }
    res.json({ data: updated });
});
pluginsRouter.post("/:name/disable", (req, res) => {
    const projectId = resolveProjectId(req.query.project ?? "default");
    const updated = plugins.disablePlugin(projectId, req.params.name);
    if (!updated) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Plugin not found" } });
        return;
    }
    res.json({ data: updated });
});
