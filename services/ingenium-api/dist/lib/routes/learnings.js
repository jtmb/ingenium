import { Router } from "express";
import { learnings, detectSkillGap } from "ingenium-core";
import { requireProject } from "../helpers.js";
export const learningsRouter = Router();
learningsRouter.get("/", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status;
    if (status && !["pending", "processed", "failed"].includes(status)) {
        res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "status must be one of: pending, processed, failed" } });
        return;
    }
    const list = status
        ? learnings.getLearnings(projectId, status, limit)
        : learnings.recentLearnings(projectId, limit);
    res.json({ data: list, total: list.length });
});
learningsRouter.get("/search", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const query = req.query.q;
    if (!query) {
        res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "query (q) is required" } });
        return;
    }
    const results = learnings.searchLearnings(projectId, query);
    res.json({ data: results, total: results.length });
});
learningsRouter.post("/", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const { entry_type, content, tags, priority, session_id } = req.body;
    const entry = learnings.logLearning(projectId, entry_type, content, tags, priority, session_id);
    // Auto-detect skill gaps (fire-and-forget, non-blocking)
    if (process.env.INGENIUM_SKILL_AUTO_DETECT !== "0") {
        setImmediate(() => {
            try {
                const taskId = detectSkillGap.detectSkillGap(projectId, entry);
                if (taskId)
                    console.log(`[detectSkillGap] Auto-detected skill gap task created: ${taskId}`);
            }
            catch (err) {
                console.warn("[detectSkillGap] Detection failed (non-fatal):", err.message);
            }
        });
    }
    res.status(201).json({ data: entry });
});
learningsRouter.patch("/:id", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
        res.status(400).json({ error: { code: "INVALID_ID", message: "Learning ID must be a number" } });
        return;
    }
    const { status, entry_type, content, tags, priority } = req.body;
    const update = {};
    if (status !== undefined)
        update.status = status;
    if (entry_type !== undefined)
        update.entry_type = entry_type;
    if (content !== undefined)
        update.content = content;
    if (tags !== undefined)
        update.tags = tags;
    if (priority !== undefined)
        update.priority = priority;
    const result = learnings.updateLearning(id, update);
    if (!result) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Learning not found" } });
        return;
    }
    res.json({ data: result });
});
// POST /learnings/skill-from-learnings — manual scan trigger
learningsRouter.post("/skill-from-learnings", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const recent = learnings.recentLearnings(projectId, 20);
    const tasks = [];
    for (const learning of recent) {
        try {
            const taskId = detectSkillGap.detectSkillGap(projectId, learning);
            if (taskId)
                tasks.push(taskId);
        }
        catch (err) {
            console.warn(`[detectSkillGap] Error processing learning #${learning.id}:`, err.message);
        }
    }
    res.json({ data: { scanned: recent.length, tasks_created: tasks.length, task_ids: tasks } });
});
