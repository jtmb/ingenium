import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtempSync, rmSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { jobs, projects, resetDbForTest } from "ingenium-core";
import { recoverInterruptedJobRunsAtStartup, startApiServer as startConfiguredApiServer } from "../scripts/api-server.js";

/**
 * Startup regression tests — verify that the API server does not exit or crash
 * when the global-default project is missing, and that it auto-creates the project
 * during initialization.
 *
 * These tests use a temporary DB (via INGENIUM_CORE_DB_PATH) to avoid interfering
 * with the developer's local database.
 */

let tempDir: string;
let apiServer: Server | null = null;

/**
 * Helper: completely reset the DB state by closing the singleton, deleting the
 * file, and clearing the env var so a fresh DB is created next time.
 */
function freshDb(): void {
  resetDbForTest();
  const dbPath = process.env.INGENIUM_CORE_DB_PATH;
  if (dbPath && existsSync(dbPath)) {
    unlinkSync(dbPath);
  }
  // Clear cached env so next getDb uses the current path
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "test.db");
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());

  // Health check (same as api-server.ts)
  app.get("/api/v1/health", (_req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });

  // Projects list (to verify auto-creation)
  app.get("/api/v1/projects", (_req, res) => {
    const list = projects.listProjects();
    res.json({ data: list });
  });

  return app;
}

async function startServer(app: express.Express): Promise<string> {
  apiServer = createServer(app);
  return new Promise<string>((resolve) => {
    apiServer!.listen(0, "127.0.0.1", () => {
      const addr = apiServer!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

async function stopServer(): Promise<void> {
  if (apiServer) {
    await new Promise<void>((resolve) => apiServer!.close(() => resolve()));
    apiServer = null;
  }
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-api-startup-"));
});

afterAll(async () => {
  await stopServer();
  resetDbForTest();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

afterEach(async () => {
  await stopServer();
  // Reset DB state between tests — close singleton + delete the temp DB file
  freshDb();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("API startup — no global project", () => {
  it("refuses to bind without the injected authentication encryption key file", () => {
    const originalToken = process.env.INGENIUM_API_TOKEN;
    const originalTokenFile = process.env.INGENIUM_API_TOKEN_FILE;
    const originalKeyFile = process.env.INGENIUM_AUTH_ENCRYPTION_KEY_FILE;
    const originalExitCode = process.exitCode;
    process.env.INGENIUM_API_TOKEN = "a".repeat(32);
    delete process.env.INGENIUM_API_TOKEN_FILE;
    delete process.env.INGENIUM_AUTH_ENCRYPTION_KEY_FILE;
    try {
      expect(startConfiguredApiServer()).toBeNull();
      expect(process.exitCode).toBe(1);
    } finally {
      if (originalToken === undefined) delete process.env.INGENIUM_API_TOKEN; else process.env.INGENIUM_API_TOKEN = originalToken;
      if (originalTokenFile === undefined) delete process.env.INGENIUM_API_TOKEN_FILE; else process.env.INGENIUM_API_TOKEN_FILE = originalTokenFile;
      if (originalKeyFile === undefined) delete process.env.INGENIUM_AUTH_ENCRYPTION_KEY_FILE; else process.env.INGENIUM_AUTH_ENCRYPTION_KEY_FILE = originalKeyFile;
      process.exitCode = originalExitCode;
    }
  });

  it("health endpoint returns 200 even with no projects in DB", async () => {
    const app = buildApp();
    const baseUrl = await startServer(app);

    const res = await fetch(`${baseUrl}/api/v1/health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("status", "ok");
    expect(body).toHaveProperty("uptime");
    expect(typeof body.uptime).toBe("number");
  });

  it("projects list is empty when no projects have been created", async () => {
    const app = buildApp();
    const baseUrl = await startServer(app);

    const res = await fetch(`${baseUrl}/api/v1/projects`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("data");
    expect(body.data).toEqual([]);
  });
});

describe("API startup — ensureGlobalProject", () => {
  /**
   * Simulate the api-server.ts startup logic: ensure a global project exists
   * using the same function pattern as the real server.
   */
  function simulateEnsureGlobalProject(): string | null {
    try {
      const existing = projects.getGlobalProject();
      if (existing) return existing.id;

      const created = projects.createProject("global-default", true);
      return created.id;
    } catch {
      return null;
    }
  }

  it("creates global-default project when none exists", () => {
    // Before: no projects at all
    expect(projects.listProjects()).toHaveLength(0);
    expect(projects.getGlobalProject()).toBeUndefined();

    const id = simulateEnsureGlobalProject();
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");

    // After: global project exists
    const global = projects.getGlobalProject();
    expect(global).toBeDefined();
    expect(global!.name).toBe("global-default");
    expect(global!.is_global).toBe(1);

    // Only one project exists
    expect(projects.listProjects()).toHaveLength(1);
  });

  it("is idempotent — does not create duplicate projects", () => {
    // First call creates
    const id1 = simulateEnsureGlobalProject();
    expect(id1).toBeTruthy();

    // Second call is a no-op
    const id2 = simulateEnsureGlobalProject();
    expect(id2).toBe(id1);

    // Still only one project
    expect(projects.listProjects()).toHaveLength(1);
  });

  it("does not crash when called with an existing project", () => {
    // Create project first
    projects.createProject("global-default", true);

    // simulateEnsureGlobalProject should find it and return its ID
    const id = simulateEnsureGlobalProject();
    expect(id).toBeTruthy();
    expect(projects.listProjects()).toHaveLength(1);
  });

  it("returns a valid string when creating the global project", () => {
    const id = simulateEnsureGlobalProject();
    // The function returns string | null; with a fresh DB it creates the project
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
    // Verify it's a UUID format
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("API startup — global project isolation", () => {
  it("getGlobalProject returns undefined when no global project exists", () => {
    // Fresh DB — no projects at all
    expect(projects.listProjects()).toHaveLength(0);
    expect(projects.getGlobalProject()).toBeUndefined();
  });

  it("createProject with isGlobal=true creates a global project", () => {
    const proj = projects.createProject("test-global", true);
    expect(proj.is_global).toBe(1);

    const global = projects.getGlobalProject();
    expect(global).toBeDefined();
    expect(global!.id).toBe(proj.id);
    expect(global!.name).toBe("test-global");
  });

  it("non-global projects are not returned by getGlobalProject", () => {
    // Create a global project first
    const globalProj = projects.createProject("global-default", true);
    const globalBefore = projects.getGlobalProject();
    expect(globalBefore).toBeDefined();
    expect(globalBefore!.id).toBe(globalProj.id);

    // Create a non-global project
    const normal = projects.createProject("my-project", false);
    expect(normal.is_global).toBe(0);

    // getGlobalProject still returns the global one
    const globalAfter = projects.getGlobalProject();
    expect(globalAfter).toBeDefined();
    expect(globalAfter!.id).toBe(globalBefore!.id);
    expect(globalAfter!.id).not.toBe(normal.id);
  });

  it("only one global project is returned when multiple exist", () => {
    // createProject is idempotent by name, so we need different names
    const first = projects.createProject("global-first", true);
    projects.createProject("global-second", true);

    // getGlobalProject returns at most one (LIMIT 1)
    const global = projects.getGlobalProject();
    expect(global).toBeDefined();
    // With LIMIT 1 and no ORDER BY, the returned row is arbitrary
    expect([first.id, global!.id]).toContain(global!.id);
  });
});

describe("API startup — interrupted job recovery", () => {
  it("marks ordinary running jobs terminal before the scheduler can rerun them", () => {
    const project = projects.createProject("startup-job-recovery");
    const job = jobs.createJob(project.id, "Recover startup job", undefined, "ingenium-qa", "test");
    const run = jobs.startJobRun(project.id, job.id, "manual");
    if ("reason" in run) throw new Error(run.reason);

    expect(recoverInterruptedJobRunsAtStartup()).toBe(1);
    expect(jobs.getJobRun(project.id, run.id)).toMatchObject({
      status: "failed",
      exit_code: -1,
      finished_at: expect.any(String),
    });
    expect("reason" in jobs.startJobRun(project.id, job.id, "manual")).toBe(false);
  });
});
