/**
 * CTX-005 integration workflow.
 *
 * Uses isolated SQLite and deterministic local HTTP fixtures only: no external
 * provider credentials, real OpenCode session, or shared learning data.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projects, resetDbForTest, settings } from "ingenium-core";
import { contextRouter } from "../lib/routes/context.js";
import { observationsRouter } from "../lib/routes/observations.js";
import { pipelineRouter } from "../lib/routes/pipeline.js";
import { synthesisRouter } from "../lib/routes/synthesis.js";

const projectName = "ctx-005-e2e";
const preference = "User prefers orchid mode for deployment summaries.";
const normalizedPreference = "User prefers orchid mode for deployment summaries";
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;

let directory = "";
let apiServer: Server | undefined;
let apiBaseUrl = "";
let fixtureLlmServer: Server;
let fixtureLlmPort = 0;
let capturedObservationId = 0;

function url(path: string): string {
  return `${apiBaseUrl}${path}${path.includes("?") ? "&" : "?"}project=${projectName}`;
}

function jsonResponse(content: string) {
  return JSON.stringify({ choices: [{ message: { content } }] });
}

async function requestJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body.length === 0 ? {} : JSON.parse(body) as Record<string, unknown>;
}

async function startApiServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/v1/context", contextRouter);
  app.use("/api/v1/observations", observationsRouter);
  app.use("/api/v1/pipeline", pipelineRouter);
  app.use("/api/v1/synthesis", synthesisRouter);
  apiServer = createServer(app);
  await new Promise<void>((resolve) => {
    apiServer!.listen(0, "127.0.0.1", () => {
      apiBaseUrl = `http://127.0.0.1:${(apiServer!.address() as AddressInfo).port}`;
      resolve();
    });
  });
}

async function waitForSynthesis(): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 2_000;
  let status: Record<string, unknown> | undefined;
  while (Date.now() < deadline) {
    const response = await fetch(url("/api/v1/synthesis/status"));
    expect(response.status).toBe(200);
    status = (await response.json() as { data: Record<string, unknown> }).data;
    if (status.pending_count === 0 && status.processed_count === 1 && status.trait_count === 1) {
      return status;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for fixture synthesis: ${JSON.stringify(status)}`);
}

beforeAll(async () => {
  fixtureLlmServer = createServer(async (request, response) => {
    const body = await requestJson(request);
    const messages = body.messages as Array<{ content?: string }> | undefined;
    const systemPrompt = messages?.[0]?.content ?? "";
    const content = systemPrompt.includes("personality model consolidator")
      ? JSON.stringify({
        create: [{
          trait_type: "communication_style",
          trait_value: normalizedPreference,
          confidence_hint: 0.12,
          observation_ids: [capturedObservationId],
        }],
        confirm: [],
        ignore_count: 0,
      })
      : JSON.stringify({
        skills_to_create: [],
        skills_to_update: [],
        insights: [],
        summary: "No skill changes for the deterministic CTX-005 fixture.",
      });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(jsonResponse(content));
  });
  await new Promise<void>((resolve) => {
    fixtureLlmServer.listen(0, "127.0.0.1", () => {
      fixtureLlmPort = (fixtureLlmServer.address() as AddressInfo).port;
      resolve();
    });
  });
});

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "ingenium-ctx-005-e2e-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  resetDbForTest();
  const global = projects.createProject("global-default", true);
  projects.createProject(projectName);
  settings.setSetting(global.id, "synthesis_model", "ctx-005-fixture");
  settings.setSetting(global.id, "synthesis_endpoint", `http://127.0.0.1:${fixtureLlmPort}`);
  settings.setSetting(global.id, "synthesis_allow_private_network", "true");
  capturedObservationId = 0;
  await startApiServer();
});

afterEach(async () => {
  if (apiServer) await new Promise<void>((resolve) => apiServer!.close(() => resolve()));
  apiServer = undefined;
  resetDbForTest();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
});

afterAll(async () => {
  await new Promise<void>((resolve) => fixtureLlmServer.close(() => resolve()));
});

describe("CTX-005 end-to-end context use", () => {
  it("captures, consolidates, indexes, retrieves, governs, and omits a disposable preference", async () => {
    const flowStartedAt = Date.now();
    const captureResponse = await fetch(url("/api/v1/observations"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        observation_type: "preference",
        content: preference,
        importance: 8,
        source: "manual",
      }),
    });
    expect(captureResponse.status).toBe(201);
    const captured = (await captureResponse.json() as { data: Record<string, unknown> }).data;
    capturedObservationId = captured.id as number;
    expect(captured).toMatchObject({
      observation_type: "preference",
      content: preference,
      status: "pending",
      source: "manual",
    });
    expect(Date.parse(captured.created_at as string)).toBeGreaterThanOrEqual(flowStartedAt);

    const synthesisResponse = await fetch(url("/api/v1/synthesis/run"), { method: "POST" });
    expect(synthesisResponse.status).toBe(200);
    expect((await synthesisResponse.json()).data).toMatchObject({ status: "started" });
    const synthesisStatus = await waitForSynthesis();
    expect(typeof synthesisStatus.last_synthesis_at).toBe("string");

    const learningResponse = await fetch(url("/api/v1/context/learning/current"));
    expect(learningResponse.status).toBe(200);
    const learning = (await learningResponse.json() as { data: {
      observations: Array<Record<string, unknown>>;
      traits: Array<Record<string, unknown>>;
      latestInputAt: string | null;
      latestTraitAt: string | null;
    } }).data;
    expect(learning.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: capturedObservationId, status: "processed", content: preference }),
    ]));
    expect(learning.traits).toEqual(expect.arrayContaining([
      expect.objectContaining({ trait_value: normalizedPreference, source: "synthesis" }),
    ]));
    expect(Date.parse(learning.latestInputAt!)).toBeGreaterThanOrEqual(flowStartedAt);
    expect(Date.parse(learning.latestTraitAt!)).toBeGreaterThanOrEqual(flowStartedAt);

    const eventsResponse = await fetch(url("/api/v1/pipeline/events?limit=20"));
    expect(eventsResponse.status).toBe(200);
    const eventTypes = (await eventsResponse.json() as { data: Array<{ event_type: string }> }).data
      .map((event) => event.event_type);
    expect(eventTypes).toEqual(expect.arrayContaining([
      "observation_created",
      "synthesis_started",
      "trait_created",
      "synthesis_completed",
    ]));

    const snapshotResponse = await fetch(url("/api/v1/context/learning/ingest"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        observationIds: [capturedObservationId],
        title: "CTX-005 deterministic preference snapshot",
      }),
    });
    expect(snapshotResponse.status).toBe(201);
    const snapshot = (await snapshotResponse.json() as { data: Record<string, any> }).data;
    expect(snapshot).toMatchObject({
      noOp: false,
      upload: { provenance: "learning_snapshot" },
      source: { sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/), chunkCount: expect.any(Number) },
    });
    const sourceId = snapshot.source.id as string;
    const sourceHash = snapshot.source.sourceHash as string;

    const relevantResponse = await fetch(url("/api/v1/context/rag/search?q=orchid%20mode"));
    expect(relevantResponse.status).toBe(200);
    const relevant = (await relevantResponse.json() as { data: Array<Record<string, unknown>>; total: number });
    expect(relevant.total).toBeGreaterThan(0);
    expect(relevant.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId,
        sourceHash,
        provenance: "learning_snapshot",
        sourceReference: expect.stringMatching(/^learning:/),
      }),
    ]));

    const irrelevantResponse = await fetch(url("/api/v1/context/rag/search?q=granite%20astrolabe"));
    expect(irrelevantResponse.status).toBe(200);
    expect(await irrelevantResponse.json()).toEqual({ data: [], total: 0 });

    const conversationResponse = await fetch(url("/api/v1/context/conversations"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "CTX-005 preference handoff", tags: ["ctx-005", "preference"] }),
    });
    expect(conversationResponse.status).toBe(201);
    const conversation = (await conversationResponse.json() as { data: { id: string; revision: number } }).data;
    expect(conversation.revision).toBe(0);

    const appendPreferenceResponse = await fetch(url(`/api/v1/context/conversations/${conversation.id}/messages`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user", content: preference, expectedRevision: 0 }),
    });
    expect(appendPreferenceResponse.status).toBe(201);
    expect((await appendPreferenceResponse.json()).data).toMatchObject({ revision: 1, idempotent: false });

    const checkpointResponse = await fetch(url(`/api/v1/context/conversations/${conversation.id}/checkpoints`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: 1, ragSourceIds: [sourceId] }),
    });
    expect(checkpointResponse.status).toBe(201);
    const checkpoint = (await checkpointResponse.json() as { data: { checkpoint: { id: string; state_hash: string; message_count: number } } }).data.checkpoint;
    expect(checkpoint).toMatchObject({ message_count: 1, state_hash: expect.stringMatching(/^[a-f0-9]{64}$/) });

    const checkpointDetailResponse = await fetch(url(`/api/v1/context/conversations/${conversation.id}/checkpoints/${checkpoint.id}`));
    expect(checkpointDetailResponse.status).toBe(200);
    expect((await checkpointDetailResponse.json()).data).toMatchObject({
      checkpoint: { id: checkpoint.id, state_hash: checkpoint.state_hash, message_count: 1 },
      ragSources: [{ rag_source_id: sourceId }],
    });

    const historicalRelevantResponse = await fetch(url(`/api/v1/context/conversations/${conversation.id}/checkpoints/${checkpoint.id}/rag/search?q=orchid%20mode`));
    expect(historicalRelevantResponse.status).toBe(200);
    expect((await historicalRelevantResponse.json()).data).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId, sourceHash, provenance: "learning_snapshot" }),
    ]));

    const appendLaterResponse = await fetch(url(`/api/v1/context/conversations/${conversation.id}/messages`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "assistant", content: "A later request must not alter the checkpoint.", expectedRevision: 1 }),
    });
    expect(appendLaterResponse.status).toBe(201);

    const restoreAuthorizationResponse = await fetch(url(`/api/v1/context/conversations/${conversation.id}/maintenance/authorize`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "restore_checkpoint", checkpointId: checkpoint.id, expectedRevision: 2 }),
    });
    expect(restoreAuthorizationResponse.status).toBe(201);
    const restoreAuthorization = (await restoreAuthorizationResponse.json() as { data: { confirmationToken: string } }).data;
    const restoreResponse = await fetch(url(`/api/v1/context/conversations/${conversation.id}/checkpoints/${checkpoint.id}/restore`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 2,
        confirmationToken: restoreAuthorization.confirmationToken,
        title: "CTX-005 restored preference handoff",
      }),
    });
    expect(restoreResponse.status).toBe(201);
    const restored = (await restoreResponse.json() as { data: { conversation: { id: string; message_count: number }; checkpoint: { state_hash: string } } }).data;
    expect(restored).toMatchObject({
      conversation: { message_count: 1 },
      checkpoint: { state_hash: checkpoint.state_hash },
    });

    const sourceMessagesResponse = await fetch(url(`/api/v1/context/conversations/${conversation.id}/messages`));
    expect((await sourceMessagesResponse.json()).data.data).toHaveLength(2);
    const restoredMessagesResponse = await fetch(url(`/api/v1/context/conversations/${restored.conversation.id}/messages`));
    expect((await restoredMessagesResponse.json()).data.data).toHaveLength(1);

    const archiveAuthorizationResponse = await fetch(url(`/api/v1/context/conversations/${conversation.id}/maintenance/authorize`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "archive_conversation", expectedRevision: 2 }),
    });
    expect(archiveAuthorizationResponse.status).toBe(201);
    const archiveAuthorization = (await archiveAuthorizationResponse.json() as { data: { confirmationToken: string } }).data;
    const archiveResponse = await fetch(url(`/api/v1/context/conversations/${conversation.id}/archive`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: 2, confirmationToken: archiveAuthorization.confirmationToken }),
    });
    expect(archiveResponse.status).toBe(200);
    expect((await archiveResponse.json()).data).toMatchObject({
      archived: true,
      event: {
        event_type: "conversation_archived",
        source_actor_type: "compatibility",
        source_actor_id: null,
      },
    });

    const blockedAppendResponse = await fetch(url(`/api/v1/context/conversations/${conversation.id}/messages`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "assistant", content: "This must not be appended.", expectedRevision: 2 }),
    });
    expect(blockedAppendResponse.status).toBe(409);
    expect((await blockedAppendResponse.json()).error).toMatchObject({ code: "CONVERSATION_ARCHIVED" });

    const auditResponse = await fetch(url(`/api/v1/context/conversations/${conversation.id}/maintenance/audit`));
    expect(auditResponse.status).toBe(200);
    const audit = (await auditResponse.json() as { data: Array<{ event_type: string }> }).data;
    expect(audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: "checkpoint_restored_as_new" }),
      expect.objectContaining({ event_type: "conversation_archived" }),
    ]));

    const archivedHistoricalResponse = await fetch(url(`/api/v1/context/conversations/${conversation.id}/checkpoints/${checkpoint.id}/rag/search?q=orchid%20mode`));
    expect(archivedHistoricalResponse.status).toBe(200);
    expect((await archivedHistoricalResponse.json()).data).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId, sourceHash, provenance: "learning_snapshot" }),
    ]));
  });
});
