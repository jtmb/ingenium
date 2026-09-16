import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { agents, projects, resetDbForTest } from "ingenium-core";
import { agentsRouter } from "../lib/routes/agents.js";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";

let directory = "";
let server: Server | undefined;
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;

afterEach(async () => {
  if (server) await closeHttpServer(server);
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
  return listenOnLoopback(server);
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

  it("does not permit API callers to create, enable, disable, mutate, or delete the reserved broker", async () => {
    directory = mkdtempSync(join(tmpdir(), "ingenium-agents-route-"));
    process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
    const project = projects.createProject("broker-route-project");
    const baseUrl = await startRouter();
    const endpoint = `${baseUrl}/agents?project=broker-route-project`;

    const create = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "ingenium-llm-broker", content: "# Broker" }),
    });
    expect(create.status).toBe(403);
    await expect(create.json()).resolves.toMatchObject({
      error: { code: "RESERVED_AGENT" },
    });

    const disabledCreate = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "ingenium-llm-broker", content: "# Broker", enabled: false }),
    });
    expect(disabledCreate.status).toBe(403);

    const enabled = await fetch(`${baseUrl}/agents/ingenium-llm-broker/enable?project=broker-route-project`, {
      method: "POST",
    });
    expect(enabled.status).toBe(403);

    for (const body of [
      { content: "# Replacement" },
      { permissions: "{malformed" },
      { metadata: "[malformed" },
      { permissions: JSON.stringify({ read: "allow" }) },
      { metadata: JSON.stringify({ hidden: false }) },
    ]) {
      const response = await fetch(`${baseUrl}/agents/ingenium-llm-broker?project=broker-route-project`, {
        method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      });
      expect(response.status).toBe(403);
    }

    const disabled = await fetch(`${baseUrl}/agents/ingenium-llm-broker/disable?project=broker-route-project`, {
      method: "POST",
    });
    expect(disabled.status).toBe(403);

    expect(agents.getAgent(project.id, "ingenium-llm-broker")).toBeUndefined();

    const deleted = await fetch(`${baseUrl}/agents/ingenium-llm-broker?project=broker-route-project`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(403);
    expect(agents.getAgent(project.id, "ingenium-llm-broker")).toBeUndefined();
  });
});
