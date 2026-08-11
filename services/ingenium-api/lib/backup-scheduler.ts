import {
  settings,
  logger,
  projects,
  maintenanceLocks,
  checkpointAfterWrite,
  backups,
} from "ingenium-core";
import { resolve } from "node:path";

interface BackupSchedule {
  hourly: { enabled: boolean; retention: number };
  daily: { enabled: boolean; retention: number };
  manual_retention: number;
}

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

function resolveCoreDbPath(): string {
  return process.env.INGENIUM_CORE_DB_PATH ?? resolve(process.cwd(), ".ingenium", "data.db");
}

function resolveOpencodeDbPath(): string {
  return process.env.OPENCODE_DB_PATH ?? "/home/appuser/.local/share/opencode/opencode.db";
}

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

/** Match deleteBackup's v2-only boundary so retention never attempts legacy records. */
function isDeletableBackupRecord(record: { id: string; filename: string; components: string }): boolean {
  try {
    return JSON.parse(record.components)?.format === backups.BACKUP_BUNDLE_FORMAT
      && record.filename === record.id;
  } catch {
    return false;
  }
}

/** Reports whether the snapshot completed successfully. */
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
      .filter((record) => record.backup_type === type && isDeletableBackupRecord(record))
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

/** Track the last hourly backup timestamp. */
let lastHourlyAt = 0;
/** Track the last daily backup timestamp. */
let lastDailyAt = 0;
let backupSchedulerRunning = false;
let backupSchedulerGeneration = 0;
let scheduledTimer: ReturnType<typeof setTimeout> | null = null;
let activeTick: Promise<void> | null = null;

function isBackupSchedulerActive(generation: number): boolean {
  return backupSchedulerRunning && backupSchedulerGeneration === generation;
}

function scheduleTimeout(generation: number, delayMs: number, callback: () => void): void {
  if (!isBackupSchedulerActive(generation)) return;
  if (scheduledTimer) clearTimeout(scheduledTimer);

  scheduledTimer = setTimeout(() => {
    scheduledTimer = null;
    if (!isBackupSchedulerActive(generation)) return;
    callback();
  }, delayMs);
}

function shouldRunHourly(): boolean {
  const now = Date.now();
  // Leave room for scheduler cadence and delayed ticks without missing the intended period.
  return now - lastHourlyAt >= 55 * 60 * 1000;
}

function shouldRunDaily(): boolean {
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  return now - lastDailyAt >= 23 * ONE_DAY / 24;
}

function getGlobalProjectId(): string | null {
  const global = projects.getGlobalProject();
  return global?.id ?? null;
}

async function schedulerTick(generation: number): Promise<void> {
  if (!isBackupSchedulerActive(generation)) return;
  const projectId = getGlobalProjectId();
  if (!projectId) {
    // No global project — skip but keep scheduler alive
    scheduleNext(generation);
    return;
  }

  const schedule = getSchedule();

  // Acquire a maintenance lock so only one scheduler instance creates backups
  const ownerToken = maintenanceLocks.generateOwnerToken();
  const acquired = maintenanceLocks.acquireLock(LOCK_RESOURCE, projectId, ownerToken, BACKUP_LOCK_TTL_MS);

  if (!acquired) {
    logger.debug("backup-scheduler", "Backup lock held by another owner — skipping this cycle");
    scheduleNext(generation);
    return;
  }

  try {
    if (isBackupSchedulerActive(generation) && schedule.hourly.enabled && shouldRunHourly()) {
      logger.info("backup-scheduler", "Starting hourly backup");
      const created = await createBackup(projectId, "hourly");
      if (created) {
        lastHourlyAt = Date.now();
      }
    }

    if (isBackupSchedulerActive(generation) && schedule.daily.enabled && shouldRunDaily()) {
      logger.info("backup-scheduler", "Starting daily backup");
      const created = await createBackup(projectId, "daily");
      if (created) {
        lastDailyAt = Date.now();
      }
    }

    // Run retention cleanup after any backup activity
    if (isBackupSchedulerActive(generation)) applyRetention(projectId);

    // WAL checkpoint to keep DB healthy
    if (isBackupSchedulerActive(generation)) checkpointAfterWrite();
  } catch (err: any) {
    logger.error("backup-scheduler", `Scheduler tick failed: ${err.message}`, {
      error: err.message,
      stack: err.stack?.split("\n").slice(0, 5).join("\n"),
    });
  } finally {
    maintenanceLocks.releaseLock(LOCK_RESOURCE, projectId, ownerToken);
  }

  if (isBackupSchedulerActive(generation)) scheduleNext(generation);
}

/** Chaining re-reads settings before scheduling the next decision. */
function scheduleNext(generation: number): void {
  if (!isBackupSchedulerActive(generation)) return;
  const schedule = getSchedule();
  const anyEnabled = schedule.hourly.enabled || schedule.daily.enabled;

  if (anyEnabled) {
    logger.debug("backup-scheduler", `Next backup check in ${SCHEDULER_TICK_MS / 1000}s`);
    scheduleTimeout(generation, SCHEDULER_TICK_MS, () => runTick(generation));
  } else {
    // Recheck disabled schedules so settings changes take effect without a restart.
    logger.debug("backup-scheduler", "Backup scheduling disabled — recheck in 60s");
    scheduleTimeout(generation, 60_000, () => scheduleNext(generation));
  }
}

function runTick(generation: number): void {
  if (!isBackupSchedulerActive(generation)) return;

  const tick = schedulerTick(generation);
  activeTick = tick;
  void tick.catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("backup-scheduler", `Unhandled tick error: ${msg}`);
    if (isBackupSchedulerActive(generation)) scheduleNext(generation);
  }).finally(() => {
    if (activeTick === tick) activeTick = null;
  });
}

/** Chained timeouts let changed schedule settings take effect without a restart. */
export function startBackupScheduler(): void {
  if (backupSchedulerRunning) {
    logger.warn("backup-scheduler", "Backup scheduler start ignored because it is already running");
    return;
  }

  backupSchedulerRunning = true;
  const generation = ++backupSchedulerGeneration;
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

  scheduleTimeout(generation, INITIAL_DELAY_MS, () => runTick(generation));
}

/** Stop the chained backup timer and wait for the current snapshot operation. */
export async function stopBackupScheduler(): Promise<void> {
  if (!backupSchedulerRunning) return;

  backupSchedulerRunning = false;
  ++backupSchedulerGeneration;
  if (scheduledTimer) clearTimeout(scheduledTimer);
  scheduledTimer = null;
  if (activeTick) await activeTick.catch(() => undefined);
  logger.info("backup-scheduler", "Backup scheduler stopped");
}

export function isBackupSchedulerRunning(): boolean {
  return backupSchedulerRunning;
}
