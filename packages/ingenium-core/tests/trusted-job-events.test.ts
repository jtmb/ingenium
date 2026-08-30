import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject, deleteProject } from "../lib/tools/projects.js";
import {
  appendContextMessage,
  archiveContextConversation,
  authorizeContextMaintenanceAction,
  createContextCheckpoint,
  createContextConversation,
  listContextCheckpointAuditEvents,
  restoreContextCheckpoint,
  unarchiveContextConversation,
} from "../lib/tools/context-conversations.js";
import {
  appendTrustedJobEvent,
  listTrustedJobEvents,
  trustedJobEventFromContextAuditEvent,
} from "../lib/tools/trusted-job-events.js";

let directory = "";
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;

function setup() {
  directory = mkdtempSync(join(tmpdir(), "ingenium-trusted-job-events-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  resetDbForTest();
  const first = createProject("trusted-events-first");
  const second = createProject("trusted-events-second");
  return { db: getDb(process.env.INGENIUM_CORE_DB_PATH), first, second };
}

function contextFixture(projectId: string) {
  const conversation = createContextConversation(projectId, { title: "Trusted event fixture" });
  appendContextMessage(projectId, conversation.id, {
    role: "user",
    content: "Retain only a content-free audit reference.",
    expectedRevision: 0,
  });
  const checkpoint = createContextCheckpoint(projectId, conversation.id, { expectedRevision: 1 });
  return { conversation, checkpoint };
}

function createPre076Database(path: string): void {
  const raw = new Database(path);
  const migrations = resolve(__dirname, "../data/migrations");
  try {
    for (const file of readdirSync(migrations)
      .filter((name) => /^\d{3}_.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 75)
      .sort()) {
      raw.exec(readFileSync(join(migrations, file), "utf8"));
    }
  } finally {
    raw.close();
  }
}

function authorizationId(
  db: Database.Database,
  projectId: string,
  conversationId: string,
  operation: string,
  expectedRevision: number,
  checkpointId: string | null = null,
): string {
  const checkpointClause = checkpointId === null ? "checkpoint_id IS NULL" : "checkpoint_id = ?";
  const parameters = checkpointId === null
    ? [projectId, conversationId, operation, expectedRevision]
    : [projectId, conversationId, operation, expectedRevision, checkpointId];
  const row = db.prepare(
    `SELECT id FROM context_checkpoint_maintenance_authorizations
     WHERE project_id = ? AND conversation_id = ? AND operation = ?
       AND expected_revision = ? AND ${checkpointClause}
     ORDER BY created_at DESC LIMIT 1`,
  ).get(...parameters) as { id: string } | undefined;
  if (!row) throw new Error("Expected maintenance authorization");
  return row.id;
}

function markAuthorizationConsumed(db: Database.Database, projectId: string, authorizationId: string): string {
  const consumedAt = new Date().toISOString();
  const result = db.prepare(
    `UPDATE context_checkpoint_maintenance_authorizations
     SET consumed_at = ?
     WHERE project_id = ? AND id = ? AND consumed_at IS NULL AND expires_at > ?`,
  ).run(consumedAt, projectId, authorizationId, consumedAt);
  if (result.changes !== 1) throw new Error("Expected unconsumed maintenance authorization");
  return consumedAt;
}

function insertFabricatedAudit(
  db: Database.Database,
  input: {
    projectId: string;
    eventType: "conversation_archived" | "conversation_unarchived" | "checkpoint_restored_as_new";
    conversationId: string;
    checkpointId: string | null;
    targetConversationId: string | null;
    expectedRevision: number;
    checkpointStateHash: string | null;
    authorizationId: string;
    archiveSequence: number | null;
    createdAt?: string;
  },
): { id: string; createdAt: string } {
  const id = randomUUID();
  const createdAt = input.createdAt ?? new Date().toISOString();
  const authorization = db.prepare(
    `SELECT organization_id, actor_type, actor_id, delegator_actor_type, delegator_actor_id, request_id, correlation_id
     FROM context_checkpoint_maintenance_authorizations WHERE project_id = ? AND id = ?`,
  ).get(input.projectId, input.authorizationId) as {
    organization_id: string;
    actor_type: string;
    actor_id: string | null;
    delegator_actor_type: string | null;
    delegator_actor_id: string | null;
    request_id: string | null;
    correlation_id: string | null;
  } | undefined;
  const organizationId = authorization?.organization_id
    ?? (db.prepare("SELECT organization_id FROM projects WHERE id = ?").get(input.projectId) as { organization_id: string }).organization_id;
  db.prepare(
    `INSERT INTO context_checkpoint_audit_events
     (id, project_id, organization_id, event_type, conversation_id, checkpoint_id, target_conversation_id,
      expected_revision, checkpoint_state_hash, authorization_id, archive_sequence, source_actor_type,
      source_actor_id, delegator_actor_type, delegator_actor_id, request_id, correlation_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, input.projectId, organizationId, input.eventType, input.conversationId, input.checkpointId,
    input.targetConversationId, input.expectedRevision, input.checkpointStateHash,
    input.authorizationId, input.archiveSequence, authorization?.actor_type ?? "compatibility",
    authorization?.actor_id ?? null, authorization?.delegator_actor_type ?? null,
    authorization?.delegator_actor_id ?? null, authorization?.request_id ?? null,
    authorization?.correlation_id ?? null, createdAt,
  );
  return { id, createdAt };
}

function insertFabricatedTrustedEvent(
  db: Database.Database,
  projectId: string,
  eventType: "context.conversation.archived" | "context.conversation.unarchived" | "context.checkpoint.restored_as_new",
  sourceAuditEventId: string,
  payload: Record<string, string | number>,
  createdAt: string,
): void {
  const project = db.prepare("SELECT organization_id FROM projects WHERE id = ?").get(projectId) as { organization_id: string };
  db.prepare(
    `INSERT INTO trusted_job_events
     (id, project_id, organization_id, source_actor_type, event_type, schema_version,
      producer, source_audit_event_id, dedupe_key, payload, created_at)
     VALUES (?, ?, ?, 'compatibility', ?, 1, 'context.maintenance', ?, ?, ?, ?)`,
  ).run(randomUUID(), projectId, project.organization_id, eventType, sourceAuditEventId,
    sourceAuditEventId, JSON.stringify(payload), createdAt);
}

afterEach(() => {
  resetDbForTest();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
});

describe("migration 076 trusted job events", () => {
  it("installs the complete fresh schema, immutable guards, JSON boundary, and project child protection", () => {
    const { db, first } = setup();
    expect(db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'trusted_job_events'",
    ).get()).toEqual({ count: 1 });
    expect(db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trusted_job_events_%' ORDER BY name",
    ).all()).toEqual([
      { name: "trusted_job_events_automation_scope_insert" },
      { name: "trusted_job_events_context_provenance" },
      { name: "trusted_job_events_immutable_delete" },
      { name: "trusted_job_events_immutable_update" },
      { name: "trusted_job_events_payload_contract" },
    ]);

    const { conversation } = contextFixture(first.id);
    const authorization = authorizeContextMaintenanceAction(first.id, conversation.id, {
      operation: "archive_conversation",
      expectedRevision: 1,
    });
    const archived = archiveContextConversation(first.id, conversation.id, {
      expectedRevision: 1,
      confirmationToken: authorization.confirmationToken,
    });
    const event = listTrustedJobEvents(first.id).data[0]!;
    expect(event).toMatchObject({
      event_type: "context.conversation.archived",
      source_audit_event_id: archived.event.id,
      dedupe_key: archived.event.id,
      schema_version: 1,
      producer: "context.maintenance",
      payload: { conversationId: conversation.id, expectedRevision: 1, archiveSequence: 0 },
    });
    expect(() => db.prepare("UPDATE trusted_job_events SET producer = 'x' WHERE id = ?").run(event.id)).toThrow(/immutable/);
    expect(() => db.prepare("DELETE FROM trusted_job_events WHERE id = ?").run(event.id)).toThrow(/immutable/);
    expect(() => db.prepare(
      `INSERT INTO trusted_job_events
       (id, project_id, organization_id, source_actor_type, event_type, schema_version,
        producer, source_audit_event_id, dedupe_key, payload, created_at)
       VALUES (?, ?, ?, 'compatibility', ?, 1, 'context.maintenance', ?, ?, '{not-json', ?)`,
    ).run(randomUUID(), first.id, first.organization_id, "context.conversation.archived",
      archived.event.id, archived.event.id, archived.event.created_at)).toThrow();
    expect(() => db.prepare(
      `INSERT INTO trusted_job_events
       (id, project_id, organization_id, source_actor_type, event_type, schema_version,
        producer, source_audit_event_id, dedupe_key, payload, created_at)
       VALUES (?, ?, ?, 'compatibility', ?, 1, 'context.maintenance', ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      first.id,
      first.organization_id,
      "context.conversation.archived",
      randomUUID(),
      randomUUID(),
      JSON.stringify({ conversationId: conversation.id, expectedRevision: 1, archiveSequence: 0 }),
      archived.event.created_at,
    )).toThrow();
    expect(deleteProject(first.name)).toMatchObject({
      status: "has_children",
      childTables: expect.arrayContaining(["trusted_job_events"]),
    });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("upgrades existing databases without rewriting legacy job trigger values", () => {
    directory = mkdtempSync(join(tmpdir(), "ingenium-trusted-job-events-upgrade-"));
    const path = join(directory, "legacy.db");
    createPre076Database(path);
    const legacy = new Database(path);
    const projectId = randomUUID();
    const createdAt = "2026-08-02T00:00:00.000Z";
    try {
      legacy.pragma("foreign_keys = ON");
      legacy.prepare(
        "INSERT INTO projects (id, name, path, is_global, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)",
      ).run(projectId, "legacy-trigger-project", "/legacy-trigger-project", createdAt, createdAt);
      legacy.prepare(
        `INSERT INTO jobs
         (id, project_id, name, agent, prompt_template, trigger_event, enabled, timeout_minutes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'legacy.webhook', 1, 30, ?, ?)`,
      ).run(randomUUID(), projectId, "Legacy job", "agent", "prompt", createdAt, createdAt);
    } finally {
      legacy.close();
    }

    process.env.INGENIUM_CORE_DB_PATH = path;
    resetDbForTest();
    const upgraded = getDb(path);
    const legacyJob = upgraded.prepare(
      "SELECT id, trigger_event, organization_id, service_principal_id FROM jobs WHERE project_id = ?",
    ).get(projectId) as { id: string; trigger_event: string; organization_id: string; service_principal_id: string };
    expect(legacyJob.trigger_event).toBe("legacy.webhook");
    expect(upgraded.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'job_event_deliveries'",
    ).get()).toEqual({ count: 1 });
    expect(upgraded.prepare(
      "SELECT count(*) AS count FROM pragma_table_info('job_runs') WHERE name = 'project_id'",
    ).get()).toEqual({ count: 1 });
    expect(() => upgraded.prepare(
      `INSERT INTO jobs
       (id, project_id, organization_id, service_principal_id, name, agent, prompt_template,
        trigger_event, enabled, timeout_minutes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'unknown.event', 1, 30, ?, ?)`,
    ).run(randomUUID(), projectId, legacyJob.organization_id, legacyJob.service_principal_id,
      "Unknown", "agent", "prompt", createdAt, createdAt)).toThrow(/trigger_event/);
    expect(() => upgraded.prepare("UPDATE jobs SET trigger_event = 'unknown.event', revision = revision + 1 WHERE id = ?").run(legacyJob.id)).toThrow(/trigger_event/);
    expect(upgraded.prepare("UPDATE jobs SET name = ?, revision = revision + 1 WHERE id = ?").run("Legacy job renamed", legacyJob.id).changes).toBe(1);
    expect(upgraded.prepare("UPDATE jobs SET trigger_event = NULL, revision = revision + 1 WHERE id = ?").run(legacyJob.id).changes).toBe(1);
  });
});

describe("trusted job event core contract", () => {
  it("rejects direct-SQL audit/event fabrication without a real consumed authorization", () => {
    const { db, first, second } = setup();
    const { conversation } = contextFixture(first.id);
    const { conversation: otherProjectConversation } = contextFixture(second.id);

    expect(() => insertFabricatedAudit(db, {
      projectId: first.id,
      eventType: "conversation_archived",
      conversationId: conversation.id,
      checkpointId: null,
      targetConversationId: null,
      expectedRevision: 1,
      checkpointStateHash: null,
      authorizationId: randomUUID(),
      archiveSequence: 0,
    })).toThrow(/provenance mismatch|FOREIGN KEY/);

    authorizeContextMaintenanceAction(first.id, conversation.id, {
      operation: "archive_conversation",
      expectedRevision: 1,
    });
    const unconsumedAuthorizationId = authorizationId(db, first.id, conversation.id, "archive_conversation", 1);
    const unconsumedAudit = insertFabricatedAudit(db, {
      projectId: first.id,
      eventType: "conversation_archived",
      conversationId: conversation.id,
      checkpointId: null,
      targetConversationId: null,
      expectedRevision: 1,
      checkpointStateHash: null,
      authorizationId: unconsumedAuthorizationId,
      archiveSequence: 0,
    });
    expect(() => insertFabricatedTrustedEvent(
      db,
      first.id,
      "context.conversation.archived",
      unconsumedAudit.id,
      { conversationId: conversation.id, expectedRevision: 1, archiveSequence: 0 },
      unconsumedAudit.createdAt,
    )).toThrow(/source audit provenance mismatch/);

    authorizeContextMaintenanceAction(second.id, otherProjectConversation.id, {
      operation: "archive_conversation",
      expectedRevision: 1,
    });
    const otherProjectAuthorizationId = authorizationId(
      db, second.id, otherProjectConversation.id, "archive_conversation", 1,
    );
    expect(() => insertFabricatedAudit(db, {
      projectId: first.id,
      eventType: "conversation_archived",
      conversationId: conversation.id,
      checkpointId: null,
      targetConversationId: null,
      expectedRevision: 1,
      checkpointStateHash: null,
      authorizationId: otherProjectAuthorizationId,
      archiveSequence: 1,
    })).toThrow(/provenance mismatch|FOREIGN KEY/);
    expect(listTrustedJobEvents(first.id).data).toEqual([]);
  });

  it("rejects direct-SQL trusted events with mismatched or replayed authorizations", () => {
    const { db, first } = setup();
    const { conversation, checkpoint } = contextFixture(first.id);
    const alternateCheckpoint = createContextCheckpoint(first.id, conversation.id, { expectedRevision: 1 });
    const { conversation: otherConversation } = contextFixture(first.id);
    const { conversation: expiryConversation } = contextFixture(first.id);
    const { conversation: legitimateConversation } = contextFixture(first.id);
    const targetConversation = createContextConversation(first.id, { title: "Fabricated restore target" });

    authorizeContextMaintenanceAction(first.id, conversation.id, {
      operation: "archive_conversation",
      expectedRevision: 1,
    });
    const wrongOperationAuthorizationId = authorizationId(db, first.id, conversation.id, "archive_conversation", 1);
    markAuthorizationConsumed(db, first.id, wrongOperationAuthorizationId);
    const wrongOperationAudit = insertFabricatedAudit(db, {
      projectId: first.id,
      eventType: "conversation_unarchived",
      conversationId: conversation.id,
      checkpointId: null,
      targetConversationId: null,
      expectedRevision: 1,
      checkpointStateHash: null,
      authorizationId: wrongOperationAuthorizationId,
      archiveSequence: 0,
    });
    expect(() => insertFabricatedTrustedEvent(
      db,
      first.id,
      "context.conversation.unarchived",
      wrongOperationAudit.id,
      { conversationId: conversation.id, expectedRevision: 1, archiveSequence: 0 },
      wrongOperationAudit.createdAt,
    )).toThrow(/source audit provenance mismatch/);

    authorizeContextMaintenanceAction(first.id, conversation.id, {
      operation: "archive_conversation",
      expectedRevision: 1,
    });
    const wrongConversationAuthorizationId = authorizationId(db, first.id, conversation.id, "archive_conversation", 1);
    markAuthorizationConsumed(db, first.id, wrongConversationAuthorizationId);
    const wrongConversationAudit = insertFabricatedAudit(db, {
      projectId: first.id,
      eventType: "conversation_archived",
      conversationId: otherConversation.id,
      checkpointId: null,
      targetConversationId: null,
      expectedRevision: 1,
      checkpointStateHash: null,
      authorizationId: wrongConversationAuthorizationId,
      archiveSequence: 0,
    });
    expect(() => insertFabricatedTrustedEvent(
      db,
      first.id,
      "context.conversation.archived",
      wrongConversationAudit.id,
      { conversationId: otherConversation.id, expectedRevision: 1, archiveSequence: 0 },
      wrongConversationAudit.createdAt,
    )).toThrow(/source audit provenance mismatch/);

    authorizeContextMaintenanceAction(first.id, conversation.id, {
      operation: "restore_checkpoint",
      checkpointId: checkpoint.checkpoint.id,
      expectedRevision: 1,
    });
    const wrongCheckpointAuthorizationId = authorizationId(
      db, first.id, conversation.id, "restore_checkpoint", 1, checkpoint.checkpoint.id,
    );
    markAuthorizationConsumed(db, first.id, wrongCheckpointAuthorizationId);
    const wrongCheckpointAudit = insertFabricatedAudit(db, {
      projectId: first.id,
      eventType: "checkpoint_restored_as_new",
      conversationId: conversation.id,
      checkpointId: alternateCheckpoint.checkpoint.id,
      targetConversationId: targetConversation.id,
      expectedRevision: 1,
      checkpointStateHash: "a".repeat(64),
      authorizationId: wrongCheckpointAuthorizationId,
      archiveSequence: null,
    });
    expect(() => insertFabricatedTrustedEvent(
      db,
      first.id,
      "context.checkpoint.restored_as_new",
      wrongCheckpointAudit.id,
      {
        sourceConversationId: conversation.id,
        sourceCheckpointId: alternateCheckpoint.checkpoint.id,
        targetConversationId: targetConversation.id,
        expectedRevision: 1,
      },
      wrongCheckpointAudit.createdAt,
    )).toThrow(/source audit provenance mismatch/);

    authorizeContextMaintenanceAction(first.id, conversation.id, {
      operation: "archive_conversation",
      expectedRevision: 1,
    });
    const wrongRevisionAuthorizationId = authorizationId(db, first.id, conversation.id, "archive_conversation", 1);
    markAuthorizationConsumed(db, first.id, wrongRevisionAuthorizationId);
    const wrongRevisionAudit = insertFabricatedAudit(db, {
      projectId: first.id,
      eventType: "conversation_archived",
      conversationId: conversation.id,
      checkpointId: null,
      targetConversationId: null,
      expectedRevision: 2,
      checkpointStateHash: null,
      authorizationId: wrongRevisionAuthorizationId,
      archiveSequence: 1,
    });
    expect(() => insertFabricatedTrustedEvent(
      db,
      first.id,
      "context.conversation.archived",
      wrongRevisionAudit.id,
      { conversationId: conversation.id, expectedRevision: 2, archiveSequence: 1 },
      wrongRevisionAudit.createdAt,
    )).toThrow(/source audit provenance mismatch/);

    authorizeContextMaintenanceAction(first.id, expiryConversation.id, {
      operation: "archive_conversation",
      expectedRevision: 1,
    });
    const expiredAuthorizationId = authorizationId(db, first.id, expiryConversation.id, "archive_conversation", 1);
    const expiration = db.prepare(
      "SELECT expires_at FROM context_checkpoint_maintenance_authorizations WHERE id = ?",
    ).get(expiredAuthorizationId) as { expires_at: string };
    db.prepare("UPDATE context_checkpoint_maintenance_authorizations SET consumed_at = ? WHERE id = ?")
      .run(expiration.expires_at, expiredAuthorizationId);
    const expiredAudit = insertFabricatedAudit(db, {
      projectId: first.id,
      eventType: "conversation_archived",
      conversationId: expiryConversation.id,
      checkpointId: null,
      targetConversationId: null,
      expectedRevision: 1,
      checkpointStateHash: null,
      authorizationId: expiredAuthorizationId,
      archiveSequence: 0,
      createdAt: expiration.expires_at,
    });
    expect(() => insertFabricatedTrustedEvent(
      db,
      first.id,
      "context.conversation.archived",
      expiredAudit.id,
      { conversationId: expiryConversation.id, expectedRevision: 1, archiveSequence: 0 },
      expiredAudit.createdAt,
    )).toThrow(/source audit provenance mismatch/);

    const legitimateAuthorization = authorizeContextMaintenanceAction(first.id, legitimateConversation.id, {
      operation: "archive_conversation",
      expectedRevision: 1,
    });
    const legitimate = archiveContextConversation(first.id, legitimateConversation.id, {
      expectedRevision: 1,
      confirmationToken: legitimateAuthorization.confirmationToken,
    });
    const legitimateAuthorizationId = db.prepare(
      "SELECT authorization_id FROM context_checkpoint_audit_events WHERE id = ?",
    ).get(legitimate.event.id) as { authorization_id: string };
    const replayAudit = insertFabricatedAudit(db, {
      projectId: first.id,
      eventType: "conversation_archived",
      conversationId: legitimateConversation.id,
      checkpointId: null,
      targetConversationId: null,
      expectedRevision: 1,
      checkpointStateHash: null,
      authorizationId: legitimateAuthorizationId.authorization_id,
      archiveSequence: 1,
    });
    expect(() => insertFabricatedTrustedEvent(
      db,
      first.id,
      "context.conversation.archived",
      replayAudit.id,
      { conversationId: legitimateConversation.id, expectedRevision: 1, archiveSequence: 1 },
      replayAudit.createdAt,
    )).toThrow(/source audit provenance mismatch/);
    expect(listTrustedJobEvents(first.id).data).toHaveLength(1);
  });

  it("uses source audit IDs for idempotency and returns typed conflicts for mismatched, cross-project, and type-colliding replays", () => {
    const { first, second } = setup();
    const { conversation } = contextFixture(first.id);
    const authorization = authorizeContextMaintenanceAction(first.id, conversation.id, {
      operation: "archive_conversation",
      expectedRevision: 1,
    });
    archiveContextConversation(first.id, conversation.id, {
      expectedRevision: 1,
      confirmationToken: authorization.confirmationToken,
    });
    const audit = listContextCheckpointAuditEvents(first.id, { conversationId: conversation.id })[0]!;
    const input = trustedJobEventFromContextAuditEvent(audit);
    expect(appendTrustedJobEvent(first.id, input)).toMatchObject({ idempotent: true, event: { source_audit_event_id: audit.id } });
    expect(() => appendTrustedJobEvent(first.id, {
      ...input,
      payload: { ...input.payload as Record<string, unknown>, expectedRevision: 2 },
    })).toThrow(expect.objectContaining({ code: "TRUSTED_JOB_EVENT_DEDUPE_CONFLICT" }));
    expect(() => appendTrustedJobEvent(second.id, input)).toThrow(expect.objectContaining({ code: "SOURCE_AUDIT_PROJECT_CONFLICT" }));
    expect(() => appendTrustedJobEvent(first.id, {
      ...input,
      eventType: "context.conversation.unarchived",
    })).toThrow(expect.objectContaining({ code: "SOURCE_AUDIT_TYPE_CONFLICT" }));
  });

  it("denies dangerous, oversized, and deeply nested payloads before anything is persisted", () => {
    const { first } = setup();
    const sourceAuditEventId = randomUUID();
    const payload = { conversationId: randomUUID(), expectedRevision: 0, archiveSequence: 0 };
    expect(() => appendTrustedJobEvent(first.id, {
      eventType: "context.conversation.archived",
      sourceAuditEventId,
      payload: { ...payload, token: "super-secret" },
    })).toThrow(expect.objectContaining({ code: "INVALID_TRUSTED_JOB_EVENT" }));
    expect(() => appendTrustedJobEvent(first.id, {
      eventType: "context.conversation.archived",
      sourceAuditEventId,
      payload: { ...payload, padding: "x".repeat(2_049) },
    })).toThrow(expect.objectContaining({ code: "INVALID_TRUSTED_JOB_EVENT" }));
    expect(() => appendTrustedJobEvent(first.id, {
      eventType: "context.conversation.archived",
      sourceAuditEventId,
      payload: { ...payload, nested: { one: { two: { three: { four: "x" } } } } },
    })).toThrow(expect.objectContaining({ code: "INVALID_TRUSTED_JOB_EVENT" }));
    expect(listTrustedJobEvents(first.id).data).toEqual([]);
  });

  it("atomically records archive, unarchive, and restore producers with source provenance and survives restart", () => {
    const { first } = setup();
    const { conversation, checkpoint } = contextFixture(first.id);
    const archiveAuthorization = authorizeContextMaintenanceAction(first.id, conversation.id, {
      operation: "archive_conversation",
      expectedRevision: 1,
    });
    archiveContextConversation(first.id, conversation.id, {
      expectedRevision: 1,
      confirmationToken: archiveAuthorization.confirmationToken,
    });
    const unarchiveAuthorization = authorizeContextMaintenanceAction(first.id, conversation.id, {
      operation: "unarchive_conversation",
      expectedRevision: 1,
    });
    unarchiveContextConversation(first.id, conversation.id, {
      expectedRevision: 1,
      confirmationToken: unarchiveAuthorization.confirmationToken,
    });
    const restoreAuthorization = authorizeContextMaintenanceAction(first.id, conversation.id, {
      operation: "restore_checkpoint",
      checkpointId: checkpoint.checkpoint.id,
      expectedRevision: 1,
    });
    const restored = restoreContextCheckpoint(first.id, conversation.id, checkpoint.checkpoint.id, {
      expectedRevision: 1,
      confirmationToken: restoreAuthorization.confirmationToken,
      idempotencyKey: "trusted-restore",
    });

    const events = listTrustedJobEvents(first.id, { limit: 100 }).data;
    const audits = listContextCheckpointAuditEvents(first.id, { conversationId: conversation.id });
    expect(events).toHaveLength(3);
    expect(events.map((event) => event.source_audit_event_id).sort())
      .toEqual(audits.map((audit) => audit.id).sort());
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: "context.conversation.archived", payload: { conversationId: conversation.id, expectedRevision: 1, archiveSequence: 0 } }),
      expect.objectContaining({ event_type: "context.conversation.unarchived", payload: { conversationId: conversation.id, expectedRevision: 1, archiveSequence: 1 } }),
      expect.objectContaining({ event_type: "context.checkpoint.restored_as_new", payload: {
        sourceConversationId: conversation.id,
        sourceCheckpointId: checkpoint.checkpoint.id,
        targetConversationId: restored.conversation.id,
        expectedRevision: 1,
      } }),
    ]));

    const beforeFailure = events.length;
    const failedAuthorization = authorizeContextMaintenanceAction(first.id, conversation.id, {
      operation: "archive_conversation",
      expectedRevision: 1,
    });
    expect(() => archiveContextConversation(first.id, conversation.id, {
      expectedRevision: 1,
      confirmationToken: `${failedAuthorization.confirmationToken}x`,
    })).toThrow(expect.objectContaining({ code: "MAINTENANCE_AUTHORIZATION_INVALID" }));
    expect(listTrustedJobEvents(first.id).data).toHaveLength(beforeFailure);
    expect(restoreContextCheckpoint(first.id, conversation.id, checkpoint.checkpoint.id, {
      expectedRevision: 1,
      confirmationToken: restoreAuthorization.confirmationToken,
      idempotencyKey: "trusted-restore",
    })).toMatchObject({ idempotent: true, conversation: { id: restored.conversation.id } });
    expect(listTrustedJobEvents(first.id).data).toHaveLength(beforeFailure);

    const path = process.env.INGENIUM_CORE_DB_PATH!;
    resetDbForTest();
    expect(listTrustedJobEvents(first.id, { limit: 100 }).data).toHaveLength(3);
    expect(getDb(path).prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("carries the authenticated maintenance actor into trusted events and runs", () => {
    const { db, first } = setup();
    const { conversation } = contextFixture(first.id);
    const actorId = randomUUID();
    const authorization = authorizeContextMaintenanceAction(first.id, conversation.id, {
      operation: "archive_conversation",
      expectedRevision: 1,
    }, {
      actorType: "user",
      actorId,
      requestId: "req-auth-106",
      correlationId: "corr-auth-106",
    });

    const archived = archiveContextConversation(first.id, conversation.id, {
      expectedRevision: 1,
      confirmationToken: authorization.confirmationToken,
    });
    const event = db.prepare(
      "SELECT source_actor_type, source_actor_id FROM trusted_job_events WHERE source_audit_event_id = ?",
    ).get(archived.event.id);

    expect(archived.event).toMatchObject({
      source_actor_type: "user",
      source_actor_id: actorId,
      request_id: "req-auth-106",
      correlation_id: "corr-auth-106",
    });
    expect(event).toEqual({ source_actor_type: "user", source_actor_id: actorId });
  });
});
