import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import {
  Job,
  JobRun,
  JobRunLog,
  JobRunWithEventMetadata,
  JobVaultReference,
  TrustedJobEventTypeSchema,
  type TrustedJobEventType,
} from "../schema.js";
import { randomUUID } from "node:crypto";
import { sanitizeJobEventText } from "./job-event-deliveries.js";

// Internal helpers

function dbPath(): string {
  return process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db";
}

export class JobTriggerEventError extends Error {
  readonly code = "UNKNOWN_TRIGGER_EVENT" as const;

  constructor() {
    super("UNKNOWN_TRIGGER_EVENT");
    this.name = "JobTriggerEventError";
  }
}

export type JobDeleteResult =
  | { status: "deleted" }
  | { status: "not_found" }
  | { status: "active_delivery" };

export const JOB_VAULT_REFERENCE_MAX = 16;

type JobRow = Omit<Job, "vault_references">;
type JobDb = ReturnType<typeof getDb>;

export class JobVaultReferenceError extends Error {
  readonly code: "INVALID_VAULT_ITEM_IDS" | "VAULT_ITEM_NOT_FOUND";

  constructor(code: "INVALID_VAULT_ITEM_IDS" | "VAULT_ITEM_NOT_FOUND") {
    super(code);
    this.name = "JobVaultReferenceError";
    this.code = code;
  }
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeVaultItemIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > JOB_VAULT_REFERENCE_MAX) {
    throw new JobVaultReferenceError("INVALID_VAULT_ITEM_IDS");
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!value.every((itemId) => typeof itemId === "string" && uuid.test(itemId))) {
    throw new JobVaultReferenceError("INVALID_VAULT_ITEM_IDS");
  }
  const ids = value as string[];
  if (new Set(ids).size !== ids.length) throw new JobVaultReferenceError("INVALID_VAULT_ITEM_IDS");
  return ids;
}

function loadVaultReferences(db: JobDb, projectId: string, jobId: string): JobVaultReference[] {
  return db.prepare(
    `SELECT reference.item_id, reference.authorized_at,
            reference.authorized_item_version AS item_version,
            CASE WHEN item.id IS NOT NULL AND item.access_policy <> ? THEN 'available' ELSE 'unavailable' END AS availability
     FROM job_vault_references reference
     LEFT JOIN vault_items item ON item.project_id = reference.project_id AND item.id = reference.item_id
     WHERE reference.project_id = ? AND reference.job_id = ? AND reference.status = 'authorized'
     ORDER BY reference.authorized_at ASC, reference.item_id ASC`,
  ).all('{"mode":"deleted"}', projectId, jobId) as JobVaultReference[];
}

function withVaultReferences(db: JobDb, job: JobRow): Job {
  return { ...job, vault_references: loadVaultReferences(db, job.project_id, job.id) };
}

function loadJob(db: JobDb, projectId: string, jobId: string): Job | undefined {
  const job = db.prepare(
    "SELECT * FROM jobs WHERE id = ? AND project_id = ? AND deleted_at IS NULL",
  ).get(jobId, projectId) as JobRow | undefined;
  return job ? withVaultReferences(db, job) : undefined;
}

function loadActiveVaultItems(db: JobDb, projectId: string, itemIds: string[]): Map<string, number> {
  if (itemIds.length === 0) return new Map();
  const placeholders = itemIds.map(() => "?").join(", ");
  const rows = db.prepare(
    `SELECT id, version FROM vault_items
     WHERE project_id = ? AND access_policy <> ? AND id IN (${placeholders})`,
  ).all(projectId, '{"mode":"deleted"}', ...itemIds) as Array<{ id: string; version: number }>;
  if (rows.length !== itemIds.length) throw new JobVaultReferenceError("VAULT_ITEM_NOT_FOUND");
  return new Map(rows.map((item) => [item.id, item.version]));
}

function insertVaultReferenceAudit(
  db: JobDb,
  projectId: string,
  jobId: string,
  itemId: string,
  itemVersion: number,
  action: "authorized" | "revoked",
  timestamp: string,
): void {
  db.prepare(
    `INSERT INTO job_vault_reference_audit
     (id, project_id, job_id, item_id, authorized_item_version, action, actor, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'authenticated_api', ?)`,
  ).run(randomUUID(), projectId, jobId, itemId, itemVersion, action, timestamp);
}

function replaceVaultReferences(db: JobDb, projectId: string, jobId: string, value: unknown): void {
  const itemIds = normalizeVaultItemIds(value);
  const parent = db.prepare(
    "SELECT 1 FROM jobs WHERE id = ? AND project_id = ?",
  ).get(jobId, projectId);
  if (!parent) throw new Error("Job vault reference parent is missing");

  const requestedVersions = loadActiveVaultItems(db, projectId, itemIds);
  const existing = db.prepare(
    `SELECT item_id, authorized_item_version, status
     FROM job_vault_references WHERE project_id = ? AND job_id = ?`,
  ).all(projectId, jobId) as Array<{
    item_id: string;
    authorized_item_version: number;
    status: "authorized" | "revoked";
  }>;
  const existingByItemId = new Map(existing.map((reference) => [reference.item_id, reference]));
  const requestedIds = new Set(itemIds);
  const timestamp = new Date().toISOString();

  for (const reference of existing) {
    if (reference.status !== "authorized" || requestedIds.has(reference.item_id)) continue;
    db.prepare(
      `UPDATE job_vault_references SET status = 'revoked'
       WHERE project_id = ? AND job_id = ? AND item_id = ? AND status = 'authorized'`,
    ).run(projectId, jobId, reference.item_id);
    insertVaultReferenceAudit(
      db, projectId, jobId, reference.item_id, reference.authorized_item_version, "revoked", timestamp,
    );
  }

  for (const itemId of itemIds) {
    const existingReference = existingByItemId.get(itemId);
    if (existingReference?.status === "authorized") continue;
    const itemVersion = requestedVersions.get(itemId)!;
    if (existingReference) {
      db.prepare(
        `UPDATE job_vault_references
         SET authorized_at = ?, authorized_item_version = ?, status = 'authorized'
         WHERE project_id = ? AND job_id = ? AND item_id = ? AND status = 'revoked'`,
      ).run(timestamp, itemVersion, projectId, jobId, itemId);
    } else {
      db.prepare(
        `INSERT INTO job_vault_references
         (project_id, job_id, item_id, authorized_at, authorized_item_version, status)
         VALUES (?, ?, ?, ?, ?, 'authorized')`,
      ).run(projectId, jobId, itemId, timestamp, itemVersion);
    }
    insertVaultReferenceAudit(db, projectId, jobId, itemId, itemVersion, "authorized", timestamp);
  }
}

export function isTrustedJobTriggerEvent(value: unknown): value is TrustedJobEventType {
  return TrustedJobEventTypeSchema.safeParse(value).success;
}

/** New or actually changed trigger values are constrained to the v1 catalog. */
export function normalizeJobTriggerEvent(value: unknown): TrustedJobEventType | null {
  if (value === undefined || value === null) return null;
  if (isTrustedJobTriggerEvent(value)) return value;
  throw new JobTriggerEventError();
}

// ── Job CRUD ────────────────────────────────────────────────────────────────


/**
 * Create a new job with an agent prompt template and optional schedule/trigger.
 * Enabled by default. Timeout defaults to 30 minutes.
 */
export function createJob(
  projectId: string,
  name: string,
  description: string | undefined,
  agent: string,
  promptTemplate: string,
  scheduleCron?: string,
  triggerEvent?: string | null,
  timeoutMinutes?: number,
  vaultItemIds?: string[],
): Job {
  const trustedTriggerEvent = normalizeJobTriggerEvent(triggerEvent);
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO jobs (id, project_id, name, description, agent, prompt_template,
        schedule_cron, trigger_event, enabled, timeout_minutes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    ).run(
      id, projectId, name, description ?? null, agent, promptTemplate,
       scheduleCron ?? null, trustedTriggerEvent,
      timeoutMinutes ?? 30, now, now,
    );
    if (vaultItemIds !== undefined) replaceVaultReferences(db, projectId, id, vaultItemIds);
    return withVaultReferences(
      db,
      db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow,
    );
  });
  checkpointAfterWrite();
  return result;
}

/**
 * Update a job's fields. Dynamically builds the SET clause from the provided `fields` object,
 * mapping camelCase field names to snake_case column names.
 * SQLite has no native boolean type — `enabled` is stored as 0/1 integer.
 */
export type JobUpdateFields = Partial<Pick<
  Job,
  "name" | "description" | "agent" | "prompt_template" | "schedule_cron" | "trigger_event" | "enabled" | "timeout_minutes"
>> & {
  vault_item_ids?: string[];
};

export function updateJob(
  projectId: string,
  jobId: string,
  fields: JobUpdateFields,
): Job | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const now = new Date().toISOString();

    const existing = db.prepare("SELECT id, trigger_event FROM jobs WHERE id = ? AND project_id = ? AND deleted_at IS NULL").get(jobId, projectId) as
      { id: string; trigger_event: string | null } | undefined;
    if (!existing) return undefined;

    const nextTriggerEvent = hasOwn(fields, "trigger_event")
      ? ((fields as Record<string, unknown>).trigger_event === existing.trigger_event
        ? existing.trigger_event
        : normalizeJobTriggerEvent((fields as Record<string, unknown>).trigger_event))
      : undefined;

    const setClauses: string[] = ["updated_at = ?"];
    const params: unknown[] = [now];

    const mappable: Record<string, string> = {
      name: "name",
      description: "description",
      agent: "agent",
      prompt_template: "prompt_template",
      schedule_cron: "schedule_cron",
      trigger_event: "trigger_event",
      timeout_minutes: "timeout_minutes",
    };

    for (const [field, col] of Object.entries(mappable)) {
      if (hasOwn(fields, field)) {
        setClauses.push(`${col} = ?`);
        params.push(field === "trigger_event"
          ? nextTriggerEvent
          : (fields as Record<string, unknown>)[field] ?? null);
      }
    }

    if (hasOwn(fields, "enabled")) {
      setClauses.push("enabled = ?");
      params.push(fields.enabled ? 1 : 0);
    }

    params.push(jobId, projectId);

    const sql = `UPDATE jobs SET ${setClauses.join(", ")} WHERE id = ? AND project_id = ? AND deleted_at IS NULL`;
    const info = db.prepare(sql).run(...params);

    if (info.changes === 0) return undefined;
    if (fields.vault_item_ids !== undefined) replaceVaultReferences(db, projectId, jobId, fields.vault_item_ids);

    return loadJob(db, projectId, jobId);
  });
  if (result) checkpointAfterWrite();
  return result;
}

/** Remove a job from public use while retaining delivery provenance. */
export function deleteJob(projectId: string, jobId: string): JobDeleteResult {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const existing = db.prepare("SELECT id FROM jobs WHERE id = ? AND project_id = ? AND deleted_at IS NULL").get(jobId, projectId) as { id: string } | undefined;
    if (!existing) return { status: "not_found" } as const;
    const activeDelivery = db.prepare(
      `SELECT 1
       FROM job_event_deliveries delivery
       LEFT JOIN job_event_attempts attempt
         ON attempt.project_id = delivery.project_id AND attempt.delivery_id = delivery.id
       LEFT JOIN job_runs run
         ON run.project_id = attempt.project_id AND run.id = attempt.run_id
       WHERE delivery.project_id = ? AND delivery.job_id = ?
         AND (delivery.state = 'leased' OR run.status IN ('queued', 'running'))
       LIMIT 1`,
    ).get(projectId, jobId);
    if (activeDelivery) return { status: "active_delivery" } as const;
    const timestamp = new Date().toISOString();
    db.prepare(
      `UPDATE job_event_deliveries
       SET state = 'dead_letter', next_attempt_at = NULL, lease_expires_at = NULL, lease_owner_hash = NULL,
           last_error_code = 'job_deleted', last_error_message = 'Job was deleted before delivery completed.',
           updated_at = ?
       WHERE project_id = ? AND job_id = ? AND state IN ('queued', 'leased', 'retry_wait')`,
    ).run(timestamp, projectId, jobId);
    db.prepare(
      "UPDATE jobs SET enabled = 0, deleted_at = ?, updated_at = ? WHERE id = ? AND project_id = ?",
    ).run(timestamp, timestamp, jobId, projectId);
    return { status: "deleted" } as const;
  });
  if (result.status === "deleted") checkpointAfterWrite();
  return result;
}

/** List all jobs for a project, ordered by creation date descending. */
export function listJobs(projectId: string): Job[] {
  const db = getDb(dbPath());
  const jobs = db.prepare(
    "SELECT * FROM jobs WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at DESC",
  ).all(projectId) as JobRow[];
  return jobs.map((job) => withVaultReferences(db, job));
}

/** Get a single job by ID. Returns undefined if not found. */
export function getJob(projectId: string, jobId: string): Job | undefined {
  return loadJob(getDb(dbPath()), projectId, jobId);
}

// ── Job Run lifecycle ────────────────────────────────────────────────────────


/**
 * Start a new job run. Performs concurrency guard: only one run per job can be
 * in 'running' or 'queued' status at a time. Returns either the created JobRun
 * or a `{ status: "queued", reason }` object if the job can't start.
 *
 * Reasons for rejection: job not found, job disabled, or an existing run in progress.
 */
export function startJobRun(projectId: string, jobId: string, trigger: "manual" | "cron" | "event"): JobRun | { status: "queued"; reason: string } {
  const result = execTransaction(() => {
    const db = getDb(dbPath());

    const job = db.prepare("SELECT id, enabled FROM jobs WHERE id = ? AND project_id = ? AND deleted_at IS NULL")
      .get(jobId, projectId) as { id: string; enabled: number } | undefined;
    if (!job) {
      return { status: "queued" as const, reason: "Job not found" };
    }
    if (!job.enabled) {
      return { status: "queued" as const, reason: "Job is disabled" };
    }

    // Concurrency guard: prevent overlapping runs. A new run cannot start if
    // another run is still 'running' or 'queued' for the same job.
    const running = db.prepare(
      "SELECT id FROM job_runs WHERE job_id = ? AND status IN ('running', 'queued')",
    ).get(jobId) as { id: string } | undefined;
    if (running) {
      return { status: "queued" as const, reason: "Job already has a running or queued run" };
    }

    const now = new Date().toISOString();
    const runId = randomUUID();

    db.prepare(
      `INSERT INTO job_runs (id, job_id, project_id, status, trigger, started_at, created_at)
       VALUES (?, ?, ?, 'running', ?, ?, ?)`,
    ).run(runId, jobId, projectId, trigger, now, now);

    return db.prepare("SELECT * FROM job_runs WHERE id = ?").get(runId) as JobRun;
  });
  checkpointAfterWrite();
  return result;
}

/**
 * Mark a job run as finished with a terminal status and optional exit code.
 * Returns undefined if the run ID doesn't exist.
 */
export function finishJobRun(projectId: string, runId: string, status: "success" | "failed" | "timeout" | "cancelled", exitCode: number | null): JobRunWithEventMetadata | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const now = new Date().toISOString();

    const existing = db.prepare(
      `SELECT run.id FROM job_runs run
       JOIN jobs job ON job.id = run.job_id AND job.project_id = ?
       WHERE run.id = ?`,
    ).get(projectId, runId) as { id: string } | undefined;
    if (!existing) return undefined;

    db.prepare(
      "UPDATE job_runs SET status = ?, finished_at = ?, exit_code = ? WHERE id = ? AND project_id = ?",
    ).run(status, now, exitCode, runId, projectId);

    return getJobRunFromDb(db, projectId, runId);
  });
  checkpointAfterWrite();
  return result;
}

/**
 * Cancel a job run. Only succeeds if the run is currently 'running' or 'queued'.
 * If already in a terminal state, returns the run unchanged (idempotent).
 */
export function cancelJobRun(projectId: string, runId: string): JobRunWithEventMetadata | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const now = new Date().toISOString();

    const existing = db.prepare(
      `SELECT run.id, run.status FROM job_runs run
       JOIN jobs job ON job.id = run.job_id AND job.project_id = ?
       WHERE run.id = ?`,
    ).get(projectId, runId) as
      { id: string; status: string } | undefined;
    if (!existing) return undefined;

    if (!["running", "queued"].includes(existing.status)) {
      return getJobRunFromDb(db, projectId, runId)!;
    }

    db.prepare(
      "UPDATE job_runs SET status = 'cancelled', finished_at = ? WHERE id = ? AND project_id = ?",
    ).run(now, runId, projectId);

    return getJobRunFromDb(db, projectId, runId)!;
  });
  checkpointAfterWrite();
  return result;
}

/** List job runs for a given job, most recent first. Default limit 50. */
export function listJobRuns(projectId: string, jobId: string, limit = 50): JobRunWithEventMetadata[] {
  const db = getDb(dbPath());
  const boundedLimit = Math.min(Math.max(Number.isSafeInteger(limit) ? limit : 50, 1), 100);
  const rows = db.prepare(
    `SELECT run.*, attempt.delivery_id AS event_delivery_id, attempt.attempt_number AS event_attempt_number,
            delivery.trusted_event_id AS event_trusted_event_id, delivery.state AS event_delivery_state
     FROM job_runs run
     JOIN jobs job ON job.id = run.job_id AND job.project_id = ?
     LEFT JOIN job_event_attempts attempt ON attempt.project_id = run.project_id AND attempt.run_id = run.id
     LEFT JOIN job_event_deliveries delivery ON delivery.project_id = attempt.project_id AND delivery.id = attempt.delivery_id
     WHERE run.job_id = ? ORDER BY run.created_at DESC, run.id DESC LIMIT ?`,
  ).all(projectId, jobId, boundedLimit) as Array<JobRun & EventMetadataRow>;
  return rows.map(toRunWithEventMetadata);
}

/** Get a single job run by ID. */
export function getJobRun(projectId: string, runId: string): JobRunWithEventMetadata | undefined {
  return getJobRunFromDb(getDb(dbPath()), projectId, runId);
}

// ── Run logs ─────────────────────────────────────────────────────────────────


/**
 * Append a line of output to a job run's log stream.
 * Uses a monotonic sequence number (seq) per run for ordered retrieval and streaming —
 * the client polls with `afterSeq` to get new lines incrementally.
 */
export function appendRunLog(projectId: string, runId: string, stream: "stdout" | "stderr", line: string): JobRunLog | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const now = new Date().toISOString();

    const ownedRun = db.prepare(
      `SELECT run.id FROM job_runs run
       JOIN jobs job ON job.id = run.job_id AND job.project_id = ?
       WHERE run.id = ?`,
    ).get(projectId, runId) as { id: string } | undefined;
    if (!ownedRun) return undefined;
    // Increment sequence number per run — provides ordering and supports
    // incremental polling (the client passes `afterSeq` to get only new lines).
    const maxSeq = db.prepare(
      "SELECT COALESCE(MAX(seq), 0) as max_seq FROM job_run_logs WHERE run_id = ?",
    ).get(runId) as { max_seq: number };
    const seq = maxSeq.max_seq + 1;

    db.prepare(
      "INSERT INTO job_run_logs (run_id, seq, stream, line, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(runId, seq, stream, sanitizeJobEventText(line, 4_096), now);

    return db.prepare(
      "SELECT * FROM job_run_logs WHERE run_id = ? AND seq = ?",
    ).get(runId, seq) as JobRunLog;
  });
  checkpointAfterWrite();
  return result;
}

/**
 * Get log lines for a job run in sequence order.
 * If `afterSeq` is provided, returns only lines with seq > afterSeq (incremental polling).
 * This allows the client to tail logs without re-fetching already-seen lines.
 */
export function getRunLogs(projectId: string, runId: string, afterSeq?: number): JobRunLog[] {
  const db = getDb(dbPath());
  if (afterSeq !== undefined) {
    return db.prepare(
      `SELECT log.* FROM job_run_logs log
       JOIN job_runs run ON run.id = log.run_id
       JOIN jobs job ON job.id = run.job_id AND job.project_id = ?
       WHERE log.run_id = ? AND log.seq > ? ORDER BY log.seq ASC`,
    ).all(projectId, runId, afterSeq) as JobRunLog[];
  }
  return db.prepare(
    `SELECT log.* FROM job_run_logs log
     JOIN job_runs run ON run.id = log.run_id
     JOIN jobs job ON job.id = run.job_id AND job.project_id = ?
     WHERE log.run_id = ? ORDER BY log.seq ASC`,
  ).all(projectId, runId) as JobRunLog[];
}

type EventMetadataRow = {
  event_delivery_id: string | null;
  event_attempt_number: number | null;
  event_trusted_event_id: string | null;
  event_delivery_state: JobRunWithEventMetadata["event_delivery"] extends infer T
    ? T extends { delivery_state: infer State } ? State | null : never
    : never;
};

function toRunWithEventMetadata(row: JobRun & EventMetadataRow): JobRunWithEventMetadata {
  const { event_delivery_id, event_attempt_number, event_trusted_event_id, event_delivery_state, ...run } = row;
  return {
    ...run,
    event_delivery: event_delivery_id && event_attempt_number !== null && event_trusted_event_id && event_delivery_state
      ? {
        delivery_id: event_delivery_id,
        attempt_number: event_attempt_number,
        trusted_event_id: event_trusted_event_id,
        delivery_state: event_delivery_state,
      }
      : null,
  };
}

function getJobRunFromDb(db: ReturnType<typeof getDb>, projectId: string, runId: string): JobRunWithEventMetadata | undefined {
  const row = db.prepare(
    `SELECT run.*, attempt.delivery_id AS event_delivery_id, attempt.attempt_number AS event_attempt_number,
            delivery.trusted_event_id AS event_trusted_event_id, delivery.state AS event_delivery_state
     FROM job_runs run
     JOIN jobs job ON job.id = run.job_id AND job.project_id = ?
     LEFT JOIN job_event_attempts attempt ON attempt.project_id = run.project_id AND attempt.run_id = run.id
     LEFT JOIN job_event_deliveries delivery ON delivery.project_id = attempt.project_id AND delivery.id = attempt.delivery_id
     WHERE run.id = ?`,
  ).get(projectId, runId) as (JobRun & EventMetadataRow) | undefined;
  return row ? toRunWithEventMetadata(row) : undefined;
}
