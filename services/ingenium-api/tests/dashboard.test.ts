import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { identity, organizations, personality, pipelineEvents, projects } from "ingenium-core";
import { dashboardRouter } from "../lib/routes/dashboard.js";
import { authorizationMiddleware } from "../lib/authorization-policy.js";

const emailMocks = vi.hoisted(() => ({
  listAccounts: vi.fn(() => []),
  getEngineStatus: vi.fn(() => ({ running: false, heartbeatAt: null, accounts: [] })),
}));
const supervisorMocks = vi.hoisted(() => ({ rpc: vi.fn() }));

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
vi.mock("ingenium-email", () => emailMocks);
vi.mock("../lib/supervisor-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/supervisor-client.js")>();
  return { ...actual, supervisorRpc: supervisorMocks.rpc };
});

let tempDir: string;
let projectId: string;
let projectName: string;
let server: Server | null = null;
let baseUrl: string;
const nativeFetch = globalThis.fetch;
const originalDeploymentMode = process.env.INGENIUM_DEPLOYMENT_MODE;

function supervisorResponse(): string {
  const processes = [
    "restore-handoff",
    "ingenium-api",
    "ingenium-api-boundary",
    "ingenium-dashboard",
    "ingenium-gateway",
    "opencode-web",
    "ttyd-opencode",
    "vscode",
  ]
    .map((name) => `<value><struct><member><name>name</name><value><string>${name}</string></value></member><member><name>statename</name><value><string>RUNNING</string></value></member><member><name>start</name><value><i4>1</i4></value></member><member><name>now</name><value><i4>2</i4></value></member></struct></value>`)
    .join("");
  return `<methodResponse><params><param><value><array><data>${processes}</data></array></value></param></params></methodResponse>`;
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/dashboard", dashboardRouter);
  return app;
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-api-dashboard-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "test.db");
  process.env.INGENIUM_DEPLOYMENT_MODE = "compatibility";

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

  supervisorMocks.rpc.mockResolvedValue(supervisorResponse());
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  if (originalDeploymentMode === undefined) delete process.env.INGENIUM_DEPLOYMENT_MODE;
  else process.env.INGENIUM_DEPLOYMENT_MODE = originalDeploymentMode;
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

  it("includes all seven supervised processes in the health strip", async () => {
    const res = await fetch(`${baseUrl}/api/v1/dashboard/summary?project=${projectName}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.health.services).toHaveLength(9);
    expect(body.data.health.services).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "VS Code", status: "running" }),
    ]));
  });

  it("uses the expected Supervisor processes in control-plane mode", async () => {
    process.env.INGENIUM_DEPLOYMENT_MODE = "control-plane";
    try {
      const res = await fetch(`${baseUrl}/api/v1/dashboard/summary?project=${projectName}`);
      const body = await res.json();

      expect(body.data.health.services).toHaveLength(7);
      expect(body.data.health.services).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "Restore Handoff", status: "running" }),
        expect.objectContaining({ name: "API", status: "running" }),
      ]));
      expect(body.data.health.services).not.toContainEqual(expect.objectContaining({ name: "OpenCode" }));
    } finally {
      process.env.INGENIUM_DEPLOYMENT_MODE = "compatibility";
    }
  });

  it("correctly counts tasks by column", async () => {
    const tasksModule = await import("ingenium-core").then((m) => m.tasks);

    // Create tasks in different columns
    tasksModule.createTask(projectId, "Todo 1");
    tasksModule.createTask(projectId, "Todo 2");
    const inProgress = tasksModule.createTask(projectId, "In Progress 1");
    tasksModule.moveTask(projectId, inProgress.id, "in_progress");
    const review = tasksModule.createTask(projectId, "Review 1");
    tasksModule.moveTask(projectId, review.id, "review");

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
    const runs = jobsModule.listJobRuns(projectId, job.id, 1);
    if (runs.length > 0) {
      jobsModule.finishJobRun(projectId, runs[0]!.id, "failed", 1);
    }

    // Create a disabled job — should NOT appear in failedRecently
    const disabledJob = jobsModule.createJob(projectId, "Disabled Job", "test", "agent", "prompt");
    jobsModule.updateJob(projectId, disabledJob.id, { enabled: 0 } as any, disabledJob.revision);

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

  it("does not mark unconfigured mail unhealthy", async () => {
    const res = await fetch(`${baseUrl}/api/v1/dashboard/summary?project=${projectName}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.mail).toMatchObject({
      accountCount: 0,
      engineRunning: false,
      engineHealthy: true,
    });
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

  it("scopes private learning and activity to the authenticated user", async () => {
    const first = identity.createUser("dashboard-first@example.test", "Dashboard First");
    const second = identity.createUser("dashboard-second@example.test", "Dashboard Second");
    for (const user of [first, second]) {
      organizations.addOrganizationMember(organizations.BOOTSTRAP_ORGANIZATION_ID, user.id, "member");
      organizations.addProjectMember(projectId, user.id, "editor");
    }
    personality.upsertTrait(projectId, "communication_style", "first-private", undefined, 0.8, undefined, undefined, { ownerUserId: first.id, visibility: "private" });
    personality.upsertTrait(projectId, "code_preference", "second-private", undefined, 0.8, undefined, undefined, { ownerUserId: second.id, visibility: "private" });
    personality.upsertTrait(projectId, "workflow_pattern", "organization-visible", undefined, 0.8, undefined, undefined, { visibility: "organization" });
    pipelineEvents.logEvent(projectId, "trait_created", "synthesis", "First private activity", undefined, undefined, undefined, undefined, undefined, { ownerUserId: first.id, visibility: "private" });
    pipelineEvents.logEvent(projectId, "skill_created", "synthesis", "Second private activity", undefined, undefined, undefined, undefined, undefined, { ownerUserId: second.id, visibility: "private" });
    pipelineEvents.logEvent(projectId, "synthesis_completed", "synthesis", "Organization activity");

    const authorized = express();
    authorized.use(express.json());
    authorized.use((req, _res, next) => {
      const userId = req.header("x-test-user")!;
      req.principal = { type: "user", id: userId, scopes: ["*"], session: { id: `session-${userId}` } } as any;
      next();
    });
    authorized.use(authorizationMiddleware);
    authorized.use("/api/v1/dashboard", dashboardRouter);
    const isolated = createServer(authorized);
    await new Promise<void>((resolve) => isolated.listen(0, "127.0.0.1", resolve));
    const isolatedUrl = `http://127.0.0.1:${(isolated.address() as AddressInfo).port}/api/v1/dashboard/summary?project=${projectName}`;
    try {
      for (const [viewer, ownTitle, foreignTitle] of [
        [first, "First private activity", "Second private activity"],
        [second, "Second private activity", "First private activity"],
      ] as const) {
        const response = await nativeFetch(isolatedUrl, { headers: { "x-test-user": viewer.id } });
        expect(response.status).toBe(200);
        const summary = await response.json();
        expect(summary.data.learning.displayTraitsCount).toBe(2);
        const titles = summary.data.activity.map((item: { title: string }) => item.title);
        expect(titles).toEqual(expect.arrayContaining([ownTitle, "Organization activity"]));
        expect(titles).not.toContain(foreignTitle);
      }
      const compatibilityResponse = await nativeFetch(`${baseUrl}/api/v1/dashboard/summary?project=${projectName}`);
      const compatibilitySummary = await compatibilityResponse.json();
      expect(compatibilitySummary.data.learning.displayTraitsCount).toBe(1);
      const compatibilityTitles = compatibilitySummary.data.activity.map((item: { title: string }) => item.title);
      expect(compatibilityTitles).toContain("Organization activity");
      expect(compatibilityTitles).not.toContain("First private activity");
      expect(compatibilityTitles).not.toContain("Second private activity");
    } finally {
      await new Promise<void>((resolve) => isolated.close(() => resolve()));
    }
  });
});
