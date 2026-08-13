import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { identity, organizations, projects, resetDbForTest } from "ingenium-core";
import { contextRouter } from "../lib/routes/context.js";
import { ragRouter } from "../lib/routes/rag.js";
import { authorizationMiddleware } from "../lib/authorization-policy.js";

const directory = mkdtempSync(join(tmpdir(), "ingenium-context-conversations-api-"));
const databasePath = join(directory, "data.db");
const projectName = "context-api-primary";
const secondProjectName = "context-api-secondary";
let server: Server;
let baseUrl: string;

function url(path: string, project = projectName): string {
  return `${baseUrl}/api/v1/context${path}${path.includes("?") ? "&" : "?"}project=${project}`;
}

async function json(response: Response): Promise<any> {
  return response.json();
}

beforeAll(async () => {
  process.env.INGENIUM_CORE_DB_PATH = databasePath;
  resetDbForTest();
  projects.createProject(projectName);
  projects.createProject(secondProjectName);

  const app = express();
  app.use(express.json());
  app.use("/api/v1/context", contextRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  resetDbForTest();
  delete process.env.INGENIUM_CORE_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

describe("immutable context conversation API", () => {
  it("enforces project ownership, revisions, idempotency, bounded retrieval, and restore-as-new", async () => {
    const create = await fetch(url("/conversations"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "api-conversation" },
      body: JSON.stringify({ title: "API context conversation", tags: ["api", "api"] }),
    });
    expect(create.status).toBe(201);
    const conversation = (await json(create)).data;
    expect(conversation).toMatchObject({ revision: 0, tags: JSON.stringify(["api"]) });

    const firstAppend = await fetch(url(`/conversations/${conversation.id}/messages`), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "api-message-1" },
      body: JSON.stringify({
        role: "user",
        content: "The violet lighthouse must be restored safely.",
        expectedRevision: 0,
      }),
    });
    expect(firstAppend.status).toBe(201);
    const first = (await json(firstAppend)).data;
    expect(first).toMatchObject({ revision: 1, idempotent: false });
    expect(first.message).not.toHaveProperty("content");

    const repeatedAppend = await fetch(url(`/conversations/${conversation.id}/messages`), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "api-message-1" },
      body: JSON.stringify({
        role: "user",
        content: "The violet lighthouse must be restored safely.",
        expectedRevision: 0,
      }),
    });
    expect(repeatedAppend.status).toBe(201);
    expect((await json(repeatedAppend)).data).toMatchObject({
      idempotent: true,
      message: { id: first.message.id },
    });

    const reusedKey = await fetch(url(`/conversations/${conversation.id}/messages`), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "api-message-1" },
      body: JSON.stringify({ role: "user", content: "Do not leak this body.", expectedRevision: 1 }),
    });
    expect(reusedKey.status).toBe(409);
    expect(JSON.stringify(await json(reusedKey))).not.toContain("Do not leak this body.");

    const secondAppend = await fetch(url(`/conversations/${conversation.id}/messages`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "assistant", content: "A checkpoint records immutable state.", expectedRevision: 1 }),
    });
    const second = (await json(secondAppend)).data;
    expect(secondAppend.status).toBe(201);
    expect(second.revision).toBe(2);

    const checkpointResponse = await fetch(url(`/conversations/${conversation.id}/checkpoints`), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "api-checkpoint" },
      body: JSON.stringify({ expectedRevision: 2, metadata: { reason: "handoff" } }),
    });
    expect(checkpointResponse.status).toBe(201);
    const checkpoint = (await json(checkpointResponse)).data;
    expect(checkpoint).toMatchObject({ revision: 2, checkpoint: { message_count: 2 } });
    const staleAuthorizationResponse = await fetch(url(`/conversations/${conversation.id}/maintenance/authorize`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "restore_checkpoint",
        checkpointId: checkpoint.checkpoint.id,
        expectedRevision: 2,
      }),
    });
    expect(staleAuthorizationResponse.status).toBe(201);
    const staleAuthorization = (await json(staleAuthorizationResponse)).data;

    const listed = await fetch(url(`/conversations/${conversation.id}/messages?limit=1`));
    expect(listed.status).toBe(200);
    const firstPage = (await json(listed)).data;
    expect(firstPage.data).toHaveLength(1);
    expect(firstPage.data[0]).not.toHaveProperty("content");
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    const secondPage = await fetch(url(`/conversations/${conversation.id}/messages?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`));
    expect((await json(secondPage)).data.data).toMatchObject([{ id: second.message.id }]);

    const searched = await fetch(url(`/conversations/${conversation.id}/messages/search?q=violet%20lighthouse`));
    expect(searched.status).toBe(200);
    const matches = (await json(searched)).data;
    expect(matches).toMatchObject([{ id: first.message.id }]);
    expect(matches[0]).not.toHaveProperty("content");

    const batch = await fetch(url(`/conversations/${conversation.id}/messages/batch`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageIds: [second.message.id, "00000000-0000-0000-0000-000000000000", first.message.id] }),
    });
    expect(batch.status).toBe(200);
    expect((await json(batch)).data).toMatchObject({
      messages: [{ id: second.message.id }, { id: first.message.id }],
      missingIds: ["00000000-0000-0000-0000-000000000000"],
    });

    const retrieve = await fetch(url(`/conversations/${conversation.id}/messages/${first.message.id}`));
    expect(retrieve.status).toBe(200);
    expect((await json(retrieve)).data.content).toContain("violet lighthouse");
    const crossProjectRetrieve = await fetch(url(`/conversations/${conversation.id}/messages/${first.message.id}`, secondProjectName));
    expect(crossProjectRetrieve.status).toBe(404);

    const thirdAppend = await fetch(url(`/conversations/${conversation.id}/messages`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "tool", content: "Source branch continues.", expectedRevision: 2 }),
    });
    expect(thirdAppend.status).toBe(201);
    const staleRestore = await fetch(url(`/conversations/${conversation.id}/checkpoints/${checkpoint.checkpoint.id}/restore`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: 2, confirmationToken: staleAuthorization.confirmationToken }),
    });
    expect(staleRestore.status).toBe(409);
    expect((await json(staleRestore)).error).toMatchObject({ code: "REVISION_CONFLICT", currentRevision: 3 });

    const restoreAuthorizationResponse = await fetch(url(`/conversations/${conversation.id}/maintenance/authorize`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "restore_checkpoint",
        checkpointId: checkpoint.checkpoint.id,
        expectedRevision: 3,
      }),
    });
    expect(restoreAuthorizationResponse.status).toBe(201);
    const restoreAuthorization = (await json(restoreAuthorizationResponse)).data;

    const restoredResponse = await fetch(url(`/conversations/${conversation.id}/checkpoints/${checkpoint.checkpoint.id}/restore`), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "api-restore" },
      body: JSON.stringify({
        expectedRevision: 3,
        confirmationToken: restoreAuthorization.confirmationToken,
        title: "Recovered context",
      }),
    });
    expect(restoredResponse.status).toBe(201);
    const restored = (await json(restoredResponse)).data;
    expect(restored).toMatchObject({ revision: 2, conversation: { title: "Recovered context", message_count: 2 } });
    const originalMessages = await fetch(url(`/conversations/${conversation.id}/messages`));
    expect((await json(originalMessages)).data.data).toHaveLength(3);
    const restoredMessages = await fetch(url(`/conversations/${restored.conversation.id}/messages`));
    expect((await json(restoredMessages)).data.data).toHaveLength(2);
  });

  it("uses preview, authorization, append-only archive events, and content-free audit records", async () => {
    const create = await fetch(url("/conversations"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Maintenance candidate" }),
    });
    const conversation = (await json(create)).data;
    const append = await fetch(url(`/conversations/${conversation.id}/messages`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: "user",
        content: "never reflect this maintenance body",
        expectedRevision: 0,
      }),
    });
    expect(append.status).toBe(201);

    const preview = await fetch(url("/conversations/maintenance/preview"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationIds: [conversation.id],
        staleBefore: new Date(Date.now() + 1_000).toISOString(),
      }),
    });
    expect(preview.status).toBe(200);
    const previewBody = await json(preview);
    expect(previewBody.data).toMatchObject([{ conversationId: conversation.id, reasons: ["STALE"] }]);
    expect(JSON.stringify(previewBody)).not.toContain("maintenance body");

    const crossProjectPreview = await fetch(url("/conversations/maintenance/preview", secondProjectName), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationIds: [conversation.id] }),
    });
    expect((await json(crossProjectPreview)).data).toEqual([]);

    const authorization = await fetch(url(`/conversations/${conversation.id}/maintenance/authorize`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "archive_conversation", expectedRevision: 1 }),
    });
    expect(authorization.status).toBe(201);
    const confirmation = (await json(authorization)).data.confirmationToken as string;
    const archive = await fetch(url(`/conversations/${conversation.id}/archive`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: 1, confirmationToken: confirmation }),
    });
    expect(archive.status).toBe(200);
    expect((await json(archive)).data).toMatchObject({ archived: true, event: { event_type: "conversation_archived" } });

    const audit = await fetch(url(`/conversations/${conversation.id}/maintenance/audit`));
    expect(audit.status).toBe(200);
    const auditBody = await json(audit);
    expect(auditBody.data).toMatchObject([{ event_type: "conversation_archived", conversation_id: conversation.id }]);
    expect(JSON.stringify(auditBody)).not.toContain("maintenance body");
    expect(JSON.stringify(auditBody)).not.toContain(confirmation);

    const appendArchived = await fetch(url(`/conversations/${conversation.id}/messages`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "assistant", content: "blocked", expectedRevision: 1 }),
    });
    expect(appendArchived.status).toBe(409);
    expect((await json(appendArchived)).error.code).toBe("CONVERSATION_ARCHIVED");
  });

  it("returns a body-free 404 when an organization administrator requests another user's private conversation", async () => {
    const owner = identity.createUser("api-private-owner@example.test", "API Private Owner");
    const admin = identity.createUser("api-content-admin@example.test", "API Content Admin");
    organizations.addOrganizationMember(organizations.BOOTSTRAP_ORGANIZATION_ID, owner.id, "admin");
    organizations.addOrganizationMember(organizations.BOOTSTRAP_ORGANIZATION_ID, admin.id, "admin");
    const authorized = express();
    authorized.use(express.json());
    authorized.use((req, _res, next) => {
      const userId = req.header("x-test-user")!;
      req.principal = { type: "user", id: userId, email: `${userId}@example.test`, scopes: ["*"], session: { id: `session-${userId}` } } as any;
      next();
    });
    authorized.use(authorizationMiddleware);
    authorized.use("/api/v1/context", contextRouter);
    authorized.use("/api/v1/rag", ragRouter);
    const isolated = createServer(authorized);
    await new Promise<void>((resolve) => isolated.listen(0, "127.0.0.1", resolve));
    const isolatedUrl = `http://127.0.0.1:${(isolated.address() as AddressInfo).port}/api/v1/context`;
    try {
      const create = await fetch(`${isolatedUrl}/conversations?project=${projectName}`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-test-user": owner.id }, body: JSON.stringify({ title: "private API body" }),
      });
      expect(create.status).toBe(201);
      const conversation = (await json(create)).data;
      const denied = await fetch(`${isolatedUrl}/conversations/${conversation.id}?project=${projectName}`, { headers: { "x-test-user": admin.id } });
      expect(denied.status).toBe(404);
      expect(JSON.stringify(await json(denied))).not.toContain("private API body");

      const source = await fetch(`${isolatedUrl}/uploads?project=${projectName}`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-test-user": owner.id },
        body: JSON.stringify({ title: "private source", content: "private-rag-canary" }),
      });
      expect(source.status).toBe(201);
      const sourceId = (await json(source)).data.source.id;
      const ownerSearch = await fetch(`${isolatedUrl}/rag/search?project=${projectName}&q=private-rag-canary`, { headers: { "x-test-user": owner.id } });
      expect((await json(ownerSearch)).data).toContainEqual(expect.objectContaining({ sourceId }));
      const deniedSearch = await fetch(`${isolatedUrl}/rag/search?project=${projectName}&q=private-rag-canary`, { headers: { "x-test-user": admin.id } });
      expect(await json(deniedSearch)).toMatchObject({ data: [] });
      const deniedSource = await fetch(`${isolatedUrl}/sources/${sourceId}?project=${projectName}`, { headers: { "x-test-user": admin.id } });
      expect(deniedSource.status).toBe(404);
      expect(JSON.stringify(await json(deniedSource))).not.toContain("private-rag-canary");
      const deniedGenericSource = await fetch(`${isolatedUrl.replace("/context", "/rag")}/sources/${sourceId}?project=${projectName}`, { headers: { "x-test-user": admin.id } });
      expect(deniedGenericSource.status).toBe(404);
      expect(JSON.stringify(await json(deniedGenericSource))).not.toContain("private-rag-canary");

      const chunk = "private-chunk-canary";
      const chunked = await fetch(`${isolatedUrl}/uploads/chunked?project=${projectName}`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-test-user": owner.id },
        body: JSON.stringify({
          title: "private chunked source", expectedHash: createHash("sha256").update(chunk).digest("hex"),
          expectedBytes: Buffer.byteLength(chunk), chunkCount: 1,
        }),
      });
      expect(chunked.status).toBe(201);
      const uploadId = (await json(chunked)).data.session.id;
      const deniedChunk = await fetch(`${isolatedUrl}/uploads/${uploadId}/chunks?project=${projectName}`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-test-user": admin.id },
        body: JSON.stringify({ ordinal: 0, content: chunk }),
      });
      expect(deniedChunk.status).toBe(404);
      expect(JSON.stringify(await json(deniedChunk))).not.toContain(chunk);
    } finally {
      await new Promise<void>((resolve) => isolated.close(() => resolve()));
    }
  });
});
