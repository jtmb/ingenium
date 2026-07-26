import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { projects, resetDbForTest } from "ingenium-core";
import { agentsRouter } from "../lib/routes/agents.js";

let directory = "";
let server: Server | undefined;
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  resetDbForTest();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
});

async function startRouter(): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use("/agents", agentsRouter);
  server = createServer(app);
  return await new Promise<string>((resolve) => {
    server!.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`));
  });
}

describe("agent route validation", () => {
  it("rejects traversal names and accepts the chat category", async () => {
    directory = mkdtempSync(join(tmpdir(), "ingenium-agents-route-"));
    process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
    projects.createProject("agent-route-project");
    const baseUrl = await startRouter();

    const invalid = await fetch(`${baseUrl}/agents?project=agent-route-project`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "../escape", content: "# Agent", category: "execution" }),
    });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    const chat = await fetch(`${baseUrl}/agents?project=agent-route-project`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "chat-agent", content: "# Chat", category: "chat" }),
    });
    expect(chat.status).toBe(201);
    await expect(chat.json()).resolves.toMatchObject({ data: { name: "chat-agent", category: "chat" } });
  });
});
