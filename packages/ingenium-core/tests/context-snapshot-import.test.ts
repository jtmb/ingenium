import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getDb, resetDbForTest } from "../lib/db.js";
import {
  appendContextMessage,
  archiveContextConversation,
  authorizeContextMaintenanceAction,
  createContextCheckpoint,
  createContextConversation,
  listContextCheckpoints,
} from "../lib/tools/context-conversations.js";
import {
  calculateContextConversationSnapshotHash,
  ContextSnapshotImportError,
  importContextConversationSnapshot,
} from "../lib/tools/context-snapshot-import.js";
import { createProject } from "../lib/tools/projects.js";

let directory = "";
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;

function setup() {
  directory = mkdtempSync(join(tmpdir(), "ingenium-context-snapshot-import-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  resetDbForTest();
  const first = createProject("snapshot-first");
  const second = createProject("snapshot-second");
  return { db: getDb(process.env.INGENIUM_CORE_DB_PATH), first, second };
}

afterEach(() => {
  resetDbForTest();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
});

type Entry = {
  role: "user" | "assistant";
  content: string;
  sourceMessageId?: string;
  fingerprint?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
};

function makeEntries(count: number, start = 0): Entry[] {
  return Array.from({ length: count }, (_, offset) => {
    const index = start + offset;
    return {
      role: index % 2 === 0 ? "user" : "assistant",
      content: `snapshot message ${index}`,
      sourceMessageId: `source-message-${index}`,
      metadata: { ordinal: index },
    };
  });
}

function snapshot(entries: Entry[], overrides: Record<string, unknown> = {}) {
  const unsigned = {
    sourceKey: "logical-snapshot-source",
    sourceSessionId: "session-20260729",
    title: "Imported logical snapshot",
    tags: ["import", "context"],
    priority: 7,
    metadata: { fixture: "context-snapshot-import" },
    entries,
    ...overrides,
  };
  return {
    ...unsigned,
    snapshotHash: calculateContextConversationSnapshotHash(unsigned),
  };
}

function expectErrorCode(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ContextSnapshotImportError);
    expect(error).toMatchObject({ code });
  }
}

describe("Context-native snapshot import", () => {
  it("imports more than 1,000 entries atomically, replays idempotently, and appends a verified suffix", () => {
    const { db, first } = setup();
    const initialEntries = makeEntries(1_001);
    const initialSnapshot = snapshot(initialEntries);
    const imported = importContextConversationSnapshot(first.id, initialSnapshot);

    expect(imported).toMatchObject({
      appended: 1_001,
      revision: 1_001,
      created: true,
      adopted: false,
      idempotent: false,
      conversation: { message_count: 1_001 },
    });
    expect(db.prepare(
      "SELECT count(*) AS count FROM context_conversation_source_messages WHERE project_id = ?",
    ).get(first.id)).toEqual({ count: 1_001 });
    const checkpoint = createContextCheckpoint(first.id, imported.conversation.id, { expectedRevision: 1_001 });

    expect(importContextConversationSnapshot(first.id, initialSnapshot)).toMatchObject({
      conversation: { id: imported.conversation.id },
      appended: 0,
      revision: 1_001,
      idempotent: true,
    });

    const refreshedEntries = [...initialEntries, ...makeEntries(2, initialEntries.length)];
    const refreshed = importContextConversationSnapshot(first.id, snapshot(refreshedEntries));
    expect(refreshed).toMatchObject({
      conversation: { id: imported.conversation.id, message_count: 1_003 },
      appended: 2,
      revision: 1_003,
      idempotent: false,
    });
    expect(listContextCheckpoints(first.id, imported.conversation.id).data).toMatchObject([
      { id: checkpoint.checkpoint.id, message_count: 1_001, state_hash: checkpoint.checkpoint.state_hash },
    ]);
    expect(db.prepare(
      "SELECT entry_count FROM context_conversation_sources WHERE project_id = ? AND conversation_id = ?",
    ).get(first.id, imported.conversation.id)).toEqual({ entry_count: 1_003 });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("PRAGMA integrity_check").all()).toEqual([{ integrity_check: "ok" }]);
  });

  it("adopts an existing 911-message immutable conversation only after validating its prefix", () => {
    const { db, first } = setup();
    const existing = createContextConversation(first.id, { title: "Existing immutable conversation" });
    const entries: Entry[] = [];
    for (let index = 0; index < 911; index += 1) {
      const role = index % 2 === 0 ? "user" : "assistant";
      const content = `existing message ${index}`;
      appendContextMessage(first.id, existing.id, { role, content, expectedRevision: index });
      entries.push({ role, content, sourceMessageId: `adopted-source-${index}` });
    }

    const adopted = importContextConversationSnapshot(first.id, snapshot(entries, {
      existingConversationId: existing.id,
      title: "Ignored adoption title",
    }));
    expect(adopted).toMatchObject({
      conversation: { id: existing.id, title: "Existing immutable conversation", message_count: 911 },
      appended: 0,
      revision: 911,
      created: false,
      adopted: true,
      idempotent: false,
    });
    expect(db.prepare(
      "SELECT count(*) AS count FROM context_conversation_source_messages WHERE project_id = ? AND conversation_id = ?",
    ).get(first.id, existing.id)).toEqual({ count: 911 });
  });

  it("rejects shorter, divergent, reordered, reused, and cross-project snapshots before writes", () => {
    const { db, first, second } = setup();
    const entries = makeEntries(3);
    const imported = importContextConversationSnapshot(first.id, snapshot(entries));
    const other = createContextConversation(first.id, { title: "Other target" });
    const countBefore = db.prepare(
      "SELECT count(*) AS count FROM context_messages WHERE project_id = ? AND conversation_id = ?",
    ).get(first.id, imported.conversation.id);

    expectErrorCode(() => importContextConversationSnapshot(first.id, snapshot(entries.slice(0, 2))), "SNAPSHOT_SHORTER");
    expectErrorCode(() => importContextConversationSnapshot(first.id, snapshot([
      { ...entries[0]!, content: "divergent content" },
      entries[1]!,
      entries[2]!,
    ])), "SNAPSHOT_DIVERGED");
    expectErrorCode(() => importContextConversationSnapshot(first.id, snapshot([...entries].reverse())), "SNAPSHOT_DIVERGED");
    expectErrorCode(() => importContextConversationSnapshot(first.id, snapshot(entries, {
      existingConversationId: other.id,
    })), "SOURCE_KEY_REUSED");
    expectErrorCode(() => importContextConversationSnapshot(second.id, snapshot(entries, {
      existingConversationId: imported.conversation.id,
    })), "CONVERSATION_NOT_FOUND");
    expect(db.prepare(
      "SELECT count(*) AS count FROM context_messages WHERE project_id = ? AND conversation_id = ?",
    ).get(first.id, imported.conversation.id)).toEqual(countBefore);
  });

  it("rolls back a new conversation, mapping, messages, and evidence together when an evidence insert fails", () => {
    const { db, first } = setup();
    db.exec(`
      CREATE TRIGGER fail_context_snapshot_evidence
      BEFORE INSERT ON context_conversation_source_messages
      BEGIN
        SELECT RAISE(ABORT, 'fixture source evidence failure');
      END;
    `);

    expect(() => importContextConversationSnapshot(first.id, snapshot(makeEntries(2)))).toThrow(/fixture source evidence failure/);
    expect(db.prepare("SELECT count(*) AS count FROM context_conversations WHERE project_id = ?").get(first.id))
      .toEqual({ count: 0 });
    expect(db.prepare("SELECT count(*) AS count FROM context_messages WHERE project_id = ?").get(first.id))
      .toEqual({ count: 0 });
    expect(db.prepare("SELECT count(*) AS count FROM context_conversation_sources WHERE project_id = ?").get(first.id))
      .toEqual({ count: 0 });
    expect(db.prepare("SELECT count(*) AS count FROM context_conversation_source_messages WHERE project_id = ?").get(first.id))
      .toEqual({ count: 0 });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("refuses a suffix when another writer has advanced the adopted conversation outside its source mapping", () => {
    const { db, first } = setup();
    const entries = makeEntries(2);
    const imported = importContextConversationSnapshot(first.id, snapshot(entries));
    appendContextMessage(first.id, imported.conversation.id, {
      role: "tool",
      content: "Concurrent external append",
      expectedRevision: 2,
    });

    expectErrorCode(() => importContextConversationSnapshot(first.id, snapshot([
      ...entries,
      { role: "assistant", content: "Unverified suffix", sourceMessageId: "source-message-2" },
    ])), "SNAPSHOT_DIVERGED");
    expect(db.prepare(
      "SELECT entry_count FROM context_conversation_sources WHERE project_id = ? AND conversation_id = ?",
    ).get(first.id, imported.conversation.id)).toEqual({ entry_count: 2 });
    expect(db.prepare(
      "SELECT count(*) AS count FROM context_messages WHERE project_id = ? AND conversation_id = ?",
    ).get(first.id, imported.conversation.id)).toEqual({ count: 3 });
  });

  it("preserves checkpoints and archive semantics while keeping source evidence immutable", () => {
    const { db, first } = setup();
    const entries = makeEntries(1);
    const imported = importContextConversationSnapshot(first.id, snapshot(entries));
    const checkpoint = createContextCheckpoint(first.id, imported.conversation.id, { expectedRevision: 1 });
    const refreshedEntries = [...entries, ...makeEntries(1, 1)];
    const refreshedSnapshot = snapshot(refreshedEntries);
    importContextConversationSnapshot(first.id, refreshedSnapshot);
    expect(listContextCheckpoints(first.id, imported.conversation.id).data).toMatchObject([
      { id: checkpoint.checkpoint.id, message_count: 1 },
    ]);

    const authorization = authorizeContextMaintenanceAction(first.id, imported.conversation.id, {
      operation: "archive_conversation",
      expectedRevision: 2,
    });
    archiveContextConversation(first.id, imported.conversation.id, {
      expectedRevision: 2,
      confirmationToken: authorization.confirmationToken,
    });
    expect(importContextConversationSnapshot(first.id, refreshedSnapshot)).toMatchObject({ appended: 0, idempotent: true });
    expectErrorCode(() => importContextConversationSnapshot(first.id, snapshot([
      ...refreshedEntries,
      { role: "user", content: "Archived suffix", sourceMessageId: "source-message-2" },
    ])), "CONVERSATION_ARCHIVED");

    const sourceId = (db.prepare(
      "SELECT id FROM context_conversation_sources WHERE project_id = ? AND conversation_id = ?",
    ).get(first.id, imported.conversation.id) as { id: string }).id;
    expect(() => db.prepare(
      `UPDATE context_conversation_source_messages
       SET source_fingerprint = ? WHERE project_id = ? AND source_id = ? AND sequence = 0`,
    ).run("a".repeat(64), first.id, sourceId)).toThrow(/immutable/);
  });

  it("migrates hash-only source evidence with enforced foreign keys and no mapping transcript body columns", () => {
    const { db, first } = setup();
    const imported = importContextConversationSnapshot(first.id, snapshot([
      { role: "user", content: "Fingerprint-only source evidence", fingerprint: "b".repeat(64) },
    ]));
    const mappingColumns = db.prepare("PRAGMA table_info('context_conversation_sources')").all() as Array<{ name: string }>;
    const evidenceColumns = db.prepare("PRAGMA table_info('context_conversation_source_messages')").all() as Array<{ name: string }>;
    expect(mappingColumns.map((column) => column.name)).not.toContain("content");
    expect(evidenceColumns.map((column) => column.name)).not.toContain("content");
    expect(db.prepare(
      "SELECT source_fingerprint FROM context_conversation_source_messages WHERE project_id = ?",
    ).get(first.id)).toEqual({ source_fingerprint: "b".repeat(64) });

    const unmappedConversation = createContextConversation(first.id, { title: "Invalid mapping target" });
    expect(() => db.prepare(
      `INSERT INTO context_conversation_sources
       (id, project_id, source_key, source_session_id, conversation_id, snapshot_hash,
        entry_count, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, 1, ?, ?)`,
    ).run(
      randomUUID(),
      first.id,
      "/absolute/source/key",
      unmappedConversation.id,
      "c".repeat(64),
      "2026-07-29T00:00:00.000Z",
      "2026-07-29T00:00:00.000Z",
    )).toThrow(/CHECK constraint failed/);
    expect(() => db.prepare(
      `INSERT INTO context_conversation_source_messages
       (project_id, source_id, conversation_id, message_id, sequence, role, content_hash,
        source_fingerprint, created_at)
       VALUES (?, ?, ?, ?, 0, 'user', ?, ?, ?)`,
    ).run(
      first.id,
      randomUUID(),
      imported.conversation.id,
      randomUUID(),
      "d".repeat(64),
      "e".repeat(64),
      "2026-07-29T00:00:00.000Z",
    )).toThrow(/FOREIGN KEY/);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("PRAGMA integrity_check").all()).toEqual([{ integrity_check: "ok" }]);
  });
});
