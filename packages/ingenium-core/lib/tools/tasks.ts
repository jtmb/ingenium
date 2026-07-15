import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { Task, TaskComment, TaskActivity, TaskLink, TaskNotification, BoardConfig } from "../schema.js";
import { randomUUID } from "node:crypto";

// ============================================================================
// Internal helpers
// ============================================================================

function dbPath(): string {
  // Use the same default as other core modules ("data" not "data.db").
  // The INGENIUM_CORE_DB_PATH env var is set by supervisord to the canonical path
  // (e.g. /app/.ingenium/data). The fallback "data" avoids creating a separate .db file.
  return process.env.INGENIUM_CORE_DB_PATH ?? "./data";
}

/**
 * Log activity for a task. Internal helper — called from every mutation.
 */
function logTaskActivity(
  _projectId: string,
  taskId: string,
  actor: string,
  eventType: string,
  payload?: Record<string, unknown>,
): void {
  // Activity logging runs in its own transaction so it doesn't nest
  // inside the parent transaction of the mutation.
  const id = randomUUID();
  const now = new Date().toISOString();
  const db = getDb(dbPath());
  db.prepare(
    `INSERT INTO task_activity (id, task_id, actor, event_type, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, taskId, actor, eventType, payload ? JSON.stringify(payload) : null, now);
}

// ============================================================================
// Task CRUD
// ============================================================================

export function createTask(
  projectId: string,
  title: string,
  description?: string,
  assignedTo?: string,
  fields?: Partial<Pick<Task, "parent_id" | "issue_type" | "priority" | "due_date" | "start_date" | "estimate_minutes" | "custom_fields">>,
): Task {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO tasks (id, project_id, title, description, column_id, assigned_to,
        parent_id, issue_type, priority, due_date, start_date,
        estimate_minutes, spent_minutes, remaining_minutes, custom_fields,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, 'todo', ?,
         ?, ?, ?, ?, ?,
         ?, 0, ?, ?,
         ?, ?)`
    ).run(
      id, projectId, title, description ?? null, assignedTo ?? null,
      fields?.parent_id ?? null, fields?.issue_type ?? "task", fields?.priority ?? 0,
      fields?.due_date ?? null, fields?.start_date ?? null,
      fields?.estimate_minutes ?? null, fields?.estimate_minutes ?? null, fields?.custom_fields ?? null,
      now, now,
    );
    return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task;
  });
  checkpointAfterWrite();

  // Log activity outside transaction
  logTaskActivity(projectId, result.id, "system", "created", { title });

  return result;
}

export function listTasks(projectId: string, columnId?: string): Task[] {
  const db = getDb(dbPath());
  if (columnId) {
    return db.prepare(
      "SELECT * FROM tasks WHERE project_id = ? AND column_id = ? ORDER BY priority DESC, created_at"
    ).all(projectId, columnId) as Task[];
  }
  return db.prepare(
    "SELECT * FROM tasks WHERE project_id = ? ORDER BY priority DESC, created_at"
  ).all(projectId) as Task[];
}

export function moveTask(taskId: string, columnId: string, actor?: string): Task | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const now = new Date().toISOString();
    const completedAt = columnId === "done" ? now : null;
    const prev = db.prepare("SELECT column_id FROM tasks WHERE id = ?").get(taskId) as { column_id: string } | undefined;
    db.prepare("UPDATE tasks SET column_id = ?, updated_at = ?, completed_at = ? WHERE id = ?")
      .run(columnId, now, completedAt, taskId);
    return { task: db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task | undefined, prevColumn: prev?.column_id };
  });
  checkpointAfterWrite();

  if (result.task) {
    logTaskActivity("", taskId, actor ?? "system", "moved", {
      from: result.prevColumn,
      to: columnId,
    });
  }

  return result.task;
}

export function completeTask(taskId: string, actor?: string): Task | undefined {
  return moveTask(taskId, "done", actor);
}

export function getNextTask(projectId: string): Task | undefined {
  const db = getDb(dbPath());
  return db.prepare(
    `SELECT * FROM tasks WHERE project_id = ? AND column_id = 'todo'
     ORDER BY priority DESC, created_at ASC LIMIT 1`
  ).get(projectId) as Task | undefined;
}

export function getTask(taskId: string): Task | undefined {
  const db = getDb(dbPath());
  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task | undefined;
}

/**
 * Update task fields. Only provided fields are updated (partial update).
 */
export function updateTask(
  projectId: string,
  taskId: string,
  fields: Partial<Pick<Task, "title" | "description" | "assigned_to" | "column_id" | "priority" | "due_date" | "start_date" | "issue_type" | "parent_id" | "custom_fields" | "estimate_minutes" | "spent_minutes" | "remaining_minutes">>,
  actor?: string,
): Task | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const now = new Date().toISOString();

    // Build dynamic SET clause
    const setClauses: string[] = ["updated_at = ?"];
    const params: unknown[] = [now];

    const mappable: Record<string, string> = {
      title: "title",
      description: "description",
      assigned_to: "assigned_to",
      column_id: "column_id",
      priority: "priority",
      due_date: "due_date",
      start_date: "start_date",
      issue_type: "issue_type",
      parent_id: "parent_id",
      custom_fields: "custom_fields",
      estimate_minutes: "estimate_minutes",
      spent_minutes: "spent_minutes",
      remaining_minutes: "remaining_minutes",
    };

    for (const [field, col] of Object.entries(mappable)) {
      if (field in fields) {
        setClauses.push(`${col} = ?`);
        params.push((fields as any)[field] ?? null);
      }
    }

    // Handle column_id move (set completed_at)
    if (fields.column_id !== undefined) {
      if (fields.column_id === "done") {
        setClauses.push("completed_at = ?");
        params.push(now);
      }
    }

    params.push(taskId);

    const sql = `UPDATE tasks SET ${setClauses.join(", ")} WHERE id = ?`;
    const info = db.prepare(sql).run(...params);

    if (info.changes === 0) return undefined;

    return db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task;
  });
  checkpointAfterWrite();

  if (result && actor) {
    logTaskActivity(projectId, taskId, actor, "edited", Object.keys(fields).reduce((acc, k) => {
      (acc as any)[k] = (fields as any)[k];
      return acc;
    }, {} as Record<string, unknown>));
  }

  return result;
}

/**
 * Hard delete a task + all related records (cascade manually).
 */
export function deleteTask(projectId: string, taskId: string, actor?: string): boolean {
  const result = execTransaction(() => {
    const db = getDb(dbPath());

    // Check task exists
    const task = db.prepare("SELECT id FROM tasks WHERE id = ?").get(taskId) as { id: string } | undefined;
    if (!task) return false;

    // Delete child comments first (due to parent_comment_id self-reference)
    db.prepare("DELETE FROM task_comments WHERE task_id = ?").run(taskId);
    // Delete activity
    db.prepare("DELETE FROM task_activity WHERE task_id = ?").run(taskId);
    // Delete links in both directions
    db.prepare("DELETE FROM task_links WHERE task_id = ? OR linked_task_id = ?").run(taskId, taskId);
    // Delete notifications
    db.prepare("DELETE FROM task_notifications WHERE task_id = ?").run(taskId);
    // Delete the task itself (FTS triggers fire automatically)
    db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);

    return true;
  });
  checkpointAfterWrite();

  if (result && actor) {
    logTaskActivity(projectId, taskId, actor, "deleted", {});
  }

  return result;
}

/**
 * FTS5 search across task titles and descriptions.
 */
export function searchTasks(projectId: string, query: string, limit = 50): Task[] {
  const db = getDb(dbPath());
  // Sanitize FTS5 query: wrap terms in quotes to avoid syntax errors
  const sanitized = query.replace(/"/g, '""');
  return db.prepare(
    `SELECT t.*, rank FROM tasks t
     INNER JOIN tasks_fts fts ON fts.rowid = t.rowid
     WHERE t.project_id = ? AND tasks_fts MATCH ?
     ORDER BY rank
     LIMIT ?`
  ).all(projectId, sanitized, limit) as Task[];
}

// ============================================================================
// Hierarchy
// ============================================================================

/**
 * Get the task tree: root epics → stories → subtasks.
 * If parentId is provided, return only children of that parent.
 */
export function getTaskTree(projectId: string, parentId?: string): Record<string, unknown>[] {
  const db = getDb(dbPath());

  if (parentId) {
    // Get immediate children of a specific parent
    const children = db.prepare(
      "SELECT * FROM tasks WHERE project_id = ? AND parent_id = ? ORDER BY priority DESC, created_at"
    ).all(projectId, parentId) as Task[];

    return children.map((t) => ({
      ...t,
      children: getTaskTree(projectId, t.id),
    }));
  }

  // Get root epics (parent_id IS NULL AND issue_type = 'epic')
  const epics = db.prepare(
    "SELECT * FROM tasks WHERE project_id = ? AND parent_id IS NULL AND issue_type = 'epic' ORDER BY priority DESC, created_at"
  ).all(projectId) as Task[];

  return epics.map((epic) => ({
    ...epic,
    children: getTaskTree(projectId, epic.id),
  }));
}

// ============================================================================
// Comments
// ============================================================================

export function addComment(
  projectId: string,
  taskId: string,
  author: string,
  body: string,
  parentCommentId?: string,
  actor?: string,
): TaskComment {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO task_comments (id, task_id, parent_comment_id, author, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, taskId, parentCommentId ?? null, author, body, now);
    return db.prepare("SELECT * FROM task_comments WHERE id = ?").get(id) as TaskComment;
  });
  checkpointAfterWrite();

  logTaskActivity(projectId, taskId, actor ?? author, "commented", { commentId: result.id });

  return result;
}

export function editComment(
  projectId: string,
  commentId: string,
  body: string,
  actor?: string,
): TaskComment | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const now = new Date().toISOString();
    const info = db.prepare(
      "UPDATE task_comments SET body = ?, edited_at = ? WHERE id = ?"
    ).run(body, now, commentId);
    if (info.changes === 0) return undefined;
    return db.prepare("SELECT * FROM task_comments WHERE id = ?").get(commentId) as TaskComment;
  });
  checkpointAfterWrite();

  if (result && actor) {
    logTaskActivity(projectId, result.task_id, actor, "edited_comment", { commentId });
  }

  return result;
}

export function reactComment(
  projectId: string,
  commentId: string,
  reaction: string,
  actor?: string,
): TaskComment | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());

    // Read existing reactions
    const comment = db.prepare("SELECT reactions, task_id FROM task_comments WHERE id = ?").get(commentId) as
      { reactions: string; task_id: string } | undefined;
    if (!comment) return undefined;

    let reactions: Record<string, number> = {};
    try {
      reactions = JSON.parse(comment.reactions || "{}");
    } catch { /* use empty */ }

    reactions[reaction] = (reactions[reaction] || 0) + 1;

    db.prepare("UPDATE task_comments SET reactions = ? WHERE id = ?")
      .run(JSON.stringify(reactions), commentId);

    return db.prepare("SELECT * FROM task_comments WHERE id = ?").get(commentId) as TaskComment;
  });
  checkpointAfterWrite();

  if (result && actor) {
    logTaskActivity(projectId, result.task_id, actor, "reacted", { commentId, reaction });
  }

  return result;
}

export function getComments(_projectId: string, taskId: string): TaskComment[] {
  const db = getDb(dbPath());
  return db.prepare(
    "SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at"
  ).all(taskId) as TaskComment[];
}

// ============================================================================
// Activity
// ============================================================================

export function getTaskActivity(_projectId: string, taskId: string, limit = 50): TaskActivity[] {
  const db = getDb(dbPath());
  const rows = db.prepare(
    "SELECT * FROM task_activity WHERE task_id = ? ORDER BY created_at DESC LIMIT ?"
  ).all(taskId, limit) as any[];
  // Map DB column "event_type" to the frontend-facing "action" field
  return rows.map((r) => ({
    ...r,
    action: r.event_type || "",
  }));
}

// ============================================================================
// Links
// ============================================================================

export function linkTasks(
  projectId: string,
  taskId: string,
  linkedTaskId: string,
  linkType: "blocks" | "blocked_by" | "relates_to",
  actor?: string,
): TaskLink {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const id = randomUUID();

    // Prevent self-links
    if (taskId === linkedTaskId) {
      throw new Error("Cannot link a task to itself");
    }

    // Check for duplicate
    const existing = db.prepare(
      "SELECT id FROM task_links WHERE task_id = ? AND linked_task_id = ? AND link_type = ?"
    ).get(taskId, linkedTaskId, linkType) as { id: string } | undefined;
    if (existing) {
      return db.prepare("SELECT * FROM task_links WHERE id = ?").get(existing.id) as TaskLink;
    }

    db.prepare(
      "INSERT INTO task_links (id, task_id, linked_task_id, link_type) VALUES (?, ?, ?, ?)"
    ).run(id, taskId, linkedTaskId, linkType);

    return db.prepare("SELECT * FROM task_links WHERE id = ?").get(id) as TaskLink;
  });
  checkpointAfterWrite();

  // Log activity on both tasks
  if (actor) {
    logTaskActivity(projectId, taskId, actor, "linked", {
      linkedTaskId,
      linkType,
      linkId: result.id,
    });
    logTaskActivity(projectId, linkedTaskId, actor, "linked", {
      linkedTaskId: taskId,
      linkType,
      linkId: result.id,
    });
  }

  return result;
}

export function unlinkTasks(projectId: string, linkId: string, actor?: string): boolean {
  const result = execTransaction(() => {
    const db = getDb(dbPath());

    // Read link to know which tasks to log
    const link = db.prepare("SELECT task_id, linked_task_id, link_type FROM task_links WHERE id = ?").get(linkId) as
      { task_id: string; linked_task_id: string; link_type: string } | undefined;

    const info = db.prepare("DELETE FROM task_links WHERE id = ?").run(linkId);

    return { deleted: info.changes > 0, link };
  });
  checkpointAfterWrite();

  if (result.deleted && result.link && actor) {
    logTaskActivity(projectId, result.link.task_id, actor, "unlinked", {
      linkedTaskId: result.link.linked_task_id,
      linkType: result.link.link_type,
    });
    logTaskActivity(projectId, result.link.linked_task_id, actor, "unlinked", {
      linkedTaskId: result.link.task_id,
      linkType: result.link.link_type,
    });
  }

  return result.deleted;
}

export function getTaskLinks(_projectId: string, taskId: string): TaskLink[] {
  const db = getDb(dbPath());
  return db.prepare(
    "SELECT * FROM task_links WHERE task_id = ? OR linked_task_id = ?"
  ).all(taskId, taskId) as TaskLink[];
}

// ============================================================================
// Notifications
// ============================================================================

export function notifyTask(
  projectId: string,
  recipient: string,
  taskId: string,
  kind: "mentioned" | "assigned" | "watched_status",
): TaskNotification | null {
  const result = execTransaction(() => {
    const db = getDb(dbPath());

    // Dedupe: skip if same recipient+task+kind with unread already exists
    const existing = db.prepare(
      "SELECT id FROM task_notifications WHERE recipient = ? AND task_id = ? AND kind = ? AND read_at IS NULL"
    ).get(recipient, taskId, kind) as { id: string } | undefined;
    if (existing) return null;

    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(
      "INSERT INTO task_notifications (id, project_id, recipient, task_id, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, projectId, recipient, taskId, kind, now);

    return db.prepare("SELECT * FROM task_notifications WHERE id = ?").get(id) as TaskNotification;
  });
  checkpointAfterWrite();
  return result;
}

export function getNotifications(
  projectId: string,
  recipient: string,
  unreadOnly?: boolean,
): TaskNotification[] {
  const db = getDb(dbPath());
  if (unreadOnly) {
    return db.prepare(
      "SELECT * FROM task_notifications WHERE project_id = ? AND recipient = ? AND read_at IS NULL ORDER BY created_at DESC"
    ).all(projectId, recipient) as TaskNotification[];
  }
  return db.prepare(
    "SELECT * FROM task_notifications WHERE project_id = ? AND recipient = ? ORDER BY created_at DESC"
  ).all(projectId, recipient) as TaskNotification[];
}

export function markNotificationRead(_projectId: string, notificationId: string): boolean {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const now = new Date().toISOString();
    const info = db.prepare(
      "UPDATE task_notifications SET read_at = ? WHERE id = ?"
    ).run(now, notificationId);
    return info.changes > 0;
  });
  checkpointAfterWrite();
  return result;
}

// ============================================================================
// Board Config
// ============================================================================

const DEFAULT_COLUMNS = JSON.stringify([
  { id: "todo", name: "Todo", wip_limit: null },
  { id: "in_progress", name: "In Progress", wip_limit: 5 },
  { id: "review", name: "Review", wip_limit: 3 },
  { id: "done", name: "Done", wip_limit: null },
]);

export function getBoardConfig(projectId: string): BoardConfig {
  const result = execTransaction(() => {
    const db = getDb(dbPath());

    // Try to insert default if none exists
    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR IGNORE INTO board_config (id, project_id, columns, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(randomUUID(), projectId, DEFAULT_COLUMNS, now, now);

    return db.prepare("SELECT * FROM board_config WHERE project_id = ?").get(projectId) as BoardConfig;
  });
  checkpointAfterWrite();

  return result;
}

export function updateBoardConfig(
  projectId: string,
  updates: { columns?: string; custom_field_defs?: string },
): BoardConfig | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const now = new Date().toISOString();

    // Ensure config exists
    const existing = db.prepare("SELECT id FROM board_config WHERE project_id = ?").get(projectId) as
      { id: string } | undefined;
    if (!existing) {
      // Create default first, then update
      db.prepare(
        `INSERT INTO board_config (id, project_id, columns, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(randomUUID(), projectId, DEFAULT_COLUMNS, now, now);
    }

    const setClauses: string[] = ["updated_at = ?"];
    const params: unknown[] = [now];

    if (updates.columns !== undefined) {
      setClauses.push("columns = ?");
      params.push(updates.columns);
    }
    if (updates.custom_field_defs !== undefined) {
      setClauses.push("custom_field_defs = ?");
      params.push(updates.custom_field_defs);
    }

    params.push(projectId);

    db.prepare(`UPDATE board_config SET ${setClauses.join(", ")} WHERE project_id = ?`).run(...params);

    return db.prepare("SELECT * FROM board_config WHERE project_id = ?").get(projectId) as BoardConfig;
  });
  checkpointAfterWrite();
  return result;
}

/**
 * Check WIP limit for a column. Returns { count, limit, breached }.
 * WIP limits are advisory — this is used by the API to return status,
 * not to block moves.
 */
export function validateWipLimit(projectId: string, columnId: string): {
  count: number;
  limit: number | null;
  breached: boolean;
} {
  const db = getDb(dbPath());

  // Count tasks in the column
  const countRow = db.prepare(
    "SELECT COUNT(*) as count FROM tasks WHERE project_id = ? AND column_id = ?"
  ).get(projectId, columnId) as { count: number };

  // Get board config
  const config = getBoardConfig(projectId);
  let limit: number | null = null;

  try {
    const columns = JSON.parse(config.columns) as Array<{ id: string; wip_limit: number | null }>;
    const col = columns.find((c) => c.id === columnId);
    limit = col?.wip_limit ?? null;
  } catch {
    // If JSON parse fails, no limit
  }

  const breached = limit !== null && countRow.count > limit;

  return {
    count: countRow.count,
    limit,
    breached,
  };
}

// ============================================================================
// Bulk operations
// ============================================================================

export function bulkUpdateTasks(
  _projectId: string,
  taskIds: string[],
  fields: Partial<Pick<Task, "title" | "description" | "assigned_to" | "column_id" | "priority" | "due_date" | "start_date" | "issue_type" | "parent_id" | "custom_fields" | "estimate_minutes" | "spent_minutes" | "remaining_minutes">>,
): number {
  if (taskIds.length === 0) return 0;

  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const now = new Date().toISOString();

    const setClauses: string[] = ["updated_at = ?"];
    const params: unknown[] = [now];

    const mappable: Record<string, string> = {
      title: "title",
      description: "description",
      assigned_to: "assigned_to",
      column_id: "column_id",
      priority: "priority",
      due_date: "due_date",
      start_date: "start_date",
      issue_type: "issue_type",
      parent_id: "parent_id",
      custom_fields: "custom_fields",
      estimate_minutes: "estimate_minutes",
      spent_minutes: "spent_minutes",
      remaining_minutes: "remaining_minutes",
    };

    for (const [field, col] of Object.entries(mappable)) {
      if (field in fields) {
        setClauses.push(`${col} = ?`);
        params.push((fields as any)[field] ?? null);
      }
    }

    // Handle column_id move (set completed_at)
    if (fields.column_id !== undefined) {
      if (fields.column_id === "done") {
        setClauses.push("completed_at = ?");
        params.push(now);
      } else {
        setClauses.push("completed_at = NULL");
      }
    }

    // Build IN clause placeholders
    const placeholders = taskIds.map(() => "?").join(", ");
    params.push(...taskIds);

    const sql = `UPDATE tasks SET ${setClauses.join(", ")} WHERE id IN (${placeholders})`;
    const info = db.prepare(sql).run(...params);

    return info.changes;
  });
  checkpointAfterWrite();

  return result;
}
