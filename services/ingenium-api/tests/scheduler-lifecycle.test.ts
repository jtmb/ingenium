import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  settings: { getSetting: vi.fn(() => undefined) },
  projects: {
    getGlobalProject: vi.fn(() => undefined),
    listProjects: vi.fn(() => []),
  },
  extraction: { runExtraction: vi.fn() },
  synthesis: { runSynthesis: vi.fn() },
  jobs: {
    listJobs: vi.fn(() => []),
    startJobRun: vi.fn(),
  },
  maintenanceLocks: {
    generateOwnerToken: vi.fn(() => "lock-token"),
    acquireLock: vi.fn(() => true),
    renewLock: vi.fn(() => true),
    releaseLock: vi.fn(),
    cleanupExpiredLocks: vi.fn(() => 0),
  },
  checkpointAfterWrite: vi.fn(),
  resolveCoreDbPath: vi.fn(() => "/tmp/ingenium-scheduler-lifecycle.db"),
  backups: { listBackups: vi.fn(() => []) },
}));

const email = vi.hoisted(() => ({
  getEmailEncryptionDiagnostics: vi.fn(() => ({ status: "ready" })),
  listAccounts: vi.fn(() => []),
  startEngine: vi.fn(),
  getEngineStatus: vi.fn(() => ({ running: true, heartbeatAt: new Date().toISOString(), accounts: [] })),
  getGlobalProjectId: vi.fn(() => "global-project"),
  providerErrorDiagnostic: vi.fn(() => ({})),
}));

vi.mock("ingenium-core", () => core);
vi.mock("ingenium-email", () => email);
vi.mock("../lib/job-runner.js", () => ({ executeJobRun: vi.fn(), recoverVaultSecretRunDirectories: vi.fn(() => Promise.resolve()) }));

import { isSchedulerRunning, startScheduler, stopScheduler } from "../lib/scheduler.js";
import {
  isBackupSchedulerRunning,
  startBackupScheduler,
  stopBackupScheduler,
} from "../lib/backup-scheduler.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  await stopScheduler();
  await stopBackupScheduler();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("scheduler lifecycle ownership", () => {
  it("does not create duplicate timers when started twice and clears all timers on stop", async () => {
    startScheduler(4097);
    const timerCountAfterFirstStart = vi.getTimerCount();
    startScheduler(4097);

    expect(isSchedulerRunning()).toBe(true);
    expect(timerCountAfterFirstStart).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBe(timerCountAfterFirstStart);

    await stopScheduler();
    expect(isSchedulerRunning()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a single backup timer across repeated starts and cancels it on stop", async () => {
    startBackupScheduler();
    const timerCountAfterFirstStart = vi.getTimerCount();
    startBackupScheduler();

    expect(isBackupSchedulerRunning()).toBe(true);
    expect(timerCountAfterFirstStart).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBe(timerCountAfterFirstStart);

    await stopBackupScheduler();
    expect(isBackupSchedulerRunning()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not restart an unconfigured mail engine for a stale heartbeat", async () => {
    core.projects.getGlobalProject.mockReturnValue({ id: "global-project", name: "global-default" });
    core.settings.getSetting.mockImplementation((_projectId: string, key: string) => (
      key === "mail_sync_interval_ms" ? "100" : undefined
    ));
    email.getEngineStatus.mockReturnValue({
      running: true,
      heartbeatAt: new Date(Date.now() - 121_000).toISOString(),
      accounts: [],
    });

    try {
      startScheduler(4097);
      await vi.advanceTimersByTimeAsync(15_100);

      expect(email.startEngine).toHaveBeenCalledTimes(1);
      expect(core.logger.warn).not.toHaveBeenCalledWith(
        "mail-sync",
        expect.stringContaining("heartbeat stale"),
      );
    } finally {
      core.projects.getGlobalProject.mockReturnValue(undefined);
      core.settings.getSetting.mockReturnValue(undefined);
      email.getEngineStatus.mockImplementation(() => ({
        running: true,
        heartbeatAt: new Date().toISOString(),
        accounts: [],
      }));
    }
  });

  it("passes the scheduler lock owner into synthesis batch ownership", async () => {
    core.projects.listProjects.mockReturnValue([{
      id: "scheduled-project",
      name: "scheduled-project",
      archived_at: null,
    }]);
    core.extraction.runExtraction.mockResolvedValue({ scanned: 0, created: 0 });
    core.synthesis.runSynthesis.mockResolvedValue({ summary: "resumed" });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));

    startScheduler(4097);
    await vi.advanceTimersByTimeAsync(30_001);
    await Promise.resolve();

    expect(core.synthesis.runSynthesis).toHaveBeenCalledWith(
      "scheduled-project",
      undefined,
      expect.objectContaining({ ownerToken: "lock-token" }),
    );
  });
});
