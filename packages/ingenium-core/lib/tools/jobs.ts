import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import {
  Job,
  JobRun,
  JobRunLog,
  JobRunWithEventMetadata,
  JobVaultReference,
  MAX_CONCURRENT_AUTOMATION_RUNS,
  MAX_CONCURRENT_RUNS_PER_ORGANIZATION,
  MAX_CONCURRENT_RUNS_PER_SERVICE_PRINCIPAL,
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
  | { status: "active_delivery" }
  | { status: "revision_conflict"; currentRevision: number };

export type JobUpdateResult =
  | { status: "updated"; job: Job }
  | { status: "not_found" }
  | { status: "revision_conflict"; currentRevision: number };

export const JOB_VAULT_REFERENCE_MAX = 16;
export const DEFAULT_JOB_TIMEOUT_MINUTES = 30;
export const MIN_JOB_TIMEOUT_MINUTES = 1;
export const MAX_JOB_TIMEOUT_MINUTES = 1_440;
export { MAX_CONCURRENT_AUTOMATION_RUNS, MAX_CONCURRENT_RUNS_PER_ORGANIZATION, MAX_CONCURRENT_RUNS_PER_SERVICE_PRINCIPAL };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

type JobRow = Omit<Job, "vault_references">;
type JobDb = ReturnType<typeof getDb>;

export type AutomationActorType = "compatibility" | "user" | "service" | "system";

export interface JobOwnershipInput {
  organizationId: string;
  servicePrincipalId?: string;
  ownerUserId?: string | null;
  visibility?: "private" | "organization";
  actorType?: AutomationActorType;
  actorId?: string | null;
}

export interface JobRunProvenance {
  delegator?: { type: AutomationActorType; id?: string | null };
  sourceActor?: { type: AutomationActorType; id?: string | null };
  scheduledFor?: string;
  expectedScheduleRevision?: number;
}

export class JobVaultReferenceError extends Error {
  readonly code: "INVALID_VAULT_ITEM_IDS" | "VAULT_ITEM_NOT_FOUND";

  constructor(code: "INVALID_VAULT_ITEM_IDS" | "VAULT_ITEM_NOT_FOUND") {
    super(code);
    this.name = "JobVaultReferenceError";
    this.code = code;
  }
}

export class JobTimeoutError extends RangeError {
  constructor() {
    super(`timeout_minutes must be an integer between ${MIN_JOB_TIMEOUT_MINUTES} and ${MAX_JOB_TIMEOUT_MINUTES}`);
    this.name = "JobTimeoutError";
  }
}

export function isValidJobTimeoutMinutes(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= MIN_JOB_TIMEOUT_MINUTES
    && value <= MAX_JOB_TIMEOUT_MINUTES;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeVaultItemIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > JOB_VAULT_REFERENCE_MAX) {
    throw new JobVaultReferenceError("INVALID_VAULT_ITEM_IDS");
  }
  if (!value.every((itemId) => typeof itemId === "string" && UUID_PATTERN.test(itemId))) {
    throw new JobVaultReferenceError("INVALID_VAULT_ITEM_IDS");
  }
  const ids = value as string[];
  if (new Set(ids).size !== ids.length) throw new JobVaultReferenceError("INVALID_VAULT_ITEM_IDS");
  return ids;
}

function loadVaultReferences(db: JobDb, projectId: string, jobId: string): JobVaultReference[] {
  return db.prepare(
    `SELECT reference.item_id, reference.authorized_at,
            reference.authorized_item_version,
            CASE
              WHEN item.id IS NULL OR item.access_policy = ? THEN 'unavailable'
              WHEN item.version = reference.authorized_item_version THEN 'authorized'
              ELSE 'version_stale'
            END AS status
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

export function orderJobsForFairDispatch<T extends Pick<Job, "organization_id" | "id">>(
  candidates: readonly T[],
  dispatchKind: "cron" | "event",
): T[] {
  const cursor = getDb(dbPath()).prepare(
    "SELECT last_organization_id FROM automation_dispatch_cursors WHERE dispatch_kind = ?",
  ).get(dispatchKind) as { last_organization_id: string | null } | undefined;
  const lastOrganizationId = cursor?.last_organization_id;
  return [...candidates].sort((left, right) => {
    const leftWrapped = lastOrganizationId && left.organization_id <= lastOrganizationId ? 1 : 0;
    const rightWrapped = lastOrganizationId && right.organization_id <= lastOrganizationId ? 1 : 0;
    return leftWrapped - rightWrapped
      || left.organization_id.localeCompare(right.organization_id)
      || left.id.localeCompare(right.id);
  });
}

function hasAutomationCapacity(db: JobDb, organizationId: string, servicePrincipalId: string): boolean {
  const counts = db.prepare(
    `SELECT count(*) AS global_count,
            count(*) FILTER (WHERE organization_id = ?) AS organization_count,
            count(*) FILTER (WHERE effective_service_principal_id = ?) AS principal_count
     FROM job_runs WHERE status IN ('queued', 'running')`,
  ).get(organizationId, servicePrincipalId) as {
    global_count: number;
    organization_count: number;
    principal_count: number;
  };
  return counts.global_count < MAX_CONCURRENT_AUTOMATION_RUNS
    && counts.organization_count < MAX_CONCURRENT_RUNS_PER_ORGANIZATION
    && counts.principal_count < MAX_CONCURRENT_RUNS_PER_SERVICE_PRINCIPAL;
}

function advanceDispatchCursor(db: JobDb, dispatchKind: "cron" | "event", organizationId: string, timestamp: string): void {
  db.prepare(
    `INSERT INTO automation_dispatch_cursors (dispatch_kind, last_organization_id, last_claimed_at)
     VALUES (?, ?, ?)
     ON CONFLICT(dispatch_kind) DO UPDATE SET last_organization_id = excluded.last_organization_id,
       last_claimed_at = excluded.last_claimed_at, revision = automation_dispatch_cursors.revision + 1`,
  ).run(dispatchKind, organizationId, timestamp);
}

function ensureAutomationPrincipal(db: JobDb, organizationId: string, projectId: string): string {
  let principal = db.prepare(
    "SELECT id FROM service_principals WHERE organization_id = ? AND name = 'Automation Dispatcher'",
  ).get(organizationId) as { id: string } | undefined;
  const timestamp = new Date().toISOString();
  if (!principal) {
    principal = { id: randomUUID() };
    db.prepare(
      "INSERT INTO service_principals (id, organization_id, name, status, created_at, updated_at) VALUES (?, ?, 'Automation Dispatcher', 'active', ?, ?)",
    ).run(principal.id, organizationId, timestamp, timestamp);
  }
  db.prepare(
    `INSERT INTO automation_principal_grants
     (id, organization_id, project_id, service_principal_id, permission, granted_by_actor_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'execute', 'system', ?, ?)
     ON CONFLICT(project_id, service_principal_id, permission) DO NOTHING`,
  ).run(randomUUID(), organizationId, projectId, principal.id, timestamp, timestamp);
  return principal.id;
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

function requireAutomationVaultGrant(db: JobDb, projectId: string, jobId: string, itemId: string): number {
  const grant = db.prepare(
    `SELECT grant_row.revision
     FROM jobs job
     JOIN resource_grants grant_row ON grant_row.organization_id = job.organization_id
       AND grant_row.resource_type = 'vault_item' AND grant_row.resource_id = ?
       AND grant_row.grantee_kind = 'service' AND grant_row.grantee_id = job.service_principal_id
       AND grant_row.revoked_at IS NULL AND (grant_row.expires_at IS NULL OR grant_row.expires_at > ?)
       AND EXISTS (SELECT 1 FROM json_each(grant_row.permissions_json) permission WHERE permission.value IN ('*', 'read', 'write', 'admin'))
     WHERE job.project_id = ? AND job.id = ?`,
  ).get(itemId, new Date().toISOString(), projectId, jobId) as { revision: number } | undefined;
  if (!grant) throw new JobVaultReferenceError("VAULT_ITEM_NOT_FOUND");
  return grant.revision;
}

function ensureAutomationVaultGrants(db: JobDb, projectId: string, jobId: string, itemIds: readonly string[]): void {
  if (itemIds.length === 0) return;
  const timestamp = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO resource_grants
     (id, organization_id, resource_type, resource_id, grantee_kind, grantee_id, permissions_json,
      granted_by_actor_type, created_at, updated_at)
     SELECT ?, job.organization_id, 'vault_item', ?, 'service', job.service_principal_id, '["read"]',
            'compatibility', ?, ?
     FROM jobs job WHERE job.project_id = ? AND job.id = ?
     ON CONFLICT DO NOTHING`,
  );
  for (const itemId of itemIds) insert.run(randomUUID(), itemId, timestamp, timestamp, projectId, jobId);
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
     (id, project_id, organization_id, job_id, item_id, authorized_item_version, action, actor, actor_type, created_at)
     SELECT ?, job.project_id, job.organization_id, job.id, ?, ?, ?, 'authenticated_api', 'compatibility', ?
     FROM jobs job WHERE job.project_id = ? AND job.id = ?`,
  ).run(randomUUID(), itemId, itemVersion, action, timestamp, projectId, jobId);
}

function replaceVaultReferences(db: JobDb, projectId: string, jobId: string, value: unknown): void {
  const itemIds = normalizeVaultItemIds(value);
  const parent = db.prepare(
    "SELECT 1 FROM jobs WHERE id = ? AND project_id = ?",
  ).get(jobId, projectId);
  if (!parent) throw new Error("Job vault reference parent is missing");

  const requestedVersions = loadActiveVaultItems(db, projectId, itemIds);
  ensureAutomationVaultGrants(db, projectId, jobId, itemIds);
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
    const itemVersion = requestedVersions.get(itemId)!;
    const grantRevision = requireAutomationVaultGrant(db, projectId, jobId, itemId);
    if (existingReference?.status === "authorized") {
      // An explicit same-ID PATCH is an intentional reauthorization event even
      // without rotation. Omission preserves the previous authorization and
      // continues to fail closed if a later item version diverges.
      db.prepare(
        `UPDATE job_vault_references
         SET authorized_at = ?, authorized_item_version = ?, grant_revision = ?
         WHERE project_id = ? AND job_id = ? AND item_id = ? AND status = 'authorized'`,
      ).run(timestamp, itemVersion, grantRevision, projectId, jobId, itemId);
      insertVaultReferenceAudit(db, projectId, jobId, itemId, itemVersion, "authorized", timestamp);
      continue;
    }
    if (existingReference) {
      db.prepare(
        `UPDATE job_vault_references
         SET authorized_at = ?, authorized_item_version = ?, grant_revision = ?, status = 'authorized'
         WHERE project_id = ? AND job_id = ? AND item_id = ? AND status = 'revoked'`,
      ).run(timestamp, itemVersion, grantRevision, projectId, jobId, itemId);
    } else {
      db.prepare(
        `INSERT INTO job_vault_references
         (project_id, organization_id, job_id, item_id, authorized_at, authorized_item_version, grant_revision, status)
         SELECT job.project_id, job.organization_id, job.id, ?, ?, ?, ?, 'authorized'
         FROM jobs job WHERE job.project_id = ? AND job.id = ?`,
      ).run(itemId, timestamp, itemVersion, grantRevision, projectId, jobId);
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
  ownership?: JobOwnershipInput,
): Job {
  const effectiveTimeoutMinutes = timeoutMinutes ?? DEFAULT_JOB_TIMEOUT_MINUTES;
  if (!isValidJobTimeoutMinutes(effectiveTimeoutMinutes)) throw new JobTimeoutError();
  const trustedTriggerEvent = normalizeJobTriggerEvent(triggerEvent);
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const now = new Date().toISOString();
    const id = randomUUID();
    const project = db.prepare("SELECT organization_id FROM projects WHERE id = ?").get(projectId) as { organization_id: string } | undefined;
    if (!project) throw new Error("Job project is unavailable");
    const organizationId = ownership?.organizationId ?? project.organization_id;
    const servicePrincipalId = ownership?.servicePrincipalId ?? ensureAutomationPrincipal(db, organizationId, projectId);
    if (!servicePrincipalId || organizationId !== project.organization_id) throw new Error("Job automation principal is unavailable");
    db.prepare(
      `INSERT INTO jobs (id, project_id, organization_id, owner_kind, owner_user_id, visibility,
        service_principal_id, created_by_actor_type, created_by_actor_id, name, description, agent, prompt_template,
        schedule_cron, trigger_event, enabled, timeout_minutes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    ).run(
      id, projectId, organizationId, ownership?.ownerUserId ? "user" : "organization", ownership?.ownerUserId ?? null,
      ownership?.visibility ?? (ownership?.ownerUserId ? "private" : "organization"), servicePrincipalId,
      ownership?.actorType ?? "compatibility", ownership?.actorId ?? null, name, description ?? null, agent, promptTemplate,
       scheduleCron ?? null, trustedTriggerEvent,
       effectiveTimeoutMinutes, now, now,
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
  expectedRevision: number,
): JobUpdateResult {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new RangeError("expected_revision must be a nonnegative integer");
  }
  if (hasOwn(fields, "timeout_minutes") && !isValidJobTimeoutMinutes(fields.timeout_minutes)) {
    throw new JobTimeoutError();
  }
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const now = new Date().toISOString();

    const existing = db.prepare("SELECT id, trigger_event, revision FROM jobs WHERE id = ? AND project_id = ? AND deleted_at IS NULL").get(jobId, projectId) as
      { id: string; trigger_event: string | null; revision: number } | undefined;
    if (!existing) return { status: "not_found" } as const;
    if (existing.revision !== expectedRevision) {
      return { status: "revision_conflict", currentRevision: existing.revision } as const;
    }

    const nextTriggerEvent = hasOwn(fields, "trigger_event")
      ? ((fields as Record<string, unknown>).trigger_event === existing.trigger_event
        ? existing.trigger_event
        : normalizeJobTriggerEvent((fields as Record<string, unknown>).trigger_event))
      : undefined;

    const setClauses: string[] = ["updated_at = ?", "revision = revision + 1"];
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
    if (hasOwn(fields, "schedule_cron")) {
      setClauses.push("schedule_revision = schedule_revision + 1");
    }

    if (hasOwn(fields, "enabled")) {
      setClauses.push("enabled = ?");
      params.push(fields.enabled ? 1 : 0);
    }

    params.push(jobId, projectId);

    const sql = `UPDATE jobs SET ${setClauses.join(", ")} WHERE id = ? AND project_id = ? AND deleted_at IS NULL AND revision = ?`;
    params.push(expectedRevision);
    const info = db.prepare(sql).run(...params);

    if (info.changes === 0) {
      const current = db.prepare(
        "SELECT revision FROM jobs WHERE id = ? AND project_id = ? AND deleted_at IS NULL",
      ).get(jobId, projectId) as { revision: number } | undefined;
      return current
        ? { status: "revision_conflict", currentRevision: current.revision } as const
        : { status: "not_found" } as const;
    }
    if (fields.vault_item_ids !== undefined) replaceVaultReferences(db, projectId, jobId, fields.vault_item_ids);

    return { status: "updated", job: loadJob(db, projectId, jobId)! } as const;
  });
  if (result.status === "updated") checkpointAfterWrite();
  return result;
}

/** Remove a job from public use while retaining delivery provenance. */
export function deleteJob(projectId: string, jobId: string, expectedRevision: number): JobDeleteResult {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new RangeError("expected_revision must be a nonnegative integer");
  }
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const existing = db.prepare("SELECT id, revision FROM jobs WHERE id = ? AND project_id = ? AND deleted_at IS NULL").get(jobId, projectId) as { id: string; revision: number } | undefined;
    if (!existing) return { status: "not_found" } as const;
    if (existing.revision !== expectedRevision) {
      return { status: "revision_conflict", currentRevision: existing.revision } as const;
    }
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
      `UPDATE jobs SET enabled = 0, deleted_at = ?, updated_at = ?, revision = revision + 1
       WHERE id = ? AND project_id = ? AND deleted_at IS NULL AND revision = ?`,
    ).run(timestamp, timestamp, jobId, projectId, expectedRevision);
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

export type JobVaultAuditAction = "authorized" | "revoked" | "secret_read" | "access_denied";
export type JobVaultAuditActorCategory = "authenticated_api" | "job_run";

/** Credential-free, fixed-shape job vault audit projection. */
export interface JobVaultAuditEntry {
  id: string;
  job_id: string;
  item_id: string | null;
  action: JobVaultAuditAction;
  actor_category: JobVaultAuditActorCategory;
  run_id: string | null;
  version: number | null;
  timestamp: string;
}

export interface JobVaultAuditPage {
  data: JobVaultAuditEntry[];
  nextCursor: string | null;
}

type JobVaultAuditCursor = { timestamp: string; id: string };

function encodeJobVaultAuditCursor(cursor: JobVaultAuditCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeJobVaultAuditCursor(cursor: string): JobVaultAuditCursor {
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(cursor)) throw new Error("Invalid job vault audit cursor");
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid job vault audit cursor");
  }
  if (!value || typeof value !== "object") throw new Error("Invalid job vault audit cursor");
  const record = value as Record<string, unknown>;
  if (typeof record.timestamp !== "string" || record.timestamp.length < 1 || record.timestamp.length > 64
    || typeof record.id !== "string" || !UUID_PATTERN.test(record.id)) {
    throw new Error("Invalid job vault audit cursor");
  }
  return { timestamp: record.timestamp, id: record.id };
}

/** Insert runtime evidence only after the database proves the exact job/run linkage. */
export function insertJobVaultRuntimeAudit(
  db: JobDb,
  input: {
    projectId: string;
    jobId: string;
    runId: string;
    action: "secret_read" | "access_denied";
    itemId?: string;
    authorizedItemVersion?: number;
  },
): boolean {
  if (!UUID_PATTERN.test(input.projectId) || !UUID_PATTERN.test(input.jobId) || !UUID_PATTERN.test(input.runId)) {
    return false;
  }
  const isRead = input.action === "secret_read";
  const itemId = input.itemId;
  const version = input.authorizedItemVersion;
  const hasReadFields = typeof itemId === "string" && UUID_PATTERN.test(itemId)
    && typeof version === "number" && Number.isSafeInteger(version) && version >= 1;
  if (isRead !== hasReadFields) {
    return false;
  }
  const run = db.prepare(
    `SELECT run.organization_id, run.effective_service_principal_id
     FROM job_runs run
     JOIN jobs job ON job.project_id = run.project_id AND job.id = run.job_id
     WHERE run.project_id = ? AND run.id = ? AND job.id = ?`,
  ).get(input.projectId, input.runId, input.jobId) as {
    organization_id: string;
    effective_service_principal_id: string;
  } | undefined;
  if (!run) return false;
  db.prepare(
    `INSERT INTO job_vault_runtime_audit
     (id, project_id, organization_id, effective_service_principal_id, job_id, item_id, action, run_id, authorized_item_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(), input.projectId, run.organization_id, run.effective_service_principal_id,
    input.jobId, isRead ? itemId! : null, input.action,
    input.runId, isRead ? version! : null, new Date().toISOString(),
  );
  return true;
}

/** List a bounded fixed-shape union of authorization and runtime audit evidence. */
export function listJobVaultAudit(
  projectId: string,
  jobId: string,
  options: { limit?: number; cursor?: string } = {},
): JobVaultAuditPage | undefined {
  const db = getDb(dbPath());
  const job = db.prepare(
    "SELECT 1 FROM jobs WHERE project_id = ? AND id = ? AND deleted_at IS NULL",
  ).get(projectId, jobId);
  if (!job) return undefined;
  const limit = options.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid job vault audit limit");
  const cursor = options.cursor === undefined ? undefined : decodeJobVaultAuditCursor(options.cursor);
  const boundary = cursor
    ? "WHERE timestamp < ? OR (timestamp = ? AND id < ?)"
    : "";
  const rows = db.prepare(
    `WITH audit AS (
       SELECT id, job_id, item_id, action, 'authenticated_api' AS actor_category,
              NULL AS run_id, authorized_item_version AS version, created_at AS timestamp
       FROM job_vault_reference_audit
       WHERE project_id = ? AND job_id = ?
       UNION ALL
       SELECT id, job_id, item_id, action, 'job_run' AS actor_category,
              run_id, authorized_item_version AS version, created_at AS timestamp
       FROM job_vault_runtime_audit
       WHERE project_id = ? AND job_id = ?
     )
     SELECT id, job_id, item_id, action, actor_category, run_id, version, timestamp
     FROM audit ${boundary}
     ORDER BY timestamp DESC, id DESC
     LIMIT ?`,
  ).all(
    projectId, jobId, projectId, jobId,
    ...(cursor ? [cursor.timestamp, cursor.timestamp, cursor.id] : []),
    limit + 1,
  ) as JobVaultAuditEntry[];
  const data = rows.slice(0, limit);
  const last = data.at(-1);
  return {
    data,
    nextCursor: rows.length > limit && last ? encodeJobVaultAuditCursor({ timestamp: last.timestamp, id: last.id }) : null,
  };
}

// ── Job Run lifecycle ────────────────────────────────────────────────────────


/**
 * Start a new job run. Performs concurrency guard: only one run per job can be
 * in 'running' or 'queued' status at a time. Returns either the created JobRun
 * or a `{ status: "queued", reason }` object if the job can't start.
 *
 * Reasons for rejection: job not found, job disabled, or an existing run in progress.
 */
export function startJobRun(
  projectId: string,
  jobId: string,
  trigger: "manual" | "cron" | "event",
  provenance: JobRunProvenance = {},
): JobRun | { status: "queued"; reason: string } {
  const result = execTransaction(() => {
    const db = getDb(dbPath());

    const job = db.prepare(
      `SELECT job.id, job.enabled, job.organization_id, job.service_principal_id, job.revision, job.schedule_revision,
              grant_row.revision AS authorization_revision
       FROM jobs job
       JOIN service_principals principal ON principal.id = job.service_principal_id
         AND principal.organization_id = job.organization_id AND principal.status = 'active'
       JOIN automation_principal_grants grant_row ON grant_row.project_id = job.project_id
         AND grant_row.organization_id = job.organization_id AND grant_row.service_principal_id = job.service_principal_id
         AND grant_row.permission = 'execute' AND grant_row.status = 'active'
       WHERE job.id = ? AND job.project_id = ? AND job.deleted_at IS NULL`,
    ).get(jobId, projectId) as {
      id: string; enabled: number; organization_id: string; service_principal_id: string;
      revision: number; schedule_revision: number; authorization_revision: number;
    } | undefined;
    if (!job) {
      return { status: "queued" as const, reason: "Job automation authorization is unavailable" };
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
    if (!hasAutomationCapacity(db, job.organization_id, job.service_principal_id)) {
      return { status: "queued" as const, reason: "Automation concurrency quota is full" };
    }

    const now = new Date().toISOString();
    const scheduledFor = trigger === "cron" ? provenance.scheduledFor : undefined;
    if (trigger === "cron" && (!scheduledFor || provenance.expectedScheduleRevision !== job.schedule_revision)) {
      return { status: "queued" as const, reason: "Job schedule changed before it could be claimed" };
    }
    const delegator = trigger === "manual" ? provenance.delegator ?? { type: "compatibility" as const, id: "internal" } : undefined;
    const runId = randomUUID();

    try {
      db.prepare(
        `INSERT INTO job_runs
         (id, job_id, project_id, organization_id, effective_service_principal_id,
          delegator_actor_type, delegator_actor_id, source_actor_type, source_actor_id,
          job_revision, schedule_revision, scheduled_for, authorization_revision,
          status, trigger, started_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
      ).run(
        runId, jobId, projectId, job.organization_id, job.service_principal_id,
        delegator?.type ?? null, delegator?.id ?? null,
        provenance.sourceActor?.type ?? null, provenance.sourceActor?.id ?? null,
        job.revision, trigger === "cron" ? job.schedule_revision : null, scheduledFor ?? null,
        job.authorization_revision, trigger, now, now,
      );
      if (trigger === "cron") advanceDispatchCursor(db, "cron", job.organization_id, now);
    } catch (error) {
      if (trigger === "cron" && error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        return { status: "queued" as const, reason: "Scheduled occurrence was already claimed" };
      }
      throw error;
    }

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

/** Mark ordinary runs interrupted by an API restart as terminal so they can run again. */
export function recoverInterruptedJobRuns(): number {
  const recovered = execTransaction(() => {
    const db = getDb(dbPath());
    const finishedAt = new Date().toISOString();
    return db.prepare(
      `UPDATE job_runs
       SET status = 'failed', finished_at = ?, exit_code = -1
       WHERE status = 'running' AND trigger IN ('manual', 'cron')`,
    ).run(finishedAt).changes;
  });
  if (recovered > 0) checkpointAfterWrite();
  return recovered;
}

/** Revalidate immutable execution authority before recovery touches secrets or processes. */
export function isJobRunAuthorizationCurrent(projectId: string, runId: string): boolean {
  return Boolean(getDb(dbPath()).prepare(
    `SELECT 1
     FROM job_runs run
     JOIN jobs job ON job.project_id = run.project_id AND job.id = run.job_id
     JOIN projects project ON project.id = job.project_id AND project.organization_id = job.organization_id
       AND project.archived_at IS NULL
     JOIN service_principals principal ON principal.id = run.effective_service_principal_id
       AND principal.organization_id = run.organization_id AND principal.status = 'active'
     JOIN automation_principal_grants grant_row ON grant_row.project_id = job.project_id
       AND grant_row.organization_id = job.organization_id
       AND grant_row.service_principal_id = run.effective_service_principal_id
       AND grant_row.permission = 'execute' AND grant_row.status = 'active'
     WHERE run.project_id = ? AND run.id = ? AND run.organization_id = job.organization_id
       AND run.effective_service_principal_id = job.service_principal_id
       AND run.job_revision = job.revision AND run.authorization_revision = grant_row.revision`,
  ).get(projectId, runId));
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

/** Metadata-only immutable authorization captured for one vault-backed run. */
export interface VaultJobRunItemSnapshot {
  itemId: string;
  authorizedItemVersion: number;
}

export type VaultJobRunState = "prepared" | "spawned" | "teardown_pending" | "cleaned" | "failed";

/** Internal-only data used to recover one exact tmpfs run directory. */
export interface VaultSecretRunRecovery {
  runId: string;
  projectId: string;
  jobId: string;
  state: VaultJobRunState;
  deadlineAt: number;
  revision: number;
  processNonceHash: string;
  itemSnapshots: VaultJobRunItemSnapshot[];
  processIdentity: {
    processId: number;
    processGroupId: number;
    processStartTime: string;
    processExecutable: string;
  } | null;
}

type VaultJobRunRow = {
  run_id: string;
  project_id: string;
  job_id: string;
  state: VaultJobRunState;
  deadline_at: number;
  revision: number;
  process_nonce_hash: string;
  process_id: number | null;
  process_group_id: number | null;
  process_start_time: string | null;
  process_executable: string | null;
};

function vaultRunRecoveryFromRow(db: JobDb, row: VaultJobRunRow): VaultSecretRunRecovery {
  const items = db.prepare(
    `SELECT item_id, authorized_item_version FROM job_vault_run_items
     WHERE project_id = ? AND run_id = ? ORDER BY item_id ASC`,
  ).all(row.project_id, row.run_id) as Array<{ item_id: string; authorized_item_version: number }>;
  const hasIdentity = row.process_id !== null && row.process_group_id !== null
    && !!row.process_start_time && !!row.process_executable;
  return {
    runId: row.run_id,
    projectId: row.project_id,
    jobId: row.job_id,
    state: row.state,
    deadlineAt: row.deadline_at,
    revision: row.revision,
    processNonceHash: row.process_nonce_hash,
    itemSnapshots: items.map((item) => ({ itemId: item.item_id, authorizedItemVersion: item.authorized_item_version })),
    processIdentity: hasIdentity
      ? {
        processId: row.process_id!,
        processGroupId: row.process_group_id!,
        processStartTime: row.process_start_time!,
        processExecutable: row.process_executable!,
      }
      : null,
  };
}

function normalizeVaultRunSnapshots(value: readonly VaultJobRunItemSnapshot[]): VaultJobRunItemSnapshot[] | undefined {
  if (value.length > JOB_VAULT_REFERENCE_MAX) return undefined;
  const snapshots = value.map((item) => ({ ...item }));
  if (!snapshots.every((item) => UUID_PATTERN.test(item.itemId)
    && Number.isSafeInteger(item.authorizedItemVersion) && item.authorizedItemVersion >= 1)) return undefined;
  if (new Set(snapshots.map((item) => item.itemId)).size !== snapshots.length) return undefined;
  return snapshots.sort((left, right) => left.itemId.localeCompare(right.itemId));
}

/**
 * Persist the nonce hash and immutable authorization snapshot before files or a
 * child process exist. A later retry must use a new job run and cannot reuse it.
 */
export function prepareVaultJobRun(
  projectId: string,
  input: {
    runId: string;
    jobId: string;
    deadlineAt: number;
    processNonceHash: string;
    itemSnapshots: readonly VaultJobRunItemSnapshot[];
  },
): VaultSecretRunRecovery | undefined {
  const snapshots = normalizeVaultRunSnapshots(input.itemSnapshots);
  if (!UUID_PATTERN.test(input.runId) || !UUID_PATTERN.test(input.jobId)
    || !Number.isSafeInteger(input.deadlineAt) || input.deadlineAt <= 0
    || !SHA256_PATTERN.test(input.processNonceHash) || !snapshots) return undefined;

  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const run = db.prepare(
      `SELECT id FROM job_runs WHERE id = ? AND project_id = ? AND job_id = ? AND status = 'running'`,
    ).get(input.runId, projectId, input.jobId);
    if (!run) return undefined;
    const references = db.prepare(
      `SELECT reference.item_id, reference.authorized_item_version, item.version, item.access_policy
       FROM job_vault_references reference
       JOIN vault_items item ON item.project_id = reference.project_id AND item.id = reference.item_id
       WHERE reference.project_id = ? AND reference.job_id = ? AND reference.status = 'authorized'
       ORDER BY reference.item_id ASC`,
    ).all(projectId, input.jobId) as Array<{
      item_id: string; authorized_item_version: number; version: number; access_policy: string;
    }>;
    if (references.length !== snapshots.length || references.some((reference, index) => (
      reference.item_id !== snapshots[index]!.itemId
      || reference.authorized_item_version !== snapshots[index]!.authorizedItemVersion
      || reference.version !== snapshots[index]!.authorizedItemVersion
      || reference.access_policy === '{"mode":"deleted"}'
    ))) return undefined;

    const timestamp = new Date().toISOString();
    try {
      db.prepare(
        `INSERT INTO job_vault_runs
         (run_id, project_id, organization_id, job_id, effective_service_principal_id,
          job_revision, authorization_revision, state, deadline_at, process_nonce_hash, prepared_at, updated_at)
         SELECT run.id, run.project_id, run.organization_id, run.job_id, run.effective_service_principal_id,
                run.job_revision, run.authorization_revision, 'prepared', ?, ?, ?, ?
         FROM job_runs run WHERE run.id = ? AND run.project_id = ? AND run.job_id = ?`,
      ).run(input.deadlineAt, input.processNonceHash, timestamp, timestamp, input.runId, projectId, input.jobId);
    } catch {
      return undefined;
    }
    const insert = db.prepare(
      `INSERT INTO job_vault_run_items
       (project_id, organization_id, run_id, job_id, item_id, authorized_item_version, grant_revision, created_at)
       SELECT reference.project_id, reference.organization_id, ?, reference.job_id, reference.item_id,
              ?, reference.grant_revision, ?
       FROM job_vault_references reference
       WHERE reference.project_id = ? AND reference.job_id = ? AND reference.item_id = ?`,
    );
    for (const snapshot of snapshots) {
      insert.run(input.runId, snapshot.authorizedItemVersion, timestamp, projectId, input.jobId, snapshot.itemId);
    }
    const row = db.prepare(
      "SELECT * FROM job_vault_runs WHERE project_id = ? AND run_id = ?",
    ).get(projectId, input.runId) as VaultJobRunRow;
    return vaultRunRecoveryFromRow(db, row);
  });
  if (result) checkpointAfterWrite();
  return result;
}

/** Persist the verified post-spawn identity exactly once using a state CAS. */
export function recordVaultJobRunProcessIdentity(
  projectId: string,
  runId: string,
  input: { processId: number; processGroupId: number; processStartTime: string; processExecutable: string },
): VaultSecretRunRecovery | undefined {
  if (!UUID_PATTERN.test(runId) || !Number.isSafeInteger(input.processId) || input.processId <= 0
    || !Number.isSafeInteger(input.processGroupId) || input.processGroupId <= 0
    || input.processStartTime.length < 1 || input.processStartTime.length > 128
    || input.processExecutable.length < 1 || input.processExecutable.length > 512) return undefined;
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const row = db.prepare(
      "SELECT * FROM job_vault_runs WHERE project_id = ? AND run_id = ?",
    ).get(projectId, runId) as VaultJobRunRow | undefined;
    if (!row) return undefined;
    if (row.process_id !== null) {
      if (row.process_id !== input.processId || row.process_group_id !== input.processGroupId
        || row.process_start_time !== input.processStartTime || row.process_executable !== input.processExecutable) return undefined;
      return vaultRunRecoveryFromRow(db, row);
    }
    if (row.state !== "prepared") return undefined;
    const timestamp = new Date().toISOString();
    const changed = db.prepare(
      `UPDATE job_vault_runs
       SET state = 'spawned', process_id = ?, process_group_id = ?, process_start_time = ?, process_executable = ?,
           spawned_at = ?, updated_at = ?, revision = revision + 1
       WHERE project_id = ? AND run_id = ? AND state = 'prepared' AND process_id IS NULL AND revision = ?`,
    ).run(input.processId, input.processGroupId, input.processStartTime, input.processExecutable,
      timestamp, timestamp, projectId, runId, row.revision);
    if (changed.changes !== 1) return undefined;
    const persisted = db.prepare(
      "SELECT * FROM job_vault_runs WHERE project_id = ? AND run_id = ?",
    ).get(projectId, runId) as VaultJobRunRow;
    return vaultRunRecoveryFromRow(db, persisted);
  });
  if (result) checkpointAfterWrite();
  return result;
}

function transitionVaultJobRun(
  projectId: string,
  runId: string,
  nextState: Exclude<VaultJobRunState, "prepared" | "spawned">,
): VaultSecretRunRecovery | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const row = db.prepare(
      "SELECT * FROM job_vault_runs WHERE project_id = ? AND run_id = ?",
    ).get(projectId, runId) as VaultJobRunRow | undefined;
    if (!row) return undefined;
    if (row.state === nextState) return vaultRunRecoveryFromRow(db, row);
    const timestamp = new Date().toISOString();
    const timestampColumn = nextState === "teardown_pending"
      ? "teardown_started_at" : nextState === "cleaned" ? "cleaned_at" : "failed_at";
    const changed = db.prepare(
      `UPDATE job_vault_runs SET state = ?, ${timestampColumn} = ?, updated_at = ?, revision = revision + 1
       WHERE project_id = ? AND run_id = ? AND revision = ?`,
    ).run(nextState, timestamp, timestamp, projectId, runId, row.revision);
    if (changed.changes !== 1) return undefined;
    const updated = db.prepare(
      "SELECT * FROM job_vault_runs WHERE project_id = ? AND run_id = ?",
    ).get(projectId, runId) as VaultJobRunRow;
    return vaultRunRecoveryFromRow(db, updated);
  });
  if (result) checkpointAfterWrite();
  return result;
}

export function markVaultJobRunTeardownPending(projectId: string, runId: string): VaultSecretRunRecovery | undefined {
  return transitionVaultJobRun(projectId, runId, "teardown_pending");
}

export function markVaultJobRunCleaned(projectId: string, runId: string): VaultSecretRunRecovery | undefined {
  return transitionVaultJobRun(projectId, runId, "cleaned");
}

export function markVaultJobRunFailed(projectId: string, runId: string): VaultSecretRunRecovery | undefined {
  return transitionVaultJobRun(projectId, runId, "failed");
}

/** Resolve immutable run snapshots without consulting mutable job references. */
export function getVaultSecretRunRecovery(runId: string): VaultSecretRunRecovery | undefined {
  const db = getDb(dbPath());
  const row = db.prepare(
    "SELECT * FROM job_vault_runs WHERE run_id = ?",
  ).get(runId) as VaultJobRunRow | undefined;
  return row ? vaultRunRecoveryFromRow(db, row) : undefined;
}

/** Startup/scheduler-only backlog for retained vault run directories. */
export function listVaultSecretRunsForRecovery(): VaultSecretRunRecovery[] {
  const db = getDb(dbPath());
  const rows = db.prepare(
    `SELECT * FROM job_vault_runs WHERE state <> 'cleaned'
     ORDER BY prepared_at ASC, run_id ASC`,
  ).all() as VaultJobRunRow[];
  return rows.map((row) => vaultRunRecoveryFromRow(db, row));
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
      `INSERT INTO job_run_logs (run_id, organization_id, seq, stream, line, created_at)
       SELECT id, organization_id, ?, ?, ?, ? FROM job_runs WHERE id = ? AND project_id = ?`,
    ).run(seq, stream, sanitizeJobEventText(line, 4_096), now, runId, projectId);

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
