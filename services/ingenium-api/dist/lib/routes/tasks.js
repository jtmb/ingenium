import { Router } from "express";
import { tasks } from "ingenium-core";
import { resolveProjectId } from "../helpers.js";
export const tasksRouter = Router();
tasksRouter.get("/", (req, res) => {
    const projectId = resolveProjectId(req.query.project ?? "default");
    const columnId = req.query.column_id;
    const list = tasks.listTasks(projectId, columnId);
    res.json({ data: list, total: list.length });
});
tasksRouter.post("/", (req, res) => {
    const projectId = resolveProjectId(req.query.project ?? "default");
    const { title, description, assigned_to } = req.body;
    const task = tasks.createTask(projectId, title, description, assigned_to);
    res.status(201).json({ data: task });
});
tasksRouter.patch("/:id", (req, res) => {
    const { column_id } = req.body;
    const updated = column_id
        ? tasks.moveTask(req.params.id, column_id)
        : tasks.completeTask(req.params.id);
    if (!updated) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Task not found" } });
        return;
    }
    res.json({ data: updated });
});
tasksRouter.get("/next", (req, res) => {
    const projectId = resolveProjectId(req.query.project ?? "default");
    const task = tasks.getNextTask(projectId);
    if (!task) {
        res.json({ data: null });
        return;
    }
    res.json({ data: task });
});
