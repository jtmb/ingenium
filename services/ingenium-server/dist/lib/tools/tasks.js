/**
 * MCP tool handlers for Kaban-style task management.
 * Supports task CRUD, column movement, completion, and next-task retrieval.
 */
import { api } from "../client.js";
/** Create a new task with optional description and assignee. */
export async function taskCreate(project, title, description, assignedTo) {
    const res = await api.post("/tasks", { title, description, assigned_to: assignedTo }, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** List tasks, optionally filtered by column. */
export async function taskList(project, columnId) {
    const params = { project };
    if (columnId)
        params.column_id = columnId;
    const res = await api.get("/tasks", params);
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Move a task to a different column. */
export async function taskMove(project, taskId, columnId) {
    const res = await api.patch(`/tasks/${taskId}`, { column_id: columnId }, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Mark a task as completed (move to "done" column). */
export async function taskComplete(project, taskId) {
    const res = await api.patch(`/tasks/${taskId}`, { column_id: "done" }, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Get the highest-priority next task to work on. */
export async function taskNext(project) {
    const res = await api.get("/tasks/next", { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Update task fields (title, description, assigned_to, priority, etc.). */
export async function taskUpdate(project, taskId, fields) {
    const res = await api.patch(`/tasks/${taskId}`, fields, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Delete a task by ID. */
export async function taskDelete(project, taskId) {
    await api.del(`/tasks/${taskId}`, { project });
    return { content: [{ type: "text", text: JSON.stringify({ deleted: taskId }) }] };
}
/** Full-text search across tasks. */
export async function taskSearch(project, query, limit) {
    const params = { project, q: query };
    if (limit)
        params.limit = String(limit);
    const res = await api.get("/tasks/search", params);
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Add a comment to a task. */
export async function taskComment(project, taskId, author, body, parentCommentId) {
    const payload = { author, body };
    if (parentCommentId)
        payload.parent_comment_id = parentCommentId;
    const res = await api.post(`/tasks/${taskId}/comments`, payload, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Get activity feed for a task. */
export async function taskActivity(project, taskId, limit) {
    const params = { project };
    if (limit)
        params.limit = String(limit);
    const res = await api.get(`/tasks/${taskId}/activity`, params);
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Link two tasks together (blocks, relates_to, duplicates). */
export async function taskLink(project, taskId, linkedTaskId, linkType) {
    const res = await api.post(`/tasks/${taskId}/links`, { linked_task_id: linkedTaskId, link_type: linkType }, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Get board configuration (columns and custom field definitions). */
export async function taskBoardConfigGet(project) {
    const res = await api.get("/tasks/board-config", { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Set board configuration (columns and/or custom field definitions). */
export async function taskBoardConfigSet(project, columns, customFieldDefs) {
    const payload = {};
    if (columns)
        payload.columns = columns;
    if (customFieldDefs)
        payload.custom_field_defs = customFieldDefs;
    const res = await api.put("/tasks/board-config", payload, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Create a subtask under an existing task. */
export async function taskSubtaskCreate(project, parentId, title, description, assignedTo) {
    const payload = { title, parent_id: parentId };
    if (description)
        payload.description = description;
    if (assignedTo)
        payload.assigned_to = assignedTo;
    const res = await api.post("/tasks", payload, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** List task notifications for a recipient, optionally filtered by unread status. */
export async function taskNotifications(project, recipient, unread) {
    const params = { project, recipient };
    if (unread !== undefined)
        params.unread = String(unread);
    const res = await api.get("/tasks/notifications", params);
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
