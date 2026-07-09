import { Router } from "express";
import { plugins } from "ingenium-core";
import { requireProject } from "../helpers.js";
export const pluginsRouter = Router();
// GET / — list plugins
pluginsRouter.get("/", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const list = plugins.listPlugins(projectId);
    res.json({ data: list });
});
// POST / — create a new plugin
pluginsRouter.post("/", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    try {
        const { name, file_path, source_content } = req.body;
        if (!name || !file_path) {
            res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "name and file_path are required" } });
            return;
        }
        const plugin = plugins.createPlugin(projectId, name, file_path, source_content);
        res.status(201).json({ data: plugin });
    }
    catch (err) {
        res.status(400).json({ error: { code: "VALIDATION_ERROR", message: err.message } });
    }
});
// GET /:name — get a single plugin
pluginsRouter.get("/:name", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const plugin = plugins.getPlugin(projectId, req.params.name);
    if (!plugin) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Plugin not found" } });
        return;
    }
    res.json({ data: plugin });
});
// PUT /:name — update a plugin
pluginsRouter.put("/:name", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    try {
        const updated = plugins.updatePlugin(projectId, req.params.name, req.body);
        if (!updated) {
            res.status(404).json({ error: { code: "NOT_FOUND", message: "Plugin not found" } });
            return;
        }
        res.json({ data: updated });
    }
    catch (err) {
        res.status(400).json({ error: { code: "VALIDATION_ERROR", message: err.message } });
    }
});
// DELETE /:name — delete a plugin
pluginsRouter.delete("/:name", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const deleted = plugins.deletePlugin(projectId, req.params.name);
    if (!deleted) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Plugin not found" } });
        return;
    }
    res.status(204).send();
});
// POST /:name/enable — enable a plugin (writes .ts to disk)
pluginsRouter.post("/:name/enable", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const updated = plugins.enablePlugin(projectId, req.params.name);
    if (!updated) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Plugin not found" } });
        return;
    }
    res.json({ data: updated });
});
// POST /:name/disable — disable a plugin (removes .ts from disk)
pluginsRouter.post("/:name/disable", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const updated = plugins.disablePlugin(projectId, req.params.name);
    if (!updated) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Plugin not found" } });
        return;
    }
    res.json({ data: updated });
});
