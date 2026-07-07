import { Router } from "express";
import { learnings } from "ingenium-core";
import { resolveProjectId } from "../helpers.js";
export const learningsRouter = Router();
learningsRouter.get("/", (req, res) => {
    const projectId = resolveProjectId(req.query.project ?? "default");
    const limit = parseInt(req.query.limit) || 20;
    const list = learnings.recentLearnings(projectId, limit);
    res.json({ data: list, total: list.length });
});
learningsRouter.get("/search", (req, res) => {
    const projectId = resolveProjectId(req.query.project ?? "default");
    const query = req.query.q;
    if (!query) {
        res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "query (q) is required" } });
        return;
    }
    const results = learnings.searchLearnings(projectId, query);
    res.json({ data: results, total: results.length });
});
learningsRouter.post("/", (req, res) => {
    const projectId = resolveProjectId(req.query.project ?? "default");
    const { entry_type, content, tags, priority, session_id } = req.body;
    const entry = learnings.logLearning(projectId, entry_type, content, tags, priority, session_id);
    res.status(201).json({ data: entry });
});
