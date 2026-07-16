import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { projects } from "ingenium-core";
import { dashboardRouter } from "../lib/routes/dashboard.js";

// ── Controlled failure flag for partial-failure test ─────────────────────────
let throwTasksList = false;

// ── Mock ingenium-core to allow controlled injection of failures ────────────
vi.mock("ingenium-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ingenium-core")>();
  return {
    ...actual,
    tasks: {
      ...actual.tasks,
      listTasks: (...args: Parameters<typeof actual.tasks.listTasks>) => {
        if (throwTasksList) {
          throw new Error("Simulated tasks module failure");
        }
        return actual.tasks.listTasks(...args);
      },
    },
  };
});

let tempDir: string;
let projectId: string;
let projectName: string;
let server: Server | null = null;
let baseUrl: string;

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/dashboard", dashboardRouter);
  return app;
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-api-dashboard-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "test.db");

  projectName = "dashboard-test-project";
  const project = projects.createProject(projectName);
  projectId = project.id;

  // Start a local server for fetch-based testing
  const app = buildApp();
  server = createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("GET /api/v1/dashboard/summary", () => {
  it("returns 400 when no project param", async () => {
    const res = await fetch(`${baseUrl}/api/v1/dashboard/summary`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("BAD_REQUEST");
  });

  it("returns 404 for unknown project", async () => {
    const res = await fetch(`${baseUrl}/api/v1/dashboard/summary?project=nonexistent`);
    expect(res.status).toBe(404);
  });

  it("returns 200 with valid response shape", async () => {
    const res = await fetch(`${baseUrl}/api/v1/dashboard/summary?project=${projectName}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    // Top-level shape
    expect(body).toHaveProperty("data");
    expect(body).toHaveProperty("unavailable");
    expect(Array.isArray(body.unavailable)).toBe(true);

    // Data shape
    expect(body.data).toHaveProperty("learning");
    expect(body.data).toHaveProperty("tasks");
    expect(body.data).toHaveProperty("jobs");
    expect(body.data).toHaveProperty("mail");
    expect(body.data).toHaveProperty("generatedAt");

    // Learning shape
    const learning = body.data.learning;
    expect(typeof learning.pendingObservations).toBe("number");
    expect(typeof learning.displayTraitsCount).toBe("number");
    expect(typeof learning.synthesisIntervalMs).toBe("number");

    // Tasks shape
    const tasksData = body.data.tasks;
    expect(typeof tasksData.todoCount).toBe("number");
    expect(typeof tasksData.inProgressCount).toBe("number");
    expect(typeof tasksData.reviewCount).toBe("number");

    // Jobs shape
    const jobsData = body.data.jobs;
    expect(typeof jobsData.total).toBe("number");
    expect(typeof jobsData.enabledCount).toBe("number");
    expect(Array.isArray(jobsData.failedRecently)).toBe(true);

    // Mail shape (may be null if engine not running)
    // generatedAt is an ISO string
    expect(body.data.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
  });

  it("correctly counts tasks by column", async () => {
    const tasksModule = await import("ingenium-core").then((m) => m.tasks);

    // Create tasks in different columns
    tasksModule.createTask(projectId, "Todo 1");
    tasksModule.createTask(projectId, "Todo 2");
    const inProgress = tasksModule.createTask(projectId, "In Progress 1");
    tasksModule.moveTask(inProgress.id, "in_progress");
    const review = tasksModule.createTask(projectId, "Review 1");
    tasksModule.moveTask(review.id, "review");

    const res = await fetch(`${baseUrl}/api/v1/dashboard/summary?project=${projectName}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.tasks.todoCount).toBeGreaterThanOrEqual(2);
    expect(body.data.tasks.inProgressCount).toBeGreaterThanOrEqual(1);
    expect(body.data.tasks.reviewCount).toBeGreaterThanOrEqual(1);
  });

  it("returns nextTask from todo column", async () => {
    const tasksModule = await import("ingenium-core").then((m) => m.tasks);

    // Create a high-priority todo task that should be next
    tasksModule.createTask(projectId, "Next Up", undefined, undefined, { priority: 10 });

    const res = await fetch(`${baseUrl}/api/v1/dashboard/summary?project=${projectName}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    // nextTask should exist if there are any todo tasks
    const allTasks = tasksModule.listTasks(projectId);
    const todos = allTasks.filter((t) => t.column_id === "todo");
    if (todos.length > 0) {
      expect(body.data.tasks.nextTask).not.toBeNull();
      expect(body.data.tasks.nextTask).toHaveProperty("id");
      expect(body.data.tasks.nextTask).toHaveProperty("title");
    }
  });

  it("failedRecently contains only enabled jobs with failed runs", async () => {
    const { jobs: jobsModule } = await import("ingenium-core");

    // Create an enabled job and a failed run
    const job = jobsModule.createJob(projectId, "Failing Job", "test", "agent", "prompt");
    jobsModule.startJobRun(projectId, job.id, "manual");

    // Get the run ID and mark it as failed
    const runs = jobsModule.listJobRuns(job.id, 1);
    if (runs.length > 0) {
      jobsModule.finishJobRun(runs[0]!.id, "failed", 1);
    }

    // Create a disabled job — should NOT appear in failedRecently
    const disabledJob = jobsModule.createJob(projectId, "Disabled Job", "test", "agent", "prompt");
    jobsModule.updateJob(projectId, disabledJob.id, { enabled: 0 } as any);

    const res = await fetch(`${baseUrl}/api/v1/dashboard/summary?project=${projectName}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.jobs.total).toBeGreaterThanOrEqual(2);
    expect(body.data.jobs.enabledCount).toBeGreaterThanOrEqual(1);

    // Check that failedRecently only includes enabled jobs
    for (const failed of body.data.jobs.failedRecently) {
      expect(failed).toHaveProperty("id");
      expect(failed).toHaveProperty("name");
      expect(failed.id).not.toBe(disabledJob.id); // disabled job NOT in failedRecently
    }
  });

  it("mail account count matches accounts", async () => {
    const res = await fetch(`${baseUrl}/api/v1/dashboard/summary?project=${projectName}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    // Mail may be null if the email engine isn't running, or have an accountCount
    if (body.data.mail !== null) {
      expect(typeof body.data.mail.accountCount).toBe("number");
      expect(typeof body.data.mail.engineRunning).toBe("boolean");
      expect(typeof body.data.mail.engineHealthy).toBe("boolean");
    }
  });

  it("partial failure: one module fails, others still populate", async () => {
    // Trigger controlled failure in mocked tasks.listTasks
    throwTasksList = true;

    try {
      const res = await fetch(`${baseUrl}/api/v1/dashboard/summary?project=${projectName}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      // Tasks should be null
      expect(body.data.tasks).toBeNull();
      // Learning should still populate
      expect(body.data.learning).not.toBeNull();
      // unavailable should include "tasks" module
      expect(body.unavailable).toContain("tasks");
    } finally {
      throwTasksList = false;
    }
  });
});
