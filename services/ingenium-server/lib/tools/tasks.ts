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

/** Mark a task as completed (move to "done" column). */
export async function taskComplete(project: string, taskId: string) {
  const res = await api.patch(`/tasks/${taskId}`, { column_id: "done" }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get the highest-priority next task to work on. */
export async function taskNext(project: string) {
  const res = await api.get("/tasks/next", { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Update task fields (title, description, assigned_to, priority, etc.). */
export async function taskUpdate(project: string, taskId: string, fields: Record<string, unknown>) {
  const res = await api.patch(`/tasks/${taskId}`, fields, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Delete a task by ID. */
export async function taskDelete(project: string, taskId: string) {
  await api.del(`/tasks/${taskId}`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: taskId }) }] };
}

/** Full-text search across tasks. */
export async function taskSearch(project: string, query: string, limit?: number) {
  const params: Record<string, string> = { project, q: query };
  if (limit) params.limit = String(limit);
  const res = await api.get("/tasks/search", params);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Add a comment to a task. */
export async function taskComment(project: string, taskId: string, author: string, body: string, parentCommentId?: string) {
  const payload: Record<string, unknown> = { author, body };
  if (parentCommentId) payload.parent_comment_id = parentCommentId;
  const res = await api.post(`/tasks/${taskId}/comments`, payload, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get activity feed for a task. */
export async function taskActivity(project: string, taskId: string, limit?: number) {
  const params: Record<string, string> = { project };
  if (limit) params.limit = String(limit);
  const res = await api.get(`/tasks/${taskId}/activity`, params);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Link two tasks together (blocks, relates_to, duplicates). */
export async function taskLink(project: string, taskId: string, linkedTaskId: string, linkType: string) {
  const res = await api.post(`/tasks/${taskId}/links`, { linked_task_id: linkedTaskId, link_type: linkType }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get board configuration (columns and custom field definitions). */
export async function taskBoardConfigGet(project: string) {
  const res = await api.get("/tasks/board-config", { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Set board configuration (columns and/or custom field definitions). */
export async function taskBoardConfigSet(project: string, columns?: unknown[], customFieldDefs?: unknown[]) {
  const payload: Record<string, unknown> = {};
  if (columns) payload.columns = columns;
  if (customFieldDefs) payload.custom_field_defs = customFieldDefs;
  const res = await api.put("/tasks/board-config", payload, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Create a subtask under an existing task. */
export async function taskSubtaskCreate(project: string, parentId: string, title: string, description?: string, assignedTo?: string) {
  const payload: Record<string, unknown> = { title, parent_id: parentId };
  if (description) payload.description = description;
  if (assignedTo) payload.assigned_to = assignedTo;
  const res = await api.post("/tasks", payload, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** List task notifications for a recipient, optionally filtered by unread status. */
export async function taskNotifications(project: string, recipient: string, unread?: boolean) {
  const params: Record<string, string> = { project, recipient };
  if (unread !== undefined) params.unread = String(unread);
  const res = await api.get("/tasks/notifications", params);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get a single task by ID. */
export async function taskGet(project: string, taskId: string) {
  const res = await api.get(`/tasks/${taskId}`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** List comments for a task. */
export async function taskCommentsList(project: string, taskId: string) {
  const res = await api.get(`/tasks/${taskId}/comments`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Edit an existing comment on a task. */
export async function taskCommentEdit(project: string, taskId: string, commentId: string, body: string, actor?: string) {
  const payload: Record<string, unknown> = { body };
  if (actor) payload.actor = actor;
  const res = await api.patch(`/tasks/${taskId}/comments/${commentId}`, payload, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Add a reaction to a task comment. */
export async function taskCommentReact(project: string, taskId: string, commentId: string, reaction: string, actor: string) {
  const res = await api.post(`/tasks/${taskId}/comments/${commentId}/react`, { reaction, actor }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** List task links (blocks, relates_to, duplicates). */
export async function taskLinksList(project: string, taskId: string) {
  const res = await api.get(`/tasks/${taskId}/links`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Delete a task link by ID. */
export async function taskLinkDelete(project: string, taskId: string, linkId: string, actor?: string) {
  const params: Record<string, string> = { project };
  if (actor) params.actor = actor;
  await api.del(`/tasks/${taskId}/links/${linkId}`, params);
  return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: linkId }) }] };
}

/** Get the full task tree (parent + subtasks + linked tasks). */
export async function taskTree(project: string, taskId: string) {
  const res = await api.get(`/tasks/${taskId}/tree`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Mark a notification as read. */
export async function taskNotificationRead(project: string, notificationId: string) {
  const res = await api.post(`/tasks/notifications/${notificationId}/read`, {}, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Bulk update multiple tasks with the same fields. */
export async function taskBulkUpdate(project: string, taskIds: string[], fields: Record<string, unknown>) {
  const res = await api.post("/tasks/bulk", { task_ids: taskIds, ...fields }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}
