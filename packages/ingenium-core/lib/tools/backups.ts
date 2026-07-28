import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import { BackupRecord, BackupRestoreJob } from "../schema.js";
import { getGlobalProject } from "./projects.js";

const BACKUP_SCHEMA_VERSION = 47;
const BACKUP_TYPES = new Set(["manual", "scheduled_hourly", "scheduled_daily", "pre_restore"]);
const RESTORE_STATUSES = new Set(["validating", "confirmed", "applying", "completed", "failed", "rolled_back"]);

type BackupComponent = {
  filename: string;
  sha256: string;
  size_bytes: number;
};

type BackupManifest = {
  schema_version: number;
  ingenium: BackupComponent;
  opencode: BackupComponent;
};

function coreDbPath(): string {
  return process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db";
}

/** Resolve the single absolute directory used for all snapshot components. */
export function resolveBackupDirectory(dbPath: string): string {
  const configuredDirectory = process.env.INGENIUM_BACKUPS_DIR?.trim();
  return configuredDirectory
    ? resolve(configuredDirectory)
    : resolve(dirname(dbPath), "backups");
}

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function parseManifest(components: string): BackupManifest | null {
  try {
    const manifest = JSON.parse(components) as Partial<BackupManifest>;
    if (
      manifest.schema_version !== BACKUP_SCHEMA_VERSION ||
      !manifest.ingenium?.filename || !manifest.ingenium.sha256 ||
      !manifest.opencode?.filename || !manifest.opencode.sha256
    ) {
      return null;
    }
    return manifest as BackupManifest;
  } catch {
    return null;
  }
}

function componentPath(dbPath: string, filename: string): string | null {
  const directory = resolveBackupDirectory(dbPath);
  const path = resolve(directory, filename);
  return dirname(path) === directory && basename(path) === filename ? path : null;
}

/** Resolve the owner for every backup operation from the active global project. */
function canonicalBackupOwnerId(): string {
  const global = getGlobalProject();
  if (!global) throw new Error("No active global project is configured");
  return global.id;
}

/** Create a consistent pair of Ingenium and OpenCode SQLite database snapshots. */
export async function createSnapshot(
  _projectId: string,
  backupType: string,
  dbPath: string,
  opencodeDbPath: string,
): Promise<{ backupId: string; filename: string; sizeBytes: number; sha256: string }> {
  const projectId = canonicalBackupOwnerId();
  if (!BACKUP_TYPES.has(backupType)) throw new Error(`Unsupported backup type: ${backupType}`);
  if (!existsSync(opencodeDbPath)) throw new Error(`OpenCode database does not exist: ${opencodeDbPath}`);

  const backupId = randomUUID();
  const directory = resolveBackupDirectory(dbPath);
  const filename = `${backupId}.db`;
  const opencodeFilename = `${backupId}.opencode.db`;
  const ingeniumSnapshotPath = resolve(directory, filename);
  const opencodeSnapshotPath = resolve(directory, opencodeFilename);
  mkdirSync(directory, { recursive: true });

  try {
    await getDb(dbPath).backup(ingeniumSnapshotPath);
    const opencodeDb = new Database(opencodeDbPath, { readonly: true, fileMustExist: true });
    try {
      await opencodeDb.backup(opencodeSnapshotPath);
    } finally {
      opencodeDb.close();
    }

    const manifest: BackupManifest = {
      schema_version: BACKUP_SCHEMA_VERSION,
      ingenium: {
        filename,
        sha256: sha256(ingeniumSnapshotPath),
        size_bytes: statSync(ingeniumSnapshotPath).size,
      },
      opencode: {
        filename: opencodeFilename,
        sha256: sha256(opencodeSnapshotPath),
        size_bytes: statSync(opencodeSnapshotPath).size,
      },
    };
    const manifestJson = JSON.stringify(manifest);
    const combinedSha256 = createHash("sha256").update(manifest.ingenium.sha256).update(manifest.opencode.sha256).digest("hex");
    const sizeBytes = manifest.ingenium.size_bytes + manifest.opencode.size_bytes;

    execTransaction(() => {
      getDb(dbPath).prepare(
        `INSERT INTO backup_records
         (id, project_id, filename, size_bytes, sha256, backup_type, components, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')`,
      ).run(backupId, projectId, filename, sizeBytes, combinedSha256, backupType, manifestJson);
    });
    checkpointAfterWrite();
    return { backupId, filename, sizeBytes, sha256: combinedSha256 };
  } catch (error) {
    rmSync(ingeniumSnapshotPath, { force: true });
    rmSync(opencodeSnapshotPath, { force: true });
    throw error;
  }
}

/** List completed and failed server-owned backup records, newest first. */
export function listBackups(_projectId: string): BackupRecord[] {
  const ownerId = canonicalBackupOwnerId();
  return getDb(coreDbPath()).prepare(
    "SELECT * FROM backup_records WHERE project_id = ? ORDER BY created_at DESC",
  ).all(ownerId) as BackupRecord[];
}

/** Get one backup record from the canonical global owner. */
export function getBackup(_projectId: string, backupId: string): BackupRecord | null {
  const ownerId = canonicalBackupOwnerId();
  return getDb(coreDbPath()).prepare(
    "SELECT * FROM backup_records WHERE project_id = ? AND id = ?",
  ).get(ownerId, backupId) as BackupRecord | undefined ?? null;
}

/** Resolve a validated snapshot component path for streaming or restore. */
export function getBackupComponentPath(
  projectId: string,
  backupId: string,
  component: "ingenium" | "opencode" = "ingenium",
): string | null {
  const backup = getBackup(projectId, backupId);
  if (!backup) return null;
  const manifest = parseManifest(backup.components);
  if (!manifest) return null;
  return componentPath(coreDbPath(), manifest[component].filename);
}

/** Delete backup metadata and its local snapshot component files. */
export function deleteBackup(_projectId: string, backupId: string): void {
  const dbPath = coreDbPath();
  const ownerId = canonicalBackupOwnerId();
  const backup = getBackup(ownerId, backupId);
  if (!backup) return;
  const manifest = parseManifest(backup.components);

  execTransaction(() => {
    getDb(dbPath).prepare("DELETE FROM backup_records WHERE project_id = ? AND id = ?").run(ownerId, backupId);
  });
  checkpointAfterWrite();

  for (const filename of [manifest?.ingenium.filename, manifest?.opencode.filename]) {
    if (!filename) continue;
    const path = componentPath(dbPath, filename);
    if (path) rmSync(path, { force: true });
  }
}

/** Verify snapshot component hashes, SQLite integrity, and the required migration-047 schema. */
export function validateRestorePreflight(backupId: string): { valid: boolean; errors: string[]; manifest: object } {
  const dbPath = coreDbPath();
  const ownerId = canonicalBackupOwnerId();
  const backup = getDb(dbPath).prepare(
    "SELECT * FROM backup_records WHERE project_id = ? AND id = ?",
  ).get(ownerId, backupId) as BackupRecord | undefined;
  const errors: string[] = [];
  const manifest = backup ? parseManifest(backup.components) : null;
  if (!backup) return { valid: false, errors: ["Backup record not found"], manifest: {} };
  if (!manifest) return { valid: false, errors: ["Backup manifest is invalid"], manifest: {} };

  for (const component of [manifest.ingenium, manifest.opencode]) {
    const path = componentPath(dbPath, component.filename);
    if (!path || !existsSync(path)) {
      errors.push(`Backup component is missing: ${component.filename}`);
    } else if (sha256(path) !== component.sha256) {
      errors.push(`Backup component checksum mismatch: ${component.filename}`);
    }
  }

  const calculatedCombinedSha = createHash("sha256")
    .update(manifest.ingenium.sha256)
    .update(manifest.opencode.sha256)
    .digest("hex");
  if (backup.sha256 !== calculatedCombinedSha) errors.push("Backup manifest checksum mismatch");

  const ingeniumPath = componentPath(dbPath, manifest.ingenium.filename);
  if (ingeniumPath && existsSync(ingeniumPath)) {
    const snapshotDb = new Database(ingeniumPath, { readonly: true, fileMustExist: true });
    try {
      const integrity = snapshotDb.pragma("integrity_check", { simple: true });
      if (integrity !== "ok") errors.push("Ingenium snapshot integrity check failed");
      const migration = snapshotDb.prepare(
        "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'backup_records'",
      ).get() as { count: number };
      if (migration.count === 0) errors.push("Ingenium snapshot is incompatible with migration 047");
    } finally {
      snapshotDb.close();
    }
  }

  return { valid: errors.length === 0, errors, manifest };
}

/** Create a restore job after confirming that the backup belongs to the global owner. */
export function startRestore(_projectId: string, backupId: string): string {
  const ownerId = canonicalBackupOwnerId();
  const backup = getBackup(ownerId, backupId);
  if (!backup) throw new Error("Backup not found in the canonical global project");
  const jobId = randomUUID();
  const now = new Date().toISOString();
  execTransaction(() => {
    getDb(coreDbPath()).prepare(
      `INSERT INTO backup_restore_jobs (id, project_id, backup_id, status, components, started_at)
       VALUES (?, ?, ?, 'validating', ?, ?)`,
    ).run(jobId, ownerId, backupId, backup.components, now);
  });
  checkpointAfterWrite();
  return jobId;
}

/**
 * Move legacy per-project backup metadata into the active global namespace.
 *
 * Snapshot files are already stored in the shared backup directory, so this
 * backfill only changes ownership metadata and restore-job ownership. It is
 * idempotent and deliberately refuses to guess when the global project is
 * missing or ambiguous.
 */
export function migrateLegacyBackupOwnership(globalProjectId: string): {
  backupRecords: number;
  restoreJobs: number;
} {
  const ownerId = canonicalBackupOwnerId();
  if (ownerId !== globalProjectId) {
    throw new Error("Backup ownership migration target is not the active global project");
  }

  const migrated = execTransaction(() => {
    const db = getDb(coreDbPath());
    const backupRecords = db.prepare(
      "UPDATE backup_records SET project_id = ? WHERE project_id <> ?",
    ).run(ownerId, ownerId).changes;
    const restoreJobs = db.prepare(
      "UPDATE backup_restore_jobs SET project_id = ? WHERE project_id <> ?",
    ).run(ownerId, ownerId).changes;
    return { backupRecords, restoreJobs };
  });

  if (migrated.backupRecords > 0 || migrated.restoreJobs > 0) checkpointAfterWrite();
  return migrated;
}

/** Update a restore job state and record terminal completion timestamps. */
export function updateRestoreStatus(jobId: string, status: string, error?: string): void {
  if (!RESTORE_STATUSES.has(status)) throw new Error(`Unsupported restore status: ${status}`);
  const now = new Date().toISOString();
  execTransaction(() => {
    const db = getDb(coreDbPath());
    const existing = db.prepare("SELECT id FROM backup_restore_jobs WHERE id = ?").get(jobId);
    if (!existing) throw new Error("Restore job not found");
    db.prepare(
      `UPDATE backup_restore_jobs
       SET status = ?, error_message = ?, started_at = CASE WHEN ? = 'applying' AND started_at IS NULL THEN ? ELSE started_at END,
           completed_at = CASE WHEN ? IN ('completed', 'failed', 'rolled_back') THEN ? ELSE completed_at END
       WHERE id = ?`,
    ).run(status, error ?? null, status, now, status, now, jobId);
  });
  checkpointAfterWrite();
}

/** Get the current state of a restore job. */
export function getRestoreStatus(jobId: string): BackupRestoreJob | null {
  return getDb(coreDbPath()).prepare(
    "SELECT * FROM backup_restore_jobs WHERE id = ?",
  ).get(jobId) as BackupRestoreJob | undefined ?? null;
}
