import { Task, TaskComment, TaskActivity, TaskLink, TaskNotification, BoardConfig } from "../schema.js";
/**
 * Create a task in the "todo" column.
 *
 * `estimate_minutes` is also written to `remaining_minutes` (the two diverge
 * as work progresses). `spent_minutes` starts at 0. The callbacks are
 * responsible for deciding whether to create a parent (epic/story) first.
 */
export declare function createTask(projectId: string, title: string, description?: string, assignedTo?: string, fields?: Partial<Pick<Task, "parent_id" | "issue_type" | "priority" | "due_date" | "start_date" | "estimate_minutes" | "custom_fields">>): Task;
/**
 * List tasks for a project, optionally filtered by column.
 * Results ordered by priority DESC then FIFO creation time.
 */
export declare function listTasks(projectId: string, columnId?: string): Task[];
/**
 * Move a task to a new column. `completed_at` is set only when moving to "done".
 * Returns the updated task (or undefined if the task doesn't exist).
 */
export declare function moveTask(taskId: string, columnId: string, actor?: string): Task | undefined;
/** Convenience wrapper — delegates to moveTask(…, "done"). */
export declare function completeTask(taskId: string, actor?: string): Task | undefined;
/**
 * Return the highest-priority task in the "todo" column.
 * Priority-first, then FIFO (oldest first) for tiebreaking.
 */
export declare function getNextTask(projectId: string): Task | undefined;
/** Get a single task by ID. Returns undefined if not found. */
export declare function getTask(taskId: string): Task | undefined;
/**
 * Partial update of task fields. Builds a dynamic SET clause from the provided
 * keys so callers only send the fields they intend to change.
 *
 * When `column_id` is set to "done", `completed_at` is stamped automatically.
 * `expectedRevision` is NOT supported here (unlike docs pages) — this is a
 * last-writer-wins model.
 */
export declare function updateTask(projectId: string, taskId: string, fields: Partial<Pick<Task, "title" | "description" | "assigned_to" | "column_id" | "priority" | "due_date" | "start_date" | "issue_type" | "parent_id" | "custom_fields" | "estimate_minutes" | "spent_minutes" | "remaining_minutes">>, actor?: string): Task | undefined;
/**
 * Hard delete a task + all related records (cascade manually because
 * SQLite FK enforcement may not cascade on TEXT PKs).
 * Deletion order: comments → activity → links → notifications → task.
 * FTS triggers fire automatically on the task delete.
 */
export declare function deleteTask(projectId: string, taskId: string, actor?: string): boolean;
/**
 * FTS5 full-text search across task titles and descriptions.
 * Returns results ranked by BM25 relevance, scoped to the given project.
 * Returns an empty array if the query sanitizes to nothing (stop-words only, etc.).
 */
export declare function searchTasks(projectId: string, query: string, limit?: number): Task[];
/**
 * Get the task tree: root epics → stories → subtasks.
 * If parentId is provided, return only children of that parent.
 *
 * PERF: Uses recursive N+1 queries (one per parent). Fine for typical
 *       3-level hierarchies but will be slow with very deep trees.
 */
export declare function getTaskTree(projectId: string, parentId?: string): Record<string, unknown>[];
/**
 * Add a comment to a task. Supports threaded replies via `parentCommentId`.
 * `actor` is distinct from `author` — the author is the commenter, while
 * actor is who performed the action (for activity log), defaulting to author.
 */
export declare function addComment(projectId: string, taskId: string, author: string, body: string, parentCommentId?: string, actor?: string): TaskComment;
/**
 * Edit an existing comment body. Stamps `edited_at` timestamp.
 */
export declare function editComment(projectId: string, commentId: string, body: string, actor?: string): TaskComment | undefined;
/**
 * Add a reaction (emoji) to a comment. Reactions are stored as a JSON map:
 * `{ "👍": 2, "🚀": 1 }`. Each call increments the counter for that emoji.
 *
 * HACK: Read-modify-write on the JSON blob — not safe under concurrent access.
 *       Two callers reacting at the same time can lose one increment.
 *       A proper fix would extract reactions to a separate table.
 */
export declare function reactComment(projectId: string, commentId: string, reaction: string, actor?: string): TaskComment | undefined;
/** Get all comments for a task, ordered chronologically. */
export declare function getComments(_projectId: string, taskId: string): TaskComment[];
/**
 * Get activity timeline for a task.
 * Maps the DB column `event_type` → the frontend-facing `action` field
 * so the API can expose a uniform interface without renaming columns.
 */
export declare function getTaskActivity(_projectId: string, taskId: string, limit?: number): TaskActivity[];
/**
 * Create a link between two tasks.
 * - Self-links are rejected explicitly.
 * - Duplicate links (same pair + type) return the existing link silently.
 * - Activity is logged on BOTH tasks so both timelines show the link.
 */
export declare function linkTasks(projectId: string, taskId: string, linkedTaskId: string, linkType: "blocks" | "blocked_by" | "relates_to", actor?: string): TaskLink;
/**
 * Remove a task link. Reads the link before deleting so we can log
 * the activity with context (knowing which two tasks were involved).
 */
export declare function unlinkTasks(projectId: string, linkId: string, actor?: string): boolean;
/**
 * Get all links for a task (both directions — where taskId is either
 * source or target).
 */
export declare function getTaskLinks(_projectId: string, taskId: string): TaskLink[];
/**
 * Create a notification for a user about a task event.
 * Deduplicates: if an unread notification already exists for the same
 * recipient + task + kind, no duplicate is created.
 */
export declare function notifyTask(projectId: string, recipient: string, taskId: string, kind: "mentioned" | "assigned" | "watched_status"): TaskNotification | null;
/**
 * List notifications for a recipient. Optionally filter to unread only.
 * Ordered most-recent-first.
 */
export declare function getNotifications(projectId: string, recipient: string, unreadOnly?: boolean): TaskNotification[];
/** Mark a single notification as read by setting `read_at` timestamp. */
export declare function markNotificationRead(_projectId: string, notificationId: string): boolean;
/**
 * Get the board configuration for a project. If none exists, creates one
 * with the default columns (Todo → In Progress → Review → Done) with WIP
 * limits on In Progress (5) and Review (3).
 *
 * Uses INSERT OR IGNORE so concurrent calls don't cause constraint errors.
 */
export declare function getBoardConfig(projectId: string): BoardConfig;
/**
 * Update board configuration. If no config exists yet for the project,
 * one is created with defaults before applying the update.
 * Only the provided fields are changed (partial update).
 */
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
/**
 * Apply the same field changes to multiple tasks in a single transaction.
 * Uses an SQL `IN (...)` clause. Returns the number of affected rows.
 *
 * NOTE: Shares the dynamic SET-builder pattern with `updateTask` — any
 *       change to the field mapping should be mirrored in both places.
 */
export declare function bulkUpdateTasks(_projectId: string, taskIds: string[], fields: Partial<Pick<Task, "title" | "description" | "assigned_to" | "column_id" | "priority" | "due_date" | "start_date" | "issue_type" | "parent_id" | "custom_fields" | "estimate_minutes" | "spent_minutes" | "remaining_minutes">>): number;
//# sourceMappingURL=tasks.d.ts.map