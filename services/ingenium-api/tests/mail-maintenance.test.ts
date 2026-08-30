import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { createApiLifecycle, type LifecycleDependencies } from "../lib/lifecycle.js";
import {
  MAIL_MAINTENANCE_START_DELAY_MS,
  startMailMaintenance,
  type MailMaintenanceDependencies,
} from "../lib/mail-maintenance.js";
import type { MailAccountMigrationResult } from "../lib/routes/emails.js";

const emptyMigrationResult: MailAccountMigrationResult = {
  migratedSettings: 0,
  migratedAccounts: 0,
  collisions: 0,
  skippedForEncryption: false,
};

function resolvedLifecycleDependencies(): LifecycleDependencies {
  return {
    stopBackupScheduler: async () => {},
    stopJobs: async () => {},
    stopMailEngine: async () => {},
    stopMailWatchers: async () => {},
    stopScheduler: async () => {},
  };
}

function deferred<T>() {
  let resolve: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve: (value: T) => resolve(value) };
}

function dependencies(
  migrateEmailAccounts: () => Promise<MailAccountMigrationResult>,
): MailMaintenanceDependencies {
  return {
    establishContinuity: vi.fn(() => ({ status: "ready" })),
    getDiagnostics: vi.fn(() => ({ status: "ready", globalProjectId: "global-project" })),
    info: vi.fn(),
    migrateEmailAccounts,
    startEngine: vi.fn(),
    warn: vi.fn(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("mail maintenance lifecycle ownership", () => {
  it("awaits an in-flight startup migration and prevents a late engine start during shutdown", async () => {
    const migration = deferred<MailAccountMigrationResult>();
    const mail = dependencies(vi.fn(() => migration.promise));
    const lifecycle = createApiLifecycle(createServer(), resolvedLifecycleDependencies(), {
      shutdownTimeoutMs: 1_000,
    });
    startMailMaintenance(lifecycle, "global-project", mail);

    await vi.advanceTimersByTimeAsync(MAIL_MAINTENANCE_START_DELAY_MS);
    expect(mail.migrateEmailAccounts).toHaveBeenCalledOnce();

    let shutdownCompleted = false;
    const shutdown = lifecycle.shutdown("SIGTERM").then((result) => {
      shutdownCompleted = true;
      return result;
    });
    await Promise.resolve();
    expect(shutdownCompleted).toBe(false);

    migration.resolve(emptyMigrationResult);

    await expect(shutdown).resolves.toEqual({ status: "completed", reason: "SIGTERM" });
    expect(mail.startEngine).not.toHaveBeenCalled();
  });

  it("cancels the delayed startup migration before its timer can begin it", async () => {
    const mail = dependencies(vi.fn(async () => emptyMigrationResult));
    const lifecycle = createApiLifecycle(createServer(), resolvedLifecycleDependencies());
    startMailMaintenance(lifecycle, "global-project", mail);

    await expect(lifecycle.shutdown("SIGTERM")).resolves.toEqual({
      status: "completed",
      reason: "SIGTERM",
    });
    await vi.advanceTimersByTimeAsync(MAIL_MAINTENANCE_START_DELAY_MS);

    expect(mail.migrateEmailAccounts).not.toHaveBeenCalled();
    expect(mail.startEngine).not.toHaveBeenCalled();
  });

  it("does not create a startup timer when maintenance registration races completed shutdown", async () => {
    const mail = dependencies(vi.fn(async () => emptyMigrationResult));
    const lifecycle = createApiLifecycle(createServer(), resolvedLifecycleDependencies());

    await lifecycle.shutdown("SIGTERM");
    startMailMaintenance(lifecycle, "global-project", mail);
    await vi.advanceTimersByTimeAsync(MAIL_MAINTENANCE_START_DELAY_MS);

    expect(mail.migrateEmailAccounts).not.toHaveBeenCalled();
    expect(mail.startEngine).not.toHaveBeenCalled();
  });
});
