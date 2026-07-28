import { afterEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { getDb, resetDbForTest } from "../lib/db.js";
import {
  appendContextMessage,
  archiveContextConversation,
  authorizeContextMaintenanceAction,
  ContextConversationError,
  createContextCheckpoint,
  createContextConversation,
  getContextMessage,
  listContextCheckpointAuditEvents,
  listContextCheckpointRagSources,
  listContextCheckpoints,
  listContextConversations,
  listContextMessages,
  previewContextMaintenance,
  restoreContextCheckpoint,
  retrieveContextMessages,
  searchContextMessages,
  unarchiveContextConversation,
} from "../lib/tools/context-conversations.js";
import { deleteProject, createProject } from "../lib/tools/projects.js";
import { ingestCanonicalSource } from "../lib/tools/rag.js";

let directory = "";
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
const originalHome = process.env.INGENIUM_HOME;

function setup() {
  directory = mkdtempSync(join(tmpdir(), "ingenium-context-conversations-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  process.env.INGENIUM_HOME = join(directory, "home");
  resetDbForTest();
  const first = createProject("context-first");
  const second = createProject("context-second");
  return { db: getDb(process.env.INGENIUM_CORE_DB_PATH), first, second };
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function replaceWithRecoverablePartial063Shape(db: ReturnType<typeof getDb>): void {
  db.pragma("foreign_keys = OFF");
  try {
    db.exec(`
      CREATE TABLE context_conversations_partial (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        idempotency_key TEXT,
        tags TEXT,
        priority INTEGER,
        created_at TEXT NOT NULL
      );
      INSERT INTO context_conversations_partial (id, project_id, title, idempotency_key, tags, priority, created_at)
      SELECT id, project_id, title, idempotency_key, tags, priority, created_at FROM context_conversations;

      CREATE TABLE context_messages_partial (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT,
        idempotency_key TEXT,
        tags TEXT,
        priority INTEGER,
        created_at TEXT NOT NULL
      );
      INSERT INTO context_messages_partial (id, project_id, conversation_id, role, content, content_hash, idempotency_key, tags, priority, created_at)
      SELECT id, project_id, conversation_id, role, content, content_hash, idempotency_key, tags, priority, created_at FROM context_messages;

      CREATE TABLE context_checkpoints_partial (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        through_message_id TEXT NOT NULL,
        message_count INTEGER NOT NULL,
        state_hash TEXT,
        idempotency_key TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO context_checkpoints_partial (id, project_id, conversation_id, through_message_id, message_count, state_hash, idempotency_key, created_at)
      SELECT id, project_id, conversation_id, through_message_id, message_count, state_hash, idempotency_key, created_at FROM context_checkpoints;

      CREATE TABLE context_checkpoint_rag_sources_partial (
        checkpoint_id TEXT NOT NULL,
        rag_source_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO context_checkpoint_rag_sources_partial (checkpoint_id, rag_source_id, created_at)
      SELECT checkpoint_id, rag_source_id, created_at FROM context_checkpoint_rag_sources;

      DROP TRIGGER context_conversations_immutable_update;
      DROP TRIGGER context_conversations_immutable_delete;
      DROP TRIGGER context_messages_immutable_update;
      DROP TRIGGER context_messages_immutable_delete;
      DROP TRIGGER context_messages_fts_insert;
      DROP TRIGGER context_checkpoints_immutable_update;
      DROP TRIGGER context_checkpoints_immutable_delete;
      DROP TRIGGER context_checkpoint_rag_sources_immutable_update;
      DROP TRIGGER context_checkpoint_rag_sources_immutable_delete;
      DROP TRIGGER rag_sources_context_checkpoint_immutable_update;
      DROP TRIGGER rag_sources_context_checkpoint_immutable_delete;
      DROP TRIGGER rag_chunks_context_checkpoint_immutable_insert;
      DROP TRIGGER rag_chunks_context_checkpoint_immutable_update;
      DROP TRIGGER rag_chunks_context_checkpoint_immutable_delete;
      DROP TABLE context_messages_fts;
      DROP TABLE context_checkpoint_rag_sources;
      DROP TABLE context_checkpoints;
      DROP TABLE context_messages;
      DROP TABLE context_conversations;
      ALTER TABLE context_conversations_partial RENAME TO context_conversations;
      ALTER TABLE context_messages_partial RENAME TO context_messages;
      ALTER TABLE context_checkpoints_partial RENAME TO context_checkpoints;
      ALTER TABLE context_checkpoint_rag_sources_partial RENAME TO context_checkpoint_rag_sources;
    `);
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

afterEach(() => {
  resetDbForTest();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
  if (originalHome === undefined) delete process.env.INGENIUM_HOME;
  else process.env.INGENIUM_HOME = originalHome;
});

describe("immutable context conversations", () => {
  it("appends project-isolated messages and records a hash-addressed checkpoint with RAG provenance", () => {
    const { db, first, second } = setup();
    const conversation = createContextConversation(first.id, {
      title: "Approved context design",
      tags: ["architecture", "architecture", "context"],
      priority: 9,
      metadata: { ticket: "CTX-001" },
    });
    const firstMessage = appendContextMessage(first.id, conversation.id, {
      role: "user",
      content: "Use immutable messages.",
      tags: ["request"],
      priority: 8,
      metadata: { source: "test" },
      expectedRevision: 0,
      idempotencyKey: "first-message",
    });
    const secondMessage = appendContextMessage(first.id, conversation.id, {
      role: "assistant",
      content: "The sequence is append-only.",
      expectedRevision: 1,
    });
    const source = ingestCanonicalSource(first.id, "Context design", "Immutable checkpoints retain provenance.");
    const checkpoint = createContextCheckpoint(first.id, conversation.id, {
      ragSourceIds: [source.id],
      metadata: { reason: "handoff" },
      expectedRevision: 2,
    });

    expect(conversation).toMatchObject({
      project_id: first.id,
      tags: JSON.stringify(["architecture", "context"]),
      priority: 9,
    });
    expect([firstMessage.message.sequence, secondMessage.message.sequence]).toEqual([0, 1]);
    expect(firstMessage.message.content_hash).toBe(hash("Use immutable messages."));
    expect(checkpoint.checkpoint).toMatchObject({
      sequence: 0,
      through_message_id: secondMessage.message.id,
      message_count: 2,
      metadata: JSON.stringify({ reason: "handoff" }),
    });
    expect(checkpoint.checkpoint.state_hash).toBe(hash(JSON.stringify([
      {
        sequence: firstMessage.message.sequence,
        role: firstMessage.message.role,
        content_hash: firstMessage.message.content_hash,
        tags: firstMessage.message.tags,
        priority: firstMessage.message.priority,
        metadata: firstMessage.message.metadata,
      },
      {
        sequence: secondMessage.message.sequence,
        role: secondMessage.message.role,
        content_hash: secondMessage.message.content_hash,
        tags: secondMessage.message.tags,
        priority: secondMessage.message.priority,
        metadata: secondMessage.message.metadata,
      },
    ])));
    expect(listContextMessages(first.id, conversation.id).data.map((message) => message.id))
      .toEqual([firstMessage.message.id, secondMessage.message.id]);
    expect(listContextCheckpoints(first.id, conversation.id).data).toMatchObject([checkpoint.checkpoint]);
    expect(listContextCheckpointRagSources(first.id, checkpoint.checkpoint.id)).toMatchObject([
      { project_id: first.id, checkpoint_id: checkpoint.checkpoint.id, rag_source_id: source.id, ordinal: 0 },
    ]);

    expect(() => appendContextMessage(second.id, conversation.id, {
      role: "user",
      content: "Cross-project write",
      expectedRevision: 0,
    })).toThrow(ContextConversationError);
    try {
      createContextCheckpoint(first.id, conversation.id, {
        ragSourceIds: [ingestCanonicalSource(second.id, "Other", "Other project source.").id],
        expectedRevision: 2,
      });
      throw new Error("Expected a cross-project RAG source to be rejected");
    } catch (error) {
      expect(error).toMatchObject({ code: "RAG_SOURCE_NOT_FOUND" });
    }
    expect(() => db.prepare(
      `INSERT INTO context_checkpoint_rag_sources
       (project_id, checkpoint_id, rag_source_id, ordinal, metadata, created_at)
       VALUES (?, ?, ?, ?, '{}', ?)`,
    ).run(first.id, checkpoint.checkpoint.id, randomUUID(), 1, new Date().toISOString())).toThrow(/FOREIGN KEY/);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("rejects malformed immutable rows, metadata overflow, duplicate sequences, and all mutation paths", () => {
    const { db, first } = setup();
    const conversation = createContextConversation(first.id, { title: "Integrity" });
    const message = appendContextMessage(first.id, conversation.id, { role: "user", content: "Immutable.", expectedRevision: 0 });
    const source = ingestCanonicalSource(first.id, "Integrity source", "RAG source.");
    const checkpoint = createContextCheckpoint(first.id, conversation.id, { ragSourceIds: [source.id], expectedRevision: 1 });
    const createdAt = new Date().toISOString();

    expect(() => db.prepare(
      `INSERT INTO context_conversations
       (id, project_id, title, tags, priority, metadata, created_at)
       VALUES (?, ?, ?, '[]', 5, '[]', ?)`,
    ).run(randomUUID(), first.id, "Invalid metadata", createdAt)).toThrow();
    expect(() => db.prepare(
      `INSERT INTO context_conversations
       (id, project_id, title, tags, priority, metadata, created_at)
       VALUES (?, ?, ?, '[]', 5, ?, ?)`,
    ).run(randomUUID(), first.id, "Oversized metadata", JSON.stringify({ payload: "x".repeat(16_384) }), createdAt)).toThrow();
    expect(() => db.prepare(
      `INSERT INTO context_messages
       (id, project_id, conversation_id, sequence, role, content, content_hash, tags, priority, metadata, created_at)
       VALUES (?, ?, ?, 0, 'user', 'Duplicate sequence', ?, '[]', 5, '{}', ?)`,
    ).run(randomUUID(), first.id, conversation.id, "a".repeat(64), createdAt)).toThrow();
    expect(() => db.prepare(
      `INSERT INTO context_messages
       (id, project_id, conversation_id, sequence, role, content, content_hash, tags, priority, metadata, created_at)
       VALUES (?, ?, ?, 1, 'user', 'Bad hash', 'bad-hash', '[]', 5, '{}', ?)`,
    ).run(randomUUID(), first.id, conversation.id, createdAt)).toThrow();

    for (const [table, idColumn, id] of [
      ["context_conversations", "id", conversation.id],
      ["context_messages", "id", message.message.id],
      ["context_checkpoints", "id", checkpoint.checkpoint.id],
      ["context_checkpoint_rag_sources", "checkpoint_id", checkpoint.checkpoint.id],
    ]) {
      expect(() => db.prepare(`UPDATE ${table} SET metadata = '{}' WHERE ${idColumn} = ?`).run(id)).toThrow(/immutable/);
      expect(() => db.prepare(`DELETE FROM ${table} WHERE ${idColumn} = ?`).run(id)).toThrow(/immutable/);
    }
    expect(() => db.prepare("DELETE FROM rag_sources WHERE id = ?").run(source.id)).toThrow(/immutable|FOREIGN KEY/);
  });

  it("protects a project containing immutable context records from purge", () => {
    const { first } = setup();
    const conversation = createContextConversation(first.id, { title: "Protected" });
    appendContextMessage(first.id, conversation.id, { role: "system", content: "Retain this record.", expectedRevision: 0 });
    createContextCheckpoint(first.id, conversation.id, { expectedRevision: 1 });

    expect(deleteProject(first.name)).toMatchObject({
      status: "has_children",
      childTables: expect.arrayContaining([
        "context_conversations",
        "context_messages",
        "context_checkpoints",
      ]),
    });
  });

  it("repairs a recoverable partial 063 schema without losing conversations, messages, checkpoints, or RAG links", () => {
    const { db, first } = setup();
    const conversation = createContextConversation(first.id, {
      title: "G3 repair fixture",
      metadata: { fixture: "partial-063" },
    });
    const message = appendContextMessage(first.id, conversation.id, {
      role: "user",
      content: "Retain this message through the G3 repair.",
      expectedRevision: 0,
    });
    const source = ingestCanonicalSource(first.id, "G3 source", "Retain this citation link.");
    const checkpoint = createContextCheckpoint(first.id, conversation.id, {
      ragSourceIds: [source.id],
      expectedRevision: 1,
    });
    const snapshotsBefore = db.prepare(
      "SELECT count(*) AS count FROM context_checkpoint_rag_source_snapshots",
    ).get();

    replaceWithRecoverablePartial063Shape(db);
    resetDbForTest();

    const repaired = getDb(process.env.INGENIUM_CORE_DB_PATH);
    expect(repaired.prepare(
      "SELECT id, project_id, title, metadata FROM context_conversations WHERE id = ?",
    ).get(conversation.id)).toEqual({
      id: conversation.id,
      project_id: first.id,
      title: "G3 repair fixture",
      metadata: JSON.stringify({}),
    });
    expect(repaired.prepare(
      "SELECT id, sequence, content, content_hash, metadata FROM context_messages WHERE id = ?",
    ).get(message.message.id)).toEqual({
      id: message.message.id,
      sequence: 0,
      content: "Retain this message through the G3 repair.",
      content_hash: message.message.content_hash,
      metadata: JSON.stringify({}),
    });
    expect(repaired.prepare(
      "SELECT id, sequence, through_message_id, state_hash, metadata FROM context_checkpoints WHERE id = ?",
    ).get(checkpoint.checkpoint.id)).toEqual({
      id: checkpoint.checkpoint.id,
      sequence: 0,
      through_message_id: message.message.id,
      state_hash: checkpoint.checkpoint.state_hash,
      metadata: JSON.stringify({}),
    });
    expect(repaired.prepare(
      "SELECT project_id, checkpoint_id, rag_source_id, ordinal, metadata FROM context_checkpoint_rag_sources WHERE checkpoint_id = ?",
    ).get(checkpoint.checkpoint.id)).toEqual({
      project_id: first.id,
      checkpoint_id: checkpoint.checkpoint.id,
      rag_source_id: source.id,
      ordinal: 0,
      metadata: JSON.stringify({}),
    });
    expect(repaired.prepare(
      "SELECT count(*) AS count FROM context_checkpoint_rag_source_snapshots",
    ).get()).toEqual(snapshotsBefore);
    expect(searchContextMessages(first.id, conversation.id, "G3 repair", 10))
      .toMatchObject([{ id: message.message.id }]);
    expect(repaired.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(repaired.prepare("PRAGMA integrity_check").all()).toEqual([{ integrity_check: "ok" }]);
    expect(repaired.prepare(
      "SELECT source_schema_hash, row_counts FROM context_migration_repairs WHERE id = 1",
    ).get()).toMatchObject({
      source_schema_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      row_counts: JSON.stringify({ conversations: 1, messages: 1, checkpoints: 1, checkpointRagSources: 1 }),
    });
    expect(repaired.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('context_rag_uploads', 'context_checkpoint_maintenance_authorizations')",
    ).get()).toEqual({ count: 2 });

    const repairAudit = repaired.prepare("SELECT * FROM context_migration_repairs WHERE id = 1").get();
    resetDbForTest();
    expect(getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "SELECT * FROM context_migration_repairs WHERE id = 1",
    ).get()).toEqual(repairAudit);
  });

  it("refuses an unrecoverable partial 063 shape before changing its source data", () => {
    const { db } = setup();
    db.pragma("foreign_keys = OFF");
    try {
      db.exec(`
        DROP TRIGGER context_conversations_immutable_update;
        DROP TRIGGER context_conversations_immutable_delete;
        DROP TABLE context_conversations;
        CREATE TABLE context_conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL);
        INSERT INTO context_conversations (id, title, created_at)
        VALUES ('recovery-fixture', 'Ownership cannot be inferred', '2026-01-01T00:00:00.000Z');
      `);
    } finally {
      db.pragma("foreign_keys = ON");
    }
    const path = process.env.INGENIUM_CORE_DB_PATH!;
    resetDbForTest();

    expect(() => getDb(path)).toThrow(/Migration 067 context repair preflight refused/);
    resetDbForTest();
    const raw = new Database(path);
    try {
      expect(raw.prepare("SELECT id, title FROM context_conversations").all())
        .toEqual([{ id: "recovery-fixture", title: "Ownership cannot be inferred" }]);
    } finally {
      raw.close();
    }
  });

  it("repairs partial 063 before applying its later 065 and 066 dependencies", () => {
    directory = mkdtempSync(join(tmpdir(), "ingenium-context-pre-065-"));
    const path = join(directory, "legacy.db");
    const legacy = new Database(path);
    const migrations = resolve(__dirname, "../data/migrations");
    try {
      for (const migration of readdirSync(migrations)
        .filter((file) => /^\d{3}_.*\.sql$/.test(file) && Number(file.slice(0, 3)) <= 62)
        .sort()) {
        legacy.exec(readFileSync(join(migrations, migration), "utf8"));
      }
      const projectId = randomUUID();
      const conversationId = randomUUID();
      const messageId = randomUUID();
      const checkpointId = randomUUID();
      const sourceId = randomUUID();
      const createdAt = "2026-01-01T00:00:00.000Z";
      legacy.prepare(
        "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run(projectId, "pre-065-repair", "/pre-065-repair", createdAt, createdAt);
      legacy.prepare(
        `INSERT INTO rag_sources
         (id, project_id, title, source_type, source_path, source_hash, mime_type, byte_size, chunk_count, metadata, created_at, updated_at)
         VALUES (?, ?, ?, 'text', NULL, NULL, 'text/plain', 1, 0, '{}', ?, ?)`,
      ).run(sourceId, projectId, "Pre-065 source", createdAt, createdAt);
      legacy.exec(`
        CREATE TABLE context_conversations (id TEXT PRIMARY KEY, project_id TEXT, title TEXT, created_at TEXT);
        CREATE TABLE context_messages (id TEXT PRIMARY KEY, project_id TEXT, conversation_id TEXT, sequence INTEGER, role TEXT, content TEXT, tags TEXT, priority INTEGER, created_at TEXT);
        CREATE TABLE context_checkpoints (id TEXT PRIMARY KEY, project_id TEXT, conversation_id TEXT, sequence INTEGER, through_message_id TEXT, message_count INTEGER, created_at TEXT);
        CREATE TABLE context_checkpoint_rag_sources (checkpoint_id TEXT, rag_source_id TEXT, created_at TEXT);
      `);
      legacy.prepare("INSERT INTO context_conversations VALUES (?, ?, ?, ?)")
        .run(conversationId, projectId, "Pre-065 partial", createdAt);
      legacy.prepare("INSERT INTO context_messages VALUES (?, ?, ?, 0, 'user', 'Keep this', '[]', 5, ?)")
        .run(messageId, projectId, conversationId, createdAt);
      legacy.prepare("INSERT INTO context_checkpoints VALUES (?, ?, ?, 0, ?, 1, ?)")
        .run(checkpointId, projectId, conversationId, messageId, createdAt);
      legacy.prepare("INSERT INTO context_checkpoint_rag_sources VALUES (?, ?, ?)")
        .run(checkpointId, sourceId, createdAt);
    } finally {
      legacy.close();
    }
    process.env.INGENIUM_CORE_DB_PATH = path;
    process.env.INGENIUM_HOME = join(directory, "home");
    resetDbForTest();

    const repaired = getDb(path);
    expect(repaired.prepare("SELECT title FROM context_conversations").get())
      .toEqual({ title: "Pre-065 partial" });
    expect(repaired.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('context_rag_uploads', 'context_checkpoint_maintenance_authorizations', 'context_migration_repairs')",
    ).get()).toEqual({ count: 3 });
    expect(repaired.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(repaired.prepare("PRAGMA integrity_check").all()).toEqual([{ integrity_check: "ok" }]);
  });

  it("fails closed if a migration-066 audit safeguard is missing", () => {
    const { db } = setup();
    db.prepare("DROP TRIGGER context_checkpoint_audit_events_immutable_delete").run();
    resetDbForTest();

    expect(() => getDb(process.env.INGENIUM_CORE_DB_PATH)).toThrow(/Migration 066 is in a PARTIAL state/);
  });

  it("uses revisions, idempotency, bounded retrieval, and restore-as-new branches", () => {
    const { first } = setup();
    const conversation = createContextConversation(first.id, {
      title: "Versioned context",
      idempotencyKey: "conversation-create",
    });
    const firstMessage = appendContextMessage(first.id, conversation.id, {
      role: "user",
      content: "The violet lighthouse is approved.",
      expectedRevision: 0,
      idempotencyKey: "message-one",
    });
    const duplicate = appendContextMessage(first.id, conversation.id, {
      role: "user",
      content: "The violet lighthouse is approved.",
      expectedRevision: 0,
      idempotencyKey: "message-one",
    });
    expect(duplicate).toMatchObject({
      idempotent: true,
      revision: 1,
      message: { id: firstMessage.message.id },
    });
    expect(() => appendContextMessage(first.id, conversation.id, {
      role: "user",
      content: "Different content",
      expectedRevision: 1,
      idempotencyKey: "message-one",
    })).toThrow(expect.objectContaining({ code: "IDEMPOTENCY_KEY_REUSED" }));

    const secondMessage = appendContextMessage(first.id, conversation.id, {
      role: "assistant",
      content: "Checkpoint the lighthouse approval.",
      expectedRevision: 1,
    });
    const checkpoint = createContextCheckpoint(first.id, conversation.id, {
      expectedRevision: 2,
      idempotencyKey: "checkpoint-one",
    });
    const staleRestoreAuthorization = authorizeContextMaintenanceAction(first.id, conversation.id, {
      operation: "restore_checkpoint",
      checkpointId: checkpoint.checkpoint.id,
      expectedRevision: 2,
    });
    const thirdMessage = appendContextMessage(first.id, conversation.id, {
      role: "tool",
      content: "Later activity must remain on the source branch.",
      expectedRevision: 2,
    });

    const page = listContextMessages(first.id, conversation.id, { limit: 1 });
    expect(page.data[0]).not.toHaveProperty("content");
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(listContextMessages(first.id, conversation.id, { limit: 1, cursor: page.nextCursor! }).data)
      .toMatchObject([{ id: secondMessage.message.id }]);
    expect(searchContextMessages(first.id, conversation.id, "violet lighthouse", 10))
      .toMatchObject([{ id: firstMessage.message.id }]);
    expect(retrieveContextMessages(first.id, conversation.id, [secondMessage.message.id, "00000000-0000-0000-0000-000000000000", firstMessage.message.id]))
      .toMatchObject({
        messages: [{ id: secondMessage.message.id }, { id: firstMessage.message.id }],
        missingIds: ["00000000-0000-0000-0000-000000000000"],
      });
    expect(getContextMessage(first.id, conversation.id, firstMessage.message.id)?.content)
      .toBe("The violet lighthouse is approved.");

    expect(() => restoreContextCheckpoint(first.id, conversation.id, checkpoint.checkpoint.id, {
      expectedRevision: 2,
      confirmationToken: staleRestoreAuthorization.confirmationToken,
    })).toThrow(expect.objectContaining({ code: "REVISION_CONFLICT", currentRevision: 3 }));
    const restoreAuthorization = authorizeContextMaintenanceAction(first.id, conversation.id, {
      operation: "restore_checkpoint",
      checkpointId: checkpoint.checkpoint.id,
      expectedRevision: 3,
    });
    const restored = restoreContextCheckpoint(first.id, conversation.id, checkpoint.checkpoint.id, {
      expectedRevision: 3,
      confirmationToken: restoreAuthorization.confirmationToken,
      idempotencyKey: "restore-one",
    });
    expect(restored).toMatchObject({
      revision: 2,
      conversation: { message_count: 2 },
      checkpoint: { state_hash: checkpoint.checkpoint.state_hash },
    });
    expect(listContextMessages(first.id, restored.conversation.id).data.map((message) => message.sequence))
      .toEqual([0, 1]);
    expect(listContextMessages(first.id, conversation.id).data.map((message) => message.id))
      .toContain(thirdMessage.message.id);
    expect(restoreContextCheckpoint(first.id, conversation.id, checkpoint.checkpoint.id, {
      expectedRevision: 3,
      confirmationToken: restoreAuthorization.confirmationToken,
      idempotencyKey: "restore-one",
    })).toMatchObject({ idempotent: true, conversation: { id: restored.conversation.id } });
  });

  it("previews content-free candidates, requires one-time authorization, and archives reversibly", () => {
    const { db, first, second } = setup();
    const conversation = createContextConversation(first.id, { title: "Private maintenance target" });
    appendContextMessage(first.id, conversation.id, {
      role: "user",
      content: "do not expose this private checkpoint body",
      expectedRevision: 0,
    });
    const checkpoint = createContextCheckpoint(first.id, conversation.id, { expectedRevision: 1 });

    const preview = previewContextMaintenance(first.id, {
      conversationIds: [conversation.id],
      staleBefore: new Date(Date.now() + 1_000).toISOString(),
    });
    expect(preview).toMatchObject([{
      conversationId: conversation.id,
      currentRevision: 1,
      archived: false,
      reasons: expect.arrayContaining(["STALE"]),
    }]);
    expect(JSON.stringify(preview)).not.toContain("private checkpoint body");
    expect(previewContextMaintenance(second.id, { conversationIds: [conversation.id] })).toEqual([]);

    const archiveAuthorization = authorizeContextMaintenanceAction(first.id, conversation.id, {
      operation: "archive_conversation",
      expectedRevision: 1,
    });
    expect(() => archiveContextConversation(first.id, conversation.id, {
      expectedRevision: 1,
      confirmationToken: "x".repeat(43),
    })).toThrow(expect.objectContaining({ code: "MAINTENANCE_AUTHORIZATION_INVALID" }));
    const archived = archiveContextConversation(first.id, conversation.id, {
      expectedRevision: 1,
      confirmationToken: archiveAuthorization.confirmationToken,
    });
    expect(archived).toMatchObject({ archived: true, event: { event_type: "conversation_archived" } });
    expect(() => appendContextMessage(first.id, conversation.id, {
      role: "assistant",
      content: "This write must be rejected while archived.",
      expectedRevision: 1,
    })).toThrow(expect.objectContaining({ code: "CONVERSATION_ARCHIVED" }));
    expect(listContextConversations(first.id).data.map((item) => item.id)).not.toContain(conversation.id);

    const audit = listContextCheckpointAuditEvents(first.id, { conversationId: conversation.id });
    expect(audit).toMatchObject([{ event_type: "conversation_archived", conversation_id: conversation.id }]);
    expect(JSON.stringify(audit)).not.toContain("private checkpoint body");
    expect(JSON.stringify(audit)).not.toContain(archiveAuthorization.confirmationToken);
    expect(() => db.prepare("DELETE FROM context_checkpoints WHERE id = ?").run(checkpoint.checkpoint.id)).toThrow(/immutable/);

    const unarchiveAuthorization = authorizeContextMaintenanceAction(first.id, conversation.id, {
      operation: "unarchive_conversation",
      expectedRevision: 1,
    });
    expect(unarchiveContextConversation(first.id, conversation.id, {
      expectedRevision: 1,
      confirmationToken: unarchiveAuthorization.confirmationToken,
    })).toMatchObject({ archived: false, event: { event_type: "conversation_unarchived" } });
    expect(listContextConversations(first.id).data.map((item) => item.id)).toContain(conversation.id);

    const firstRestoreAuthorization = authorizeContextMaintenanceAction(first.id, conversation.id, {
      operation: "restore_checkpoint",
      checkpointId: checkpoint.checkpoint.id,
      expectedRevision: 1,
    });
    restoreContextCheckpoint(first.id, conversation.id, checkpoint.checkpoint.id, {
      expectedRevision: 1,
      confirmationToken: firstRestoreAuthorization.confirmationToken,
    });
    const secondRestoreAuthorization = authorizeContextMaintenanceAction(first.id, conversation.id, {
      operation: "restore_checkpoint",
      checkpointId: checkpoint.checkpoint.id,
      expectedRevision: 1,
    });
    restoreContextCheckpoint(first.id, conversation.id, checkpoint.checkpoint.id, {
      expectedRevision: 1,
      confirmationToken: secondRestoreAuthorization.confirmationToken,
    });
    expect(previewContextMaintenance(first.id, {
      conversationIds: [conversation.id],
      includeInvalid: false,
    })[0]?.reasons).toContain("MULTIPLE_ACTIVE_RESTORE_BRANCHES");
  });
});
