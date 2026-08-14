import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import { createOrganization } from "../lib/tools/organizations.js";
import { createJob, deleteJob, getRunLogs } from "../lib/tools/jobs.js";
import {
  appendContextMessage,
  archiveContextConversation,
  authorizeContextMaintenanceAction,
  createContextCheckpoint,
  createContextConversation,
  restoreContextCheckpoint,
  unarchiveContextConversation,
} from "../lib/tools/context-conversations.js";
import {
  claimJobEventDelivery,
  claimNextJobEventDelivery,
  completeJobEventDelivery,
  generateJobEventLeaseToken,
  getJobEventDelivery,
  heartbeatJobEventDelivery,
  JOB_EVENT_DELIVERY_BACKOFF_SECONDS,
  listExpiredJobEventLeases,
  listJobEventDeliveries,
  persistJobEventAttemptProcessIdentity,
  resolveExpiredJobEventLease,
  sanitizeJobEventText,
  snapshotTrustedJobEvents,
} from "../lib/tools/job-event-deliveries.js";

let directory = "";
const originalPath = process.env.INGENIUM_CORE_DB_PATH;

function setup() {
  directory = mkdtempSync(join(tmpdir(), "ingenium-job-event-deliveries-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  resetDbForTest();
  return {
    db: getDb(process.env.INGENIUM_CORE_DB_PATH),
    first: createProject("event-delivery-first"),
    second: createProject("event-delivery-second"),
  };
}

function contextFixture(projectId: string) {
  const conversation = createContextConversation(projectId, { title: "Event delivery fixture" });
  appendContextMessage(projectId, conversation.id, {
    role: "user",
    content: "Only immutable event metadata is dispatched.",
    expectedRevision: 0,
  });
  return { conversation, checkpoint: createContextCheckpoint(projectId, conversation.id, { expectedRevision: 1 }) };
}

function emitAllTrustedEvents(
  projectId: string,
  provenance: Parameters<typeof authorizeContextMaintenanceAction>[3] = { actorType: "compatibility" },
) {
  const { conversation, checkpoint } = contextFixture(projectId);
  const archive = authorizeContextMaintenanceAction(projectId, conversation.id, {
    operation: "archive_conversation", expectedRevision: 1,
  }, provenance);
  archiveContextConversation(projectId, conversation.id, { expectedRevision: 1, confirmationToken: archive.confirmationToken });
  const unarchive = authorizeContextMaintenanceAction(projectId, conversation.id, {
    operation: "unarchive_conversation", expectedRevision: 1,
  }, provenance);
  unarchiveContextConversation(projectId, conversation.id, { expectedRevision: 1, confirmationToken: unarchive.confirmationToken });
  const restore = authorizeContextMaintenanceAction(projectId, conversation.id, {
    operation: "restore_checkpoint", checkpointId: checkpoint.checkpoint.id, expectedRevision: 1,
  }, provenance);
  restoreContextCheckpoint(projectId, conversation.id, checkpoint.checkpoint.id, {
    expectedRevision: 1, confirmationToken: restore.confirmationToken, idempotencyKey: "event-delivery-restore",
  });
}

afterEach(() => {
  resetDbForTest();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
  if (originalPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalPath;
});

describe("JOB-101 trusted event delivery queue", () => {
  it("installs strict queue/provenance schema on fresh databases", () => {
    const { db } = setup();
    expect(db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'job_event_%' ORDER BY name",
    ).all()).toEqual([
      { name: "job_event_attempts" },
      { name: "job_event_deliveries" },
      { name: "job_event_dispatches" },
    ]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("snapshots each of the three catalog events once and fans out only exact enabled same-project jobs", () => {
    const { first, second } = setup();
    for (const eventType of [
      "context.conversation.archived",
      "context.conversation.unarchived",
      "context.checkpoint.restored_as_new",
    ] as const) {
      createJob(first.id, eventType, undefined, "agent", "prompt", undefined, eventType);
    }
    createJob(first.id, "disabled", undefined, "agent", "prompt", undefined, "context.conversation.archived");
    const disabled = createJob(first.id, "also disabled", undefined, "agent", "prompt", undefined, "context.conversation.archived");
    createJob(second.id, "foreign", undefined, "agent", "prompt", undefined, "context.conversation.archived");
    getDb().prepare("UPDATE jobs SET enabled = 0, revision = revision + 1 WHERE id = ?").run(disabled.id);
    emitAllTrustedEvents(first.id);

    expect(snapshotTrustedJobEvents(first.id)).toEqual({ snapshottedEvents: 3, createdDeliveries: 4 });
    const deliveries = listJobEventDeliveries(first.id, { limit: 100 }).data;
    expect(deliveries).toHaveLength(4);
    expect(deliveries.map((delivery) => delivery.event_type).sort()).toEqual([
      "context.checkpoint.restored_as_new",
      "context.conversation.archived",
      "context.conversation.archived",
      "context.conversation.unarchived",
    ]);
    expect(listJobEventDeliveries(second.id, { limit: 100 }).data).toEqual([]);
    expect(snapshotTrustedJobEvents(first.id)).toEqual({ snapshottedEvents: 0, createdDeliveries: 0 });
  });

  it("keeps a zero-match snapshot durable so later jobs do not backfill old events", () => {
    const { first } = setup();
    emitAllTrustedEvents(first.id);
    expect(snapshotTrustedJobEvents(first.id)).toEqual({ snapshottedEvents: 3, createdDeliveries: 0 });
    createJob(first.id, "later", undefined, "agent", "prompt", undefined, "context.conversation.archived");
    expect(snapshotTrustedJobEvents(first.id)).toEqual({ snapshottedEvents: 0, createdDeliveries: 0 });
    expect(listJobEventDeliveries(first.id, { limit: 100 }).data).toEqual([]);

    const dbPath = process.env.INGENIUM_CORE_DB_PATH!;
    resetDbForTest();
    expect(getDb(dbPath).prepare("SELECT COUNT(*) AS count FROM job_event_dispatches WHERE project_id = ?").get(first.id))
      .toEqual({ count: 3 });
  });

  it("rejects deletion during a leased event attempt, then deletes atomically after it completes", () => {
    const { first } = setup();
    const job = createJob(first.id, "archive", undefined, "agent", "prompt", undefined, "context.conversation.archived");
    emitAllTrustedEvents(first.id);
    snapshotTrustedJobEvents(first.id);
    const claim = claimJobEventDelivery(first.id)!;

    expect(deleteJob(first.id, job.id, job.revision)).toEqual({ status: "active_delivery" });
    expect(getJobEventDelivery(first.id, claim.delivery.id)).toMatchObject({ state: "leased" });
    expect(getDb().prepare("SELECT enabled, deleted_at FROM jobs WHERE id = ?").get(job.id)).toMatchObject({ enabled: 1, deleted_at: null });

    expect(completeJobEventDelivery(first.id, {
      deliveryId: claim.delivery.id,
      attemptNumber: claim.attemptNumber,
      runId: claim.run.id,
      leaseToken: claim.leaseToken,
      leaseRevision: claim.leaseRevision,
      outcome: "cancelled",
      exitCode: -1,
      errorCode: "cancelled",
      errorMessage: "Attempt cancelled before deletion.",
    })?.state).toBe("retry_wait");

    expect(deleteJob(first.id, job.id, job.revision)).toEqual({ status: "deleted" });
    const delivery = listJobEventDeliveries(first.id, { limit: 100 }).data.find((item) => item.job_id === job.id)!;
    expect(delivery).toMatchObject({ state: "dead_letter", attempt_count: 1, last_error_code: "job_deleted" });
    expect(getDb().prepare("SELECT enabled, deleted_at FROM jobs WHERE id = ?").get(job.id)).toMatchObject({ enabled: 0 });
    expect(getDb().prepare("SELECT status FROM job_runs WHERE id = ?").get(claim.run.id)).toEqual({ status: "cancelled" });
  });

  it("makes dispatch markers and attempt linkage immutable under direct SQL", () => {
    const { db, first } = setup();
    createJob(first.id, "archive", undefined, "agent", "prompt", undefined, "context.conversation.archived");
    emitAllTrustedEvents(first.id);
    expect(snapshotTrustedJobEvents(first.id)).toEqual({ snapshottedEvents: 3, createdDeliveries: 1 });
    const claim = claimJobEventDelivery(first.id)!;

    expect(() => db.prepare("UPDATE job_event_dispatches SET snapshotted_at = ? WHERE project_id = ?").run("tampered", first.id))
      .toThrow(/immutable/);
    expect(() => db.prepare("DELETE FROM job_event_dispatches WHERE project_id = ?").run(first.id))
      .toThrow(/immutable/);
    expect(() => db.prepare("UPDATE job_event_attempts SET attempt_number = attempt_number + 1 WHERE run_id = ?").run(claim.run.id))
      .toThrow(/linkage.*immutable/);
    expect(snapshotTrustedJobEvents(first.id)).toEqual({ snapshottedEvents: 0, createdDeliveries: 0 });
    expect(getJobEventDelivery(first.id, claim.delivery.id)).toMatchObject({ state: "leased", attempt_count: 1 });
  });

  it("redacts credential-shaped durable text before bounded storage", () => {
    const sanitized = sanitizeJobEventText(
      "Bearer bearer-secret Basic QmFzaWM6c2VjcmV0 API Key = api-secret Authorization : Bearer auth-secret "
      + '{"outer":{"PaSsWoRd":"json-secret"}} https://example.test/?access_token=url-secret&safe=ok',
    );
    for (const secret of ["bearer-secret", "QmFzaWM6c2VjcmV0", "api-secret", "auth-secret", "json-secret", "url-secret"]) {
      expect(sanitized).not.toContain(secret);
    }
    expect(sanitized).toContain("[REDACTED]");
    expect(Buffer.byteLength(sanitizeJobEventText("safe ".repeat(100), 64), "utf8")).toBeLessThanOrEqual(64);
    expect(sanitizeJobEventText(Array.from({ length: 20 }, (_, index) => `line-${index}`).join("\n"))).not.toContain("line-16");
  });

  it("claims atomically, persists only hashes, requires the current owner, and records one event attempt/run", () => {
    const { db, first, second } = setup();
    createJob(first.id, "archive", undefined, "agent", "prompt", undefined, "context.conversation.archived");
    const actorId = randomUUID();
    emitAllTrustedEvents(first.id, { actorType: "user", actorId });
    snapshotTrustedJobEvents(first.id);
    const claim = claimJobEventDelivery(first.id, generateJobEventLeaseToken())!;
    expect(claim.delivery.state).toBe("leased");
    expect(claimJobEventDelivery(first.id, generateJobEventLeaseToken())).toBeUndefined();
    expect(heartbeatJobEventDelivery(first.id, claim.delivery.id, "wrong-token-wrong-token-wrong-token-wrong", claim.leaseRevision)).toBe(false);
    expect(heartbeatJobEventDelivery(first.id, claim.delivery.id, claim.leaseToken, claim.leaseRevision)).toBe(true);
    expect(persistJobEventAttemptProcessIdentity(first.id, {
      deliveryId: claim.delivery.id,
      attemptNumber: claim.attemptNumber,
      runId: claim.run.id,
      leaseToken: claim.leaseToken,
      leaseRevision: claim.leaseRevision,
      processId: 123,
      processGroupId: 123,
      processStartTime: "1234",
      processExecutable: "/usr/bin/opencode",
      processNonce: "process-nonce-not-persisted",
    })).toBe(true);
    expect(db.prepare(
      "SELECT lease_owner_hash FROM job_event_deliveries WHERE id = ?",
    ).get(claim.delivery.id)).not.toMatchObject({ lease_owner_hash: claim.leaseToken });
    expect(db.prepare(
      "SELECT process_nonce_hash FROM job_event_attempts WHERE project_id = ? AND run_id = ?",
    ).get(first.id, claim.run.id)).not.toMatchObject({ process_nonce_hash: "process-nonce-not-persisted" });
    expect(db.prepare(
      `SELECT delivery.source_actor_type AS delivery_actor_type, delivery.source_actor_id AS delivery_actor_id,
              attempt.organization_id, attempt.effective_service_principal_id,
              attempt.source_actor_type, attempt.source_actor_id,
              run.source_actor_type AS run_actor_type, run.source_actor_id AS run_actor_id
       FROM job_event_attempts attempt JOIN job_runs run ON run.id = attempt.run_id
       JOIN job_event_deliveries delivery ON delivery.id = attempt.delivery_id
       WHERE attempt.project_id = ? AND attempt.run_id = ?`,
    ).get(first.id, claim.run.id)).toEqual({
      organization_id: first.organization_id,
      effective_service_principal_id: claim.job.service_principal_id,
      delivery_actor_type: "user",
      delivery_actor_id: actorId,
      source_actor_type: "user",
      source_actor_id: actorId,
      run_actor_type: "user",
      run_actor_id: actorId,
    });
    expect(completeJobEventDelivery(second.id, {
      ...claim,
      deliveryId: claim.delivery.id,
      runId: claim.run.id,
      outcome: "success",
      exitCode: 0,
    } as never)).toBeUndefined();
    expect(completeJobEventDelivery(first.id, {
      deliveryId: claim.delivery.id,
      attemptNumber: claim.attemptNumber,
      runId: claim.run.id,
      leaseToken: claim.leaseToken,
      leaseRevision: claim.leaseRevision,
      outcome: "success",
      exitCode: 0,
    })?.state).toBe("succeeded");
    expect(getJobEventDelivery(first.id, claim.delivery.id)?.lease_expires_at).toBeNull();
  });

  it("round-robins durable claims across organizations instead of draining one project", () => {
    const { db, first } = setup();
    const secondOrganization = createOrganization("Event delivery second org", "event-delivery-second-org");
    const second = createProject("event-delivery-second-org-project", false, secondOrganization);
    createJob(first.id, "first one", undefined, "agent", "prompt", undefined, "context.conversation.archived");
    createJob(first.id, "first two", undefined, "agent", "prompt", undefined, "context.conversation.archived");
    createJob(second.id, "second", undefined, "agent", "prompt", undefined, "context.conversation.archived");
    emitAllTrustedEvents(first.id);
    emitAllTrustedEvents(second.id);
    snapshotTrustedJobEvents(first.id);
    snapshotTrustedJobEvents(second.id);

    const firstClaim = claimNextJobEventDelivery()!;
    const secondClaim = claimNextJobEventDelivery()!;

    expect(firstClaim.job.organization_id).not.toBe(secondClaim.job.organization_id);
    expect(db.prepare("SELECT last_organization_id FROM automation_dispatch_cursors WHERE dispatch_kind = 'event'").get())
      .toEqual({ last_organization_id: secondClaim.job.organization_id });
  });

  it("applies the same organization quota to project-scoped claims", () => {
    const { first } = setup();
    createJob(first.id, "first", undefined, "agent", "prompt", undefined, "context.conversation.archived");
    createJob(first.id, "second", undefined, "agent", "prompt", undefined, "context.conversation.archived");
    emitAllTrustedEvents(first.id);
    snapshotTrustedJobEvents(first.id);

    expect(claimJobEventDelivery(first.id)).toBeDefined();
    expect(claimJobEventDelivery(first.id)).toBeUndefined();
  });

  it("retries with bounded durable backoff and dead-letters the fifth failure", () => {
    const { db, first } = setup();
    createJob(first.id, "archive", undefined, "agent", "prompt", undefined, "context.conversation.archived");
    emitAllTrustedEvents(first.id);
    snapshotTrustedJobEvents(first.id);
    let deliveryId = "";
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const claim = claimJobEventDelivery(first.id)!;
      deliveryId = claim.delivery.id;
      const completed = completeJobEventDelivery(first.id, {
        deliveryId,
        attemptNumber: claim.attemptNumber,
        runId: claim.run.id,
        leaseToken: claim.leaseToken,
        leaseRevision: claim.leaseRevision,
        outcome: "failed",
        exitCode: 1,
        errorCode: "nonzero_exit",
        errorMessage: "token=do-not-retain\nfailed",
      })!;
      if (attempt < 5) {
        expect(completed.state).toBe("retry_wait");
        expect(completed.last_error_message).toContain("token=[REDACTED]");
        const base = new Date(completed.updated_at).getTime();
        const next = new Date(completed.next_attempt_at!).getTime();
        expect(next - base).toBe(JOB_EVENT_DELIVERY_BACKOFF_SECONDS[attempt - 1]! * 1_000);
        db.prepare("UPDATE job_event_deliveries SET next_attempt_at = ? WHERE id = ?").run(new Date(0).toISOString(), deliveryId);
      } else {
        expect(completed.state).toBe("dead_letter");
      }
    }
    expect(getJobEventDelivery(first.id, deliveryId)?.attempt_count).toBe(5);
  });

  it("recovers a verified absent expired lease without resurrecting a stale owner and scopes run logs by project", () => {
    const { db, first, second } = setup();
    createJob(first.id, "archive", undefined, "agent", "prompt has secret=never-store", undefined, "context.conversation.archived");
    emitAllTrustedEvents(first.id);
    snapshotTrustedJobEvents(first.id);
    const claim = claimJobEventDelivery(first.id)!;
    expect(persistJobEventAttemptProcessIdentity(first.id, {
      deliveryId: claim.delivery.id,
      attemptNumber: claim.attemptNumber,
      runId: claim.run.id,
      leaseToken: claim.leaseToken,
      leaseRevision: claim.leaseRevision,
      processId: 123,
      processGroupId: 123,
      processStartTime: "1234",
      processExecutable: "/usr/bin/opencode",
      processNonce: "process-nonce-not-persisted",
    })).toBe(true);
    db.prepare("UPDATE job_event_deliveries SET lease_expires_at = ? WHERE id = ?").run(new Date(0).toISOString(), claim.delivery.id);
    const expired = listExpiredJobEventLeases(first.id);
    expect(expired).toHaveLength(1);
    expect(resolveExpiredJobEventLease(first.id, {
      deliveryId: claim.delivery.id,
      leaseRevision: claim.leaseRevision,
      attemptNumber: claim.attemptNumber,
      runId: claim.run.id,
      resolution: "retry",
      errorCode: "process_absent",
      errorMessage: "verified absent",
    })?.state).toBe("retry_wait");
    expect(heartbeatJobEventDelivery(first.id, claim.delivery.id, claim.leaseToken, claim.leaseRevision)).toBe(false);
    expect(getRunLogs(second.id, claim.run.id)).toEqual([]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("fails closed when a caller tries to retry an expired lease without process evidence", () => {
    const { db, first } = setup();
    createJob(first.id, "archive", undefined, "agent", "prompt", undefined, "context.conversation.archived");
    emitAllTrustedEvents(first.id);
    snapshotTrustedJobEvents(first.id);
    const claim = claimJobEventDelivery(first.id)!;
    db.prepare("UPDATE job_event_deliveries SET lease_expires_at = ? WHERE id = ?").run(new Date(0).toISOString(), claim.delivery.id);

    expect(resolveExpiredJobEventLease(first.id, {
      deliveryId: claim.delivery.id,
      leaseRevision: claim.leaseRevision,
      attemptNumber: claim.attemptNumber,
      runId: claim.run.id,
      resolution: "retry",
      errorCode: "process_absent",
      errorMessage: "Unsafe retry must not be accepted.",
    })).toMatchObject({ state: "dead_letter", last_error_code: "ambiguous_process_identity" });
    expect(db.prepare("SELECT status, exit_code FROM job_runs WHERE id = ?").get(claim.run.id)).toEqual({ status: "failed", exit_code: -1 });
  });
});
