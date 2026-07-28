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
  getCurrentLearningContext,
  ingestContextRagDocument,
  ingestCurrentLearningContext,
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
  it("deduplicates direct uploads per project, excludes global sources, and freezes checkpoint citations", () => {
    const { db, first, second } = setup();
    const document = {
      title: "Release handoff",
      content: "The violet lighthouse release needs an immutable handoff record.",
      mimeType: "text/markdown",
      tags: ["handoff", "handoff"],
      metadata: { ticket: "CTX-003" },
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
    expect(searchContextRag(first.id, "violet lighthouse").citations).toMatchObject([
      { sourceId: firstUpload.source.id, provenance: "direct_upload" },
    ]);
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
      idempotencyKey: "chunked-context-upload",
    });
    expect(session.session?.status).toBe("pending");
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
      { sourceId: completed.source.id, provenance: "chunked_upload" },
    ]);
    expect((db.prepare(
      "SELECT status, rag_source_id FROM context_rag_upload_sessions WHERE project_id = ? AND id = ?",
    ).get(first.id, session.session!.id))).toMatchObject({ status: "completed", rag_source_id: completed.source.id });
    expect((db.prepare(
      "SELECT count(*) AS count FROM context_rag_upload_chunks WHERE project_id = ? AND upload_id = ?",
    ).get(first.id, session.session!.id) as { count: number }).count).toBe(0);
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
