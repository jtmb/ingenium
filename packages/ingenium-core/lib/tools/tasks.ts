import { getDb, execTransaction, checkpointAfterWrite, sanitizeFts5Query } from "../db.js";
import {
  Task,
  TaskComment,
  TaskActivity,
  TaskLink,
  TaskNotification,
  BoardConfig,
  TaskSourceReference,
  TaskSourceType,
  TaskCaptureSourceType,
} from "../schema.js";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

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
 *
 * NOTE: Takes a `_projectId` param for API compatibility but does not store it —
 *      the activity is keyed by task_id only.
 */
function logTaskActivity(
  projectId: string,
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
    `INSERT INTO task_activity (id, task_id, organization_id, actor, event_type, payload, created_at)
     SELECT ?, t.id, t.organization_id, ?, ?, ?, ? FROM tasks t WHERE t.id = ? AND t.project_id = ?`
  ).run(id, actor, eventType, payload ? JSON.stringify(payload) : null, now, taskId, projectId);
}

export type TaskReservationState = "available" | "reserved" | "quarantined";

export interface TaskMutationOptions {
  expectedRevision?: number;
  idempotencyKey?: string;
  ownership?: {
    organizationId: string;
    ownerUserId?: string | null;
    visibility?: "private" | "organization";
    actorType?: "compatibility" | "user" | "service" | "system";
    actorId?: string | null;
  };
}

export interface ManagedTaskReservationInput {
  expectedRevision: number;
  owner: string;
  worktree: string;
  reservationToken: string;
  idempotencyKey: string;
}

export type TaskCoordinationErrorCode =
  | "INVALID_TASK_MUTATION_INPUT"
  | "TASK_NOT_FOUND"
  | "REVISION_CONFLICT"
  | "IDEMPOTENCY_KEY_REUSED"
  | "RESERVATION_CONFLICT"
  | "RESERVATION_NOT_HELD"
  | "RESERVATION_OWNER_MISMATCH"
  | "RESERVATION_QUARANTINED";

/** Stable, disclosure-safe errors for the task coordination boundary. */
export class TaskCoordinationError extends Error {
  constructor(
    public readonly code: TaskCoordinationErrorCode,
    public readonly currentRevision?: number,
  ) {
    super(code);
    this.name = "TaskCoordinationError";
  }
}

type Db = ReturnType<typeof getDb>;

interface TaskMutationPreflight<T> {
  replay?: T;
  task?: Task;
  hash: string;
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TASK_PARTICIPANT = /^[^\u0000-\u001f\u007f]{1,256}$/;
const TASK_WORKTREE = /^[^\u0000-\u001f\u007f]{1,512}$/;
const TASK_RESERVATION_TOKEN = /^[A-Za-z0-9_-]{32,512}$/;
const MAX_RECEIPT_BYTES = 16_384;

/** Keep reservation verifiers out of every public task and receipt payload. */
function publicTask<T>(task: T): T {
  if (!task || typeof task !== "object") return task;
  const { reservation_token_hash: _reservationTokenHash, ...safeTask } = task as T & { reservation_token_hash?: unknown };
  return safeTask as T;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function mutationHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function validateMutationOptions(options: TaskMutationOptions): void {
  if (options.expectedRevision !== undefined && (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0)) {
    throw new TaskCoordinationError("INVALID_TASK_MUTATION_INPUT");
  }
  if (options.idempotencyKey !== undefined && !IDEMPOTENCY_KEY.test(options.idempotencyKey)) {
    throw new TaskCoordinationError("INVALID_TASK_MUTATION_INPUT");
  }
}

function scopedTask(db: Db, projectId: string, taskId: string): Task | undefined {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND project_id = ?").get(taskId, projectId) as Task | undefined;
  return task && publicTask(task);
}

function requireScopedTask(db: Db, projectId: string, taskId: string): Task {
  const task = scopedTask(db, projectId, taskId);
  if (!task) throw new TaskCoordinationError("TASK_NOT_FOUND");
  return task;
}

function requireScopedParent(db: Db, projectId: string, taskId: string, parentId: string | null | undefined): void {
  if (parentId === null || parentId === undefined) return;
  if (parentId === taskId || !scopedTask(db, projectId, parentId)) {
    throw new TaskCoordinationError("TASK_NOT_FOUND");
  }
}

function receipt<T>(db: Db, projectId: string, key: string | undefined, hash: string): T | undefined {
  if (!key) return undefined;
  const existing = db.prepare(
    "SELECT request_hash, result_json FROM task_mutation_receipts WHERE project_id = ? AND idempotency_key = ?",
  ).get(projectId, key) as { request_hash: string; result_json: string } | undefined;
  if (!existing) return undefined;
  if (existing.request_hash !== hash) throw new TaskCoordinationError("IDEMPOTENCY_KEY_REUSED");
  try {
    return JSON.parse(existing.result_json) as T;
  } catch {
    throw new Error("Invalid task mutation receipt");
  }
}

function writeReceipt<T>(
  db: Db,
  projectId: string,
  taskId: string,
  operation: string,
  key: string | undefined,
  hash: string,
  result: T,
): T {
  if (!key) return result;
  const resultJson = JSON.stringify(result);
  if (Buffer.byteLength(resultJson, "utf8") > MAX_RECEIPT_BYTES) {
    throw new TaskCoordinationError("INVALID_TASK_MUTATION_INPUT");
  }
  db.prepare(
    `INSERT INTO task_mutation_receipts
     (id, project_id, organization_id, task_id, operation, idempotency_key, request_hash, result_json, created_at)
     SELECT ?, project.id, project.organization_id, ?, ?, ?, ?, ?, ? FROM projects project WHERE project.id = ?`,
  ).run(randomUUID(), taskId, operation, key, hash, resultJson, new Date().toISOString(), projectId);
  return result;
}

function preflightTaskMutation<T>(
  db: Db,
  projectId: string,
  taskId: string,
  operation: string,
  request: unknown,
  options: TaskMutationOptions,
): TaskMutationPreflight<T> {
  validateMutationOptions(options);
  const hash = mutationHash({ operation, projectId, taskId, request });
  const replay = receipt<T>(db, projectId, options.idempotencyKey, hash);
  if (replay !== undefined) return { replay, hash };
  const task = requireScopedTask(db, projectId, taskId);
  if (options.expectedRevision !== undefined && task.revision !== options.expectedRevision) {
    throw new TaskCoordinationError("REVISION_CONFLICT", task.revision);
  }
  return { task, hash };
}

function incrementTaskRevision(db: Db, projectId: string, taskId: string, revision: number): Task {
  const info = db.prepare(
    "UPDATE tasks SET revision = revision + 1, updated_at = ? WHERE id = ? AND project_id = ? AND revision = ?",
  ).run(new Date().toISOString(), taskId, projectId, revision);
  if (info.changes === 0) {
    const current = scopedTask(db, projectId, taskId);
    if (!current) throw new TaskCoordinationError("TASK_NOT_FOUND");
    throw new TaskCoordinationError("REVISION_CONFLICT", current.revision);
  }
  return requireScopedTask(db, projectId, taskId);
}

function requireManagedReservationInput(input: ManagedTaskReservationInput): void {
  validateMutationOptions(input);
  if (!TASK_PARTICIPANT.test(input.owner) || input.owner !== input.owner.trim()
    || !TASK_WORKTREE.test(input.worktree) || input.worktree !== input.worktree.trim()
    || !TASK_RESERVATION_TOKEN.test(input.reservationToken)
    || !input.idempotencyKey) {
    throw new TaskCoordinationError("INVALID_TASK_MUTATION_INPUT");
  }
}

function reservationTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function reservationTokenMatches(storedHash: unknown, token: string): boolean {
  if (typeof storedHash !== "string" || !/^[0-9a-f]{64}$/.test(storedHash)) return false;
  return timingSafeEqual(Buffer.from(storedHash, "hex"), Buffer.from(reservationTokenHash(token), "hex"));
}

// ============================================================================
// Task CRUD
// ============================================================================

/**
 * Create a task in the "todo" column.
 *
 * `estimate_minutes` is also written to `remaining_minutes` (the two diverge
 * as work progresses). `spent_minutes` starts at 0. The callbacks are
 * responsible for deciding whether to create a parent (epic/story) first.
 */
export function createTask(
  projectId: string,
  title: string,
  description?: string,
  assignedTo?: string,
  fields?: Partial<Pick<Task, "parent_id" | "issue_type" | "priority" | "due_date" | "start_date" | "estimate_minutes" | "custom_fields">>,
  options: TaskMutationOptions = {},
): Task {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    validateMutationOptions(options);
    const hash = mutationHash({ operation: "create", projectId, title, description, assignedTo, fields, expectedRevision: options.expectedRevision });
    const replay = receipt<Task>(db, projectId, options.idempotencyKey, hash);
    if (replay !== undefined) return { task: replay, written: false };
    if (options.expectedRevision !== undefined && options.expectedRevision !== 0) {
      throw new TaskCoordinationError("REVISION_CONFLICT", 0);
    }
    requireScopedParent(db, projectId, "", fields?.parent_id);
    const now = new Date().toISOString();
    const id = randomUUID();
    const project = db.prepare("SELECT organization_id FROM projects WHERE id = ?").get(projectId) as { organization_id: string } | undefined;
    if (!project) throw new TaskCoordinationError("TASK_NOT_FOUND");
    const organizationId = options.ownership?.organizationId ?? project.organization_id;
    if (organizationId !== project.organization_id) throw new TaskCoordinationError("TASK_NOT_FOUND");
    db.prepare(
      `INSERT INTO tasks (id, project_id, organization_id, owner_kind, owner_user_id, visibility,
        created_by_actor_type, created_by_actor_id, title, description, column_id, assigned_to,
        parent_id, issue_type, priority, due_date, start_date,
        estimate_minutes, spent_minutes, remaining_minutes, custom_fields,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'todo', ?,
          ?, ?, ?, ?, ?,
          ?, 0, ?, ?,
          ?, ?)`
    ).run(
      id, projectId, organizationId, options.ownership?.ownerUserId ? "user" : "organization",
      options.ownership?.ownerUserId ?? null,
      options.ownership?.visibility ?? (options.ownership?.ownerUserId ? "private" : "organization"),
      options.ownership?.actorType ?? "compatibility", options.ownership?.actorId ?? null,
      title, description ?? null, assignedTo ?? null,
      fields?.parent_id ?? null, fields?.issue_type ?? "task", fields?.priority ?? 0,
      fields?.due_date ?? null, fields?.start_date ?? null,
      fields?.estimate_minutes ?? null, fields?.estimate_minutes ?? null, fields?.custom_fields ?? null,
      now, now,
    );
    const task = requireScopedTask(db, projectId, id);
    return { task: writeReceipt(db, projectId, id, "create", options.idempotencyKey, hash, task), written: true };
  });
  if (result.written) checkpointAfterWrite();

  if (result.written) logTaskActivity(projectId, result.task.id, "system", "created", { title });

  return result.task;
}

/**
 * List tasks for a project, optionally filtered by column.
 * Results ordered by priority DESC then FIFO creation time.
 */
export function listTasks(projectId: string, columnId?: string): Task[] {
  const db = getDb(dbPath());
  if (columnId) {
    return db.prepare(
      "SELECT * FROM tasks WHERE project_id = ? AND column_id = ? ORDER BY priority DESC, created_at"
    ).all(projectId, columnId).map(publicTask) as Task[];
  }
  return db.prepare(
    "SELECT * FROM tasks WHERE project_id = ? ORDER BY priority DESC, created_at"
  ).all(projectId).map(publicTask) as Task[];
}

/**
 * Move a task to a new column. `completed_at` is set only when moving to "done".
 * Returns the updated task (or undefined if the task doesn't exist).
 */
export function moveTask(
  projectId: string,
  taskId: string,
  columnId: string,
  actor?: string,
  options: TaskMutationOptions = {},
): Task | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const preflight = preflightTaskMutation<Task>(db, projectId, taskId, "move", { columnId, actor, expectedRevision: options.expectedRevision }, options);
    if (preflight.replay !== undefined) return { task: preflight.replay, prevColumn: undefined, written: false };
    const task = preflight.task!;
    const now = new Date().toISOString();
    const completedAt = columnId === "done" ? now : null;
    const info = db.prepare(
      `UPDATE tasks SET column_id = ?, updated_at = ?, completed_at = ?, revision = revision + 1
       WHERE id = ? AND project_id = ? AND revision = ?`,
    ).run(columnId, now, completedAt, taskId, projectId, task.revision);
    if (info.changes === 0) throw new TaskCoordinationError("REVISION_CONFLICT", requireScopedTask(db, projectId, taskId).revision);
    const updated = requireScopedTask(db, projectId, taskId);
    return { task: writeReceipt(db, projectId, taskId, "move", options.idempotencyKey, preflight.hash, updated), prevColumn: task.column_id, written: true };
  });
  if (result.written) checkpointAfterWrite();

  if (result.written) {
    logTaskActivity(projectId, taskId, actor ?? "system", "moved", {
      from: result.prevColumn,
      to: columnId,
    });
  }

  return result.task;
}

/** Convenience wrapper — delegates to the scoped moveTask(…, "done"). */
export function completeTask(
  projectId: string,
  taskId: string,
  actor?: string,
  options: TaskMutationOptions = {},
): Task | undefined {
  return moveTask(projectId, taskId, "done", actor, options);
}

/**
 * Return the highest-priority task in the "todo" column.
 * Priority-first, then FIFO (oldest first) for tiebreaking.
 */
export function getNextTask(projectId: string): Task | undefined {
  const db = getDb(dbPath());
  const task = db.prepare(
    `SELECT * FROM tasks WHERE project_id = ? AND column_id = 'todo'
     ORDER BY priority DESC, created_at ASC LIMIT 1`
  ).get(projectId) as Task | undefined;
  return task && publicTask(task);
}

/** Get a single task by ID. Returns undefined if not found. */
export function getTask(projectId: string, taskId: string): Task | undefined {
  const db = getDb(dbPath());
  return scopedTask(db, projectId, taskId);
}

// ============================================================================
// Trusted source references
// ============================================================================

const TASK_SOURCE_ID_MAX_LENGTH = 512;
const TASK_SOURCE_COMPONENT_MAX_LENGTH = 256;
const TASK_SOURCE_REFERENCE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface TaskSourceReferenceTaskScope {
  id: string;
  project_id: string;
  organization_id: string;
  is_global: boolean;
  archived_at: string | null;
}

interface TaskSourceReferenceSnapshot {
  display_title: string;
  display_detail: string | null;
  source_timestamp: string | null;
}

export interface ChatTaskSourceSnapshot {
  sourceTimestamp: string | null;
}

export type CreateTaskSourceReferenceResult =
  | { status: "created" | "duplicate"; reference: TaskSourceReference }
  | { status: "not_found" };

export type CreateTaskWithSourceReferenceResult =
  | { status: "created" | "duplicate"; task: Task; reference: TaskSourceReference }
  | { status: "not_found" };

export class TaskSourceReferenceInputError extends Error {
  constructor() {
    super("Invalid task source reference input");
    this.name = "TaskSourceReferenceInputError";
  }
}

function sourceComponent(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= TASK_SOURCE_COMPONENT_MAX_LENGTH
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function openCodeIdentifier(value: unknown): value is string {
  return sourceComponent(value)
    && !/[\\/]/.test(value)
    && value !== "."
    && value !== "..";
}

/** Validate an OpenCode session identifier before it is used in an upstream path. */
export function isSafeTaskCaptureSessionId(value: unknown): value is string {
  return openCodeIdentifier(value);
}

function canonicalCompoundSourceId(parts: readonly string[]): string {
  if (!parts.every(sourceComponent)) throw new TaskSourceReferenceInputError();
  const sourceId = Buffer.from(JSON.stringify(parts), "utf8").toString("base64url");
  if (sourceId.length > TASK_SOURCE_ID_MAX_LENGTH) throw new TaskSourceReferenceInputError();
  return sourceId;
}

function parseCanonicalCompoundSourceId(sourceId: string, expectedParts: readonly string[]): string[] | undefined {
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(sourceId)) return undefined;
  try {
    const decoded = Buffer.from(sourceId, "base64url");
    if (decoded.toString("base64url") !== sourceId) return undefined;
    const parts = JSON.parse(decoded.toString("utf8"));
    if (!Array.isArray(parts) || parts.length !== expectedParts.length || !parts.every(sourceComponent)) return undefined;
    if (expectedParts.some((part, index) => part !== "" && parts[index] !== part)) return undefined;
    if (canonicalCompoundSourceId(parts) !== sourceId) return undefined;
    return parts;
  } catch {
    return undefined;
  }
}

/** Canonical base64url identity for an email_cache account/folder/uid tuple. */
export function createEmailTaskSourceId(accountId: string, folder: string, uid: string): string {
  return canonicalCompoundSourceId([accountId, folder, uid]);
}

/** Canonical base64url identity for a session at a specific OpenCode source instance. */
export function createChatTaskSourceId(sourceInstance: string, upstreamProjectId: string, sessionId: string): string {
  if (!sourceComponent(sourceInstance) || !openCodeIdentifier(upstreamProjectId) || !openCodeIdentifier(sessionId)) {
    throw new TaskSourceReferenceInputError();
  }
  return canonicalCompoundSourceId([sourceInstance, upstreamProjectId, sessionId]);
}

export function parseEmailTaskSourceId(sourceId: string): [string, string, string] | undefined {
  const parts = parseCanonicalCompoundSourceId(sourceId, ["", "", ""]);
  return parts ? [parts[0]!, parts[1]!, parts[2]!] : undefined;
}

export function parseChatTaskSourceId(sourceId: string): [string, string, string] | undefined {
  const parts = parseCanonicalCompoundSourceId(sourceId, ["", "", ""]);
  if (!parts || !openCodeIdentifier(parts[1]) || !openCodeIdentifier(parts[2])) return undefined;
  return [parts[0]!, parts[1]!, parts[2]!];
}

function isUuid(value: string): boolean {
  return TASK_SOURCE_REFERENCE_UUID.test(value);
}

function isCanonicalDocsPageId(value: string): boolean {
  if (!/^[1-9][0-9]{0,14}$/.test(value)) return false;
  const pageId = Number(value);
  return Number.isSafeInteger(pageId) && pageId > 0 && String(pageId) === value;
}

/** Validate the immutable canonical source identifier without reading source content. */
export function isValidTaskSourceReferenceIdentity(sourceType: TaskSourceType, sourceId: string): boolean {
  if (typeof sourceId !== "string" || sourceId.length === 0 || sourceId.length > TASK_SOURCE_ID_MAX_LENGTH) return false;
  switch (sourceType) {
    case "email": return parseEmailTaskSourceId(sourceId) !== undefined;
    case "context":
    case "job": return isUuid(sourceId);
    case "docs": return isCanonicalDocsPageId(sourceId);
    case "chat": return parseChatTaskSourceId(sourceId) !== undefined;
  }
}

export function isTaskSourceReferenceId(value: string): boolean {
  return isUuid(value);
}

function taskSourceReferenceScope(
  db: ReturnType<typeof getDb>,
  projectId: string,
  taskId: string,
): TaskSourceReferenceTaskScope | undefined {
  return db.prepare(
    `SELECT t.id, t.project_id, t.organization_id, p.is_global, p.archived_at
     FROM tasks t
     INNER JOIN projects p ON p.id = t.project_id
     WHERE t.id = ? AND t.project_id = ?`,
  ).get(taskId, projectId) as TaskSourceReferenceTaskScope | undefined;
}

/** Scoped task lookup for task-source routes; never resolves a task by ID alone. */
export function getTaskSourceReferenceTaskScope(
  projectId: string,
  taskId: string,
): TaskSourceReferenceTaskScope | undefined {
  return taskSourceReferenceScope(getDb(dbPath()), projectId, taskId);
}

const LIKELY_TASK_SOURCE_SECRET_PATTERNS = [
  /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/,
  /\b(?:sk[-_]|rk_)[A-Za-z0-9_-]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\b(?:api[_-]?(?:key|token)|secret|password)\s*[:=]\s*["']?[A-Za-z0-9_+\/=.-]{24,}/i,
];

function hasLikelyTaskSourceSecret(value: string): boolean {
  return LIKELY_TASK_SOURCE_SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

function displayTitle(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return normalized && !hasLikelyTaskSourceSecret(normalized) ? normalized.slice(0, 256) : fallback;
}

function sourceTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 64 && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : null;
}

function captureTaskTitle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const title = value.trim();
  return title.length > 0 && title.length <= 256 && !/[\u0000-\u001f\u007f]/.test(title)
    ? title
    : undefined;
}

function resolveStoredTaskSourceReference(
  db: ReturnType<typeof getDb>,
  scope: TaskSourceReferenceTaskScope,
  sourceType: Exclude<TaskSourceType, "chat">,
  sourceId: string,
): TaskSourceReferenceSnapshot | undefined {
  switch (sourceType) {
    case "email": {
      if (!scope.is_global || scope.archived_at !== null) return undefined;
      const parts = parseEmailTaskSourceId(sourceId);
      if (!parts) return undefined;
      const row = db.prepare(
        "SELECT cached_at FROM email_cache WHERE organization_id = ? AND account_id = ? AND folder = ? AND uid = ?",
      ).get(scope.organization_id, ...parts) as { cached_at: string } | undefined;
      return row ? {
        display_title: "Email",
        display_detail: "Email message",
        source_timestamp: sourceTimestamp(row.cached_at),
      } : undefined;
    }
    case "context": {
      const row = db.prepare(
        `SELECT source.title, upload.created_at
         FROM context_rag_uploads upload
         INNER JOIN rag_sources source
           ON source.project_id = upload.project_id AND source.id = upload.rag_source_id
         WHERE upload.project_id = ? AND upload.rag_source_id = ?`,
      ).get(scope.project_id, sourceId) as { title: string; created_at: string } | undefined;
      return row ? {
        display_title: displayTitle(row.title, "Context source"),
        display_detail: "Context source",
        source_timestamp: sourceTimestamp(row.created_at),
      } : undefined;
    }
    case "docs": {
      const row = db.prepare(
        `SELECT page.title, page.updated_at
         FROM docs_pages page
         WHERE page.id = ? AND page.status != 'archived'
           AND (? = 1 OR EXISTS (
             SELECT 1 FROM docs_page_projects link
             WHERE link.page_id = page.id AND link.project_id = ?
           ))`,
      ).get(Number(sourceId), scope.is_global ? 1 : 0, scope.project_id) as { title: string; updated_at: string } | undefined;
      return row ? {
        display_title: displayTitle(row.title, "Documentation page"),
        display_detail: "Documentation page",
        source_timestamp: sourceTimestamp(row.updated_at),
      } : undefined;
    }
    case "job": {
      const row = db.prepare(
        "SELECT name, updated_at FROM jobs WHERE id = ? AND project_id = ?",
      ).get(sourceId, scope.project_id) as { name: string; updated_at: string } | undefined;
      return row ? {
        display_title: displayTitle(row.name, "Job"),
        display_detail: "Job",
        source_timestamp: sourceTimestamp(row.updated_at),
      } : undefined;
    }
  }
}

function insertTaskSourceReference(
  db: ReturnType<typeof getDb>,
  scope: TaskSourceReferenceTaskScope,
  sourceType: TaskSourceType,
  sourceId: string,
  snapshot: TaskSourceReferenceSnapshot,
): CreateTaskSourceReferenceResult {
  const existing = db.prepare(
    `SELECT * FROM task_source_references
     WHERE project_id = ? AND task_id = ? AND source_type = ? AND source_id = ?`,
  ).get(scope.project_id, scope.id, sourceType, sourceId) as TaskSourceReference | undefined;
  if (existing) return { status: "duplicate", reference: existing };

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO task_source_references
     (id, project_id, organization_id, task_id, source_type, source_id, display_title, display_detail, source_timestamp, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    scope.project_id,
    scope.organization_id,
    scope.id,
    sourceType,
    sourceId,
    snapshot.display_title,
    snapshot.display_detail,
    snapshot.source_timestamp,
    createdAt,
  );
  return {
    status: "created",
    reference: db.prepare("SELECT * FROM task_source_references WHERE id = ?").get(id) as TaskSourceReference,
  };
}

function findTaskBySourceReference(
  db: ReturnType<typeof getDb>,
  projectId: string,
  sourceType: TaskCaptureSourceType,
  sourceId: string,
): { task: Task; reference: TaskSourceReference } | undefined {
  const row = db.prepare(
    `SELECT t.*,
            reference.id AS reference_id,
            reference.project_id AS reference_project_id,
            reference.task_id AS reference_task_id,
            reference.source_type AS reference_source_type,
            reference.source_id AS reference_source_id,
            reference.display_title AS reference_display_title,
            reference.display_detail AS reference_display_detail,
            reference.source_timestamp AS reference_source_timestamp,
            reference.created_at AS reference_created_at
       FROM task_source_references reference
       INNER JOIN tasks t ON t.id = reference.task_id AND t.project_id = reference.project_id
      WHERE reference.project_id = ? AND reference.source_type = ? AND reference.source_id = ?
      ORDER BY reference.created_at ASC, reference.id ASC
      LIMIT 1`,
  ).get(projectId, sourceType, sourceId) as (Task & {
    reservation_token_hash?: string | null;
    reference_id: string;
    reference_project_id: string;
    reference_task_id: string;
    reference_source_type: TaskSourceType;
    reference_source_id: string;
    reference_display_title: string;
    reference_display_detail: string | null;
    reference_source_timestamp: string | null;
    reference_created_at: string;
  }) | undefined;
  if (!row) return undefined;

  const {
    reservation_token_hash: _reservationTokenHash,
    reference_id,
    reference_project_id,
    reference_task_id,
    reference_source_type,
    reference_source_id,
    reference_display_title,
    reference_display_detail,
    reference_source_timestamp,
    reference_created_at,
    ...task
  } = row;
  return {
    task: publicTask(task as Task),
    reference: {
      id: reference_id,
      project_id: reference_project_id,
      organization_id: row.organization_id,
      task_id: reference_task_id,
      source_type: reference_source_type,
      source_id: reference_source_id,
      display_title: reference_display_title,
      display_detail: reference_display_detail,
      source_timestamp: reference_source_timestamp,
      created_at: reference_created_at,
    },
  };
}

function createTaskWithVerifiedSourceSnapshot(
  projectId: string,
  title: string,
  sourceType: TaskCaptureSourceType,
  sourceId: string,
  resolveSnapshot: (
    db: ReturnType<typeof getDb>,
    scope: TaskSourceReferenceTaskScope,
  ) => TaskSourceReferenceSnapshot | undefined,
  options: TaskMutationOptions,
): CreateTaskWithSourceReferenceResult {
  const normalizedTitle = captureTaskTitle(title);
  if (!normalizedTitle) throw new TaskSourceReferenceInputError();

  const result = execTransaction(() => {
    const db = getDb(dbPath());
    validateMutationOptions(options);
    const hash = mutationHash({ operation: "capture", projectId, title: normalizedTitle, sourceType, sourceId, expectedRevision: options.expectedRevision });
    const replay = receipt<CreateTaskWithSourceReferenceResult>(db, projectId, options.idempotencyKey, hash);
    if (replay !== undefined) return { result: replay, written: false, created: false };
    const project = db.prepare(
      "SELECT id AS project_id, organization_id, is_global, archived_at FROM projects WHERE id = ?",
    ).get(projectId) as Omit<TaskSourceReferenceTaskScope, "id"> | undefined;
    if (!project) return { result: { status: "not_found" } as CreateTaskWithSourceReferenceResult, written: false, created: false };

    const duplicate = findTaskBySourceReference(db, projectId, sourceType, sourceId);
    if (duplicate) {
      if (options.expectedRevision !== undefined && duplicate.task.revision !== options.expectedRevision) {
        throw new TaskCoordinationError("REVISION_CONFLICT", duplicate.task.revision);
      }
      const captured = { status: "duplicate", ...duplicate } as CreateTaskWithSourceReferenceResult;
      return {
        result: writeReceipt(db, projectId, duplicate.task.id, "capture", options.idempotencyKey, hash, captured),
        written: options.idempotencyKey !== undefined,
        created: false,
      };
    }
    if (options.expectedRevision !== undefined && options.expectedRevision !== 0) {
      throw new TaskCoordinationError("REVISION_CONFLICT", 0);
    }

    const snapshot = resolveSnapshot(db, { id: "", ...project });
    if (!snapshot) return { result: { status: "not_found" } as CreateTaskWithSourceReferenceResult, written: false, created: false };

    const now = new Date().toISOString();
    const taskId = randomUUID();
    db.prepare(
      `INSERT INTO tasks
       (id, project_id, organization_id, owner_kind, visibility, created_by_actor_type,
        title, column_id, issue_type, priority, spent_minutes, created_at, updated_at)
       VALUES (?, ?, ?, 'organization', 'organization', 'compatibility', ?, 'todo', 'task', 0, 0, ?, ?)`,
    ).run(taskId, projectId, project.organization_id, normalizedTitle, now, now);
    const task = requireScopedTask(db, projectId, taskId);
    const reference = insertTaskSourceReference(
      db,
      { id: taskId, ...project },
      sourceType,
      sourceId,
      snapshot,
    );
    if (reference.status !== "created") throw new Error("Task capture reference unexpectedly duplicated");
    const captured = { status: "created", task, reference: reference.reference } as CreateTaskWithSourceReferenceResult;
    return {
      result: writeReceipt(db, projectId, taskId, "capture", options.idempotencyKey, hash, captured),
      written: true,
      created: true,
    };
  });

  if (result.written) checkpointAfterWrite();
  if (result.created) {
    if (result.result.status !== "created") throw new Error("Task capture result changed unexpectedly");
    logTaskActivity(projectId, result.result.task.id, "system", "created", { title: result.result.task.title });
  }
  return result.result;
}

/**
 * Atomically create a todo task and its trusted source reference.
 *
 * A project/source pair is idempotent: the oldest reference wins deterministically
 * for historical data created before capture support existed.
 */
export function createTaskWithSourceReference(
  projectId: string,
  title: string,
  sourceType: TaskCaptureSourceType,
  sourceId: string,
  options: TaskMutationOptions = {},
): CreateTaskWithSourceReferenceResult {
  if (
    (sourceType !== "email" && sourceType !== "context" && sourceType !== "docs")
    || !isValidTaskSourceReferenceIdentity(sourceType, sourceId)
  ) {
    throw new TaskSourceReferenceInputError();
  }

  return createTaskWithVerifiedSourceSnapshot(
    projectId,
    title,
    sourceType,
    sourceId,
    (db, scope) => resolveStoredTaskSourceReference(db, scope, sourceType, sourceId),
    options,
  );
}

/** Atomically capture an API-verified OpenCode session with fixed metadata only. */
export function createChatTaskWithSourceReference(
  projectId: string,
  title: string,
  sourceId: string,
  chat: ChatTaskSourceSnapshot,
  options: TaskMutationOptions = {},
): CreateTaskWithSourceReferenceResult {
  if (!isValidTaskSourceReferenceIdentity("chat", sourceId)) throw new TaskSourceReferenceInputError();
  return createTaskWithVerifiedSourceSnapshot(
    projectId,
    title,
    "chat",
    sourceId,
    (_db, scope) => {
      if (!scope.is_global || scope.archived_at !== null) return undefined;
      return {
        display_title: "OpenCode chat",
        display_detail: "OpenCode chat",
        source_timestamp: sourceTimestamp(chat.sourceTimestamp),
      };
    },
    options,
  );
}

/** Create an idempotent reference to a DB-backed trusted source. */
export function createTaskSourceReference(
  projectId: string,
  taskId: string,
  sourceType: Exclude<TaskSourceType, "chat">,
  sourceId: string,
  options: TaskMutationOptions = {},
): CreateTaskSourceReferenceResult {
  if (!isValidTaskSourceReferenceIdentity(sourceType, sourceId)) throw new TaskSourceReferenceInputError();
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const preflight = preflightTaskMutation<CreateTaskSourceReferenceResult>(
      db,
      projectId,
      taskId,
      "source_reference_create",
      { sourceType, sourceId, expectedRevision: options.expectedRevision },
      options,
    );
    if (preflight.replay !== undefined) return { result: preflight.replay, written: false };
    const scope = taskSourceReferenceScope(db, projectId, taskId);
    if (!scope) throw new TaskCoordinationError("TASK_NOT_FOUND");
    const snapshot = resolveStoredTaskSourceReference(db, scope, sourceType, sourceId);
    if (!snapshot) return { result: { status: "not_found" } as CreateTaskSourceReferenceResult, written: false };
    const reference = insertTaskSourceReference(db, scope, sourceType, sourceId, snapshot);
    if (reference.status === "created") incrementTaskRevision(db, projectId, taskId, preflight.task!.revision);
    return {
      result: writeReceipt(db, projectId, taskId, "source_reference_create", options.idempotencyKey, preflight.hash, reference),
      written: reference.status === "created" || options.idempotencyKey !== undefined,
    };
  });
  if (result.written) checkpointAfterWrite();
  return result.result;
}

/** Create an idempotent reference after the API has verified the live chat session. */
export function createChatTaskSourceReference(
  projectId: string,
  taskId: string,
  sourceId: string,
  chat: ChatTaskSourceSnapshot,
  options: TaskMutationOptions = {},
): CreateTaskSourceReferenceResult {
  if (!isValidTaskSourceReferenceIdentity("chat", sourceId)) throw new TaskSourceReferenceInputError();
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const preflight = preflightTaskMutation<CreateTaskSourceReferenceResult>(
      db,
      projectId,
      taskId,
      "chat_source_reference_create",
      { sourceId, chat, expectedRevision: options.expectedRevision },
      options,
    );
    if (preflight.replay !== undefined) return { result: preflight.replay, written: false };
    const scope = taskSourceReferenceScope(db, projectId, taskId);
    if (!scope || !scope.is_global || scope.archived_at !== null) {
      return { result: { status: "not_found" } as CreateTaskSourceReferenceResult, written: false };
    }
    const reference = insertTaskSourceReference(db, scope, "chat", sourceId, {
      display_title: "OpenCode chat",
      display_detail: "OpenCode chat",
      source_timestamp: sourceTimestamp(chat.sourceTimestamp),
    });
    if (reference.status === "created") incrementTaskRevision(db, projectId, taskId, preflight.task!.revision);
    return {
      result: writeReceipt(db, projectId, taskId, "chat_source_reference_create", options.idempotencyKey, preflight.hash, reference),
      written: reference.status === "created" || options.idempotencyKey !== undefined,
    };
  });
  if (result.written) checkpointAfterWrite();
  return result.result;
}

/** List references only within the supplied task/project composite scope. */
export function listTaskSourceReferences(projectId: string, taskId: string): TaskSourceReference[] {
  const db = getDb(dbPath());
  return db.prepare(
    `SELECT * FROM task_source_references
     WHERE project_id = ? AND task_id = ?
     ORDER BY created_at ASC, id ASC`,
  ).all(projectId, taskId) as TaskSourceReference[];
}

/** Check whether a DB-backed reference is still safely available to its task project. */
export function isStoredTaskSourceReferenceAvailable(reference: TaskSourceReference): boolean {
  if (reference.source_type === "chat") return false;
  const db = getDb(dbPath());
  const scope = taskSourceReferenceScope(db, reference.project_id, reference.task_id);
  return Boolean(scope && resolveStoredTaskSourceReference(db, scope, reference.source_type, reference.source_id));
}

/** Delete a reference only when both its task and project match; repeated deletes return false. */
export function deleteTaskSourceReference(
  projectId: string,
  taskId: string,
  referenceId: string,
  options: TaskMutationOptions = {},
): boolean {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const preflight = preflightTaskMutation<boolean>(
      db,
      projectId,
      taskId,
      "source_reference_delete",
      { referenceId, expectedRevision: options.expectedRevision },
      options,
    );
    if (preflight.replay !== undefined) return { deleted: preflight.replay, written: false };
    const deleted = db.prepare(
      "DELETE FROM task_source_references WHERE id = ? AND project_id = ? AND task_id = ?",
    ).run(referenceId, projectId, taskId).changes > 0;
    if (deleted) incrementTaskRevision(db, projectId, taskId, preflight.task!.revision);
    return {
      deleted: writeReceipt(db, projectId, taskId, "source_reference_delete", options.idempotencyKey, preflight.hash, deleted),
      written: deleted || options.idempotencyKey !== undefined,
    };
  });
  if (result.written) checkpointAfterWrite();
  return result.deleted;
}

/**
 * Partial update of task fields. Builds a dynamic SET clause from the provided
 * keys so callers only send the fields they intend to change.
 *
 * When `column_id` is set to "done", `completed_at` is stamped automatically.
 * Omitting `expectedRevision` preserves the unmanaged compatibility path.
 */
export function updateTask(
  projectId: string,
  taskId: string,
  fields: Partial<Pick<Task, "title" | "description" | "assigned_to" | "column_id" | "priority" | "due_date" | "start_date" | "issue_type" | "parent_id" | "custom_fields" | "estimate_minutes" | "spent_minutes" | "remaining_minutes">>,
  actor?: string,
  options: TaskMutationOptions = {},
): Task | undefined {
  const definedFields = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as typeof fields;
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const preflight = preflightTaskMutation<Task>(
      db,
      projectId,
      taskId,
      "update",
      { fields: definedFields, actor, expectedRevision: options.expectedRevision },
      options,
    );
    if (preflight.replay !== undefined) return { task: preflight.replay, written: false };
    const current = preflight.task!;
    requireScopedParent(db, projectId, taskId, definedFields.parent_id);
    const now = new Date().toISOString();

    // Build dynamic SET clause
    const setClauses: string[] = ["updated_at = ?", "revision = revision + 1"];
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
      if ((definedFields as Record<string, unknown>)[field] !== undefined) {
        setClauses.push(`${col} = ?`);
        params.push((definedFields as any)[field] ?? null);
      }
    }

    // Handle column_id move (set completed_at)
    if (definedFields.column_id !== undefined) {
      if (definedFields.column_id === "done") {
        setClauses.push("completed_at = ?");
        params.push(now);
      }
    }

    params.push(taskId, projectId, current.revision);

    const sql = `UPDATE tasks SET ${setClauses.join(", ")} WHERE id = ? AND project_id = ? AND revision = ?`;
    const info = db.prepare(sql).run(...params);

    if (info.changes === 0) throw new TaskCoordinationError("REVISION_CONFLICT", requireScopedTask(db, projectId, taskId).revision);

    const task = requireScopedTask(db, projectId, taskId);
    return { task: writeReceipt(db, projectId, taskId, "update", options.idempotencyKey, preflight.hash, task), written: true };
  });
  if (result.written) checkpointAfterWrite();

  if (result.written && actor) {
    logTaskActivity(projectId, taskId, actor, "edited", Object.keys(definedFields).reduce((acc, k) => {
      (acc as any)[k] = (definedFields as any)[k];
      return acc;
    }, {} as Record<string, unknown>));
  }

  return result.task;
}

export function deleteTask(
  projectId: string,
  taskId: string,
  actor?: string,
  options: TaskMutationOptions = {},
): boolean {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const preflight = preflightTaskMutation<boolean>(
      db,
      projectId,
      taskId,
      "delete",
      { actor, expectedRevision: options.expectedRevision },
      options,
    );
    if (preflight.replay !== undefined) return { deleted: preflight.replay, written: false };
    const task = preflight.task!;
    // Migration 099 proves receipt scope against the live task; this transaction rolls it back if deletion fails.
    const deletionReceipt = writeReceipt(db, projectId, taskId, "delete", options.idempotencyKey, preflight.hash, true);

    // Threaded comment parent links do not cascade, so delete task comments explicitly.
    db.prepare("DELETE FROM task_comments WHERE task_id = ?").run(taskId);
    db.prepare("DELETE FROM task_activity WHERE task_id = ?").run(taskId);
    // A task can be either endpoint of a task link.
    db.prepare("DELETE FROM task_links WHERE task_id = ? OR linked_task_id = ?").run(taskId, taskId);
    db.prepare("DELETE FROM task_notifications WHERE task_id = ?").run(taskId);
    // FTS triggers keep the search index synchronized with this delete.
    // Increment before deletion so every successful mutation crosses exactly one
    // revision boundary, even though the deleted row cannot expose it afterward.
    const advanced = db.prepare(
      "UPDATE tasks SET revision = revision + 1, updated_at = ? WHERE id = ? AND project_id = ? AND revision = ?",
    ).run(new Date().toISOString(), taskId, projectId, task.revision);
    if (advanced.changes === 0) throw new TaskCoordinationError("REVISION_CONFLICT", requireScopedTask(db, projectId, taskId).revision);
    const deleted = db.prepare(
      "DELETE FROM tasks WHERE id = ? AND project_id = ? AND revision = ?",
    ).run(taskId, projectId, task.revision + 1).changes > 0;
    if (!deleted) throw new TaskCoordinationError("REVISION_CONFLICT", requireScopedTask(db, projectId, taskId).revision);

    return {
      deleted: deletionReceipt,
      written: true,
    };
  });
  if (result.written) checkpointAfterWrite();

  return result.deleted;
}

function mutateReservation(
  projectId: string,
  taskId: string,
  operation: "reserve" | "release",
  input: ManagedTaskReservationInput,
): Task {
  requireManagedReservationInput(input);
  const options: TaskMutationOptions = {
    expectedRevision: input.expectedRevision,
    idempotencyKey: input.idempotencyKey,
  };
  const tokenHash = reservationTokenHash(input.reservationToken);
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const preflight = preflightTaskMutation<Task>(
      db,
      projectId,
      taskId,
      operation,
      { owner: input.owner, worktree: input.worktree, reservationTokenHash: tokenHash, expectedRevision: input.expectedRevision },
      options,
    );
    if (preflight.replay !== undefined) return { task: preflight.replay, written: false };
    const task = preflight.task!;
    const reservation = db.prepare(
      "SELECT reservation_token_hash FROM tasks WHERE id = ? AND project_id = ?",
    ).get(taskId, projectId) as { reservation_token_hash: string | null } | undefined;
    const ownsReservation = task.reservation_owner === input.owner
      && task.reservation_worktree === input.worktree
      && reservationTokenMatches(reservation?.reservation_token_hash, input.reservationToken);

    if (operation === "reserve") {
      if (task.reservation_state === "quarantined") throw new TaskCoordinationError("RESERVATION_QUARANTINED");
      if (task.reservation_state !== "available") throw new TaskCoordinationError("RESERVATION_CONFLICT");
      db.prepare(
        `UPDATE tasks
          SET reservation_state = 'reserved', reservation_owner = ?, reservation_worktree = ?, reservation_token_hash = ?,
              revision = revision + 1, updated_at = ?
          WHERE id = ? AND project_id = ? AND revision = ?`,
      ).run(input.owner, input.worktree, tokenHash, new Date().toISOString(), taskId, projectId, task.revision);
    } else {
      if (task.reservation_state === "quarantined") throw new TaskCoordinationError("RESERVATION_QUARANTINED");
      if (task.reservation_state === "available") throw new TaskCoordinationError("RESERVATION_NOT_HELD");
      if (!ownsReservation) throw new TaskCoordinationError("RESERVATION_OWNER_MISMATCH");
      db.prepare(
        `UPDATE tasks
          SET reservation_state = 'available', reservation_owner = NULL, reservation_worktree = NULL, reservation_token_hash = NULL,
             revision = revision + 1, updated_at = ?
         WHERE id = ? AND project_id = ? AND revision = ?`,
      ).run(new Date().toISOString(), taskId, projectId, task.revision);
    }
    const updated = requireScopedTask(db, projectId, taskId);
    return {
      task: writeReceipt(db, projectId, taskId, operation, input.idempotencyKey, preflight.hash, updated),
      written: true,
    };
  });
  if (result.written) checkpointAfterWrite();
  return result.task;
}

/** Managed reservation: project/task/CAS/owner/worktree/idempotency are mandatory. */
export function reserveTask(projectId: string, taskId: string, input: ManagedTaskReservationInput): Task {
  return mutateReservation(projectId, taskId, "reserve", input);
}

/** Managed release requires exactly the owner and worktree that made the reservation. */
export function releaseTask(projectId: string, taskId: string, input: ManagedTaskReservationInput): Task {
  return mutateReservation(projectId, taskId, "release", input);
}

/**
 * FTS5 full-text search across task titles and descriptions.
 * Returns results ranked by BM25 relevance, scoped to the given project.
 * Returns an empty array if the query sanitizes to nothing (stop-words only, etc.).
 */
export function searchTasks(projectId: string, query: string, limit = 50): Task[] {
  const db = getDb(dbPath());
  const sanitized = sanitizeFts5Query(query);
  if (!sanitized) return [];
  return db.prepare(
    `SELECT t.*, rank FROM tasks t
     INNER JOIN tasks_fts fts ON fts.rowid = t.rowid
     WHERE t.project_id = ? AND tasks_fts MATCH ?
     ORDER BY rank
     LIMIT ?`
  ).all(projectId, sanitized, limit).map(publicTask) as Task[];
}

// ============================================================================
// Hierarchy
// ============================================================================

/**
 * Get the task tree: root epics → stories → subtasks.
 * If parentId is provided, return only children of that parent.
 *
 * PERF: Uses recursive N+1 queries (one per parent). Fine for typical
 *       3-level hierarchies but will be slow with very deep trees.
 */
export function getTaskTree(projectId: string, parentId?: string): Record<string, unknown>[] {
  const db = getDb(dbPath());

  if (parentId) {
    // Get immediate children of a specific parent
    const children = db.prepare(
      "SELECT * FROM tasks WHERE project_id = ? AND parent_id = ? ORDER BY priority DESC, created_at"
    ).all(projectId, parentId).map(publicTask) as Task[];

    return children.map((t) => ({
      ...t,
      children: getTaskTree(projectId, t.id),
    }));
  }

  // Get root epics (parent_id IS NULL AND issue_type = 'epic')
  const epics = db.prepare(
    "SELECT * FROM tasks WHERE project_id = ? AND parent_id IS NULL AND issue_type = 'epic' ORDER BY priority DESC, created_at"
  ).all(projectId).map(publicTask) as Task[];

  return epics.map((epic) => ({
    ...epic,
    children: getTaskTree(projectId, epic.id),
  }));
}

// ============================================================================
// Comments
// ============================================================================

/**
 * Add a comment to a task. Supports threaded replies via `parentCommentId`.
 * `actor` is distinct from `author` — the author is the commenter, while
 * actor is who performed the action (for activity log), defaulting to author.
 */
export function addComment(
  projectId: string,
  taskId: string,
  author: string,
  body: string,
  parentCommentId?: string,
  actor?: string,
  options: TaskMutationOptions = {},
): TaskComment {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const preflight = preflightTaskMutation<TaskComment>(
      db,
      projectId,
      taskId,
      "comment_create",
      { author, body, parentCommentId, actor, expectedRevision: options.expectedRevision },
      options,
    );
    if (preflight.replay !== undefined) return { comment: preflight.replay, written: false };
    if (parentCommentId) {
      const parent = db.prepare(
        `SELECT 1 FROM task_comments comment
         INNER JOIN tasks task ON task.id = comment.task_id
         WHERE comment.id = ? AND comment.task_id = ? AND task.id = ? AND task.project_id = ?`,
      ).get(parentCommentId, taskId, taskId, projectId);
      if (!parent) throw new TaskCoordinationError("TASK_NOT_FOUND");
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO task_comments (id, task_id, organization_id, parent_comment_id, author, body, created_at)
       SELECT ?, task.id, task.organization_id, ?, ?, ?, ?
       FROM tasks task WHERE task.id = ? AND task.project_id = ?`
    ).run(id, parentCommentId ?? null, author, body, now, taskId, projectId);
    const comment = db.prepare("SELECT * FROM task_comments WHERE id = ? AND task_id = ?").get(id, taskId) as TaskComment;
    incrementTaskRevision(db, projectId, taskId, preflight.task!.revision);
    return {
      comment: writeReceipt(db, projectId, taskId, "comment_create", options.idempotencyKey, preflight.hash, comment),
      written: true,
    };
  });
  if (result.written) checkpointAfterWrite();

  if (result.written) logTaskActivity(projectId, taskId, actor ?? author, "commented", { commentId: result.comment.id });

  return result.comment;
}

/**
 * Edit an existing comment body. Stamps `edited_at` timestamp.
 */
export function editComment(
  projectId: string,
  taskId: string,
  commentId: string,
  body: string,
  actor?: string,
  options: TaskMutationOptions = {},
): TaskComment | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const preflight = preflightTaskMutation<TaskComment>(
      db,
      projectId,
      taskId,
      "comment_edit",
      { commentId, body, actor, expectedRevision: options.expectedRevision },
      options,
    );
    if (preflight.replay !== undefined) return { comment: preflight.replay, written: false };
    const now = new Date().toISOString();
    const info = db.prepare(
      "UPDATE task_comments SET body = ?, edited_at = ? WHERE id = ? AND task_id = ?"
    ).run(body, now, commentId, taskId);
    if (info.changes === 0) throw new TaskCoordinationError("TASK_NOT_FOUND");
    const comment = db.prepare("SELECT * FROM task_comments WHERE id = ? AND task_id = ?").get(commentId, taskId) as TaskComment;
    incrementTaskRevision(db, projectId, taskId, preflight.task!.revision);
    return {
      comment: writeReceipt(db, projectId, taskId, "comment_edit", options.idempotencyKey, preflight.hash, comment),
      written: true,
    };
  });
  if (result.written) checkpointAfterWrite();

  if (result.written && actor) {
    logTaskActivity(projectId, taskId, actor, "edited_comment", { commentId });
  }

  return result.comment;
}

/**
 * Add a reaction (emoji) to a comment. Reactions are stored as a JSON map:
 * `{ "👍": 2, "🚀": 1 }`. Each call increments the counter for that emoji.
 *
 * HACK: Read-modify-write on the JSON blob — not safe under concurrent access.
 *       Two callers reacting at the same time can lose one increment.
 *       A proper fix would extract reactions to a separate table.
 */
export function reactComment(
  projectId: string,
  taskId: string,
  commentId: string,
  reaction: string,
  actor?: string,
  options: TaskMutationOptions = {},
): TaskComment | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const preflight = preflightTaskMutation<TaskComment>(
      db,
      projectId,
      taskId,
      "comment_react",
      { commentId, reaction, actor, expectedRevision: options.expectedRevision },
      options,
    );
    if (preflight.replay !== undefined) return { comment: preflight.replay, written: false };

    const comment = db.prepare("SELECT reactions, task_id FROM task_comments WHERE id = ? AND task_id = ?").get(commentId, taskId) as
      { reactions: string; task_id: string } | undefined;
    if (!comment) throw new TaskCoordinationError("TASK_NOT_FOUND");

    let reactions: Record<string, number> = {};
    try {
      reactions = JSON.parse(comment.reactions || "{}");
    } catch { /* use empty */ }

    reactions[reaction] = (reactions[reaction] || 0) + 1;

    db.prepare("UPDATE task_comments SET reactions = ? WHERE id = ? AND task_id = ?")
      .run(JSON.stringify(reactions), commentId, taskId);

    const updated = db.prepare("SELECT * FROM task_comments WHERE id = ? AND task_id = ?").get(commentId, taskId) as TaskComment;
    incrementTaskRevision(db, projectId, taskId, preflight.task!.revision);
    return {
      comment: writeReceipt(db, projectId, taskId, "comment_react", options.idempotencyKey, preflight.hash, updated),
      written: true,
    };
  });
  if (result.written) checkpointAfterWrite();

  if (result.written && actor) {
    logTaskActivity(projectId, taskId, actor, "reacted", { commentId, reaction });
  }

  return result.comment;
}

/** Get all comments for a task, ordered chronologically. */
export function getComments(projectId: string, taskId: string): TaskComment[] {
  const db = getDb(dbPath());
  return db.prepare(
    `SELECT comment.* FROM task_comments comment
     INNER JOIN tasks task ON task.id = comment.task_id
     WHERE comment.task_id = ? AND task.project_id = ? ORDER BY comment.created_at`
  ).all(taskId, projectId) as TaskComment[];
}

// ============================================================================
// Activity
// ============================================================================

/**
 * Get activity timeline for a task.
 * Maps the DB column `event_type` → the frontend-facing `action` field
 * so the API can expose a uniform interface without renaming columns.
 */
export function getTaskActivity(projectId: string, taskId: string, limit = 50): TaskActivity[] {
  const db = getDb(dbPath());
  const rows = db.prepare(
    `SELECT activity.* FROM task_activity activity
     INNER JOIN tasks task ON task.id = activity.task_id
     WHERE activity.task_id = ? AND task.project_id = ? ORDER BY activity.created_at DESC LIMIT ?`
  ).all(taskId, projectId, limit) as any[];
  // Map DB column "event_type" to the frontend-facing "action" field
  return rows.map((r) => ({
    ...r,
    action: r.event_type || "",
  }));
}

// ============================================================================
// Links
// ============================================================================

/**
 * Create a link between two tasks.
 * - Self-links are rejected explicitly.
 * - Duplicate links (same pair + type) return the existing link silently.
 * - Activity is logged on BOTH tasks so both timelines show the link.
 */
export function linkTasks(
  projectId: string,
  taskId: string,
  linkedTaskId: string,
  linkType: "blocks" | "blocked_by" | "relates_to",
  actor?: string,
  options: TaskMutationOptions = {},
): TaskLink {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const preflight = preflightTaskMutation<TaskLink>(
      db,
      projectId,
      taskId,
      "link_create",
      { linkedTaskId, linkType, actor, expectedRevision: options.expectedRevision },
      options,
    );
    if (preflight.replay !== undefined) return { link: preflight.replay, written: false, duplicate: false };
    const source = preflight.task!;

    // Prevent self-links
    if (taskId === linkedTaskId) {
      throw new TaskCoordinationError("INVALID_TASK_MUTATION_INPUT");
    }
    const linked = requireScopedTask(db, projectId, linkedTaskId);

    // Check for duplicate
    const existing = db.prepare(
      `SELECT link.id FROM task_links link
       INNER JOIN tasks source ON source.id = link.task_id AND source.project_id = ?
       INNER JOIN tasks target ON target.id = link.linked_task_id AND target.project_id = ?
       WHERE link.task_id = ? AND link.linked_task_id = ? AND link.link_type = ?`
    ).get(projectId, projectId, taskId, linkedTaskId, linkType) as { id: string } | undefined;
    if (existing) {
      const link = db.prepare("SELECT * FROM task_links WHERE id = ?").get(existing.id) as TaskLink;
      return {
        link: writeReceipt(db, projectId, taskId, "link_create", options.idempotencyKey, preflight.hash, link),
        written: options.idempotencyKey !== undefined,
        duplicate: true,
      };
    }

    const id = randomUUID();
    db.prepare(
      `INSERT INTO task_links (id, task_id, linked_task_id, organization_id, link_type)
       SELECT ?, source.id, target.id, source.organization_id, ?
       FROM tasks source JOIN tasks target ON target.id = ? AND target.project_id = source.project_id
       WHERE source.id = ? AND source.project_id = ?`
    ).run(id, linkType, linkedTaskId, taskId, projectId);

    incrementTaskRevision(db, projectId, taskId, source.revision);
    incrementTaskRevision(db, projectId, linkedTaskId, linked.revision);
    const link = db.prepare("SELECT * FROM task_links WHERE id = ?").get(id) as TaskLink;
    return {
      link: writeReceipt(db, projectId, taskId, "link_create", options.idempotencyKey, preflight.hash, link),
      written: true,
      duplicate: false,
    };
  });
  if (result.written) checkpointAfterWrite();

  // Log activity on both tasks
  if (result.written && !result.duplicate && actor) {
    logTaskActivity(projectId, taskId, actor, "linked", {
      linkedTaskId,
      linkType,
      linkId: result.link.id,
    });
    logTaskActivity(projectId, linkedTaskId, actor, "linked", {
      linkedTaskId: taskId,
      linkType,
      linkId: result.link.id,
    });
  }

  return result.link;
}

/**
 * Remove a task link. Reads the link before deleting so we can log
 * the activity with context (knowing which two tasks were involved).
 */
export function unlinkTasks(
  projectId: string,
  taskId: string,
  linkId: string,
  actor?: string,
  options: TaskMutationOptions = {},
): boolean {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const preflight = preflightTaskMutation<boolean>(
      db,
      projectId,
      taskId,
      "link_delete",
      { linkId, actor, expectedRevision: options.expectedRevision },
      options,
    );
    if (preflight.replay !== undefined) return { deleted: preflight.replay, link: undefined, written: false };
    const link = db.prepare(
      `SELECT link.task_id, link.linked_task_id, link.link_type FROM task_links link
       INNER JOIN tasks source ON source.id = link.task_id AND source.project_id = ?
       INNER JOIN tasks target ON target.id = link.linked_task_id AND target.project_id = ?
       WHERE link.id = ? AND (link.task_id = ? OR link.linked_task_id = ?)`,
    ).get(projectId, projectId, linkId, taskId, taskId) as { task_id: string; linked_task_id: string; link_type: string } | undefined;
    if (!link) throw new TaskCoordinationError("TASK_NOT_FOUND");
    const otherTaskId = link.task_id === taskId ? link.linked_task_id : link.task_id;
    const other = requireScopedTask(db, projectId, otherTaskId);
    const info = db.prepare("DELETE FROM task_links WHERE id = ?").run(linkId);
    if (info.changes === 0) throw new TaskCoordinationError("TASK_NOT_FOUND");
    incrementTaskRevision(db, projectId, taskId, preflight.task!.revision);
    incrementTaskRevision(db, projectId, otherTaskId, other.revision);
    return {
      deleted: writeReceipt(db, projectId, taskId, "link_delete", options.idempotencyKey, preflight.hash, true),
      link,
      written: true,
    };
  });
  if (result.written) checkpointAfterWrite();

  if (result.written && result.deleted && result.link && actor) {
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

/**
 * Get all links for a task (both directions — where taskId is either
 * source or target).
 */
export function getTaskLinks(projectId: string, taskId: string): TaskLink[] {
  const db = getDb(dbPath());
  return db.prepare(
    `SELECT link.* FROM task_links link
     INNER JOIN tasks source ON source.id = link.task_id AND source.project_id = ?
     INNER JOIN tasks target ON target.id = link.linked_task_id AND target.project_id = ?
     WHERE link.task_id = ? OR link.linked_task_id = ?`
  ).all(projectId, projectId, taskId, taskId) as TaskLink[];
}

// ============================================================================
// Notifications
// ============================================================================

/**
 * Create a notification for a user about a task event.
 * Deduplicates: if an unread notification already exists for the same
 * recipient + task + kind, no duplicate is created.
 */
export function notifyTask(
  projectId: string,
  recipient: string,
  taskId: string,
  kind: "mentioned" | "assigned" | "watched_status",
  options: TaskMutationOptions = {},
): TaskNotification | null {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const preflight = preflightTaskMutation<TaskNotification | null>(
      db,
      projectId,
      taskId,
      "notification_create",
      { recipient, kind, expectedRevision: options.expectedRevision },
      options,
    );
    if (preflight.replay !== undefined) return { notification: preflight.replay, written: false };

    // Dedupe: skip if same recipient+task+kind with unread already exists
    const existing = db.prepare(
      `SELECT notification.id FROM task_notifications notification
       INNER JOIN tasks task ON task.id = notification.task_id AND task.project_id = ?
       WHERE notification.project_id = ? AND notification.recipient = ? AND notification.task_id = ?
         AND notification.kind = ? AND notification.read_at IS NULL`,
    ).get(projectId, projectId, recipient, taskId, kind) as { id: string } | undefined;
    if (existing) {
      return {
        notification: writeReceipt(db, projectId, taskId, "notification_create", options.idempotencyKey, preflight.hash, null),
        written: options.idempotencyKey !== undefined,
      };
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO task_notifications (id, project_id, organization_id, recipient, task_id, kind, created_at)
       SELECT ?, task.project_id, task.organization_id, ?, task.id, ?, ?
       FROM tasks task WHERE task.project_id = ? AND task.id = ?`
    ).run(id, recipient, kind, now, projectId, taskId);

    const notification = db.prepare("SELECT * FROM task_notifications WHERE id = ? AND project_id = ? AND task_id = ?")
      .get(id, projectId, taskId) as TaskNotification;
    incrementTaskRevision(db, projectId, taskId, preflight.task!.revision);
    return {
      notification: writeReceipt(db, projectId, taskId, "notification_create", options.idempotencyKey, preflight.hash, notification),
      written: true,
    };
  });
  if (result.written) checkpointAfterWrite();
  return result.notification;
}

/**
 * List notifications for a recipient. Optionally filter to unread only.
 * Ordered most-recent-first.
 */
export function getNotifications(
  projectId: string,
  recipient: string,
  unreadOnly?: boolean,
): TaskNotification[] {
  const db = getDb(dbPath());
  if (unreadOnly) {
    return db.prepare(
      `SELECT notification.* FROM task_notifications notification
       INNER JOIN tasks task ON task.id = notification.task_id AND task.project_id = notification.project_id
       WHERE notification.project_id = ? AND notification.recipient = ? AND notification.read_at IS NULL
       ORDER BY notification.created_at DESC`
    ).all(projectId, recipient) as TaskNotification[];
  }
  return db.prepare(
    `SELECT notification.* FROM task_notifications notification
     INNER JOIN tasks task ON task.id = notification.task_id AND task.project_id = notification.project_id
     WHERE notification.project_id = ? AND notification.recipient = ? ORDER BY notification.created_at DESC`
  ).all(projectId, recipient) as TaskNotification[];
}

/** Scoped notification member lookup for API mutations; absent and foreign both return undefined. */
export function getTaskNotification(projectId: string, notificationId: string): TaskNotification | undefined {
  const db = getDb(dbPath());
  return db.prepare(
    `SELECT notification.* FROM task_notifications notification
     INNER JOIN tasks task ON task.id = notification.task_id AND task.project_id = notification.project_id
     WHERE notification.id = ? AND notification.project_id = ?`,
  ).get(notificationId, projectId) as TaskNotification | undefined;
}

/** Mark a single notification as read by setting `read_at` timestamp. */
export function markNotificationRead(
  projectId: string,
  notificationId: string,
  options: TaskMutationOptions = {},
): boolean {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const notification = db.prepare(
      `SELECT notification.task_id FROM task_notifications notification
       INNER JOIN tasks task ON task.id = notification.task_id AND task.project_id = notification.project_id
       WHERE notification.id = ? AND notification.project_id = ?`,
    ).get(notificationId, projectId) as { task_id: string } | undefined;
    if (!notification) throw new TaskCoordinationError("TASK_NOT_FOUND");
    const preflight = preflightTaskMutation<boolean>(
      db,
      projectId,
      notification.task_id,
      "notification_read",
      { notificationId, expectedRevision: options.expectedRevision },
      options,
    );
    if (preflight.replay !== undefined) return { read: preflight.replay, written: false };
    const now = new Date().toISOString();
    const info = db.prepare(
      "UPDATE task_notifications SET read_at = ? WHERE id = ? AND project_id = ? AND task_id = ?"
    ).run(now, notificationId, projectId, notification.task_id);
    if (info.changes === 0) throw new TaskCoordinationError("TASK_NOT_FOUND");
    incrementTaskRevision(db, projectId, notification.task_id, preflight.task!.revision);
    return {
      read: writeReceipt(db, projectId, notification.task_id, "notification_read", options.idempotencyKey, preflight.hash, true),
      written: true,
    };
  });
  if (result.written) checkpointAfterWrite();
  return result.read;
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

/**
 * Get the board configuration for a project. If none exists, creates one
 * with the default columns (Todo → In Progress → Review → Done) with WIP
 * limits on In Progress (5) and Review (3).
 *
 * Uses INSERT OR IGNORE so concurrent calls don't cause constraint errors.
 */
export function getBoardConfig(projectId: string): BoardConfig {
  const result = execTransaction(() => {
    const db = getDb(dbPath());

    // Try to insert default if none exists
    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR IGNORE INTO board_config (id, project_id, organization_id, columns, created_at, updated_at)
       SELECT ?, project.id, project.organization_id, ?, ?, ? FROM projects project WHERE project.id = ?`
    ).run(randomUUID(), DEFAULT_COLUMNS, now, now, projectId);

    return db.prepare("SELECT * FROM board_config WHERE project_id = ?").get(projectId) as BoardConfig;
  });
  checkpointAfterWrite();

  return result;
}

/**
 * Update board configuration. If no config exists yet for the project,
 * one is created with defaults before applying the update.
 * Only the provided fields are changed (partial update).
 */
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
        `INSERT INTO board_config (id, project_id, organization_id, columns, created_at, updated_at)
         SELECT ?, project.id, project.organization_id, ?, ?, ? FROM projects project WHERE project.id = ?`
      ).run(randomUUID(), DEFAULT_COLUMNS, now, now, projectId);
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

export interface BulkTaskMutationOptions extends TaskMutationOptions {
  /** Managed bulk calls pin every affected task; partial revision maps are rejected. */
  expectedRevisions?: Record<string, number>;
}

/**
 * Apply the same field changes to multiple tasks in a single transaction.
 * Uses an SQL `IN (...)` clause. Returns the number of affected rows.
 *
 * NOTE: Shares the dynamic SET-builder pattern with `updateTask` — any
 *       change to the field mapping should be mirrored in both places.
 */
export function bulkUpdateTasks(
  projectId: string,
  taskIds: string[],
  fields: Partial<Pick<Task, "title" | "description" | "assigned_to" | "column_id" | "priority" | "due_date" | "start_date" | "issue_type" | "parent_id" | "custom_fields" | "estimate_minutes" | "spent_minutes" | "remaining_minutes">>,
  options: BulkTaskMutationOptions = {},
): number {
  if (taskIds.length === 0) return 0;

  const result = execTransaction(() => {
    const db = getDb(dbPath());
    validateMutationOptions(options);
    const definedFields = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as typeof fields;
    const ids = [...new Set(taskIds)].sort((left, right) => left.localeCompare(right));
    if (ids.length !== taskIds.length || ids.some((id) => typeof id !== "string" || id.length === 0)) {
      throw new TaskCoordinationError("INVALID_TASK_MUTATION_INPUT");
    }
    if (options.expectedRevisions !== undefined) {
      const entries = Object.entries(options.expectedRevisions);
      if (entries.some(([id, revision]) => (
        !ids.includes(id) || !Number.isSafeInteger(revision) || revision < 0
      )) || (options.expectedRevision === undefined && entries.length !== ids.length)) {
        throw new TaskCoordinationError("INVALID_TASK_MUTATION_INPUT");
      }
    }
    const hash = mutationHash({
      operation: "bulk_update",
      projectId,
      taskIds: ids,
      fields: definedFields,
      expectedRevision: options.expectedRevision,
      expectedRevisions: options.expectedRevisions,
    });
    const replay = receipt<number>(db, projectId, options.idempotencyKey, hash);
    if (replay !== undefined) return { count: replay, written: false };
    const placeholders = ids.map(() => "?").join(", ");
    const existing = db.prepare(
      `SELECT id, revision FROM tasks WHERE project_id = ? AND id IN (${placeholders})`,
    ).all(projectId, ...ids) as Array<{ id: string; revision: number }>;
    if (existing.length !== ids.length) throw new TaskCoordinationError("TASK_NOT_FOUND");
    if (options.expectedRevision !== undefined || options.expectedRevisions !== undefined) {
      const stale = existing.find((task) => task.revision !== (options.expectedRevisions?.[task.id] ?? options.expectedRevision));
      if (stale) throw new TaskCoordinationError("REVISION_CONFLICT", stale.revision);
    }
    if (definedFields.parent_id !== undefined) {
      if (definedFields.parent_id !== null && (ids.includes(definedFields.parent_id) || !scopedTask(db, projectId, definedFields.parent_id))) {
        throw new TaskCoordinationError("TASK_NOT_FOUND");
      }
    }
    const now = new Date().toISOString();

    const setClauses: string[] = ["updated_at = ?", "revision = revision + 1"];
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
      if ((definedFields as Record<string, unknown>)[field] !== undefined) {
        setClauses.push(`${col} = ?`);
        params.push((definedFields as any)[field] ?? null);
      }
    }

    // Handle column_id move (set completed_at)
    if (definedFields.column_id !== undefined) {
      if (definedFields.column_id === "done") {
        setClauses.push("completed_at = ?");
        params.push(now);
      } else {
        setClauses.push("completed_at = NULL");
      }
    }

    params.push(projectId, ...ids);

    const sql = `UPDATE tasks SET ${setClauses.join(", ")} WHERE project_id = ? AND id IN (${placeholders})`;
    const info = db.prepare(sql).run(...params);
    if (info.changes !== ids.length) throw new TaskCoordinationError("TASK_NOT_FOUND");
    return {
      count: writeReceipt(db, projectId, ids[0]!, "bulk_update", options.idempotencyKey, hash, info.changes),
      written: true,
    };
  });
  if (result.written) checkpointAfterWrite();

  return result.count;
}
