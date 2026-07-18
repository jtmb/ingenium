import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { projects, docs, tasks } from "ingenium-core";
import { servicesRouter } from "../lib/routes/services.js";

let tempDir: string;
let globalProjectId: string;
let server: Server | null = null;
let baseUrl: string;

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/services", servicesRouter);
  return app;
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-api-services-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "test.db");

  // getTasksStatus() calls tasks.listTasks("global-default"), but the FK
  // constraint on tasks.project_id REFERENCES projects(id) requires a UUID.
  // We create the project and store its UUID for creating test tasks.
  const project = projects.createProject("global-default");
  globalProjectId = project.id;

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

describe("GET /api/v1/services/status — applications", () => {
  it("returns all 4 applications in the response", async () => {
    const res = await fetch(`${baseUrl}/api/v1/services/status`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty("data");
    expect(body.data).toHaveProperty("applications");
    expect(Array.isArray(body.data.applications)).toBe(true);
    expect(body.data.applications).toHaveLength(4);

    const names = body.data.applications.map((a: { name: string }) => a.name).sort();
    expect(names).toEqual(["docs-workspace", "email-client", "synthesis-engine", "tasks-board"]);
  });

  it("docs-workspace is idle when no docs exist", async () => {
    const res = await fetch(`${baseUrl}/api/v1/services/status`);
    expect(res.status).toBe(200);
    const body = await res.json();

    const docsApp = body.data.applications.find(
      (a: { name: string }) => a.name === "docs-workspace"
    );
    expect(docsApp).toBeDefined();
    expect(docsApp.state).toBe("idle");
    expect(docsApp.description).toContain("Documentation workspace");
    expect(docsApp.detail).toContain("No documents yet");
  });

  it("tasks-board is idle when no tasks exist", async () => {
    const res = await fetch(`${baseUrl}/api/v1/services/status`);
    expect(res.status).toBe(200);
    const body = await res.json();

    const tasksApp = body.data.applications.find(
      (a: { name: string }) => a.name === "tasks-board"
    );
    expect(tasksApp).toBeDefined();
    expect(tasksApp.state).toBe("idle");
    expect(tasksApp.description).toContain("Task board");
    expect(tasksApp.detail).toContain("No tasks");
  });

  it("docs-workspace becomes healthy when docs exist", async () => {
    // Create a space and a page
    const space = docs.createSpace("Test Space", "test-space");
    docs.createPage(space.id, "Test Page", "test-page");

    const res = await fetch(`${baseUrl}/api/v1/services/status`);
    expect(res.status).toBe(200);
    const body = await res.json();

    const docsApp = body.data.applications.find(
      (a: { name: string }) => a.name === "docs-workspace"
    );
    expect(docsApp).toBeDefined();
    expect(docsApp.state).toBe("healthy");
    expect(docsApp.description).toContain("1 space(s), 1 page(s)");
    expect(docsApp.detail).toContain("1 spaces, 1 pages");
  });

  it("tasks-board becomes healthy when tasks exist in global-default", async () => {
    // getTasksStatus() calls tasks.listTasks("global-default") but the FK
    // constraint requires a real project UUID. We create tasks under the
    // actual global-default project UUID so they're visible to the query.
    tasks.createTask(globalProjectId, "Task 1");
    tasks.createTask(globalProjectId, "Task 2");
    const inProgress = tasks.createTask(globalProjectId, "In Progress");
    tasks.moveTask(inProgress.id, "in_progress");
    const review = tasks.createTask(globalProjectId, "Review");
    tasks.moveTask(review.id, "review");
    const done = tasks.createTask(globalProjectId, "Done");
    tasks.moveTask(done.id, "done");

    const res = await fetch(`${baseUrl}/api/v1/services/status`);
    expect(res.status).toBe(200);
    const body = await res.json();

    const tasksApp = body.data.applications.find(
      (a: { name: string }) => a.name === "tasks-board"
    );
    expect(tasksApp).toBeDefined();
    expect(tasksApp.state).toBe("healthy");
    expect(tasksApp.description).toContain("5 task(s)");
    expect(tasksApp.detail).toContain("2 todo");
    expect(tasksApp.detail).toContain("1 in progress");
    expect(tasksApp.detail).toContain("1 in review");
    expect(tasksApp.detail).toContain("1 done");
  });
});

describe("GET /api/v1/services/applications/:name", () => {
  it("docs-workspace returns stats", async () => {
    const res = await fetch(`${baseUrl}/api/v1/services/applications/docs-workspace`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty("data");
    expect(body.data.name).toBe("docs-workspace");
    expect(body.data.state).toBe("healthy");
    expect(body.data).toHaveProperty("stats");
    expect(body.data.stats).toHaveProperty("spaces");
    expect(body.data.stats).toHaveProperty("pages");
    expect(body.data.stats).toHaveProperty("drafts");
    expect(typeof body.data.stats.spaces).toBe("number");
    expect(typeof body.data.stats.pages).toBe("number");
  });

  it("tasks-board returns stats with byColumn", async () => {
    const res = await fetch(`${baseUrl}/api/v1/services/applications/tasks-board`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty("data");
    expect(body.data.name).toBe("tasks-board");
    expect(body.data.state).toBe("healthy");
    expect(body.data).toHaveProperty("stats");
    expect(body.data.stats).toHaveProperty("total");
    expect(body.data.stats).toHaveProperty("byColumn");
    expect(typeof body.data.stats.total).toBe("number");
    expect(body.data.stats.total).toBeGreaterThanOrEqual(5);

    // Verify byColumn breakdown
    const byColumn = body.data.stats.byColumn;
    expect(byColumn).toHaveProperty("todo");
    expect(byColumn).toHaveProperty("in_progress");
    expect(byColumn).toHaveProperty("review");
    expect(byColumn).toHaveProperty("done");
    expect(byColumn.todo).toBeGreaterThanOrEqual(2);
    expect(byColumn.in_progress).toBeGreaterThanOrEqual(1);
    expect(byColumn.review).toBeGreaterThanOrEqual(1);
    expect(byColumn.done).toBeGreaterThanOrEqual(1);
  });

  it("returns 404 for unknown application", async () => {
    const res = await fetch(`${baseUrl}/api/v1/services/applications/unknown-app`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toContain("Unknown application");
  });
});
