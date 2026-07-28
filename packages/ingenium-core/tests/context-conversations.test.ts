import { afterEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, resetDbForTest } from "../lib/db.js";
import {
  appendContextMessage,
  ContextConversationError,
  createContextCheckpoint,
  createContextConversation,
  getContextMessage,
  listContextCheckpointRagSources,
  listContextCheckpoints,
  listContextMessages,
  restoreContextCheckpoint,
  retrieveContextMessages,
  searchContextMessages,
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

  it("fails loudly if a migration-063 immutable trigger is missing", () => {
    const { db } = setup();
    db.prepare("DROP TRIGGER context_messages_immutable_update").run();
    resetDbForTest();

    expect(() => getDb(process.env.INGENIUM_CORE_DB_PATH)).toThrow(/Migration 063 is in a PARTIAL state/);
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
    })).toThrow(expect.objectContaining({ code: "REVISION_CONFLICT", currentRevision: 3 }));
    const restored = restoreContextCheckpoint(first.id, conversation.id, checkpoint.checkpoint.id, {
      expectedRevision: 3,
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
      idempotencyKey: "restore-one",
    })).toMatchObject({ idempotent: true, conversation: { id: restored.conversation.id } });
  });
});
