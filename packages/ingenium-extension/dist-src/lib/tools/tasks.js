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
/** Mark a task as completed. */
export async function taskComplete(project, taskId) {
    const res = await api.patch(`/tasks/${taskId}`, {}, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Get the highest-priority next task to work on. */
export async function taskNext(project) {
    const res = await api.get("/tasks/next", { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
