import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { createProject } from "../../../packages/ingenium-core/lib/tools/projects.js";
import { getDb } from "../../../packages/ingenium-core/lib/db.js";
import Database from "better-sqlite3";
import { backupsRouter } from "../lib/routes/backups.js";

// Override paths for test isolation
const tempDir = mkdtempSync(join(tmpdir(), "ingenium-backup-api-"));
const coreDbPath = join(tempDir, "data.db");
const backupsDir = join(tempDir, "backups");
const overrideBackupsDir = join(tempDir, "override-backups");
const opencodeDbPath = join(tempDir, "opencode.db");

// Set env before any module initialization
process.env.INGENIUM_CORE_DB_PATH = coreDbPath;
process.env.INGENIUM_BACKUPS_DIR = backupsDir;
process.env.OPENCODE_DB_PATH = opencodeDbPath;

// ── Test setup ──────────────────────────────────────────────────────────────────

let server: Server;
let baseUrl: string;
const projectName = "backup-api-test";
let projectId: string;
let globalProjectId: string;

function url(path: string): string {
  return `${baseUrl}/api/v1/backups${path}?project=${projectName}`;
}

beforeAll(async () => {
  // Initialize DB and create the test project
  getDb(coreDbPath);
  mkdirSync(backupsDir, { recursive: true });

  // Create a valid SQLite OpenCode DB for snapshot tests.
  const opencodeDb = new Database(opencodeDbPath);
  opencodeDb.exec("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY)");
  opencodeDb.close();

  globalProjectId = createProject("global-default", true).id;
  projectId = createProject(projectName).id;

  const app = express();
  app.use(express.json());
  app.use("/api/v1/backups", backupsRouter);
  server = createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.INGENIUM_CORE_DB_PATH;
  delete process.env.INGENIUM_BACKUPS_DIR;
  delete process.env.OPENCODE_DB_PATH;
});

// ── Tests ───────────────────────────────────────────────────────────────────────

describe("POST /api/v1/backups — create backup", () => {
  it("creates a backup and returns 201 with the record", async () => {
    const res = await fetch(url(""), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.data.id).toBeTruthy();
    expect(body.data.type).toBe("manual");
    expect(body.data.status).toBe("completed");
    expect(body.data.created_at).toBeTruthy();
    expect(body.data.filename).toMatch(/\.db$/);
    expect(body.data.size).toBeGreaterThan(0);
  });
});

describe("GET /api/v1/backups — list backups", () => {
  it("returns created backups", async () => {
    const res = await fetch(url(""));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data[0].type).toBe("manual");
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  it("ignores an external or unknown URL project context and resolves the global owner", async () => {
    const res = await fetch(`${baseUrl}/api/v1/backups?project=nonexistent`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.every((backup: { id: string }) => backup.id)).toBe(true);
  });
});

describe("backup directory resolution", () => {
  it("uses one contained directory for create, list, download, and restore preview", async () => {
    const defaultDirectory = resolve(tempDir, "backups");
    const relativeOverride = relative(process.cwd(), overrideBackupsDir);
    const scenarios: Array<{ configuredDirectory: string | undefined; expectedDirectory: string }> = [
      { configuredDirectory: undefined, expectedDirectory: defaultDirectory },
      { configuredDirectory: "", expectedDirectory: defaultDirectory },
      { configuredDirectory: " \t ", expectedDirectory: defaultDirectory },
      { configuredDirectory: relativeOverride, expectedDirectory: resolve(overrideBackupsDir) },
    ];
    const previous = process.env.INGENIUM_BACKUPS_DIR;
    let canonicalSnapshot: { backupId: string; filename: string } | undefined;

    try {
      for (const { configuredDirectory, expectedDirectory } of scenarios) {
        if (configuredDirectory === undefined) delete process.env.INGENIUM_BACKUPS_DIR;
        else process.env.INGENIUM_BACKUPS_DIR = configuredDirectory;

        const created = await fetch(url(""), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        expect(created.status).toBe(201);
        const createdBody = await created.json();
        const backupId = createdBody.data.id as string;
        const filename = createdBody.data.filename as string;
        if (expectedDirectory === defaultDirectory && !canonicalSnapshot) {
          canonicalSnapshot = { backupId, filename };
        }
        const existingSnapshot = expectedDirectory === defaultDirectory
          ? canonicalSnapshot!
          : { backupId, filename };

        expect(existsSync(join(expectedDirectory, existingSnapshot.filename))).toBe(true);

        const listed = await fetch(url(""));
        expect(listed.status).toBe(200);
        const listedBody = await listed.json();
        expect(listedBody.data.some((record: { id: string }) => record.id === backupId)).toBe(true);

        const downloaded = await fetch(url(`/${existingSnapshot.backupId}/download`));
        expect(downloaded.status).toBe(200);
        expect((await downloaded.arrayBuffer()).byteLength).toBeGreaterThan(0);

        const preview = await fetch(url("/restore/preview"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ backupId: existingSnapshot.backupId }),
        });
        expect(preview.status).toBe(200);
        expect((await preview.json()).data).toMatchObject({ valid: true, errors: [] });
      }
    } finally {
      if (previous === undefined) delete process.env.INGENIUM_BACKUPS_DIR;
      else process.env.INGENIUM_BACKUPS_DIR = previous;
    }
  });
});

describe("global backup ownership", () => {
  it("stores a backup created from an external URL context under the active global project", async () => {
    const res = await fetch(url(""), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    const record = getDb(coreDbPath)
      .prepare("SELECT project_id FROM backup_records WHERE id = ?")
      .get(body.data.id) as { project_id: string };
    expect(record.project_id).toBe(globalProjectId);
    expect(record.project_id).not.toBe(projectId);
  });
});

describe("GET /api/v1/backups/:id — get backup metadata", () => {
  let backupId: string;

  beforeAll(async () => {
    const res = await fetch(url(""), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const body = await res.json();
    backupId = body.data.id;
  });

  it("returns a single backup record", async () => {
    const res = await fetch(url(`/${backupId}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(backupId);
    expect(body.data.type).toBe("manual");
  });

  it("returns 404 for non-existent backup", async () => {
    const res = await fetch(url("/00000000-0000-0000-0000-000000000000"));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/v1/backups/:id — remove backup", () => {
  let backupId: string;

  beforeAll(async () => {
    const res = await fetch(url(""), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const body = await res.json();
    backupId = body.data.id;
  });

  it("deletes a backup and returns the record", async () => {
    const delRes = await fetch(url(`/${backupId}`), { method: "DELETE" });
    expect(delRes.status).toBe(200);
    const body = await delRes.json();
    expect(body.data.deleted).toBe(true);
    expect(body.data.id).toBe(backupId);

    // Verify it's gone
    const getRes = await fetch(url(`/${backupId}`));
    expect(getRes.status).toBe(404);
  });

  it("returns 404 when deleting a non-existent backup", async () => {
    const res = await fetch(url("/00000000-0000-0000-0000-000000000000"), { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/backups/restore/preview — validate", () => {
  let backupId: string;

  beforeAll(async () => {
    const res = await fetch(url(""), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const body = await res.json();
    backupId = body.data.id;
  });

  it("returns preview for an existing backup", async () => {
    const res = await fetch(url("/restore/preview"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backupId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.backup).toBeDefined();
    expect(body.data.backup.id).toBe(backupId);
    expect(body.data.warnings.length).toBeGreaterThan(0);
    expect(body.data.warnings.some((warning: string) => warning.includes("does not replace active databases"))).toBe(true);
    expect(body.data.valid).toBe(true);
  });

  it("returns 422 when backupId is missing", async () => {
    const res = await fetch(url("/restore/preview"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });

  it("returns 404 for a non-existent backup id", async () => {
    const res = await fetch(url("/restore/preview"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backupId: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/backups/restore — confirmation safety", () => {
  let backupId: string;

  beforeAll(async () => {
    const res = await fetch(url(""), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const body = await res.json();
    backupId = body.data.id;
  });

  it("rejects missing confirmation and only creates a non-applying confirmed job", async () => {
    const rejected = await fetch(url("/restore"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backupId, confirm: false }),
    });
    expect(rejected.status).toBe(422);

    const started = await fetch(url("/restore"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backupId, confirm: true }),
    });
    expect(started.status).toBe(202);
    const startedBody = await started.json();
    expect(startedBody.data.status).toBe("confirmed");
    expect(startedBody.data.restartRequired).toBe(true);

    const status = await fetch(url(`/restore/${startedBody.data.jobId}`));
    expect(status.status).toBe(200);
    const statusBody = await status.json();
    expect(statusBody.data.status).toBe("confirmed");
  });
});

describe("GET /api/v1/backups/schedule — get schedule config", () => {
  it("returns default schedule config", async () => {
    const res = await fetch(`${baseUrl}/api/v1/backups/schedule?project=${projectName}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.data.hourly.enabled).toBe(false);
    expect(body.data.hourly.retention).toBe(24);
    expect(body.data.daily.enabled).toBe(false);
    expect(body.data.daily.retention).toBe(7);
    expect(body.data.manual_retention).toBe(10);
  });
});

describe("PUT /api/v1/backups/schedule — set schedule config", () => {
  it("updates and returns the schedule config", async () => {
    const newConfig = {
      hourly: { enabled: true, retention: 12 },
      daily: { enabled: true, retention: 30 },
      manual_retention: 20,
    };

    const res = await fetch(`${baseUrl}/api/v1/backups/schedule?project=${projectName}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newConfig),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.hourly.enabled).toBe(true);
    expect(body.data.hourly.retention).toBe(12);
    expect(body.data.daily.enabled).toBe(true);
    expect(body.data.daily.retention).toBe(30);
    expect(body.data.manual_retention).toBe(20);
  });

  it("persists the schedule and returns it on subsequent GET", async () => {
    const res = await fetch(`${baseUrl}/api/v1/backups/schedule?project=${projectName}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.hourly.enabled).toBe(true);
    expect(body.data.hourly.retention).toBe(12);
    expect(body.data.daily.enabled).toBe(true);
    expect(body.data.daily.retention).toBe(30);
    expect(body.data.manual_retention).toBe(20);
  });

  it("accepts partial updates without resetting existing values", async () => {
    const res = await fetch(`${baseUrl}/api/v1/backups/schedule?project=${projectName}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hourly: { enabled: false } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.hourly.enabled).toBe(false);
    expect(body.data.daily.retention).toBe(30);
    expect(body.data.manual_retention).toBe(20);
  });
});
