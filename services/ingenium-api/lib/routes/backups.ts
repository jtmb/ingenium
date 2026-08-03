import { Router } from "express";
import { backups, logger, settings } from "ingenium-core";
import { requireGlobalProject } from "../helpers.js";
import { startRestoreMaintenance } from "../restore-supervisor.js";

type BackupSchedule = {
  hourly: { enabled: boolean; retention: number };
  daily: { enabled: boolean; retention: number };
  manual_retention: number;
};

const DEFAULT_SCHEDULE: BackupSchedule = {
  hourly: { enabled: false, retention: 24 },
  daily: { enabled: false, retention: 7 },
  manual_retention: 10,
};

const RESTORE_MIGRATION_ERROR = {
  error: {
    code: "RESTORE_MIGRATION_REQUIRED",
    message: "Use the restore preview, authorize, and confirm plan workflow.",
  },
};

function coreDbPath(): string {
  return process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data";
}

function opencodeDbPath(): string {
  return process.env.OPENCODE_DB_PATH ?? "/home/appuser/.local/share/opencode/opencode.db";
}

function getSchedule(projectId: string): BackupSchedule {
  const raw = settings.getSetting(projectId, "backup_schedule");
  if (!raw) return structuredClone(DEFAULT_SCHEDULE);
  try {
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
      manual_retention: Number(parsed.manual_retention) || DEFAULT_SCHEDULE.manual_retention,
    };
  } catch {
    return structuredClone(DEFAULT_SCHEDULE);
  }
}

function publicBackup(record: any) {
  const type = record.backup_type === "scheduled_hourly"
    ? "hourly"
    : record.backup_type === "scheduled_daily" ? "daily" : "manual";
  return {
    id: record.id,
    // This is a display/download name only, never an absolute filesystem path.
    filename: record.filename,
    type,
    size: record.size_bytes,
    created_at: record.created_at,
    status: record.status,
    sha256: record.sha256,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function restoreError(res: any, error: unknown): boolean {
  if (!(error instanceof backups.BackupError)) return false;
  const statusByCode: Record<backups.BackupErrorCode, number> = {
    BACKUP_NOT_FOUND: 404,
    RESTORE_PLAN_NOT_FOUND: 404,
    BACKUP_INVALID: 422,
    BACKUP_LEGACY_UNSUPPORTED: 422,
    RESTORE_AUTHORIZATION_INVALID: 422,
    RESTORE_AUTHORIZATION_EXPIRED: 422,
    BACKUP_REFERENCED: 409,
    RESTORE_REVISION_CONFLICT: 409,
    RESTORE_STATE_CONFLICT: 409,
    RESTORE_IDEMPOTENCY_CONFLICT: 409,
    RESTORE_EXECUTION_AUTHORIZATION_INVALID: 422,
    RESTORE_EXECUTION_AUTHORIZATION_EXPIRED: 422,
    RESTORE_EXECUTION_NOT_FOUND: 404,
    RESTORE_EXECUTION_DEADLINE_EXCEEDED: 409,
    RESTORE_EXECUTION_CONFLICT: 409,
    RESTORE_PROJECT_SCOPE: 409,
    RESTORE_MIGRATION_REQUIRED: 410,
  };
  const response: Record<string, unknown> = { code: error.code, message: "Restore request rejected." };
  if (error.currentRevision !== undefined) response.currentRevision = error.currentRevision;
  res.status(statusByCode[error.code]).json({ error: response });
  return true;
}

function parsePreview(body: unknown): { backupId: string; dryRun: true; idempotencyKey: string } | null {
  if (!isObject(body) || Object.keys(body).sort().join("\0") !== "backupId\0dryRun\0idempotencyKey") return null;
  return typeof body.backupId === "string" && body.backupId.length > 0
    && body.dryRun === true && typeof body.idempotencyKey === "string"
    ? { backupId: body.backupId, dryRun: true, idempotencyKey: body.idempotencyKey }
    : null;
}

function parseAuthorize(body: unknown): { expectedRevision: number } | null {
  if (!isObject(body) || Object.keys(body).join("\0") !== "expectedRevision") return null;
  return Number.isSafeInteger(body.expectedRevision) && (body.expectedRevision as number) >= 0
    ? { expectedRevision: body.expectedRevision as number }
    : null;
}

function parseConfirm(body: unknown): { confirmationToken: string; expectedRevision: number; idempotencyKey: string } | null {
  if (!isObject(body) || Object.keys(body).sort().join("\0") !== "confirmationToken\0expectedRevision\0idempotencyKey") return null;
  return typeof body.confirmationToken === "string" && body.confirmationToken.length >= 32
    && typeof body.idempotencyKey === "string"
    && Number.isSafeInteger(body.expectedRevision) && (body.expectedRevision as number) >= 0
    ? {
      confirmationToken: body.confirmationToken,
      expectedRevision: body.expectedRevision as number,
      idempotencyKey: body.idempotencyKey,
    }
    : null;
}

function parseExecution(body: unknown): { executionToken: string; expectedRevision: number; idempotencyKey: string } | null {
  if (!isObject(body) || Object.keys(body).sort().join("\0") !== "executionToken\0expectedRevision\0idempotencyKey") return null;
  return typeof body.executionToken === "string" && body.executionToken.length >= 32
    && typeof body.idempotencyKey === "string"
    && Number.isSafeInteger(body.expectedRevision) && (body.expectedRevision as number) >= 0
    ? {
      executionToken: body.executionToken,
      expectedRevision: body.expectedRevision as number,
      idempotencyKey: body.idempotencyKey,
    }
    : null;
}

function parseLimit(value: unknown): number | null {
  if (value === undefined) return 50;
  if (typeof value !== "string" || !/^[1-9][0-9]{0,2}$/.test(value)) return null;
  const limit = Number(value);
  return limit <= 100 ? limit : null;
}

export const backupsRouter = Router();

backupsRouter.post("/", async (req, res) => {
  const projectId = requireGlobalProject(req, res);
  if (!projectId) return;
  try {
    const snapshot = await backups.createSnapshot(projectId, "manual", coreDbPath(), opencodeDbPath());
    const record = backups.getBackup(projectId, snapshot.backupId);
    if (!record) throw new backups.BackupError("BACKUP_INVALID");
    res.status(201).json({ data: publicBackup(record) });
  } catch (error) {
    logger.error("backups", "Manual backup failed", {
      code: error instanceof backups.BackupError ? error.code : "BACKUP_FAILED",
    });
    if (restoreError(res, error)) return;
    res.status(500).json({ error: { code: "BACKUP_FAILED", message: "Failed to create backup" } });
  }
});

backupsRouter.get("/", (req, res) => {
  const projectId = requireGlobalProject(req, res);
  if (!projectId) return;
  const records = backups.listBackups(projectId).map(publicBackup);
  res.json({ data: records, total: records.length });
});

backupsRouter.get("/schedule", (req, res) => {
  const projectId = requireGlobalProject(req, res);
  if (!projectId) return;
  res.json({ data: getSchedule(projectId) });
});

backupsRouter.put("/schedule", (req, res) => {
  const projectId = requireGlobalProject(req, res);
  if (!projectId) return;
  const current = getSchedule(projectId);
  const { hourly, daily, manual_retention } = req.body ?? {};
  const schedule: BackupSchedule = {
    hourly: {
      enabled: typeof hourly?.enabled === "boolean" ? hourly.enabled : current.hourly.enabled,
      retention: typeof hourly?.retention === "number" && hourly.retention > 0
        ? hourly.retention : current.hourly.retention,
    },
    daily: {
      enabled: typeof daily?.enabled === "boolean" ? daily.enabled : current.daily.enabled,
      retention: typeof daily?.retention === "number" && daily.retention > 0
        ? daily.retention : current.daily.retention,
    },
    manual_retention: typeof manual_retention === "number" && manual_retention > 0
      ? manual_retention : current.manual_retention,
  };
  settings.setSetting(projectId, "backup_schedule", JSON.stringify(schedule));
  res.json({ data: schedule });
});

backupsRouter.post("/restore/preview", (req, res) => {
  const projectId = requireGlobalProject(req, res);
  if (!projectId) return;
  const input = parsePreview(req.body);
  if (!input) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "backupId, dryRun=true, and idempotencyKey are required" } });
    return;
  }
  try {
    res.status(201).json({ data: backups.previewRestore(projectId, input) });
  } catch (error) {
    if (restoreError(res, error)) return;
    res.status(500).json({ error: { code: "RESTORE_PREVIEW_FAILED", message: "Restore preview failed." } });
  }
});

backupsRouter.post("/restore/:planId/authorize", (req, res) => {
  const projectId = requireGlobalProject(req, res);
  if (!projectId) return;
  const input = parseAuthorize(req.body);
  if (!input) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "expectedRevision is required" } });
    return;
  }
  try {
    // This is the only REST response that contains an opaque confirmation token.
    res.json({ data: backups.authorizeRestore(projectId, req.params.planId!, input.expectedRevision) });
  } catch (error) {
    if (restoreError(res, error)) return;
    res.status(500).json({ error: { code: "RESTORE_AUTHORIZE_FAILED", message: "Restore authorization failed." } });
  }
});

backupsRouter.post("/restore/:planId/confirm", (req, res) => {
  const projectId = requireGlobalProject(req, res);
  if (!projectId) return;
  const input = parseConfirm(req.body);
  if (!input) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "confirmationToken, expectedRevision, and idempotencyKey are required" } });
    return;
  }
  try {
    res.json({ data: backups.confirmRestore(projectId, req.params.planId!, input) });
  } catch (error) {
    if (restoreError(res, error)) return;
    res.status(500).json({ error: { code: "RESTORE_CONFIRM_FAILED", message: "Restore confirmation failed." } });
  }
});

backupsRouter.post("/restore/:planId/execution/authorize", (req, res) => {
  const projectId = requireGlobalProject(req, res);
  if (!projectId) return;
  const input = parseAuthorize(req.body);
  if (!input) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "expectedRevision is required" } });
    return;
  }
  try {
    // The only execution token response. It is never logged or included in status/audit DTOs.
    res.json({ data: backups.authorizeRestoreExecution(projectId, req.params.planId!, input.expectedRevision) });
  } catch (error) {
    if (restoreError(res, error)) return;
    res.status(500).json({ error: { code: "RESTORE_EXECUTION_AUTHORIZE_FAILED", message: "Restore execution authorization failed." } });
  }
});

backupsRouter.post("/restore/:planId/execute", async (req, res) => {
  const projectId = requireGlobalProject(req, res);
  if (!projectId) return;
  const input = parseExecution(req.body);
  if (!input) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "executionToken, expectedRevision, and idempotencyKey are required" } });
    return;
  }
  try {
    const queued = backups.executeRestore(projectId, req.params.planId!, input);
    try {
      await startRestoreMaintenance();
    } catch {
      // A queue acknowledgement is never allowed to strand an unstartable run.
      // This is CAS-protected, so an independently-started executor wins safely.
      backups.failRestoreExecutionStart(projectId, queued.run.id, queued.run.revision);
      logger.warn("backups", "Restore maintenance supervisor start failed", { code: "SUPERVISOR_FAILED", runId: queued.run.id });
      res.status(503).json({ error: { code: "SUPERVISOR_FAILED", message: "Restore executor could not be started." } });
      return;
    }
    res.status(202).json({ data: queued });
  } catch (error) {
    if (restoreError(res, error)) return;
    res.status(500).json({ error: { code: "RESTORE_EXECUTE_FAILED", message: "Restore execution request failed." } });
  }
});

backupsRouter.get("/restore/:planId/audit", (req, res) => {
  const projectId = requireGlobalProject(req, res);
  if (!projectId) return;
  const limit = parseLimit(req.query.limit);
  if (limit === null) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "limit must be between 1 and 100" } });
    return;
  }
  try {
    res.json({ data: backups.listRestoreAudit(projectId, req.params.planId!, limit) });
  } catch (error) {
    if (restoreError(res, error)) return;
    res.status(500).json({ error: { code: "RESTORE_AUDIT_FAILED", message: "Restore audit lookup failed." } });
  }
});

backupsRouter.get("/restore/:planId", (req, res) => {
  const projectId = requireGlobalProject(req, res);
  if (!projectId) return;
  const plan = backups.getRestorePlan(projectId, req.params.planId!);
  if (!plan) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Restore plan not found" } });
    return;
  }
  res.json({ data: plan });
});

// The legacy boolean-confirm route is retained only as a fixed no-bypass error.
backupsRouter.post("/restore", (_req, res) => {
  res.status(410).json(RESTORE_MIGRATION_ERROR);
});

backupsRouter.get("/:id", (req, res) => {
  const projectId = requireGlobalProject(req, res);
  if (!projectId) return;
  const record = backups.getBackup(projectId, req.params.id!);
  if (!record) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Backup not found" } });
    return;
  }
  res.json({ data: publicBackup(record) });
});

backupsRouter.get("/:id/download", (req, res) => {
  const projectId = requireGlobalProject(req, res);
  if (!projectId) return;
  try {
    const download = backups.readVerifiedBackupComponent(projectId, req.params.id!);
    res.setHeader("Content-Type", "application/vnd.sqlite3");
    res.setHeader("Content-Disposition", `attachment; filename="${download.filename}"`);
    res.setHeader("Content-Length", download.size);
    res.setHeader("X-Content-Type-Options", "nosniff");
    let wiped = false;
    const wipe = () => {
      if (wiped) return;
      wiped = true;
      backups.wipeBackupDownloadBuffer(download.bytes);
    };
    res.once("finish", wipe);
    res.once("close", wipe);
    res.once("error", wipe);
    try {
      res.end(download.bytes);
    } catch (error) {
      wipe();
      throw error;
    }
  } catch (error) {
    if (restoreError(res, error)) return;
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Backup file not found" } });
  }
});

backupsRouter.delete("/:id", (req, res) => {
  const projectId = requireGlobalProject(req, res);
  if (!projectId) return;
  try {
    if (!backups.getBackup(projectId, req.params.id!)) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Backup not found" } });
      return;
    }
    backups.deleteBackup(projectId, req.params.id!);
    res.json({ data: { deleted: true, id: req.params.id } });
  } catch (error) {
    if (restoreError(res, error)) return;
    res.status(500).json({ error: { code: "BACKUP_DELETE_FAILED", message: "Backup deletion failed" } });
  }
});
