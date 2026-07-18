import { Router } from "express";
import { createReadStream, existsSync, statSync } from "node:fs";
import { basename } from "node:path";
import { backups, logger, settings } from "ingenium-core";
import { requireProject } from "../helpers.js";

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

function coreDbPath(): string {
  return process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db";
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
    filename: record.filename,
    type,
    size: record.size_bytes,
    created_at: record.created_at,
    status: record.status,
    sha256: record.sha256,
  };
}

export const backupsRouter = Router();

backupsRouter.post("/", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const snapshot = await backups.createSnapshot(projectId, "manual", coreDbPath(), opencodeDbPath());
    const record = backups.getBackup(projectId, snapshot.backupId);
    res.status(201).json({ data: publicBackup(record) });
  } catch (error) {
    logger.error("backups", "Manual backup failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: { code: "BACKUP_FAILED", message: "Failed to create backup" } });
  }
});

backupsRouter.get("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const records = backups.listBackups(projectId).map(publicBackup);
  res.json({ data: records, total: records.length });
});

backupsRouter.get("/schedule", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  res.json({ data: getSchedule(projectId) });
});

backupsRouter.put("/schedule", (req, res) => {
  const projectId = requireProject(req, res);
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
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const backupId = req.body?.backupId;
  if (typeof backupId !== "string" || !backupId) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "backupId is required" } });
    return;
  }
  const record = backups.getBackup(projectId, backupId);
  if (!record) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Backup not found" } });
    return;
  }
  const validation = backups.validateRestorePreflight(backupId);
  res.json({
    data: {
      backup: publicBackup(record),
      valid: validation.valid,
      errors: validation.errors,
      warnings: [
        "Restore replaces the active Ingenium and OpenCode databases.",
        "Create a current backup before proceeding.",
      ],
      estimatedSize: record.size_bytes,
    },
  });
});

backupsRouter.post("/restore", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const { backupId, confirm } = req.body ?? {};
  if (typeof backupId !== "string" || !backupId || confirm !== true) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "backupId and confirm=true are required" } });
    return;
  }
  if (!backups.getBackup(projectId, backupId)) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Backup not found" } });
    return;
  }
  const validation = backups.validateRestorePreflight(backupId);
  if (!validation.valid) {
    res.status(422).json({ error: { code: "INVALID_BACKUP", message: validation.errors.join("; ") } });
    return;
  }
  const jobId = backups.startRestore(projectId, backupId);
  backups.updateRestoreStatus(jobId, "confirmed");
  res.status(202).json({ data: { jobId, status: "confirmed", restartRequired: true } });
});

backupsRouter.get("/restore/:jobId", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const job = backups.getRestoreStatus(req.params.jobId!);
  if (!job || job.project_id !== projectId) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Restore job not found" } });
    return;
  }
  res.json({ data: job });
});

backupsRouter.get("/:id", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const record = backups.getBackup(projectId, req.params.id!);
  if (!record) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Backup not found" } });
    return;
  }
  res.json({ data: publicBackup(record) });
});

backupsRouter.get("/:id/download", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const filePath = backups.getBackupComponentPath(projectId, req.params.id!);
  if (!filePath || !existsSync(filePath)) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Backup file not found" } });
    return;
  }
  res.setHeader("Content-Type", "application/vnd.sqlite3");
  res.setHeader("Content-Disposition", `attachment; filename="${basename(filePath)}"`);
  res.setHeader("Content-Length", statSync(filePath).size);
  createReadStream(filePath).on("error", (error) => {
    logger.error("backups", "Backup stream failed", { error: error.message });
    if (!res.headersSent) res.status(500).end();
    else res.destroy(error);
  }).pipe(res);
});

backupsRouter.delete("/:id", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const record = backups.getBackup(projectId, req.params.id!);
  if (!record) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Backup not found" } });
    return;
  }
  backups.deleteBackup(projectId, record.id);
  res.json({ data: { deleted: true, id: record.id } });
});
