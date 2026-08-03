import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { getDb, resetDbForTest } from "ingenium-core";
import { jobsRouter } from "../lib/routes/jobs.js";

let directory: string;
let server: Server;
let baseUrl: string;
const projectName = "jobs-trigger-event-api";
const projectId = randomUUID();
const legacyJobId = randomUUID();

function createPre076Database(path: string): void {
  const raw = new Database(path);
  const migrations = resolve(__dirname, "../../../packages/ingenium-core/data/migrations");
  try {
    for (const file of readdirSync(migrations)
      .filter((name) => /^\d{3}_.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 75)
      .sort()) {
      raw.exec(readFileSync(join(migrations, file), "utf8"));
    }
    const createdAt = "2026-08-02T00:00:00.000Z";
    raw.prepare(
      "INSERT INTO projects (id, name, path, is_global, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)",
    ).run(projectId, projectName, "/jobs-trigger-event-api", createdAt, createdAt);
    raw.prepare(
      `INSERT INTO jobs
       (id, project_id, name, agent, prompt_template, trigger_event, enabled, timeout_minutes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'legacy.webhook', 1, 30, ?, ?)`,
    ).run(legacyJobId, projectId, "Legacy event job", "agent", "prompt", createdAt, createdAt);
  } finally {
    raw.close();
  }
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "ingenium-jobs-trigger-api-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  createPre076Database(process.env.INGENIUM_CORE_DB_PATH);
  resetDbForTest();
  getDb(process.env.INGENIUM_CORE_DB_PATH);

  const app = express();
  app.use(express.json());
  app.use("/api/v1/jobs", jobsRouter);
  server = createServer(app);
  await new Promise<void>((complete) => {
    server.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      complete();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((complete) => server.close(() => complete()));
  resetDbForTest();
  delete process.env.INGENIUM_CORE_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

async function postJob(trigger_event: string | null) {
  return fetch(`${baseUrl}/api/v1/jobs?project=${projectName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `Job ${trigger_event ?? "none"}`,
      agent: "agent",
      prompt_template: "prompt",
      trigger_event,
    }),
  });
}

describe("job trigger event API contract", () => {
  it("accepts exact catalog values and null", async () => {
    const cataloged = await postJob("context.conversation.archived");
    expect(cataloged.status).toBe(201);
    expect((await cataloged.json()).data.trigger_event).toBe("context.conversation.archived");

    const noTrigger = await postJob(null);
    expect(noTrigger.status).toBe(201);
    expect((await noTrigger.json()).data.trigger_event).toBeNull();
  });

  it("returns a bounded typed 400 error for unknown events", async () => {
    const response = await postJob("unknown.event");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "UNKNOWN_TRIGGER_EVENT",
        message: "trigger_event must be null or a trusted job event catalog value",
      },
    });
  });

  it("allows unrelated updates to preserved legacy jobs but rejects actual unknown trigger changes", async () => {
    const unrelated = await fetch(`${baseUrl}/api/v1/jobs/${legacyJobId}?project=${projectName}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed legacy event job", expected_revision: 0 }),
    });
    expect(unrelated.status).toBe(200);
    expect((await unrelated.json()).data).toMatchObject({
      name: "Renamed legacy event job",
      trigger_event: "legacy.webhook",
    });

    const rejected = await fetch(`${baseUrl}/api/v1/jobs/${legacyJobId}?project=${projectName}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger_event: "unknown.event", expected_revision: 1 }),
    });
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error.code).toBe("UNKNOWN_TRIGGER_EVENT");
  });
});
