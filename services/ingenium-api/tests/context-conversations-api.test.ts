import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projects, resetDbForTest } from "ingenium-core";
import { contextRouter } from "../lib/routes/context.js";

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
      body: JSON.stringify({ expectedRevision: 2 }),
    });
    expect(staleRestore.status).toBe(409);
    expect((await json(staleRestore)).error).toMatchObject({ code: "REVISION_CONFLICT", currentRevision: 3 });

    const restoredResponse = await fetch(url(`/conversations/${conversation.id}/checkpoints/${checkpoint.checkpoint.id}/restore`), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "api-restore" },
      body: JSON.stringify({ expectedRevision: 3, title: "Recovered context" }),
    });
    expect(restoredResponse.status).toBe(201);
    const restored = (await json(restoredResponse)).data;
    expect(restored).toMatchObject({ revision: 2, conversation: { title: "Recovered context", message_count: 2 } });
    const originalMessages = await fetch(url(`/conversations/${conversation.id}/messages`));
    expect((await json(originalMessages)).data.data).toHaveLength(3);
    const restoredMessages = await fetch(url(`/conversations/${restored.conversation.id}/messages`));
    expect((await json(restoredMessages)).data.data).toHaveLength(2);
  });
});
