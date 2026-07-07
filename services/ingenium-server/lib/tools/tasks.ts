/**
 * MCP tool handlers for Kaban-style task management.
 * Supports task CRUD, column movement, completion, and next-task retrieval.
 */
import { api } from "../client.js";

/** Create a new task with optional description and assignee. */
export async function taskCreate(project: string, title: string, description?: string, assignedTo?: string) {
  const res = await api.post("/tasks", { title, description, assigned_to: assignedTo }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** List tasks, optionally filtered by column. */
export async function taskList(project: string, columnId?: string) {
  const params: Record<string, string> = { project };
  if (columnId) params.column_id = columnId;
  const res = await api.get("/tasks", params);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Move a task to a different column. */
export async function taskMove(project: string, taskId: string, columnId: string) {
  const res = await api.patch(`/tasks/${taskId}`, { column_id: columnId }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Mark a task as completed. */
export async function taskComplete(project: string, taskId: string) {
  const res = await api.patch(`/tasks/${taskId}`, {}, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get the highest-priority next task to work on. */
export async function taskNext(project: string) {
  const res = await api.get("/tasks/next", { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}
