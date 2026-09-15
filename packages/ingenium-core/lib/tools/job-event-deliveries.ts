import { createHash, randomBytes, randomUUID } from "node:crypto";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import {
  Job,
  JobEventDelivery,
  JobEventDeliveryState,
  JobRun,
  MAX_CONCURRENT_AUTOMATION_RUNS,
  MAX_CONCURRENT_RUNS_PER_ORGANIZATION,
  MAX_CONCURRENT_RUNS_PER_SERVICE_PRINCIPAL,
  TrustedJobEventType,
} from "../schema.js";

export const JOB_EVENT_DELIVERY_MAX_ATTEMPTS = 5;
export const JOB_EVENT_DELIVERY_BACKOFF_SECONDS = [30, 60, 120, 300, 600] as const;
export const JOB_EVENT_DELIVERY_LEASE_MS = 30_000;
const DELIVERY_PAGE_MAX = 100;

type Db = ReturnType<typeof getDb>;

interface DeliveryRow {
  id: string;
  trusted_event_id: string;
  event_type: TrustedJobEventType;
  job_id: string;
  job_name: string;
  state: JobEventDeliveryState;
  attempt_count: number;
  next_attempt_at: string | null;
  lease_revision: number;
  lease_expires_at: string | null;
  lease_owner_hash: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobEventDeliveryPage {
  data: JobEventDelivery[];
  nextCursor: string | null;
}

export interface JobEventDispatchResult {
  snapshottedEvents: number;
  createdDeliveries: number;
}

export interface JobEventClaim {
  delivery: JobEventDelivery;
  job: Pick<Job, "id" | "project_id" | "organization_id" | "service_principal_id" | "agent" | "prompt_template" | "timeout_minutes">;
  run: JobRun;
  attemptNumber: number;
  leaseRevision: number;
  /** Caller-held only. It is SHA-256 hashed before persistence and is never a DTO field. */
  leaseToken: string;
}

export interface ExpiredJobEventLease {
  projectId: string;
  deliveryId: string;
  leaseRevision: number;
  attemptNumber: number;
  runId: string;
  processId: number | null;
  processGroupId: number | null;
  processStartTime: string | null;
  processExecutable: string | null;
  processNonceHash: string | null;
}

function dbPath(): string {
  return process.env.INGENIUM_CORE_DB_PATH ?? "./data";
}

function now(): string {
  return new Date().toISOString();
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isOpaqueToken(value: unknown): value is string {
  return typeof value === "string" && value.length >= 32 && value.length <= 512 && /^[A-Za-z0-9_-]+$/.test(value);
}

function publicDelivery(row: DeliveryRow): JobEventDelivery {
  const { lease_owner_hash: _ownerHash, ...delivery } = row;
  return {
    ...delivery,
    last_error_code: delivery.last_error_code ? sanitizeErrorCode(delivery.last_error_code) : null,
    last_error_message: delivery.last_error_message ? sanitizeJobEventText(delivery.last_error_message) : null,
  };
}

function deliveryQuery(where: string, order = ""): string {
  return `SELECT d.id, d.trusted_event_id, e.event_type, d.job_id, j.name AS job_name,
                 d.state, d.attempt_count, d.next_attempt_at, d.lease_revision,
                 d.lease_expires_at, d.lease_owner_hash, d.last_error_code,
                 d.last_error_message, d.created_at, d.updated_at
          FROM job_event_deliveries d
          JOIN trusted_job_events e ON e.project_id = d.project_id AND e.id = d.trusted_event_id
          JOIN jobs j ON j.project_id = d.project_id AND j.id = d.job_id
          WHERE ${where} ${order}`;
}

function boundedCursor(cursor: string | undefined): { updatedAt: string; id: string } | undefined {
  if (cursor === undefined) return undefined;
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > 512) throw new Error("INVALID_JOB_EVENT_DELIVERY_CURSOR");
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)
      || decoded.v !== 1 || typeof decoded.updatedAt !== "string" || typeof decoded.id !== "string") {
      throw new Error("invalid cursor");
    }
    return { updatedAt: decoded.updatedAt, id: decoded.id };
  } catch {
    throw new Error("INVALID_JOB_EVENT_DELIVERY_CURSOR");
  }
}

function sanitizeErrorCode(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64) || "job_event_failure";
}

const SENSITIVE_VALUE_NAME = "(?:authorization|proxy[-_ ]?authorization|cookie|set[-_ ]?cookie|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|secret|password|passwd|token|credential(?:s)?)";
const BEARER_OR_BASIC_CREDENTIAL = /\b(Bearer|Basic)\s+[^\s,;]+/gi;
const KEY_VALUE_CREDENTIAL = new RegExp(`\\b(${SENSITIVE_VALUE_NAME})\\b\\s*[:=]\\s*(?:"(?:\\\\.|[^\"])*"|'(?:\\\\.|[^'])*'|[^\\s,;}&]+)`, "gi");
const JSON_CREDENTIAL = new RegExp(`(["']\\s*${SENSITIVE_VALUE_NAME}\\s*["']\\s*:\\s*)(?:"(?:\\\\.|[^\"])*"|'(?:\\\\.|[^'])*'|[^,}\\]\\s]+)`, "gi");
const URL_QUERY_CREDENTIAL = new RegExp(`([?&]\\s*${SENSITIVE_VALUE_NAME}\\s*=)[^&#\\s]*`, "gi");
const MAX_DURABLE_TEXT_LINES = 16;

function truncateUtf8(value: string, maxBytes: number): string {
  let bytes = 0;
  let result = "";
  for (const character of value) {
    const nextBytes = Buffer.byteLength(character, "utf8");
    if (bytes + nextBytes > maxBytes) break;
    result += character;
    bytes += nextBytes;
  }
  return result;
}

/** Keep durable error and log-like text operationally useful without retaining credentials. */
export function sanitizeJobEventText(value: string, maxBytes = 512): string {
  const boundedLines = value.split(/\r\n|\r|\n/).slice(0, MAX_DURABLE_TEXT_LINES).join(" ");
  const redacted = boundedLines
    // Credentials are redacted before generic separators can split their schemes.
    .replace(BEARER_OR_BASIC_CREDENTIAL, "$1 [REDACTED]")
    .replace(KEY_VALUE_CREDENTIAL, "$1=[REDACTED]")
    .replace(JSON_CREDENTIAL, '$1"[REDACTED]"')
    .replace(URL_QUERY_CREDENTIAL, "$1[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+/gi, "[REDACTED]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return truncateUtf8(redacted, Math.max(1, maxBytes));
}

function retryAt(attemptNumber: number, timestamp: string): string {
  const seconds = JOB_EVENT_DELIVERY_BACKOFF_SECONDS[Math.min(attemptNumber - 1, JOB_EVENT_DELIVERY_BACKOFF_SECONDS.length - 1)]!;
  return new Date(new Date(timestamp).getTime() + seconds * 1_000).toISOString();
}

function updateFailureState(
  db: Db,
  projectId: string,
  deliveryId: string,
  attemptNumber: number,
  timestamp: string,
  code: string,
  message: string,
  forceDeadLetter = false,
): "retry_wait" | "dead_letter" {
  const terminal = forceDeadLetter || attemptNumber >= JOB_EVENT_DELIVERY_MAX_ATTEMPTS;
  db.prepare(
    `UPDATE job_event_deliveries
     SET state = ?, next_attempt_at = ?, lease_expires_at = NULL, lease_owner_hash = NULL,
         last_error_code = ?, last_error_message = ?, updated_at = ?
     WHERE project_id = ? AND id = ?`,
  ).run(
    terminal ? "dead_letter" : "retry_wait",
    terminal ? null : retryAt(attemptNumber, timestamp),
    sanitizeErrorCode(code), sanitizeJobEventText(message), timestamp, projectId, deliveryId,
  );
  return terminal ? "dead_letter" : "retry_wait";
}

function reconcileUndeliverableInTransaction(db: Db, projectId: string, timestamp: string): number {
  return db.prepare(
    `UPDATE job_event_deliveries
     SET state = 'dead_letter', next_attempt_at = NULL, lease_expires_at = NULL, lease_owner_hash = NULL,
         last_error_code = 'job_unavailable', last_error_message = 'Job is disabled, deleted, or no longer matches the trusted event.',
         updated_at = ?
     WHERE project_id = ?
       AND state IN ('queued', 'retry_wait')
       AND NOT EXISTS (
         SELECT 1 FROM jobs j
         JOIN trusted_job_events e ON e.project_id = job_event_deliveries.project_id
           AND e.id = job_event_deliveries.trusted_event_id
         WHERE j.project_id = job_event_deliveries.project_id
           AND j.id = job_event_deliveries.job_id
           AND j.enabled = 1
           AND j.trigger_event = e.event_type
       )`,
  ).run(timestamp, projectId).changes;
}

/**
 * Atomically snapshot currently undispatched trusted events and set-fan-out to
 * enabled exact-trigger jobs. The marker is inserted even for zero matches.
 */
export function snapshotTrustedJobEvents(projectId: string, limit = DELIVERY_PAGE_MAX): JobEventDispatchResult {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > DELIVERY_PAGE_MAX) throw new Error("INVALID_JOB_EVENT_DELIVERY_LIMIT");
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const timestamp = now();
    const events = db.prepare(
      `SELECT e.id
       FROM trusted_job_events e
       LEFT JOIN job_event_dispatches s
         ON s.project_id = e.project_id AND s.trusted_event_id = e.id
       WHERE e.project_id = ? AND s.trusted_event_id IS NULL
       ORDER BY e.created_at ASC, e.id ASC LIMIT ?`,
    ).all(projectId, limit) as Array<{ id: string }>;
    let createdDeliveries = 0;
    for (const event of events) {
      const marked = db.prepare(
        `INSERT INTO job_event_dispatches (project_id, organization_id, trusted_event_id, snapshotted_at)
         SELECT project.id, project.organization_id, ?, ? FROM projects project WHERE project.id = ?
         ON CONFLICT(project_id, trusted_event_id) DO NOTHING`,
      ).run(event.id, timestamp, projectId);
      if (marked.changes !== 1) continue;
      createdDeliveries += db.prepare(
         `INSERT INTO job_event_deliveries
          (id, project_id, organization_id, trusted_event_id, job_id, effective_service_principal_id,
           source_actor_type, source_actor_id, job_revision, authorization_revision, state, attempt_count, next_attempt_at,
          lease_revision, lease_expires_at, lease_owner_hash, last_error_code, last_error_message, created_at, updated_at)
         SELECT lower(hex(randomblob(4))) || '-' || substr(lower(hex(randomblob(2))), 1, 4) || '-' ||
                  substr(lower(hex(randomblob(2))), 1, 4) || '-' || substr(lower(hex(randomblob(2))), 1, 4) || '-' ||
                  lower(hex(randomblob(6))),
                 ?, j.organization_id, e.id, j.id, j.service_principal_id, e.source_actor_type, e.source_actor_id,
                 j.revision, grant_row.revision,
                'queued', 0, ?, 0, NULL, NULL, NULL, NULL, ?, ?
         FROM trusted_job_events e
         JOIN jobs j ON j.project_id = e.project_id
           AND j.enabled = 1
           AND j.trigger_event = e.event_type
         JOIN service_principals principal ON principal.id = j.service_principal_id
           AND principal.organization_id = j.organization_id AND principal.status = 'active'
         JOIN automation_principal_grants grant_row ON grant_row.project_id = j.project_id
           AND grant_row.organization_id = j.organization_id AND grant_row.service_principal_id = j.service_principal_id
           AND grant_row.permission = 'execute' AND grant_row.status = 'active'
         WHERE e.project_id = ? AND e.id = ?`,
      ).run(projectId, timestamp, timestamp, timestamp, projectId, event.id).changes;
    }
    return { snapshottedEvents: events.length, createdDeliveries };
  });
  if (result.snapshottedEvents > 0) checkpointAfterWrite();
  return result;
}

export function listJobEventDeliveries(
  projectId: string,
  options: { limit?: number; cursor?: string } = {},
): JobEventDeliveryPage {
  const limit = options.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > DELIVERY_PAGE_MAX) throw new Error("INVALID_JOB_EVENT_DELIVERY_LIMIT");
  const cursor = boundedCursor(options.cursor);
  const db = getDb(dbPath());
  const rows = cursor
    ? db.prepare(deliveryQuery(
      "d.project_id = ? AND (d.updated_at < ? OR (d.updated_at = ? AND d.id < ?))",
      "ORDER BY d.updated_at DESC, d.id DESC LIMIT ?",
    )).all(projectId, cursor.updatedAt, cursor.updatedAt, cursor.id, limit + 1) as DeliveryRow[]
    : db.prepare(deliveryQuery("d.project_id = ?", "ORDER BY d.updated_at DESC, d.id DESC LIMIT ?"))
      .all(projectId, limit + 1) as DeliveryRow[];
  const data = rows.slice(0, limit).map(publicDelivery);
  const tail = data[data.length - 1];
  return {
    data,
    nextCursor: rows.length > limit && tail
      ? Buffer.from(JSON.stringify({ v: 1, updatedAt: tail.updated_at, id: tail.id }), "utf8").toString("base64url")
      : null,
  };
}

export function getJobEventDelivery(projectId: string, deliveryId: string): JobEventDelivery | undefined {
  const row = getDb(dbPath()).prepare(deliveryQuery("d.project_id = ? AND d.id = ?"))
    .get(projectId, deliveryId) as DeliveryRow | undefined;
  return row ? publicDelivery(row) : undefined;
}

export function generateJobEventLeaseToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Claim one eligible delivery and create its event run/attempt in the same transaction. */
export function claimJobEventDelivery(
  projectId: string,
  leaseToken = generateJobEventLeaseToken(),
  leaseMs = JOB_EVENT_DELIVERY_LEASE_MS,
): JobEventClaim | undefined {
  if (!isOpaqueToken(leaseToken) || !Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000) {
    throw new Error("INVALID_JOB_EVENT_LEASE");
  }
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const timestamp = now();
    const changed = reconcileUndeliverableInTransaction(db, projectId, timestamp);
    const project = db.prepare("SELECT organization_id FROM projects WHERE id = ? AND archived_at IS NULL")
      .get(projectId) as { organization_id: string } | undefined;
    if (!project) return { claim: undefined, changed };
    const capacity = db.prepare(
      `SELECT count(*) AS global_count,
              count(*) FILTER (WHERE organization_id = ?) AS organization_count
       FROM job_runs WHERE status IN ('queued', 'running')`,
    ).get(project.organization_id) as { global_count: number; organization_count: number };
    if (capacity.global_count >= MAX_CONCURRENT_AUTOMATION_RUNS
      || capacity.organization_count >= MAX_CONCURRENT_RUNS_PER_ORGANIZATION) {
      return { claim: undefined, changed };
    }
    const candidate = db.prepare(
      `SELECT d.id, d.trusted_event_id, d.job_id, d.attempt_count, d.lease_revision,
              e.event_type, e.source_actor_type, e.source_actor_id,
              j.id AS matched_job_id, j.project_id, j.organization_id, j.service_principal_id,
              j.revision AS job_revision, j.agent, j.prompt_template, j.timeout_minutes,
              grant_row.revision AS authorization_revision
       FROM job_event_deliveries d
       JOIN trusted_job_events e ON e.project_id = d.project_id AND e.id = d.trusted_event_id
       JOIN jobs j ON j.project_id = d.project_id AND j.id = d.job_id
       JOIN service_principals principal ON principal.id = j.service_principal_id
         AND principal.organization_id = j.organization_id AND principal.status = 'active'
       JOIN automation_principal_grants grant_row ON grant_row.project_id = j.project_id
         AND grant_row.organization_id = j.organization_id AND grant_row.service_principal_id = j.service_principal_id
         AND grant_row.permission = 'execute' AND grant_row.status = 'active'
       WHERE d.project_id = ? AND d.state IN ('queued', 'retry_wait')
          AND d.next_attempt_at <= ? AND j.enabled = 1 AND j.trigger_event = e.event_type
          AND d.organization_id = j.organization_id AND d.effective_service_principal_id = j.service_principal_id
          AND d.job_revision = j.revision AND d.authorization_revision = grant_row.revision
         AND (SELECT count(*) FROM job_runs active WHERE active.status IN ('queued', 'running')
              AND active.effective_service_principal_id = d.effective_service_principal_id) < ?
         AND NOT EXISTS (
           SELECT 1 FROM job_runs active
           WHERE active.job_id = d.job_id AND active.status IN ('queued', 'running')
         )
         AND NOT EXISTS (
           SELECT 1 FROM job_event_deliveries active_delivery
           WHERE active_delivery.project_id = d.project_id AND active_delivery.job_id = d.job_id
             AND active_delivery.state = 'leased'
         )
       ORDER BY d.next_attempt_at ASC, d.id ASC LIMIT 1`,
    ).get(projectId, timestamp, MAX_CONCURRENT_RUNS_PER_SERVICE_PRINCIPAL) as {
      id: string; trusted_event_id: string; job_id: string; attempt_count: number; lease_revision: number;
      event_type: TrustedJobEventType; source_actor_type: "compatibility" | "user" | "service" | "system";
      source_actor_id: string | null; matched_job_id: string; project_id: string; organization_id: string;
      service_principal_id: string; job_revision: number; authorization_revision: number; agent: string;
      prompt_template: string; timeout_minutes: number;
    } | undefined;
    if (!candidate) return { claim: undefined, changed };
    const attemptNumber = candidate.attempt_count + 1;
    const leaseRevision = candidate.lease_revision + 1;
    const expiresAt = new Date(Date.now() + leaseMs).toISOString();
    const claimed = db.prepare(
      `UPDATE job_event_deliveries
       SET state = 'leased', attempt_count = ?, next_attempt_at = NULL, lease_revision = ?,
           lease_expires_at = ?, lease_owner_hash = ?, updated_at = ?
       WHERE project_id = ? AND id = ? AND lease_revision = ?
         AND state IN ('queued', 'retry_wait') AND next_attempt_at <= ?`,
    ).run(attemptNumber, leaseRevision, expiresAt, sha256(leaseToken), timestamp,
      projectId, candidate.id, candidate.lease_revision, timestamp);
    if (claimed.changes !== 1) return { claim: undefined, changed };
    const runId = randomUUID();
    db.prepare(
      `INSERT INTO job_runs
       (id, job_id, project_id, organization_id, effective_service_principal_id,
        source_actor_type, source_actor_id, job_revision, authorization_revision,
        status, trigger, started_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', 'event', ?, ?)`,
    ).run(runId, candidate.job_id, projectId, candidate.organization_id, candidate.service_principal_id,
      candidate.source_actor_type, candidate.source_actor_id, candidate.job_revision,
      candidate.authorization_revision, timestamp, timestamp);
    db.prepare(
      `INSERT INTO job_event_attempts
        (id, project_id, organization_id, effective_service_principal_id, source_actor_type, source_actor_id,
         delivery_id, attempt_number, run_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), projectId, candidate.organization_id, candidate.service_principal_id,
      candidate.source_actor_type, candidate.source_actor_id, candidate.id, attemptNumber, runId, timestamp, timestamp);
    const row = db.prepare(deliveryQuery("d.project_id = ? AND d.id = ?"))
      .get(projectId, candidate.id) as DeliveryRow;
    return {
      changed: changed + 1,
      claim: {
        delivery: publicDelivery(row),
        job: {
          id: candidate.job_id,
          project_id: projectId,
          organization_id: candidate.organization_id,
          service_principal_id: candidate.service_principal_id,
          agent: candidate.agent,
          prompt_template: candidate.prompt_template,
          timeout_minutes: candidate.timeout_minutes,
        },
        run: db.prepare("SELECT * FROM job_runs WHERE project_id = ? AND id = ?").get(projectId, runId) as JobRun,
        attemptNumber,
        leaseRevision,
        leaseToken,
      } satisfies JobEventClaim,
    };
  });
  if (result.changed > 0) checkpointAfterWrite();
  return result.claim;
}

/** Claim the oldest eligible delivery using a durable organization round-robin cursor. */
export function claimNextJobEventDelivery(
  leaseToken = generateJobEventLeaseToken(),
  leaseMs = JOB_EVENT_DELIVERY_LEASE_MS,
): JobEventClaim | undefined {
  if (!isOpaqueToken(leaseToken) || !Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000) {
    throw new Error("INVALID_JOB_EVENT_LEASE");
  }
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const timestamp = now();
    const candidate = db.prepare(
      `SELECT d.id, d.project_id, d.organization_id, d.trusted_event_id, d.job_id,
              d.attempt_count, d.lease_revision, e.source_actor_type, e.source_actor_id,
              j.service_principal_id, j.revision AS job_revision, j.agent, j.prompt_template,
              j.timeout_minutes, grant_row.revision AS authorization_revision
       FROM job_event_deliveries d
       JOIN trusted_job_events e ON e.project_id = d.project_id AND e.id = d.trusted_event_id
       JOIN jobs j ON j.project_id = d.project_id AND j.id = d.job_id
       JOIN service_principals principal ON principal.id = j.service_principal_id
         AND principal.organization_id = j.organization_id AND principal.status = 'active'
       JOIN automation_principal_grants grant_row ON grant_row.project_id = j.project_id
         AND grant_row.organization_id = j.organization_id AND grant_row.service_principal_id = j.service_principal_id
         AND grant_row.permission = 'execute' AND grant_row.status = 'active'
       LEFT JOIN automation_dispatch_cursors cursor ON cursor.dispatch_kind = 'event'
       WHERE d.state IN ('queued', 'retry_wait') AND d.next_attempt_at <= ?
         AND j.enabled = 1 AND j.trigger_event = e.event_type
         AND d.organization_id = j.organization_id AND d.effective_service_principal_id = j.service_principal_id
         AND d.job_revision = j.revision AND d.authorization_revision = grant_row.revision
         AND (SELECT count(*) FROM job_runs active WHERE active.status IN ('queued', 'running')) < ?
         AND (SELECT count(*) FROM job_runs active WHERE active.status IN ('queued', 'running')
              AND active.organization_id = d.organization_id) < ?
         AND (SELECT count(*) FROM job_runs active WHERE active.status IN ('queued', 'running')
              AND active.effective_service_principal_id = d.effective_service_principal_id) < ?
         AND NOT EXISTS (SELECT 1 FROM job_runs active WHERE active.job_id = d.job_id AND active.status IN ('queued', 'running'))
         AND NOT EXISTS (SELECT 1 FROM job_event_deliveries active_delivery
                         WHERE active_delivery.job_id = d.job_id AND active_delivery.state = 'leased')
       ORDER BY CASE WHEN cursor.last_organization_id IS NULL OR d.organization_id > cursor.last_organization_id THEN 0 ELSE 1 END,
                d.organization_id, d.next_attempt_at, d.id LIMIT 1`,
    ).get(timestamp, MAX_CONCURRENT_AUTOMATION_RUNS, MAX_CONCURRENT_RUNS_PER_ORGANIZATION,
      MAX_CONCURRENT_RUNS_PER_SERVICE_PRINCIPAL) as {
      id: string; project_id: string; organization_id: string; trusted_event_id: string; job_id: string;
      attempt_count: number; lease_revision: number; source_actor_type: "compatibility" | "user" | "service" | "system";
      source_actor_id: string | null; service_principal_id: string; job_revision: number; authorization_revision: number;
      agent: string; prompt_template: string; timeout_minutes: number;
    } | undefined;
    if (!candidate) return undefined;
    const attemptNumber = candidate.attempt_count + 1;
    const leaseRevision = candidate.lease_revision + 1;
    const claimed = db.prepare(
      `UPDATE job_event_deliveries SET state = 'leased', attempt_count = ?, next_attempt_at = NULL,
         lease_revision = ?, lease_expires_at = ?, lease_owner_hash = ?, updated_at = ?
       WHERE id = ? AND project_id = ? AND lease_revision = ? AND state IN ('queued', 'retry_wait') AND next_attempt_at <= ?`,
    ).run(attemptNumber, leaseRevision, new Date(Date.now() + leaseMs).toISOString(), sha256(leaseToken), timestamp,
      candidate.id, candidate.project_id, candidate.lease_revision, timestamp);
    if (claimed.changes !== 1) return undefined;
    const runId = randomUUID();
    db.prepare(
      `INSERT INTO job_runs
       (id, job_id, project_id, organization_id, effective_service_principal_id, source_actor_type,
        source_actor_id, job_revision, authorization_revision, status, trigger, started_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', 'event', ?, ?)`,
    ).run(runId, candidate.job_id, candidate.project_id, candidate.organization_id, candidate.service_principal_id,
      candidate.source_actor_type, candidate.source_actor_id, candidate.job_revision, candidate.authorization_revision,
      timestamp, timestamp);
    db.prepare(
      `INSERT INTO job_event_attempts
        (id, project_id, organization_id, effective_service_principal_id, source_actor_type, source_actor_id,
         delivery_id, attempt_number, run_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), candidate.project_id, candidate.organization_id, candidate.service_principal_id,
      candidate.source_actor_type, candidate.source_actor_id, candidate.id, attemptNumber, runId, timestamp, timestamp);
    db.prepare(
      `INSERT INTO automation_dispatch_cursors (dispatch_kind, last_organization_id, last_claimed_at)
       VALUES ('event', ?, ?)
       ON CONFLICT(dispatch_kind) DO UPDATE SET last_organization_id = excluded.last_organization_id,
         last_claimed_at = excluded.last_claimed_at, revision = automation_dispatch_cursors.revision + 1`,
    ).run(candidate.organization_id, timestamp);
    const row = db.prepare(deliveryQuery("d.project_id = ? AND d.id = ?"))
      .get(candidate.project_id, candidate.id) as DeliveryRow;
    return {
      delivery: publicDelivery(row),
      job: {
        id: candidate.job_id, project_id: candidate.project_id, organization_id: candidate.organization_id,
        service_principal_id: candidate.service_principal_id, agent: candidate.agent,
        prompt_template: candidate.prompt_template, timeout_minutes: candidate.timeout_minutes,
      },
      run: db.prepare("SELECT * FROM job_runs WHERE project_id = ? AND id = ?").get(candidate.project_id, runId) as JobRun,
      attemptNumber, leaseRevision, leaseToken,
    } satisfies JobEventClaim;
  });
  if (result) checkpointAfterWrite();
  return result;
}

/** Only an unexpired current owner can extend its lease; expired leases cannot resurrect. */
export function heartbeatJobEventDelivery(
  projectId: string,
  deliveryId: string,
  leaseToken: string,
  leaseRevision: number,
  leaseMs = JOB_EVENT_DELIVERY_LEASE_MS,
): boolean {
  if (!isOpaqueToken(leaseToken) || !Number.isSafeInteger(leaseRevision) || leaseRevision < 1) return false;
  const changed = execTransaction(() => {
    const db = getDb(dbPath());
    const timestamp = now();
    return db.prepare(
      `UPDATE job_event_deliveries SET lease_expires_at = ?, updated_at = ?
       WHERE project_id = ? AND id = ? AND state = 'leased' AND lease_revision = ?
         AND lease_owner_hash = ? AND lease_expires_at > ?`,
    ).run(new Date(Date.now() + leaseMs).toISOString(), timestamp, projectId, deliveryId,
      leaseRevision, sha256(leaseToken), timestamp).changes === 1;
  });
  if (changed) checkpointAfterWrite();
  return changed;
}

/** Persist only hash-based, procfs-verifiable process evidence after a verified spawn. */
export function persistJobEventAttemptProcessIdentity(
  projectId: string,
  input: {
    deliveryId: string; attemptNumber: number; runId: string; leaseToken: string; leaseRevision: number;
    processId: number; processGroupId: number; processStartTime: string; processExecutable: string; processNonce: string;
  },
): boolean {
  if (!isOpaqueToken(input.leaseToken)
    || !Number.isSafeInteger(input.attemptNumber) || input.attemptNumber < 1 || input.attemptNumber > JOB_EVENT_DELIVERY_MAX_ATTEMPTS
    || !Number.isSafeInteger(input.processId) || input.processId <= 0
    || !Number.isSafeInteger(input.processGroupId) || input.processGroupId <= 0
    || input.processStartTime.length === 0 || input.processStartTime.length > 128
    || input.processExecutable.length === 0 || input.processExecutable.length > 512
    || input.processNonce.length === 0 || input.processNonce.length > 512) return false;
  const changed = execTransaction(() => {
    const db = getDb(dbPath());
    const timestamp = now();
    const owned = db.prepare(
      `SELECT 1 FROM job_event_deliveries
       WHERE project_id = ? AND id = ? AND state = 'leased' AND lease_revision = ?
         AND lease_owner_hash = ? AND lease_expires_at > ?`,
    ).get(projectId, input.deliveryId, input.leaseRevision, sha256(input.leaseToken), timestamp);
    if (!owned) return false;
    return db.prepare(
      `UPDATE job_event_attempts
       SET process_id = ?, process_group_id = ?, process_start_time = ?, process_executable = ?,
           process_nonce_hash = ?, updated_at = ?
       WHERE project_id = ? AND delivery_id = ? AND attempt_number = ? AND run_id = ?
         AND process_id IS NULL`,
    ).run(input.processId, input.processGroupId, input.processStartTime, input.processExecutable,
      sha256(input.processNonce), timestamp, projectId, input.deliveryId, input.attemptNumber, input.runId).changes === 1;
  });
  if (changed) checkpointAfterWrite();
  return changed;
}

export function completeJobEventDelivery(
  projectId: string,
  input: {
    deliveryId: string; attemptNumber: number; runId: string; leaseToken: string; leaseRevision: number;
    outcome: "success" | "failed" | "timeout" | "cancelled";
    exitCode: number | null; errorCode?: string; errorMessage?: string;
  },
): JobEventDelivery | undefined {
  if (!isOpaqueToken(input.leaseToken)) return undefined;
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const timestamp = now();
    const owned = db.prepare(
      `SELECT attempt_count FROM job_event_deliveries
       WHERE project_id = ? AND id = ? AND state = 'leased' AND lease_revision = ?
         AND lease_owner_hash = ? AND lease_expires_at > ?`,
    ).get(projectId, input.deliveryId, input.leaseRevision, sha256(input.leaseToken), timestamp) as { attempt_count: number } | undefined;
    if (!owned || owned.attempt_count !== input.attemptNumber) return undefined;
    const attempt = db.prepare(
      `SELECT id FROM job_event_attempts
       WHERE project_id = ? AND delivery_id = ? AND attempt_number = ? AND run_id = ?`,
    ).get(projectId, input.deliveryId, input.attemptNumber, input.runId) as { id: string } | undefined;
    if (!attempt) {
      updateFailureState(
        db, projectId, input.deliveryId, input.attemptNumber, timestamp,
        "provenance_conflict", "Attempt provenance did not match the leased delivery.", true,
      );
      return db.prepare(deliveryQuery("d.project_id = ? AND d.id = ?")).get(projectId, input.deliveryId) as DeliveryRow;
    }
    const stillDeliverable = db.prepare(
      `SELECT 1 FROM job_event_deliveries delivery
       JOIN jobs job ON job.project_id = delivery.project_id AND job.id = delivery.job_id
       JOIN trusted_job_events event ON event.project_id = delivery.project_id AND event.id = delivery.trusted_event_id
       WHERE delivery.project_id = ? AND delivery.id = ?
         AND job.enabled = 1 AND job.trigger_event = event.event_type`,
    ).get(projectId, input.deliveryId);
    if (!stillDeliverable) {
      db.prepare(
        `UPDATE job_runs SET status = 'failed', finished_at = ?, exit_code = ?
         WHERE project_id = ? AND id = ? AND status IN ('queued', 'running')`,
      ).run(timestamp, input.exitCode, projectId, input.runId);
      updateFailureState(
        db, projectId, input.deliveryId, input.attemptNumber, timestamp,
        "job_unavailable", "Job is disabled, deleted, or no longer matches the trusted event.", true,
      );
      return db.prepare(deliveryQuery("d.project_id = ? AND d.id = ?")).get(projectId, input.deliveryId) as DeliveryRow;
    }
    db.prepare(
      `UPDATE job_runs SET status = ?, finished_at = ?, exit_code = ?
       WHERE project_id = ? AND id = ? AND status IN ('queued', 'running')`,
    ).run(input.outcome === "success" ? "success" : input.outcome, timestamp, input.exitCode, projectId, input.runId);
    if (input.outcome === "success") {
      db.prepare(
        `UPDATE job_event_deliveries
         SET state = 'succeeded', next_attempt_at = NULL, lease_expires_at = NULL, lease_owner_hash = NULL,
             last_error_code = NULL, last_error_message = NULL, updated_at = ?
         WHERE project_id = ? AND id = ?`,
      ).run(timestamp, projectId, input.deliveryId);
    } else {
      updateFailureState(db, projectId, input.deliveryId, input.attemptNumber, timestamp,
        input.errorCode ?? input.outcome, input.errorMessage ?? "Event job attempt failed.",
        input.errorCode === "provenance_conflict" || input.errorCode === "ambiguous_process_ownership");
    }
    return db.prepare(deliveryQuery("d.project_id = ? AND d.id = ?")).get(projectId, input.deliveryId) as DeliveryRow;
  });
  if (result) checkpointAfterWrite();
  return result ? publicDelivery(result) : undefined;
}

/** Scheduler-only view. It intentionally exposes hashes but never plaintext nonces or lease tokens. */
export function listExpiredJobEventLeases(projectId: string, limit = DELIVERY_PAGE_MAX): ExpiredJobEventLease[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > DELIVERY_PAGE_MAX) throw new Error("INVALID_JOB_EVENT_DELIVERY_LIMIT");
  const timestamp = now();
  return getDb(dbPath()).prepare(
    `SELECT d.project_id AS projectId, d.id AS deliveryId, d.lease_revision AS leaseRevision,
            d.attempt_count AS attemptNumber, a.run_id AS runId, a.process_id AS processId,
            a.process_group_id AS processGroupId, a.process_start_time AS processStartTime,
            a.process_executable AS processExecutable, a.process_nonce_hash AS processNonceHash
     FROM job_event_deliveries d
     LEFT JOIN job_event_attempts a ON a.project_id = d.project_id AND a.delivery_id = d.id
       AND a.attempt_number = d.attempt_count
     WHERE d.project_id = ? AND d.state = 'leased' AND d.lease_expires_at <= ?
     ORDER BY d.lease_expires_at ASC, d.id ASC LIMIT ?`,
  ).all(projectId, timestamp, limit) as ExpiredJobEventLease[];
}

/** Resolve a lease only after the API runner has proved the previous process absent or unsafe. */
export function resolveExpiredJobEventLease(
  projectId: string,
  input: { deliveryId: string; leaseRevision: number; attemptNumber: number; runId: string; resolution: "retry" | "dead_letter"; errorCode: string; errorMessage: string },
): JobEventDelivery | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const timestamp = now();
    const lease = db.prepare(
      `SELECT d.attempt_count, a.process_id AS processId, a.process_group_id AS processGroupId,
              a.process_start_time AS processStartTime, a.process_executable AS processExecutable,
              a.process_nonce_hash AS processNonceHash
       FROM job_event_deliveries d
       LEFT JOIN job_event_attempts a
         ON a.project_id = d.project_id AND a.delivery_id = d.id AND a.attempt_number = d.attempt_count
       WHERE d.project_id = ? AND d.id = ? AND d.state = 'leased' AND d.lease_revision = ? AND d.lease_expires_at <= ?`,
    ).get(projectId, input.deliveryId, input.leaseRevision, timestamp) as (Pick<ExpiredJobEventLease,
      "processId" | "processGroupId" | "processStartTime" | "processExecutable" | "processNonceHash"> & { attempt_count: number }) | undefined;
    if (!lease || lease.attempt_count !== input.attemptNumber) return undefined;
    db.prepare(
      `UPDATE job_runs SET status = 'failed', finished_at = ?, exit_code = -1
       WHERE project_id = ? AND id = ? AND status IN ('queued', 'running')`,
    ).run(timestamp, projectId, input.runId);
    const hasCompleteProcessIdentity = lease.processId !== null && lease.processGroupId !== null
      && !!lease.processStartTime && !!lease.processExecutable && !!lease.processNonceHash;
    if (input.resolution === "dead_letter" || input.attemptNumber >= JOB_EVENT_DELIVERY_MAX_ATTEMPTS || !hasCompleteProcessIdentity) {
      db.prepare(
        `UPDATE job_event_deliveries
         SET state = 'dead_letter', next_attempt_at = NULL, lease_expires_at = NULL, lease_owner_hash = NULL,
             last_error_code = ?, last_error_message = ?, updated_at = ?
         WHERE project_id = ? AND id = ?`,
      ).run(
        sanitizeErrorCode(hasCompleteProcessIdentity ? input.errorCode : "ambiguous_process_identity"),
        sanitizeJobEventText(hasCompleteProcessIdentity ? input.errorMessage : "Lease expired without complete process identity evidence."),
        timestamp,
        projectId,
        input.deliveryId,
      );
    } else {
      updateFailureState(db, projectId, input.deliveryId, input.attemptNumber, timestamp, input.errorCode, input.errorMessage);
    }
    return db.prepare(deliveryQuery("d.project_id = ? AND d.id = ?")).get(projectId, input.deliveryId) as DeliveryRow;
  });
  if (result) checkpointAfterWrite();
  return result ? publicDelivery(result) : undefined;
}
