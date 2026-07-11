import { Task, TaskComment, TaskActivity, TaskLink, TaskNotification, BoardConfig } from "../schema.js";
export declare function createTask(projectId: string, title: string, description?: string, assignedTo?: string, fields?: Partial<Pick<Task, "parent_id" | "issue_type" | "priority" | "due_date" | "start_date" | "estimate_minutes" | "custom_fields">>): Task;
export declare function listTasks(projectId: string, columnId?: string): Task[];
export declare function moveTask(taskId: string, columnId: string, actor?: string): Task | undefined;
export declare function completeTask(taskId: string, actor?: string): Task | undefined;
export declare function getNextTask(projectId: string): Task | undefined;
export declare function getTask(taskId: string): Task | undefined;
/**
 * Update task fields. Only provided fields are updated (partial update).
 */
export declare function updateTask(projectId: string, taskId: string, fields: Partial<Pick<Task, "title" | "description" | "assigned_to" | "column_id" | "priority" | "due_date" | "start_date" | "issue_type" | "parent_id" | "custom_fields" | "estimate_minutes" | "spent_minutes" | "remaining_minutes">>, actor?: string): Task | undefined;
/**
 * Hard delete a task + all related records (cascade manually).
 */
export declare function deleteTask(projectId: string, taskId: string, actor?: string): boolean;
/**
 * FTS5 search across task titles and descriptions.
 */
export declare function searchTasks(projectId: string, query: string, limit?: number): Task[];
/**
 * Get the task tree: root epics → stories → subtasks.
 * If parentId is provided, return only children of that parent.
 */
export declare function getTaskTree(projectId: string, parentId?: string): Record<string, unknown>[];
export declare function addComment(projectId: string, taskId: string, author: string, body: string, parentCommentId?: string, actor?: string): TaskComment;
export declare function editComment(projectId: string, commentId: string, body: string, actor?: string): TaskComment | undefined;
export declare function reactComment(projectId: string, commentId: string, reaction: string, actor?: string): TaskComment | undefined;
export declare function getComments(_projectId: string, taskId: string): TaskComment[];
export declare function getTaskActivity(_projectId: string, taskId: string, limit?: number): TaskActivity[];
export declare function linkTasks(projectId: string, taskId: string, linkedTaskId: string, linkType: "blocks" | "blocked_by" | "relates_to", actor?: string): TaskLink;
export declare function unlinkTasks(projectId: string, linkId: string, actor?: string): boolean;
export declare function getTaskLinks(_projectId: string, taskId: string): TaskLink[];
export declare function notifyTask(projectId: string, recipient: string, taskId: string, kind: "mentioned" | "assigned" | "watched_status"): TaskNotification | null;
export declare function getNotifications(projectId: string, recipient: string, unreadOnly?: boolean): TaskNotification[];
export declare function markNotificationRead(_projectId: string, notificationId: string): boolean;
export declare function getBoardConfig(projectId: string): BoardConfig;
export declare function updateBoardConfig(projectId: string, updates: {
    columns?: string;
    custom_field_defs?: string;
}): BoardConfig | undefined;
/**
 * Check WIP limit for a column. Returns { count, limit, breached }.
 * WIP limits are advisory — this is used by the API to return status,
 * not to block moves.
 */
export declare function validateWipLimit(projectId: string, columnId: string): {
    count: number;
    limit: number | null;
    breached: boolean;
};
export declare function bulkUpdateTasks(_projectId: string, taskIds: string[], fields: Partial<Pick<Task, "title" | "description" | "assigned_to" | "column_id" | "priority" | "due_date" | "start_date" | "issue_type" | "parent_id" | "custom_fields" | "estimate_minutes" | "spent_minutes" | "remaining_minutes">>): number;
//# sourceMappingURL=tasks.d.ts.map