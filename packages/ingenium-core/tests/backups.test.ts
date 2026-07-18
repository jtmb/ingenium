import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createProject } from "../lib/tools/projects.js";
import { getDb, execTransaction } from "../lib/db.js";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import {
  createSnapshot,
  listBackups,
  getBackup,
  deleteBackup,
  validateRestorePreflight,
  startRestore,
  updateRestoreStatus,
  getRestoreStatus,
} from "../lib/tools/backups.js";

let tempDir: string;
let projectId: string;
let dbPath: string;
let opencodeDbPath: string;

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-test-backups-"));
  dbPath = join(tempDir, "test.db");
  process.env.INGENIUM_CORE_DB_PATH = dbPath;
  getDb(dbPath);

  // Create a valid SQLite OpenCode DB for snapshot testing.
  opencodeDbPath = join(tempDir, "opencode.db");
  const opencodeDb = new Database(opencodeDbPath);
  opencodeDb.exec("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY)");
  opencodeDb.close();

  const project = createProject("test-project");
  projectId = project.id;
});

afterAll(() => {
  delete process.env.INGENIUM_CORE_DB_PATH;
  rmSync(tempDir, { recursive: true, force: true });
});

// ── Helper: insert a raw backup record for functions that don't need
// file-based snapshots (listBackups, getBackup, deleteBackup, etc.)
function insertBackupRecord(
  backupId: string,
  backupType: string = "manual",
): void {
  execTransaction(() => {
    getDb(dbPath).prepare(`
      INSERT INTO backup_records (id, project_id, filename, size_bytes, sha256, backup_type, components, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')
    `).run(
      backupId,
      projectId,
      `${backupId}.db`,
      4096,
      "a" .repeat(64),
      backupType,
      JSON.stringify({
        schema_version: 47,
        ingenium: { filename: `${backupId}.db`, sha256: "a".repeat(64), size_bytes: 2048 },
        opencode: { filename: `${backupId}.opencode.db`, sha256: "b".repeat(64), size_bytes: 2048 },
      }),
    );
  });
}

function insertRestoreJob(
  jobId: string,
  backupId: string,
  status: string = "validating",
): void {
  const now = new Date().toISOString();
  execTransaction(() => {
    getDb(dbPath).prepare(`
      INSERT INTO backup_restore_jobs (id, project_id, backup_id, status, components, started_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(jobId, projectId, backupId, status, "{}", now);
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("backups — createSnapshot", () => {
  // Note: createSnapshot is async and performs file I/O.
  // We verify it inserts the correct DB record.
  it("creates a backup record with correct fields", async () => {
    const result = await createSnapshot(projectId, "manual", dbPath, opencodeDbPath);
    expect(result.backupId).toBeTruthy();
    expect(result.filename).toMatch(/\.db$/);
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.sha256).toBeTruthy();

    // Verify the record was inserted
    const record = getBackup(projectId, result.backupId);
    expect(record).not.toBeNull();
    expect(record!.project_id).toBe(projectId);
    expect(record!.backup_type).toBe("manual");
    expect(record!.status).toBe("completed");
  });

  it("createSnapshot stores the correct backup_type", async () => {
    const scheduled = await createSnapshot(projectId, "scheduled_daily", dbPath, opencodeDbPath);
    const record = getBackup(projectId, scheduled.backupId);
    expect(record!.backup_type).toBe("scheduled_daily");

    const hourly = await createSnapshot(projectId, "scheduled_hourly", dbPath, opencodeDbPath);
    const rec = getBackup(projectId, hourly.backupId);
    expect(rec!.backup_type).toBe("scheduled_hourly");
  });

  it("rejects an unsupported backup type", async () => {
    await expect(
      createSnapshot(projectId, "invalid_type" as any, dbPath, opencodeDbPath),
    ).rejects.toThrow("Unsupported backup type");
  });

  it("rejects a non-existent opencode db path", async () => {
    await expect(
      createSnapshot(projectId, "manual", dbPath, "/nonexistent/opencode.db"),
    ).rejects.toThrow("OpenCode database does not exist");
  });
});

describe("backups — listBackups", () => {
  const bid1 = randomUUID();
  const bid2 = randomUUID();
  const bid3 = randomUUID();

  beforeAll(() => {
    insertBackupRecord(bid1, "manual");
    insertBackupRecord(bid2, "scheduled_daily");
    insertBackupRecord(bid3, "pre_restore");
  });

  it("returns all backup records for the project sorted by date descending", () => {
    const all = listBackups(projectId);
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all.every((r) => r.project_id === projectId)).toBe(true);

    // Verify descending sort
    for (let i = 1; i < all.length; i++) {
      expect(new Date(all[i - 1].created_at).getTime())
        .toBeGreaterThanOrEqual(new Date(all[i].created_at).getTime());
    }
  });

  it("returns empty list for a project with no backups", () => {
    const empty = listBackups("nonexistent-project");
    expect(empty).toEqual([]);
  });
});

describe("backups — getBackup", () => {
  const bid = randomUUID();

  beforeAll(() => {
    insertBackupRecord(bid, "scheduled_daily");
  });

  it("returns a single backup record scoped to the project", () => {
    const record = getBackup(projectId, bid);
    expect(record).not.toBeNull();
    expect(record!.id).toBe(bid);
    expect(record!.backup_type).toBe("scheduled_daily");
    expect(record!.size_bytes).toBeGreaterThan(0);
    expect(record!.sha256).toBeTruthy();
  });

  it("returns null when the backup does not belong to the project", () => {
    const record = getBackup("other-project", bid);
    expect(record).toBeNull();
  });

  it("returns null for a non-existent backup id", () => {
    const record = getBackup(projectId, randomUUID());
    expect(record).toBeNull();
  });
});

describe("backups — deleteBackup", () => {
  const bid = randomUUID();

  beforeAll(() => {
    insertBackupRecord(bid, "manual");
  });

  it("removes the backup record from the DB", () => {
    expect(getBackup(projectId, bid)).not.toBeNull();
    deleteBackup(projectId, bid);
    expect(getBackup(projectId, bid)).toBeNull();
  });

  it("is a no-op when the backup does not exist", () => {
    expect(() => deleteBackup(projectId, randomUUID())).not.toThrow();
  });
});

describe("backups — validateRestorePreflight", () => {
  it("rejects a non-existent backup id", () => {
    const result = validateRestorePreflight(randomUUID());
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Backup record not found");
  });

  it("reports missing files for a record without snapshots on disk", () => {
    const bid = randomUUID();
    insertBackupRecord(bid, "manual");
    const result = validateRestorePreflight(bid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("missing"))).toBe(true);
  });
});

describe("backups — restore lifecycle", () => {
  let backupId: string;
  let jobId: string;

  beforeAll(async () => {
    // Create a real snapshot so we have a valid backup record
    const snapshot = await createSnapshot(projectId, "manual", dbPath, opencodeDbPath);
    backupId = snapshot.backupId;
  });

  it("startRestore creates a restore job", () => {
    jobId = startRestore(projectId, backupId);
    expect(jobId).toBeTruthy();

    const job = getRestoreStatus(jobId);
    expect(job).not.toBeNull();
    expect(job!.backup_id).toBe(backupId);
    expect(job!.status).toBe("validating");
    expect(job!.project_id).toBe(projectId);
  });

  it("startRestore throws when backup does not belong to the project", () => {
    expect(() => startRestore("other-project", backupId)).toThrow("Backup not found for project");
  });

  it("updateRestoreStatus transitions to applying", () => {
    updateRestoreStatus(jobId, "applying");
    const job = getRestoreStatus(jobId);
    expect(job!.status).toBe("applying");
    expect(job!.started_at).toBeTruthy();
  });

  it("updateRestoreStatus transitions to completed", () => {
    updateRestoreStatus(jobId, "completed");
    const job = getRestoreStatus(jobId);
    expect(job!.status).toBe("completed");
    expect(job!.completed_at).toBeTruthy();
  });

  it("updateRestoreStatus records an error message on failure", () => {
    const bid = randomUUID();
    insertBackupRecord(bid, "manual");
    const jid = startRestore(projectId, bid);
    updateRestoreStatus(jid, "failed", "Corrupt backup archive");
    const job = getRestoreStatus(jid);
    expect(job!.status).toBe("failed");
    expect(job!.error_message).toBe("Corrupt backup archive");
    expect(job!.completed_at).toBeTruthy();
  });

  it("updateRestoreStatus throws for unsupported status", () => {
    expect(() => updateRestoreStatus(jobId, "invalid_status")).toThrow("Unsupported restore status");
  });

  it("getRestoreStatus returns null for a non-existent job", () => {
    const job = getRestoreStatus(randomUUID());
    expect(job).toBeNull();
  });
});
