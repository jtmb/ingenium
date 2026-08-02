import { Router, Response, type Request } from "express";
import {
  projects,
  tasks,
  logger,
  TaskCaptureInputSchema,
  TaskSourceReferenceCreateInputSchema,
  usage,
} from "ingenium-core";
import { requireGlobalProject, requireProject } from "../helpers.js";
import { isOpenCodeError, opencodeClient } from "../opencode-client.js";
import { getOpenCodeUsageSourceInstance } from "../usage-sync.js";

/** Handles /api/v1/tasks — full Kanban board with comments, links, activity, notifications, and bulk operations. */
export const tasksRouter = Router();

/**
 * Maps SQLite CHECK constraint violation substrings to user-facing 422 messages.
 * Prevents raw SQL error propagation to the client (security: information hiding).
 */
const TASK_CHECK_CONSTRAINTS: Array<{ match: string; message: string }> = [
  { match: "issue_type", message: "issue_type must be one of: epic, story, task, subtask" },
];

function handleCheckConstraintError(err: unknown, res: Response): boolean {
  const msg = (err as Error)?.message || "";
  if (!msg.includes("CHECK constraint failed")) return false;

  for (const c of TASK_CHECK_CONSTRAINTS) {
    if (msg.includes(c.match)) {
      res.status(422).json({ error: { code: "VALIDATION_ERROR", message: c.message } });
      return true;
    }
  }

  // Fallback for any future CHECK constraint
  const match = msg.match(/CHECK constraint failed:\s*(\w+)/);
  const field = match ? match[1] : "field";
  res.status(422).json({ error: { code: "VALIDATION_ERROR", message: `Validation constraint violated on ${field}` } });
  return true;
}

function sendTaskCoordinationError(res: Response, error: unknown): boolean {
  if (!(error instanceof tasks.TaskCoordinationError)) return false;
  const statusByCode: Record<tasks.TaskCoordinationErrorCode, number> = {
    INVALID_TASK_MUTATION_INPUT: 422,
    TASK_NOT_FOUND: 404,
    REVISION_CONFLICT: 409,
    IDEMPOTENCY_KEY_REUSED: 409,
    RESERVATION_CONFLICT: 409,
    RESERVATION_NOT_HELD: 409,
    RESERVATION_OWNER_MISMATCH: 409,
    RESERVATION_QUARANTINED: 409,
  };
  const messageByCode: Record<tasks.TaskCoordinationErrorCode, string> = {
    INVALID_TASK_MUTATION_INPUT: "Invalid task mutation request",
    TASK_NOT_FOUND: "Task not found",
    REVISION_CONFLICT: "Task changed since the requested revision",
    IDEMPOTENCY_KEY_REUSED: "Idempotency key was already used with a different request",
    RESERVATION_CONFLICT: "Task reservation conflicts with its current state",
    RESERVATION_NOT_HELD: "Task does not have a releasable reservation",
    RESERVATION_OWNER_MISMATCH: "Task reservation ownership does not match",
    RESERVATION_QUARANTINED: "Task reservation is quarantined",
  };
  res.status(statusByCode[error.code]).json({
    error: {
      code: error.code,
      message: messageByCode[error.code],
      ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }),
    },
  });
  return true;
}

function taskMutationOptions(req: Request): tasks.TaskMutationOptions {
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : {};
  const headerKey = req.get("Idempotency-Key") ?? undefined;
  if (body.idempotency_key !== undefined && body.idempotencyKey !== undefined && body.idempotency_key !== body.idempotencyKey) {
    throw new tasks.TaskCoordinationError("INVALID_TASK_MUTATION_INPUT");
  }
  const bodyKey = body.idempotency_key ?? body.idempotencyKey;
  if (typeof bodyKey !== "undefined" && typeof bodyKey !== "string") {
    throw new tasks.TaskCoordinationError("INVALID_TASK_MUTATION_INPUT");
  }
  if (headerKey !== undefined && bodyKey !== undefined && headerKey !== bodyKey) {
    throw new tasks.TaskCoordinationError("INVALID_TASK_MUTATION_INPUT");
  }
  const expectedRevision = body.expected_revision ?? body.expectedRevision;
  return {
    ...(expectedRevision === undefined ? {} : { expectedRevision: expectedRevision as number }),
    ...((headerKey ?? bodyKey) === undefined ? {} : { idempotencyKey: (headerKey ?? bodyKey) as string }),
  };
}

function requireTaskMember(projectId: string, taskId: string, res: Response): boolean {
  if (tasks.getTask(projectId, taskId)) return true;
  res.status(404).json({ error: { code: "TASK_NOT_FOUND", message: "Task not found" } });
  return false;
}

function taskRevision(projectId: string, taskId: string): number | undefined {
  return tasks.getTask(projectId, taskId)?.revision;
}

function sendTaskReferenceNotFound(res: Response): void {
  res.status(404).json({
    error: { code: "TASK_REFERENCE_NOT_FOUND", message: "Task reference not found" },
  });
}

function sendTaskCaptureNotFound(res: Response): void {
  res.status(404).json({
    error: { code: "TASK_CAPTURE_SOURCE_NOT_FOUND", message: "Task capture source not found" },
  });
}

function sendTaskCaptureValidationError(res: Response): void {
  res.status(422).json({
    error: { code: "VALIDATION_ERROR", message: "Invalid task capture request" },
  });
}

function sendTaskCaptureUnavailable(res: Response): void {
  res.status(503).json({
    error: { code: "TASK_CAPTURE_SOURCE_UNAVAILABLE", message: "Task capture source is unavailable" },
  });
}

/** Capture is context-scoped and deliberately does not inherit a global default. */
function requireCaptureProject(req: Request, res: Response): string | null {
  const projectName = req.query.project;
  if (!projects.isValidProjectName(projectName)) {
    sendTaskCaptureValidationError(res);
    return null;
  }
  const project = projects.getProject(projectName);
  if (!project) {
    sendTaskCaptureNotFound(res);
    return null;
  }
  return project.id;
}

function taskReferenceDto(
  reference: ReturnType<typeof tasks.listTaskSourceReferences>[number],
  availability: "available" | "missing" | "unavailable",
) {
  return {
    id: reference.id,
    source_type: reference.source_type,
    source_id: reference.source_id,
    display_title: reference.display_title,
    display_detail: reference.display_detail,
    source_timestamp: reference.source_timestamp,
    created_at: reference.created_at,
    availability,
  };
}

function chatTimestamp(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

async function resolveChatReference(projectId: string, sourceId: string): Promise<
  | { status: "available"; snapshot: tasks.ChatTaskSourceSnapshot }
  | { status: "missing" | "unavailable" }
> {
  const identity = tasks.parseChatTaskSourceId(sourceId);
  if (!identity) return { status: "missing" };
  const [sourceInstance, upstreamProjectId, sessionId] = identity;
  if (sourceInstance !== getOpenCodeUsageSourceInstance()) return { status: "missing" };
  const mapping = usage.getOpenCodeProjectMapping(sourceInstance, upstreamProjectId);
  if (mapping?.status !== "mapped" || mapping.ingeniumProjectId !== projectId) return { status: "missing" };
  try {
    const result = await opencodeClient.getSession(sessionId);
    if (isOpenCodeError(result)) {
      return { status: result.error.code === "NOT_FOUND" || result.error.code === "NotFoundError" ? "missing" : "unavailable" };
    }
    if (typeof result.id !== "string" || typeof result.projectID !== "string") {
      return { status: "unavailable" };
    }
    if (result.id !== sessionId || result.projectID !== upstreamProjectId) return { status: "missing" };
    return {
      status: "available",
      snapshot: {
        sourceTimestamp: chatTimestamp(result.time?.created),
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}

async function resolveChatCapture(
  globalProjectId: string,
  sessionId: string,
): Promise<
  | { status: "available"; sourceId: string; snapshot: tasks.ChatTaskSourceSnapshot }
  | { status: "missing" | "unavailable" }
> {
  try {
    const result = await opencodeClient.getSession(sessionId);
    if (isOpenCodeError(result)) {
      return { status: result.error.code === "NOT_FOUND" || result.error.code === "NotFoundError" ? "missing" : "unavailable" };
    }
    if (typeof result.id !== "string" || typeof result.projectID !== "string") {
      return { status: "unavailable" };
    }
    if (result.id !== sessionId || !tasks.isSafeTaskCaptureSessionId(result.id)) {
      return { status: "missing" };
    }

    const sourceInstance = getOpenCodeUsageSourceInstance();
    let sourceId: string;
    try {
      sourceId = tasks.createChatTaskSourceId(sourceInstance, result.projectID, result.id);
    } catch (error) {
      if (error instanceof tasks.TaskSourceReferenceInputError) return { status: "missing" };
      throw error;
    }
    const mapping = usage.getOpenCodeProjectMapping(sourceInstance, result.projectID);
    if (mapping?.status !== "mapped" || mapping.ingeniumProjectId !== globalProjectId) {
      return { status: "missing" };
    }
    return {
      status: "available",
      sourceId,
      snapshot: { sourceTimestamp: chatTimestamp(result.time?.created) },
    };
  } catch {
    return { status: "unavailable" };
  }
}

async function deleteTaskReference(req: Request, res: Response): Promise<void> {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const taskId = req.params.taskId!;
  const referenceId = req.params.referenceId ?? req.query.reference_id;
  if (!tasks.isTaskSourceReferenceId(taskId) || typeof referenceId !== "string" || !tasks.isTaskSourceReferenceId(referenceId)) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "reference_id is required" } });
    return;
  }
  if (!tasks.getTaskSourceReferenceTaskScope(projectId, taskId)) {
    sendTaskReferenceNotFound(res);
    return;
  }
  try {
    if (!tasks.deleteTaskSourceReference(projectId, taskId, referenceId, taskMutationOptions(req))) {
      sendTaskReferenceNotFound(res);
      return;
    }
    res.status(204).send();
  } catch (error) {
    if (sendTaskCoordinationError(res, error)) return;
    throw error;
  }
}

// ============================================================================
// Literal-path routes — MUST be registered BEFORE /:id (Express route capture)
// ============================================================================

// GET /search?q=X&limit=N
tasksRouter.get("/search", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const query = req.query.q as string;
  if (!query) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "query (q) is required" } });
    return;
  }
  const limit = parseInt(req.query.limit as string) || 50;
  const results = tasks.searchTasks(projectId, query, limit);
  res.json({ data: results, total: results.length });
});

// GET /board-config
tasksRouter.get("/board-config", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const config = tasks.getBoardConfig(projectId);
  res.json({ data: config });
});

// PUT /board-config
tasksRouter.put("/board-config", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
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
  if (!projectId) return;
  const recipient = req.query.recipient as string;
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
  if (!projectId) return;
  const id = req.params.id!;
  try {
    const notification = tasks.getTaskNotification(projectId, id);
    if (!notification) {
      res.status(404).json({ error: { code: "TASK_NOT_FOUND", message: "Task not found" } });
      return;
    }
    const ok = tasks.markNotificationRead(projectId, id, taskMutationOptions(req));
    if (!ok) {
      res.status(404).json({ error: { code: "TASK_NOT_FOUND", message: "Task not found" } });
      return;
    }
    res.json({ data: { read: true, revision: taskRevision(projectId, notification.task_id) } });
  } catch (error) {
    if (sendTaskCoordinationError(res, error)) return;
    throw error;
  }
});

// POST /bulk
tasksRouter.post("/bulk", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const {
    task_ids,
    expected_revision: _expectedRevision,
    expectedRevision: _expectedRevisionCamel,
    expected_revisions: _expectedRevisions,
    expectedRevisions: _expectedRevisionsCamel,
    idempotency_key: _idempotencyKey,
    idempotencyKey: _idempotencyKeyCamel,
    ...fields
  } = req.body;
  if (!Array.isArray(task_ids) || task_ids.length === 0) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "task_ids array is required" } });
    return;
  }
  // Filter out undefined values; explicit empty strings mean "clear"
  const cleanFields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === "") {
      cleanFields[k] = null;
    } else if (v !== undefined) {
      cleanFields[k] = v;
    }
  }
  if (Object.keys(cleanFields).length === 0) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "at least one field to update is required" } });
    return;
  }
  try {
    const options = taskMutationOptions(req) as tasks.BulkTaskMutationOptions;
    const expectedRevisions = req.body.expected_revisions ?? req.body.expectedRevisions;
    if (expectedRevisions !== undefined) options.expectedRevisions = expectedRevisions;
    const count = tasks.bulkUpdateTasks(projectId, task_ids, cleanFields as any, options);
    res.json({
      data: {
        updated: count,
        revisions: Object.fromEntries(task_ids.map((taskId: string) => [taskId, taskRevision(projectId, taskId)])),
      },
    });
  } catch (err: unknown) {
    if (sendTaskCoordinationError(res, err)) return;
    if (handleCheckConstraintError(err, res)) {
      logger.error("tasks", `CHECK constraint failed on POST /bulk: ${(err as Error).message}`, {
        error: (err as Error).message,
        name: (err as Error).name,
        stack: (err as Error).stack?.split("\n").slice(0, 5).join("\n"),
        method: "POST",
        path: req.originalUrl,
      });
      return;
    }
    throw err;
  }
});

// GET /next — must be before /:id
tasksRouter.get("/next", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const task = tasks.getNextTask(projectId);
  if (!task) {
    res.json({ data: null });
    return;
  }
  res.json({ data: task });
});

// POST /captures — literal route must precede every parameter route.
tasksRouter.post("/captures", async (req, res) => {
  const input = TaskCaptureInputSchema.safeParse(req.body);
  if (!input.success) {
    sendTaskCaptureValidationError(res);
    return;
  }

  if (input.data.source_type === "chat") {
    const projectId = requireGlobalProject(req, res);
    if (!projectId) return;
    if (!tasks.isSafeTaskCaptureSessionId(input.data.session_id)) {
      sendTaskCaptureValidationError(res);
      return;
    }

    const chat = await resolveChatCapture(projectId, input.data.session_id);
    if (chat.status !== "available") {
      if (chat.status === "unavailable") sendTaskCaptureUnavailable(res);
      else sendTaskCaptureNotFound(res);
      return;
    }
    try {
      const result = tasks.createChatTaskWithSourceReference(
        projectId,
        input.data.title,
        chat.sourceId,
        chat.snapshot,
        taskMutationOptions(req),
      );
      if (result.status === "not_found") {
        sendTaskCaptureNotFound(res);
        return;
      }
      res.status(result.status === "created" ? 201 : 200).json({
        data: {
          task: result.task,
          reference: taskReferenceDto(result.reference, "available"),
        },
      });
    } catch (error) {
      if (sendTaskCoordinationError(res, error)) return;
      if (error instanceof tasks.TaskSourceReferenceInputError) {
        sendTaskCaptureValidationError(res);
        return;
      }
      throw error;
    }
    return;
  }

  const projectId = input.data.source_type === "email"
    ? requireGlobalProject(req, res)
    : requireCaptureProject(req, res);
  if (!projectId) return;

  try {
    const sourceId = input.data.source_type === "email"
      ? tasks.createEmailTaskSourceId(input.data.account_id, input.data.folder, input.data.uid)
      : input.data.source_type === "docs"
        ? String(input.data.page_id)
        : input.data.source_id;
    const result = tasks.createTaskWithSourceReference(
      projectId,
      input.data.title,
      input.data.source_type,
      sourceId,
      taskMutationOptions(req),
    );
    if (result.status === "not_found") {
      sendTaskCaptureNotFound(res);
      return;
    }
    res.status(result.status === "created" ? 201 : 200).json({
      data: {
        task: result.task,
        reference: taskReferenceDto(result.reference, "available"),
      },
    });
  } catch (error) {
    if (sendTaskCoordinationError(res, error)) return;
    if (error instanceof tasks.TaskSourceReferenceInputError) {
      sendTaskCaptureValidationError(res);
      return;
    }
    throw error;
  }
});

// GET /tasks — list tasks, optionally filtered by column
tasksRouter.get("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const columnId = req.query.column_id as string | undefined;
  const list = tasks.listTasks(projectId, columnId);
  res.json({ data: list, total: list.length });
});

// POST /
tasksRouter.post("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const { title, description, assigned_to, parent_id, issue_type, priority, due_date, start_date, estimate_minutes, custom_fields } = req.body;
  if (!title) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "title is required" } });
    return;
  }
  try {
    const task = tasks.createTask(projectId, title, description, assigned_to, {
      parent_id,
      issue_type,
      priority,
      due_date,
      start_date,
      estimate_minutes,
      custom_fields: custom_fields !== undefined ? (typeof custom_fields === "string" ? custom_fields : JSON.stringify(custom_fields)) : undefined,
    }, taskMutationOptions(req));
    res.status(201).json({ data: task });
  } catch (err: unknown) {
    if (sendTaskCoordinationError(res, err)) return;
    if (handleCheckConstraintError(err, res)) {
      logger.error("tasks", `CHECK constraint failed on POST /: ${(err as Error).message}`, {
        error: (err as Error).message,
        name: (err as Error).name,
        stack: (err as Error).stack?.split("\n").slice(0, 5).join("\n"),
        method: "POST",
        path: req.originalUrl,
      });
      return;
    }
    throw err;
  }
});

// Task source references deliberately use server-derived display snapshots only.
tasksRouter.post("/:taskId/references", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!tasks.isTaskSourceReferenceId(req.params.taskId!)) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "Invalid task source reference" } });
    return;
  }
  const input = TaskSourceReferenceCreateInputSchema.safeParse(req.body);
  if (!input.success || !tasks.isValidTaskSourceReferenceIdentity(input.data.source_type, input.data.source_id)) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "Invalid task source reference" } });
    return;
  }

  const scope = tasks.getTaskSourceReferenceTaskScope(projectId, req.params.taskId!);
  if (!scope) {
    sendTaskReferenceNotFound(res);
    return;
  }

  try {
    let result: tasks.CreateTaskSourceReferenceResult;
    if (input.data.source_type === "chat") {
      if (!scope.is_global || scope.archived_at !== null) {
        sendTaskReferenceNotFound(res);
        return;
      }
      const chat = await resolveChatReference(projectId, input.data.source_id);
      if (chat.status !== "available") {
        if (chat.status === "unavailable") {
          res.status(503).json({ error: { code: "TASK_REFERENCE_UNAVAILABLE", message: "Task reference source is unavailable" } });
        } else {
          sendTaskReferenceNotFound(res);
        }
        return;
      }
      result = tasks.createChatTaskSourceReference(
        projectId,
        req.params.taskId!,
        input.data.source_id,
        chat.snapshot,
        taskMutationOptions(req),
      );
    } else {
      result = tasks.createTaskSourceReference(
        projectId,
        req.params.taskId!,
        input.data.source_type,
        input.data.source_id,
        taskMutationOptions(req),
      );
    }
    if (result.status === "not_found") {
      sendTaskReferenceNotFound(res);
      return;
    }
    res.status(result.status === "created" ? 201 : 200).json({
      data: taskReferenceDto(result.reference, "available"),
      revision: taskRevision(projectId, req.params.taskId!),
    });
  } catch (error) {
    if (sendTaskCoordinationError(res, error)) return;
    if (error instanceof tasks.TaskSourceReferenceInputError) {
      res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "Invalid task source reference" } });
      return;
    }
    throw error;
  }
});

tasksRouter.get("/:taskId/references", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!tasks.isTaskSourceReferenceId(req.params.taskId!)) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "Invalid task source reference" } });
    return;
  }
  if (!tasks.getTaskSourceReferenceTaskScope(projectId, req.params.taskId!)) {
    sendTaskReferenceNotFound(res);
    return;
  }
  const references = tasks.listTaskSourceReferences(projectId, req.params.taskId!);
  const data = await Promise.all(references.map(async (reference) => {
    if (reference.source_type !== "chat") {
      return taskReferenceDto(
        reference,
        tasks.isStoredTaskSourceReferenceAvailable(reference) ? "available" : "missing",
      );
    }
    const chat = await resolveChatReference(projectId, reference.source_id);
    return taskReferenceDto(reference, chat.status);
  }));
  res.json({ data, total: data.length });
});

// The query form is the documented route; the member path is retained for normal REST deletion.
tasksRouter.delete("/:taskId/references", deleteTaskReference);
tasksRouter.delete("/:taskId/references/:referenceId", deleteTaskReference);

function managedReservationRoute(operation: "reserve" | "release") {
  return (req: Request, res: Response) => {
    const projectId = requireProject(req, res);
    if (!projectId) return;
    try {
      const options = taskMutationOptions(req);
      const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
      if (body.reservation_token !== undefined && body.reservationToken !== undefined && body.reservation_token !== body.reservationToken) {
        throw new tasks.TaskCoordinationError("INVALID_TASK_MUTATION_INPUT");
      }
      const reservationToken = body.reservation_token ?? body.reservationToken;
      if (options.idempotencyKey === undefined || options.expectedRevision === undefined || typeof body.owner !== "string" || typeof body.worktree !== "string" || typeof reservationToken !== "string") {
        throw new tasks.TaskCoordinationError("INVALID_TASK_MUTATION_INPUT");
      }
      const input: tasks.ManagedTaskReservationInput = {
        expectedRevision: options.expectedRevision,
        owner: body.owner,
        worktree: body.worktree,
        reservationToken,
        idempotencyKey: options.idempotencyKey,
      };
      const task = operation === "reserve"
        ? tasks.reserveTask(projectId, req.params.id!, input)
        : tasks.releaseTask(projectId, req.params.id!, input);
      res.json({ data: task });
    } catch (error) {
      if (sendTaskCoordinationError(res, error)) return;
      throw error;
    }
  };
}

// Managed coordination accepts only a caller-held opaque reservation token; no lease/fence surface exists in COORD-100.
tasksRouter.post("/:id/reserve", managedReservationRoute("reserve"));
tasksRouter.post("/:id/release", managedReservationRoute("release"));

// GET /:id
tasksRouter.get("/:id", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const task = tasks.getTask(projectId, req.params.id!);
  if (!task) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Task not found" } });
    return;
  }
  res.json({ data: task });
});

// PATCH /:id
tasksRouter.patch("/:id", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const { column_id, actor, expected_revision, expectedRevision, idempotency_key, idempotencyKey, ...fields } = req.body;

  // If only column_id is provided, use moveTask for backward compatibility
  if (column_id && Object.keys(fields).length === 0) {
    try {
      const moved = tasks.moveTask(projectId, req.params.id!, column_id, actor, taskMutationOptions(req));
      if (!moved) {
        res.status(404).json({ error: { code: "TASK_NOT_FOUND", message: "Task not found" } });
        return;
      }
      res.json({ data: moved });
    } catch (error) {
      if (sendTaskCoordinationError(res, error)) return;
      throw error;
    }
    return;
  }

  const updateFields: Record<string, unknown> = {};
  const mappable = [
    "title", "description", "assigned_to", "priority", "due_date", "start_date",
    "issue_type", "parent_id", "estimate_minutes", "spent_minutes", "remaining_minutes",
  ];
  for (const key of mappable) {
    if (fields[key] !== undefined) updateFields[key] = fields[key];
  }
  if (column_id !== undefined) updateFields["column_id"] = column_id;
  if (fields.custom_fields !== undefined) {
    updateFields["custom_fields"] = fields.custom_fields === null || typeof fields.custom_fields === "string"
      ? fields.custom_fields
      : JSON.stringify(fields.custom_fields);
  }

  try {
    const updated = tasks.updateTask(projectId, req.params.id!, updateFields as any, actor, taskMutationOptions(req));
    if (!updated) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Task not found" } });
      return;
    }
    res.json({ data: updated });
  } catch (err: unknown) {
    if (sendTaskCoordinationError(res, err)) return;
    if (handleCheckConstraintError(err, res)) {
      logger.error("tasks", `CHECK constraint failed on PATCH /:id: ${(err as Error).message}`, {
        error: (err as Error).message,
        name: (err as Error).name,
        stack: (err as Error).stack?.split("\n").slice(0, 5).join("\n"),
        taskId: req.params.id,
        method: "PATCH",
        path: req.originalUrl,
      });
      return;
    }
    throw err;
  }
});

// DELETE /:id
tasksRouter.delete("/:id", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const actor = req.query.actor as string | undefined;
  try {
    const deleted = tasks.deleteTask(projectId, req.params.id!, actor, taskMutationOptions(req));
    if (!deleted) {
      res.status(404).json({ error: { code: "TASK_NOT_FOUND", message: "Task not found" } });
      return;
    }
    res.status(204).send();
  } catch (error) {
    if (sendTaskCoordinationError(res, error)) return;
    throw error;
  }
});

// GET /:id/comments
tasksRouter.get("/:id/comments", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!requireTaskMember(projectId, req.params.id!, res)) return;
  const list = tasks.getComments(projectId, req.params.id!);
  res.json({ data: list, total: list.length });
});

// POST /:id/comments
tasksRouter.post("/:id/comments", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const { author, body, parent_comment_id, actor } = req.body;
  if (!author || !body) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "author and body are required" } });
    return;
  }
  try {
    const comment = tasks.addComment(projectId, req.params.id!, author, body, parent_comment_id, actor, taskMutationOptions(req));
    res.status(201).json({ data: comment, revision: taskRevision(projectId, req.params.id!) });
  } catch (error) {
    if (sendTaskCoordinationError(res, error)) return;
    throw error;
  }
});

// PATCH /:id/comments/:commentId
tasksRouter.patch("/:id/comments/:commentId", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const { body, actor } = req.body;
  if (!body) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "body is required" } });
    return;
  }
  try {
    const comment = tasks.editComment(projectId, req.params.id!, req.params.commentId!, body, actor, taskMutationOptions(req));
    if (!comment) {
      res.status(404).json({ error: { code: "TASK_NOT_FOUND", message: "Task not found" } });
      return;
    }
    res.json({ data: comment, revision: taskRevision(projectId, req.params.id!) });
  } catch (error) {
    if (sendTaskCoordinationError(res, error)) return;
    throw error;
  }
});

// POST /:id/comments/:commentId/react
tasksRouter.post("/:id/comments/:commentId/react", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const { reaction, actor } = req.body;
  if (!reaction) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "reaction is required" } });
    return;
  }
  try {
    const comment = tasks.reactComment(projectId, req.params.id!, req.params.commentId!, reaction, actor, taskMutationOptions(req));
    if (!comment) {
      res.status(404).json({ error: { code: "TASK_NOT_FOUND", message: "Task not found" } });
      return;
    }
    res.json({ data: comment, revision: taskRevision(projectId, req.params.id!) });
  } catch (error) {
    if (sendTaskCoordinationError(res, error)) return;
    throw error;
  }
});

// GET /:id/activity
tasksRouter.get("/:id/activity", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!requireTaskMember(projectId, req.params.id!, res)) return;
  const limit = parseInt(req.query.limit as string) || 50;
  const list = tasks.getTaskActivity(projectId, req.params.id!, limit);
  res.json({ data: list, total: list.length });
});

// GET /:id/links
tasksRouter.get("/:id/links", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!requireTaskMember(projectId, req.params.id!, res)) return;
  const list = tasks.getTaskLinks(projectId, req.params.id!);
  res.json({ data: list, total: list.length });
});

// POST /:id/links
tasksRouter.post("/:id/links", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const { linked_task_id, link_type, actor } = req.body;
  if (!linked_task_id || !link_type) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "linked_task_id and link_type are required" } });
    return;
  }
  // Server-side whitelist — must match SQL CHECK constraint on task_links.link_type
  if (!["blocks", "blocked_by", "relates_to"].includes(link_type)) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "link_type must be blocks, blocked_by, or relates_to" } });
    return;
  }
  try {
    const link = tasks.linkTasks(projectId, req.params.id!, linked_task_id, link_type, actor, taskMutationOptions(req));
    res.status(201).json({ data: link, revision: taskRevision(projectId, req.params.id!) });
  } catch (err: any) {
    if (sendTaskCoordinationError(res, err)) return;
    logger.error("tasks", `Task link creation failed: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: err.message } });
  }
});

// DELETE /:id/links/:linkId
tasksRouter.delete("/:id/links/:linkId", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const actor = req.query.actor as string | undefined;
  try {
    const deleted = tasks.unlinkTasks(projectId, req.params.id!, req.params.linkId!, actor, taskMutationOptions(req));
    if (!deleted) {
      res.status(404).json({ error: { code: "TASK_NOT_FOUND", message: "Task not found" } });
      return;
    }
    res.status(204).send();
  } catch (error) {
    if (sendTaskCoordinationError(res, error)) return;
    throw error;
  }
});

// GET /:id/tree
tasksRouter.get("/:id/tree", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!requireTaskMember(projectId, req.params.id!, res)) return;
  const tree = tasks.getTaskTree(projectId, req.params.id!);
  res.json({ data: tree });
});
