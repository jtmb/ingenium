import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  settings: { getSetting: vi.fn() },
  projects: { getGlobalProject: vi.fn() },
  maintenanceLocks: {
    generateOwnerToken: vi.fn(() => "retention-lock"),
    acquireLock: vi.fn(() => true),
    releaseLock: vi.fn(),
  },
  checkpointAfterWrite: vi.fn(),
  backups: {
    BACKUP_BUNDLE_FORMAT: 2,
    listBackups: vi.fn(),
    deleteBackup: vi.fn(),
  },
}));

vi.mock("ingenium-core", () => core);

import { startBackupScheduler, stopBackupScheduler } from "../lib/backup-scheduler.js";

function v2Backup(id: string, createdAt: string) {
  return {
    id,
    filename: id,
    components: JSON.stringify({ format: 2 }),
    backup_type: "manual",
    created_at: createdAt,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  core.settings.getSetting.mockReturnValue(JSON.stringify({
    hourly: { enabled: false, retention: 24 },
    daily: { enabled: false, retention: 7 },
    manual_retention: 1,
  }));
  core.projects.getGlobalProject.mockReturnValue({ id: "global-project" });
  core.backups.listBackups.mockReturnValue([
    {
      id: "legacy",
      filename: "legacy.db",
      components: JSON.stringify({ schema_version: 47 }),
      backup_type: "manual",
      created_at: "2026-01-01T00:00:00.000Z",
    },
    v2Backup("v2-old", "2026-01-02T00:00:00.000Z"),
    v2Backup("v2-current", "2026-01-03T00:00:00.000Z"),
  ]);
  core.backups.deleteBackup.mockImplementation((_projectId: string, backupId: string) => {
    if (backupId === "legacy") throw new Error("BACKUP_LEGACY_UNSUPPORTED");
  });
});

afterEach(async () => {
  await stopBackupScheduler();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("backup retention", () => {
  it("preserves legacy backups while retaining only deletable v2 records", async () => {
    startBackupScheduler();
    await vi.advanceTimersByTimeAsync(15_000);
    await Promise.resolve();

    expect(core.backups.deleteBackup).toHaveBeenCalledTimes(1);
    expect(core.backups.deleteBackup).toHaveBeenCalledWith("global-project", "v2-old");
    expect(core.logger.warn).not.toHaveBeenCalledWith(
      "backup-scheduler",
      expect.stringContaining("BACKUP_LEGACY_UNSUPPORTED"),
    );
  });
});
