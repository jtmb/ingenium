import {
  settings,
  logger,
  projects,
  maintenanceLocks,
  checkpointAfterWrite,
  backups,
} from "ingenium-core";
import { resolve } from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────────

interface BackupSchedule {
  hourly: { enabled: boolean; retention: number };
  daily: { enabled: boolean; retention: number };
  manual_retention: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** How often the scheduler checks whether it should run (30s). */
const SCHEDULER_TICK_MS = 30_000;
/** Lock TTL: 5 minutes for backup operations (longer for large DBs). */
const BACKUP_LOCK_TTL_MS = 300_000;
/** Lock resource name. */
const LOCK_RESOURCE = "backup";

const DEFAULT_SCHEDULE: BackupSchedule = {
  hourly: { enabled: false, retention: 24 },
  daily: { enabled: false, retention: 7 },
  manual_retention: 10,
};

// ─── Path helpers ───────────────────────────────────────────────────────────

function resolveCoreDbPath(): string {
  return process.env.INGENIUM_CORE_DB_PATH ?? resolve(process.cwd(), ".ingenium", "data.db");
}

function resolveOpencodeDbPath(): string {
  return process.env.OPENCODE_DB_PATH ?? "/home/appuser/.local/share/opencode/opencode.db";
}

// ─── Schedule helpers ───────────────────────────────────────────────────────

function getSchedule(): BackupSchedule {
  try {
    const gid = projects.getGlobalProject()?.id;
    if (gid) {
      const raw = settings.getSetting(gid, "backup_schedule");
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          hourly: {
            enabled: Boolean(parsed.hourly?.enabled),
            retention: Number(parsed.hourly?.retention) || DEFAULT_SCHEDULE.hourly.retention,
          },
          daily: {
            enabled: Boolean(parsed.daily?.enabled),
            retention: Number(parsed.daily?.retention) || DEFAULT_SCHEDULE.daily.retention,
          },
          manual_retention:
            Number(parsed.manual_retention) || DEFAULT_SCHEDULE.manual_retention,
        };
      }
    }
  } catch {
    // Fall through to defaults
  }
  return { ...DEFAULT_SCHEDULE };
}

// ─── Core backup logic ──────────────────────────────────────────────────────

/**
 * Create a backup snapshot of the core database (and optionally the OpenCode DB).
 * Returns the backup metadata or null on failure.
 */
async function createBackup(
  projectId: string,
  type: "hourly" | "daily" | "manual",
): Promise<boolean> {
  try {
    const dbPath = resolveCoreDbPath();
    const opencodeDbPath = resolveOpencodeDbPath();
    const backupType = type === "hourly" ? "scheduled_hourly" : type === "daily" ? "scheduled_daily" : "manual";
    const snapshot = await backups.createSnapshot(projectId, backupType, dbPath, opencodeDbPath);
    logger.info(
      "backup-scheduler",
      `${type} backup created: ${snapshot.backupId} (${(snapshot.sizeBytes / 1024).toFixed(1)} KB)`,
    );
    return true;
  } catch (err: any) {
    logger.error("backup-scheduler", `Backup creation failed: ${err.message}`, {
      error: err.message,
      stack: err.stack?.split("\n").slice(0, 5).join("\n"),
    });
    return false;
  }
}

/**
 * Apply retention policy: delete oldest backups exceeding the retention count
 * for each backup type (hourly, daily, manual).
 */
function applyRetention(projectId: string): void {
  const schedule = getSchedule();
  const records = backups.listBackups(projectId);

  // Retention per type
  const retentionMap: Record<string, number> = {
    scheduled_hourly: schedule.hourly.retention,
    scheduled_daily: schedule.daily.retention,
    manual: schedule.manual_retention,
  };

  const toDelete: typeof records = [];

  for (const type of ["scheduled_hourly", "scheduled_daily", "manual"] as const) {
    const typed = records
      .filter((record) => record.backup_type === type)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()); // oldest first

    const max = retentionMap[type] ?? 0;
    if (typed.length > max) {
      const excess = typed.slice(0, typed.length - max);
      toDelete.push(...excess);
    }
  }

  let deleted = 0;
  for (const record of toDelete) {
    try {
      backups.deleteBackup(projectId, record.id);
      deleted++;
    } catch (err: any) {
      logger.warn("backup-scheduler", `Failed to delete old backup ${record.id}: ${err.message}`);
    }
  }

  if (deleted > 0) {
    logger.info("backup-scheduler", `Retention cleanup: deleted ${deleted} old backup(s)`);
  }
}

// ─── Scheduling state ───────────────────────────────────────────────────────

/** Track the last hourly backup timestamp. */
let lastHourlyAt = 0;
/** Track the last daily backup timestamp. */
let lastDailyAt = 0;

/** Check whether we should run an hourly backup. */
function shouldRunHourly(): boolean {
  const now = Date.now();
  // Hourly: run if at least 55 minutes have passed since last hourly backup
  return now - lastHourlyAt >= 55 * 60 * 1000;
}

/** Check whether we should run a daily backup. */
function shouldRunDaily(): boolean {
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  // Daily: run if at least 23 hours have passed since last daily backup
  return now - lastDailyAt >= 23 * ONE_DAY / 24;
}

// ─── Scheduler tick ─────────────────────────────────────────────────────────

function getGlobalProjectId(): string | null {
  const global = projects.getGlobalProject();
  return global?.id ?? null;
}

async function schedulerTick(): Promise<void> {
  const projectId = getGlobalProjectId();
  if (!projectId) {
    // No global project — skip but keep scheduler alive
    scheduleNext();
    return;
  }

  const schedule = getSchedule();

  // Acquire a maintenance lock so only one scheduler instance creates backups
  const ownerToken = maintenanceLocks.generateOwnerToken();
  const acquired = maintenanceLocks.acquireLock(LOCK_RESOURCE, projectId, ownerToken, BACKUP_LOCK_TTL_MS);

  if (!acquired) {
    logger.debug("backup-scheduler", "Backup lock held by another owner — skipping this cycle");
    scheduleNext();
    return;
  }

  try {
    if (schedule.hourly.enabled && shouldRunHourly()) {
      logger.info("backup-scheduler", "Starting hourly backup");
      const created = await createBackup(projectId, "hourly");
      if (created) {
        lastHourlyAt = Date.now();
      }
    }

    if (schedule.daily.enabled && shouldRunDaily()) {
      logger.info("backup-scheduler", "Starting daily backup");
      const created = await createBackup(projectId, "daily");
      if (created) {
        lastDailyAt = Date.now();
      }
    }

    // Run retention cleanup after any backup activity
    applyRetention(projectId);

    // WAL checkpoint to keep DB healthy
    checkpointAfterWrite();
  } catch (err: any) {
    logger.error("backup-scheduler", `Scheduler tick failed: ${err.message}`, {
      error: err.message,
      stack: err.stack?.split("\n").slice(0, 5).join("\n"),
    });
  } finally {
    maintenanceLocks.releaseLock(LOCK_RESOURCE, projectId, ownerToken);
  }

  scheduleNext();
}

/** Chain the next timeout — same pattern as the main scheduler. */
function scheduleNext(): void {
  const schedule = getSchedule();
  const anyEnabled = schedule.hourly.enabled || schedule.daily.enabled;

  if (anyEnabled) {
    logger.debug("backup-scheduler", `Next backup check in ${SCHEDULER_TICK_MS / 1000}s`);
    setTimeout(() => {
      schedulerTick().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("backup-scheduler", `Unhandled tick error: ${msg}`);
        scheduleNext();
      });
    }, SCHEDULER_TICK_MS);
  } else {
    // No scheduling enabled — check again in 60s in case settings changed
    logger.debug("backup-scheduler", "Backup scheduling disabled — recheck in 60s");
    setTimeout(scheduleNext, 60_000);
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Start the backup scheduler.
 *
 * Uses a room-style chained setTimeout pattern (same as main scheduler.ts)
 * so scheduling intervals can change between ticks without restarting.
 * Reads schedule config from the global project's settings on every tick.
 *
 * Called from the API server's listen callback.
 */
export function startBackupScheduler(): void {
  const schedule = getSchedule();
  const gid = getGlobalProjectId();

  if (gid) {
    for (const record of backups.listBackups(gid)) {
      const createdAt = new Date(record.created_at).getTime();
      if (record.backup_type === "scheduled_hourly") lastHourlyAt = Math.max(lastHourlyAt, createdAt);
      if (record.backup_type === "scheduled_daily") lastDailyAt = Math.max(lastDailyAt, createdAt);
    }
  }

  logger.info(
    "backup-scheduler",
    `Backup scheduler starting. Hourly: ${schedule.hourly.enabled ? `enabled (retain ${schedule.hourly.retention})` : "disabled"}, Daily: ${schedule.daily.enabled ? `enabled (retain ${schedule.daily.retention})` : "disabled"}, Manual retention: ${schedule.manual_retention}. Project: ${gid ?? "none (global project not found)"}`,
  );

  // Initial delay: 15s to avoid startup stampede
  const INITIAL_DELAY_MS = 15_000;

  setTimeout(() => {
    schedulerTick().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("backup-scheduler", `Initial tick failed: ${msg}`);
      scheduleNext();
    });
  }, INITIAL_DELAY_MS);
}
