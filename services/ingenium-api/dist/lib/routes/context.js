import { Router } from "express";
import { context } from "ingenium-core";
import { requireProject } from "../helpers.js";
export const contextRouter = Router();
contextRouter.get("/", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const limit = parseInt(req.query.limit) || 20;
    const entries = context.recentContext(projectId, limit);
    res.json({ data: entries });
});
contextRouter.get("/search", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const query = req.query.q;
    if (!query) {
        res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "query (q) is required" } });
        return;
    }
    const results = context.searchContext(projectId, query);
    res.json({ data: results });
});
contextRouter.post("/", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const { content, tags, priority } = req.body;
    const entry = context.saveContext(projectId, content, tags, priority);
    res.status(201).json({ data: entry });
});
