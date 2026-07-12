import { Router } from "express";
import { tasks, logger } from "ingenium-core";
import { requireProject } from "../helpers.js";
export const tasksRouter = Router();
// ============================================================================
// Literal-path routes — MUST be registered BEFORE /:id
// ============================================================================
// GET /search?q=X&limit=N
tasksRouter.get("/search", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const query = req.query.q;
    if (!query) {
        res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "query (q) is required" } });
        return;
    }
    const limit = parseInt(req.query.limit) || 50;
    const results = tasks.searchTasks(projectId, query, limit);
    res.json({ data: results, total: results.length });
});
// GET /board-config
tasksRouter.get("/board-config", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const config = tasks.getBoardConfig(projectId);
    res.json({ data: config });
});
// PUT /board-config
tasksRouter.put("/board-config", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const { columns, custom_field_defs } = req.body;
    const updated = tasks.updateBoardConfig(projectId, {
        columns: columns !== undefined ? (typeof columns === "string" ? columns : JSON.stringify(columns)) : undefined,
        custom_field_defs: custom_field_defs !== undefined ? (typeof custom_field_defs === "string" ? custom_field_defs : JSON.stringify(custom_field_defs)) : undefined,
    });
    if (!updated) {
        res.status(500).json({ error: { code: "INTERNAL", message: "Failed to update board config" } });
        return;
    }
    res.json({ data: updated });
});
// GET /notifications?recipient=X&unread=1
tasksRouter.get("/notifications", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const recipient = req.query.recipient;
    if (!recipient) {
        res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "recipient is required" } });
        return;
    }
    const unreadOnly = req.query.unread === "1" || req.query.unread === "true";
    const list = tasks.getNotifications(projectId, recipient, unreadOnly);
    res.json({ data: list, total: list.length });
});
// POST /notifications/:id/read
tasksRouter.post("/notifications/:id/read", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const id = req.params.id;
    const ok = tasks.markNotificationRead(projectId, id);
    if (!ok) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Notification not found" } });
        return;
    }
    res.json({ data: { read: true } });
});
// POST /bulk
tasksRouter.post("/bulk", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const { task_ids, ...fields } = req.body;
    if (!Array.isArray(task_ids) || task_ids.length === 0) {
        res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "task_ids array is required" } });
        return;
    }
    // Filter out undefined values; explicit empty strings mean "clear"
    const cleanFields = {};
    for (const [k, v] of Object.entries(fields)) {
        if (v === "") {
            cleanFields[k] = null;
        }
        else if (v !== undefined) {
            cleanFields[k] = v;
        }
    }
    if (Object.keys(cleanFields).length === 0) {
        res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "at least one field to update is required" } });
        return;
    }
    const count = tasks.bulkUpdateTasks(projectId, task_ids, cleanFields);
    res.json({ data: { updated: count } });
});
// GET /next — must be before /:id
tasksRouter.get("/next", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const task = tasks.getNextTask(projectId);
    if (!task) {
        res.json({ data: null });
        return;
    }
    res.json({ data: task });
});
// ============================================================================
// Collection routes
// ============================================================================
// GET /
tasksRouter.get("/", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const columnId = req.query.column_id;
    const list = tasks.listTasks(projectId, columnId);
    res.json({ data: list, total: list.length });
});
// POST /
tasksRouter.post("/", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const { title, description, assigned_to, parent_id, issue_type, priority, due_date, start_date, estimate_minutes, custom_fields } = req.body;
    if (!title) {
        res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "title is required" } });
        return;
    }
    const task = tasks.createTask(projectId, title, description, assigned_to, {
        parent_id,
        issue_type,
        priority,
        due_date,
        start_date,
        estimate_minutes,
        custom_fields: custom_fields !== undefined ? (typeof custom_fields === "string" ? custom_fields : JSON.stringify(custom_fields)) : undefined,
    });
    res.status(201).json({ data: task });
});
// ============================================================================
// Per-task routes (/:id)
// ============================================================================
// GET /:id
tasksRouter.get("/:id", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const task = tasks.getTask(req.params.id);
    if (!task) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Task not found" } });
        return;
    }
    res.json({ data: task });
});
// PATCH /:id
tasksRouter.patch("/:id", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const { column_id, actor, ...fields } = req.body;
    // If only column_id is provided, use moveTask for backward compatibility
    if (column_id && Object.keys(fields).length === 0) {
        const moved = tasks.moveTask(req.params.id, column_id, actor);
        if (!moved) {
            res.status(404).json({ error: { code: "NOT_FOUND", message: "Task not found" } });
            return;
        }
        res.json({ data: moved });
        return;
    }
    const updateFields = {};
    const mappable = [
        "title", "description", "assigned_to", "priority", "due_date", "start_date",
        "issue_type", "parent_id", "estimate_minutes", "spent_minutes", "remaining_minutes",
    ];
    for (const key of mappable) {
        if (key in fields)
            updateFields[key] = fields[key];
    }
    if (column_id !== undefined)
        updateFields["column_id"] = column_id;
    if ("custom_fields" in fields) {
        updateFields["custom_fields"] = typeof fields.custom_fields === "string"
            ? fields.custom_fields
            : JSON.stringify(fields.custom_fields);
    }
    const updated = tasks.updateTask(projectId, req.params.id, updateFields, actor);
    if (!updated) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Task not found" } });
        return;
    }
    res.json({ data: updated });
});
// DELETE /:id
tasksRouter.delete("/:id", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const actor = req.query.actor;
    const deleted = tasks.deleteTask(projectId, req.params.id, actor);
    if (!deleted) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Task not found" } });
        return;
    }
    res.status(204).send();
});
// GET /:id/comments
tasksRouter.get("/:id/comments", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const list = tasks.getComments(projectId, req.params.id);
    res.json({ data: list, total: list.length });
});
// POST /:id/comments
tasksRouter.post("/:id/comments", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const { author, body, parent_comment_id, actor } = req.body;
    if (!author || !body) {
        res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "author and body are required" } });
        return;
    }
    const comment = tasks.addComment(projectId, req.params.id, author, body, parent_comment_id, actor);
    res.status(201).json({ data: comment });
});
// PATCH /:id/comments/:commentId
tasksRouter.patch("/:id/comments/:commentId", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const { body, actor } = req.body;
    if (!body) {
        res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "body is required" } });
        return;
    }
    const comment = tasks.editComment(projectId, req.params.commentId, body, actor);
    if (!comment) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Comment not found" } });
        return;
    }
    res.json({ data: comment });
});
// POST /:id/comments/:commentId/react
tasksRouter.post("/:id/comments/:commentId/react", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const { reaction, actor } = req.body;
    if (!reaction) {
        res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "reaction is required" } });
        return;
    }
    const comment = tasks.reactComment(projectId, req.params.commentId, reaction, actor);
    if (!comment) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Comment not found" } });
        return;
    }
    res.json({ data: comment });
});
// GET /:id/activity
tasksRouter.get("/:id/activity", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const limit = parseInt(req.query.limit) || 50;
    const list = tasks.getTaskActivity(projectId, req.params.id, limit);
    res.json({ data: list, total: list.length });
});
// GET /:id/links
tasksRouter.get("/:id/links", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const list = tasks.getTaskLinks(projectId, req.params.id);
    res.json({ data: list, total: list.length });
});
// POST /:id/links
tasksRouter.post("/:id/links", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const { linked_task_id, link_type, actor } = req.body;
    if (!linked_task_id || !link_type) {
        res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "linked_task_id and link_type are required" } });
        return;
    }
    if (!["blocks", "blocked_by", "relates_to"].includes(link_type)) {
        res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "link_type must be blocks, blocked_by, or relates_to" } });
        return;
    }
    try {
        const link = tasks.linkTasks(projectId, req.params.id, linked_task_id, link_type, actor);
        res.status(201).json({ data: link });
    }
    catch (err) {
        logger.error("tasks", `Task link creation failed: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
        res.status(422).json({ error: { code: "VALIDATION_ERROR", message: err.message } });
    }
});
// DELETE /:id/links/:linkId
tasksRouter.delete("/:id/links/:linkId", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const actor = req.query.actor;
    const deleted = tasks.unlinkTasks(projectId, req.params.linkId, actor);
    if (!deleted) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Link not found" } });
        return;
    }
    res.status(204).send();
});
// GET /:id/tree
tasksRouter.get("/:id/tree", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const tree = tasks.getTaskTree(projectId, req.params.id);
    res.json({ data: tree });
});
