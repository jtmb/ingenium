import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  settings: { getSetting: vi.fn(() => undefined) },
  projects: { getGlobalProject: vi.fn(() => undefined), listProjects: vi.fn(() => []) },
  extraction: { runExtraction: vi.fn() },
  synthesis: { runSynthesis: vi.fn() },
  jobs: { listJobs: vi.fn(() => []), startJobRun: vi.fn() },
  jobEventDeliveries: {
    sanitizeJobEventText: vi.fn((value: string) => value),
    snapshotTrustedJobEvents: vi.fn(), listExpiredJobEventLeases: vi.fn(() => []), claimJobEventDelivery: vi.fn(() => null),
  },
  maintenanceLocks: {
    generateOwnerToken: vi.fn(() => "lock-token"), acquireLock: vi.fn(() => true), renewLock: vi.fn(() => true),
    releaseLock: vi.fn(), cleanupExpiredLocks: vi.fn(() => 0),
  },
  checkpointAfterWrite: vi.fn(),
  usage: { listUsageAttentionMappedProjectIds: vi.fn(() => []), reconcileUsageAttention: vi.fn() },
}));

const usageSync = vi.hoisted(() => ({
  getUsageSyncInterval: vi.fn(() => 100),
  syncUsageFromOpenCode: vi.fn(),
}));

const email = vi.hoisted(() => ({
  getEmailEncryptionDiagnostics: vi.fn(() => ({ status: "ready" })),
  listAccounts: vi.fn(() => []), startEngine: vi.fn(),
  getEngineStatus: vi.fn(() => ({ running: true, heartbeatAt: new Date().toISOString(), accounts: [] })),
  getGlobalProjectId: vi.fn(() => "global-project"), providerErrorDiagnostic: vi.fn(() => ({})),
}));

vi.mock("ingenium-core", () => core);
vi.mock("ingenium-email", () => email);
vi.mock("../lib/job-runner.js", () => ({ executeJobRun: vi.fn(), recoverExpiredEventAttempt: vi.fn() }));
vi.mock("../lib/usage-sync.js", () => usageSync);

import { startScheduler, stopScheduler } from "../lib/scheduler.js";

function syncResult(overrides: Record<string, unknown> = {}) {
  return {
    sourceInstance: "https://opencode.test",
    projects: [],
    sessionsScanned: 0,
    sessionsQuarantined: 0,
    sessionsSkipped: 0,
    unavailable: false,
    errorCode: null,
    alreadyRunning: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  usageSync.getUsageSyncInterval.mockReset().mockReturnValue(100);
  usageSync.syncUsageFromOpenCode.mockReset().mockResolvedValue(syncResult());
  core.usage.listUsageAttentionMappedProjectIds.mockReset().mockReturnValue(["active-mapped-project"]);
  core.usage.reconcileUsageAttention.mockReset().mockReturnValue({ items: [], transitions: [] });
});

afterEach(async () => {
  await stopScheduler();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("usage attention scheduler", () => {
  it("uses the existing usage timer chain once and reconciles active mappings after no-new and failed cycles", async () => {
    startScheduler(4097);
    const timersAfterStart = vi.getTimerCount();
    startScheduler(4097);
    expect(vi.getTimerCount()).toBe(timersAfterStart);

    await vi.advanceTimersByTimeAsync(20_100);
    expect(usageSync.syncUsageFromOpenCode).toHaveBeenCalledTimes(1);
    expect(core.usage.reconcileUsageAttention).toHaveBeenCalledWith("active-mapped-project", { syncIntervalMs: 100 });

    usageSync.syncUsageFromOpenCode.mockResolvedValueOnce(syncResult({ unavailable: true, errorCode: "OPENCODE_UNAVAILABLE" }));
    await vi.advanceTimersByTimeAsync(100);
    expect(usageSync.syncUsageFromOpenCode).toHaveBeenCalledTimes(2);
    expect(core.usage.reconcileUsageAttention).toHaveBeenCalledTimes(2);
  });

  it("disables both scheduled usage sync and attention evaluation when the interval is zero", async () => {
    usageSync.getUsageSyncInterval.mockReturnValue(0);
    startScheduler(4097);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(usageSync.syncUsageFromOpenCode).not.toHaveBeenCalled();
    expect(core.usage.reconcileUsageAttention).not.toHaveBeenCalled();
  });

  it("awaits an in-flight usage cycle during shutdown", async () => {
    let resolveSync: ((value: ReturnType<typeof syncResult>) => void) | undefined;
    usageSync.syncUsageFromOpenCode.mockReturnValue(new Promise((resolve) => { resolveSync = resolve; }));
    startScheduler(4097);
    vi.advanceTimersByTime(20_100);
    await Promise.resolve();
    let stopped = false;
    const stopping = stopScheduler().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    resolveSync!(syncResult());
    await stopping;
    expect(stopped).toBe(true);
  });
});
