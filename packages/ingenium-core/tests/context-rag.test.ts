import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, resetDbForTest } from "../lib/db.js";
import {
  appendContextRagUploadChunk,
  completeContextRagUpload,
  createContextRagUploadSession,
  getContextRagSource,
  getCurrentLearningContext,
  ingestContextRagDocument,
  ingestCurrentLearningContext,
  listContextRagSources,
  searchContextCheckpointRag,
  searchContextRag,
  ContextRagError,
} from "../lib/tools/context-rag.js";
import {
  appendContextMessage,
  createContextCheckpoint,
  createContextConversation,
} from "../lib/tools/context-conversations.js";
import { createProject } from "../lib/tools/projects.js";
import { RagSourceImmutableError, ingestCanonicalSource } from "../lib/tools/rag.js";
import { storeObservation } from "../lib/tools/observations.js";

let directory = "";
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
const originalHome = process.env.INGENIUM_HOME;

function setup() {
  directory = mkdtempSync(join(tmpdir(), "ingenium-context-rag-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  process.env.INGENIUM_HOME = join(directory, "home");
  resetDbForTest();
  return {
    db: getDb(process.env.INGENIUM_CORE_DB_PATH),
    first: createProject("context-rag-first"),
    second: createProject("context-rag-second"),
  };
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

describe("context RAG ingestion", () => {
  it("keeps citation identity, ordering, fallback terms, checkpoint results, and projects deterministic", () => {
    const { db, first, second } = setup();
    const createdAt = "2026-07-31T00:00:00.000Z";
    const insertSource = (
      sourceId: string,
      citationId: string,
      uploadId: string,
      content: string,
    ) => {
      const hash = createHash("sha256").update(content).digest("hex");
       db.prepare(
         `INSERT INTO rag_sources
          (id, project_id, organization_id, visibility, title, source_type, source_path, source_hash, mime_type, byte_size, chunk_count, metadata, created_at, updated_at)
          SELECT ?, id, organization_id, 'project', ?, 'text', ?, ?, 'text/plain', ?, 1, ?, ?, ?
          FROM projects WHERE id = ?`,
       ).run(
         sourceId,
         `Source ${sourceId}`,
         `context-upload:${uploadId}`,
         hash,
         Buffer.byteLength(content),
         JSON.stringify({ kind: "context_upload", contextMetadata: {} }),
         createdAt,
         createdAt,
         first.id,
       );
      db.prepare(
        `INSERT INTO rag_chunks
         (id, source_id, chunk_index, content, token_count, heading_path, priority, tags, created_at)
         VALUES (?, ?, 0, ?, 1, NULL, 5, '[]', ?)`,
      ).run(citationId, sourceId, content, createdAt);
      db.prepare(
        `INSERT INTO context_rag_uploads
         (id, project_id, rag_source_id, content_hash, provenance, source_reference, created_at)
         VALUES (?, ?, ?, ?, 'direct_upload', NULL, ?)`,
      ).run(uploadId, first.id, sourceId, hash, createdAt);
      return hash;
    };

    const firstSourceId = "00000000-0000-4000-8000-000000000001";
    const secondSourceId = "00000000-0000-4000-8000-000000000002";
    const firstCitationId = "10000000-0000-4000-8000-000000000001";
    const secondCitationId = "10000000-0000-4000-8000-000000000002";
    const firstHash = insertSource(firstSourceId, firstCitationId, "20000000-0000-4000-8000-000000000001", "tieorderneedle.");
    insertSource(secondSourceId, secondCitationId, "20000000-0000-4000-8000-000000000002", "tieorderneedle!");

    const current = searchContextRag(first.id, "tieorderneedle", 10);
    expect(current.results.map((result) => result.id)).toEqual([firstCitationId, secondCitationId]);
    expect(new Set(current.results.map((result) => result.rank)).size).toBe(1);
    expect(current.citations).toMatchObject([
      { citationId: firstCitationId, sourceId: firstSourceId, sourceHash: firstHash, chunkIndex: 0, availability: "available" },
      { citationId: secondCitationId, sourceId: secondSourceId, chunkIndex: 0, availability: "available" },
    ]);
    expect(searchContextRag(first.id, "tieorderneedle", 10).citations.map((citation) => citation.citationId))
      .toEqual([firstCitationId, secondCitationId]);
    expect(searchContextRag(first.id, "tieorderneedle", 1).citations.map((citation) => citation.citationId))
      .toEqual([firstCitationId]);

    const alphaCitationId = "10000000-0000-4000-8000-000000000003";
    const zuluCitationId = "10000000-0000-4000-8000-000000000004";
    insertSource("00000000-0000-4000-8000-000000000003", alphaCitationId, "20000000-0000-4000-8000-000000000003", "alpha.");
    insertSource("00000000-0000-4000-8000-000000000004", zuluCitationId, "20000000-0000-4000-8000-000000000004", "zulu.");
    expect(searchContextRag(first.id, "zulu alpha", 2).citations.map((citation) => citation.citationId))
      .toEqual([alphaCitationId, zuluCitationId]);

    const isolated = ingestContextRagDocument(second.id, {
      title: "Second project",
      content: "tieorderneedle?",
    });
    expect(searchContextRag(first.id, "tieorderneedle", 10).citations.map((citation) => citation.sourceId))
      .not.toContain(isolated.source.id);
    expect(searchContextRag(second.id, "tieorderneedle", 10).citations.map((citation) => citation.sourceId))
      .toEqual([isolated.source.id]);

    const conversation = createContextConversation(first.id, { title: "Citation checkpoint" });
    appendContextMessage(first.id, conversation.id, {
      role: "user",
      content: "Freeze deterministic citations.",
      expectedRevision: 0,
    });
    const checkpoint = createContextCheckpoint(first.id, conversation.id, {
      expectedRevision: 1,
      ragSourceIds: [firstSourceId, secondSourceId],
    });
    expect(searchContextCheckpointRag(first.id, checkpoint.checkpoint.id, "tieorderneedle", 10).citations)
      .toMatchObject([
        { citationId: firstCitationId, sourceHash: firstHash, chunkIndex: 0, availability: "available" },
        { citationId: secondCitationId, chunkIndex: 0, availability: "available" },
      ]);
  });

  it("deduplicates direct uploads per project, excludes global sources, and freezes checkpoint citations", () => {
    const { db, first, second } = setup();
    const document = {
      title: "Release handoff",
      content: "The violet lighthouse release needs an immutable handoff record.",
      mimeType: "text/markdown",
      priority: 8,
      tags: ["handoff", "handoff"],
      metadata: { ticket: "CTX-003" },
      sourceReference: "work-item:CTX-100",
    };
    const firstUpload = ingestContextRagDocument(first.id, document);
    const duplicate = ingestContextRagDocument(first.id, document);
    const secondUpload = ingestContextRagDocument(second.id, document);
    const global = createProject("global-default", true);
    ingestContextRagDocument(global.id, {
      title: "Global only",
      content: "The amber global archive must never appear in project context search.",
    });

    expect(duplicate).toMatchObject({
      deduplicated: true,
      upload: { id: firstUpload.upload.id, rag_source_id: firstUpload.source.id },
    });
    expect(secondUpload.upload.id).not.toBe(firstUpload.upload.id);
    expect(getContextRagSource(first.id, firstUpload.source.id)).toMatchObject({
      id: firstUpload.source.id,
      provenance: "direct_upload",
      sourceReference: "work-item:CTX-100",
      priority: 8,
      tags: ["handoff"],
      metadata: { ticket: "CTX-003" },
    });
    expect(getContextRagSource(first.id, firstUpload.source.id)).not.toHaveProperty("content");
    expect(getContextRagSource(second.id, firstUpload.source.id)).toBeUndefined();
    expect(listContextRagSources(first.id).data).toEqual([
      expect.objectContaining({ id: firstUpload.source.id, metadata: { ticket: "CTX-003" } }),
    ]);
    expect(() => ingestCanonicalSource(
      first.id,
      "Changed handoff",
      "A changed handoff must not replace an immutable context source.",
      { sourcePath: firstUpload.source.source_path ?? undefined },
    )).toThrow(/immutable/);
    const directSearch = searchContextRag(first.id, "violet lighthouse");
    expect(directSearch.citations).toMatchObject([
      {
        sourceId: firstUpload.source.id,
        provenance: "direct_upload",
        sourceReference: "work-item:CTX-100",
      },
    ]);
    expect(directSearch.citations[0]).not.toHaveProperty("metadata");
    expect(searchContextRag(first.id, "amber global").citations).toEqual([]);

    const conversation = createContextConversation(first.id, { title: "Checkpoint source citation" });
    appendContextMessage(first.id, conversation.id, {
      role: "user",
      content: "Checkpoint the immutable handoff source.",
      expectedRevision: 0,
    });
    const checkpoint = createContextCheckpoint(first.id, conversation.id, {
      ragSourceIds: [firstUpload.source.id],
      expectedRevision: 1,
    });
    const snapshot = db.prepare(
      `SELECT source_hash, title, provenance FROM context_checkpoint_rag_source_snapshots
       WHERE project_id = ? AND checkpoint_id = ? AND rag_source_id = ?`,
    ).get(first.id, checkpoint.checkpoint.id, firstUpload.source.id);
    expect(snapshot).toMatchObject({
      source_hash: firstUpload.source.source_hash,
      title: "Release handoff",
      provenance: "direct_upload",
    });
    expect(searchContextCheckpointRag(first.id, checkpoint.checkpoint.id, "violet lighthouse").citations).toMatchObject([
      { sourceId: firstUpload.source.id, sourceHash: firstUpload.source.source_hash, provenance: "direct_upload" },
    ]);
    expect(() => ingestCanonicalSource(
      first.id,
      "Changed handoff",
      "A changed handoff must not replace checkpoint evidence.",
      { sourcePath: firstUpload.source.source_path ?? undefined },
    )).toThrow(RagSourceImmutableError);
    expect(() => db.prepare("DELETE FROM rag_sources WHERE id = ?").run(firstUpload.source.id)).toThrow(/immutable|FOREIGN KEY/);
  });

  it("keeps incomplete chunks outside the RAG index and atomically completes hash-verified uploads", () => {
    const { db, first } = setup();
    const content = "Bounded chunk one.\n\nBounded chunk two with a copper observatory.";
    const splitAt = content.indexOf("\n\n") + 2;
    const firstChunk = content.slice(0, splitAt);
    const secondChunk = content.slice(splitAt);
    const session = createContextRagUploadSession(first.id, {
      title: "Chunked context",
      expectedHash: createHash("sha256").update(content).digest("hex"),
      expectedBytes: Buffer.byteLength(content, "utf8"),
      chunkCount: 2,
      mimeType: "text/plain",
      priority: 7,
      tags: ["chunked"],
      metadata: { ticket: "CTX-100" },
      sourceReference: "upload:chunked-context",
      idempotencyKey: "chunked-context-upload",
    });
    expect(session.session).toMatchObject({ status: "pending", source_reference: "upload:chunked-context" });
    appendContextRagUploadChunk(first.id, session.session!.id, { ordinal: 0, content: firstChunk });
    expect(() => completeContextRagUpload(first.id, session.session!.id)).toThrow(
      expect.objectContaining<Partial<ContextRagError>>({ code: "UPLOAD_INCOMPLETE" }),
    );
    expect((db.prepare("SELECT count(*) AS count FROM rag_sources WHERE project_id = ?").get(first.id) as { count: number }).count).toBe(0);

    appendContextRagUploadChunk(first.id, session.session!.id, { ordinal: 1, content: secondChunk });
    const completed = completeContextRagUpload(first.id, session.session!.id);
    expect(completed).toMatchObject({
      deduplicated: false,
      source: { source_hash: createHash("sha256").update(content).digest("hex") },
    });
    expect(searchContextRag(first.id, "copper observatory").citations).toMatchObject([
      {
        sourceId: completed.source.id,
        provenance: "chunked_upload",
        sourceReference: "upload:chunked-context",
      },
    ]);
    expect(getContextRagSource(first.id, completed.source.id)).toMatchObject({
      sourceReference: "upload:chunked-context",
      priority: 7,
      tags: ["chunked"],
      metadata: { ticket: "CTX-100" },
    });
    expect((db.prepare(
      "SELECT status, rag_source_id FROM context_rag_upload_sessions WHERE project_id = ? AND id = ?",
    ).get(first.id, session.session!.id))).toMatchObject({ status: "completed", rag_source_id: completed.source.id });
    expect((db.prepare(
      "SELECT count(*) AS count FROM context_rag_upload_chunks WHERE project_id = ? AND upload_id = ?",
    ).get(first.id, session.session!.id) as { count: number }).count).toBe(0);
  });

  it("rejects path-bearing, malformed, unsupported, and oversized source inputs", () => {
    const { first } = setup();
    const valid = { title: "Bounded source", content: "small source" };
    const secretCanary = "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
    for (const unsafe of [
      { ...valid, path: "/tmp/source.md" },
      { ...valid, file: "source.md" },
      { ...valid, sourcePath: "docs/source.md" },
      { ...valid, filePath: "docs/source.md" },
      { ...valid, mimeType: "application/pdf" },
      { ...valid, metadata: [] },
      { ...valid, metadata: { nested: { filePath: "docs/source.md" } } },
      { ...valid, metadata: { nested: [{ apiKey: "redacted" }] } },
      { ...valid, metadata: { credentials: "redacted" } },
      { ...valid, sourceReference: "/tmp/context.md" },
      { ...valid, sourceReference: "token:redacted" },
      { ...valid, sourceReference: "api-key:redacted" },
      { ...valid, sourceReference: "apiKey:redacted" },
      { ...valid, metadata: { note: secretCanary } },
      { ...valid, sourceReference: secretCanary },
      { ...valid, content: "x".repeat(1_048_577) },
    ]) {
      expect(() => ingestContextRagDocument(first.id, unsafe as never)).toThrow(
        expect.objectContaining<Partial<ContextRagError>>({ code: unsafe.content.length > 1_048_576 ? "UPLOAD_SIZE_MISMATCH" : "INVALID_CONTEXT_RAG_INPUT" }),
      );
    }
    expect(() => createContextRagUploadSession(first.id, {
      title: "Rejected chunked source",
      expectedHash: createHash("sha256").update("bounded content").digest("hex"),
      expectedBytes: Buffer.byteLength("bounded content", "utf8"),
      chunkCount: 1,
      metadata: { nested: { authorization: "redacted" } },
    })).toThrow(expect.objectContaining<Partial<ContextRagError>>({ code: "INVALID_CONTEXT_RAG_INPUT" }));
    expect(() => ingestContextRagDocument(first.id, {
      ...valid,
      metadata: { note: "Reviewed 2026-07-31" },
      sourceReference: "work-item:CTX-100",
    })).not.toThrow();
  });

  it("rejects reassignment of a chunk into an immutable context source", () => {
    const { db, first } = setup();
    const protectedSource = ingestContextRagDocument(first.id, {
      title: "Protected source",
      content: "The protected source must never accept a moved chunk.",
    });
    const mutableSource = ingestCanonicalSource(
      first.id,
      "Mutable source",
      "A mutable source provides the chunk reassignment fixture.",
    );
    const mutableChunk = db.prepare(
      "SELECT id FROM rag_chunks WHERE source_id = ?",
    ).get(mutableSource.id) as { id: string };
    expect(() => db.prepare(
      "UPDATE rag_chunks SET source_id = ? WHERE id = ?",
    ).run(protectedSource.source.id, mutableChunk.id)).toThrow(/immutable/);
  });

  it("requires the complete migration-071 immutable trigger set", () => {
    const { db } = setup();
    const triggers = [
      "rag_sources_context_upload_immutable_update",
      "rag_sources_context_upload_immutable_delete",
      "rag_chunks_context_upload_immutable_insert",
      "rag_chunks_context_upload_immutable_update",
      "rag_chunks_context_upload_immutable_delete",
    ];
    expect(db.prepare(
      "SELECT count(*) AS count FROM pragma_table_info('context_rag_upload_sessions') WHERE name = 'source_reference'",
    ).get()).toEqual({ count: 1 });
    expect(db.prepare(
      `SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name IN (${triggers.map(() => "?").join(", ")})`,
    ).get(...triggers)).toEqual({ count: triggers.length });
    for (const trigger of triggers) db.prepare(`DROP TRIGGER ${trigger}`).run();
    resetDbForTest();
    expect(() => getDb(process.env.INGENIUM_CORE_DB_PATH)).toThrow(
      "Migration 071 is in a PARTIAL state. Missing required components: "
      + "rag_sources_context_upload_immutable_update trigger, "
      + "rag_sources_context_upload_immutable_delete trigger, "
      + "rag_chunks_context_upload_immutable_insert trigger, "
      + "rag_chunks_context_upload_immutable_update trigger, "
      + "rag_chunks_context_upload_immutable_delete trigger. "
      + "Restore the migration's complete schema before retrying.",
    );
  });

  it("returns timestamped current learning and only snapshots it into RAG on an explicit request", () => {
    const { first, second } = setup();
    storeObservation(
      first.id,
      "preference",
      "User prefers source-attributed context answers.",
      8,
      "import",
    );
    const current = getCurrentLearningContext(first.id);
    expect(current).toMatchObject({
      observations: [{ source: "import", content: "User prefers source-attributed context answers." }],
      latestInputAt: expect.any(String),
    });
    const before = searchContextRag(first.id, "source attributed");
    expect(before.citations).toEqual([]);
    const ingested = ingestCurrentLearningContext(first.id);
    expect(ingested).toMatchObject({
      noOp: false,
      result: { upload: { provenance: "learning_snapshot" } },
    });
    expect(searchContextRag(first.id, "source attributed").citations).toMatchObject([
      { provenance: "learning_snapshot" },
    ]);
    expect(ingestCurrentLearningContext(second.id)).toMatchObject({
      noOp: true,
      reason: "NO_CURRENT_LEARNING",
      learning: { latestInputAt: null, latestTraitAt: null },
    });
  });
});
