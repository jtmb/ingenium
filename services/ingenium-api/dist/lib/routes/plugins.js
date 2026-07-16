import { Router } from "express";
import { plugins, logger } from "ingenium-core";
import { requireProject } from "../helpers.js";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
/**
 * Handles /api/v1/plugins — plugin lifecycle management.
 * 🔴 Every lifecycle operation MUST sync .opencode/plugins/<file>.ts on disk
 * AND opencode.json's plugin array (AGENTS.md HARD RULE #16).
 */
export const pluginsRouter = Router();
pluginsRouter.get("/", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const list = plugins.listPlugins(projectId);
    res.json({ data: list });
});
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
        logger.error("plugins", `Plugin creation failed: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
        res.status(400).json({ error: { code: "VALIDATION_ERROR", message: err.message } });
    }
});
// GET /:name/source — get plugin source from disk
pluginsRouter.get("/:name/source", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const plugin = plugins.getPlugin(projectId, req.params.name);
    if (!plugin) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Plugin not found" } });
        return;
    }
    try {
        const filePath = resolve(process.cwd(), plugin.file_path);
        const content = readFileSync(filePath, "utf-8");
        res.json({ data: { source: content } });
    }
    catch {
        res.json({ data: { source: plugin.source_content || "" } });
    }
});
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
        logger.error("plugins", `Plugin update failed: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
        res.status(400).json({ error: { code: "VALIDATION_ERROR", message: err.message } });
    }
});
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
