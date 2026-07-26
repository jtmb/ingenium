import { logger } from "ingenium-core";
import {
  establishEmailEncryptionKeyContinuity,
  getEmailEncryptionDiagnostics,
  getGlobalProjectId,
  startEngine,
} from "ingenium-email";
import type { ApiLifecycle } from "./lifecycle.js";
import {
  migrateEmailAccountsToGlobal,
  type MailAccountMigrationResult,
} from "./routes/emails.js";

export const MAIL_MAINTENANCE_START_DELAY_MS = 10_000;

interface EncryptionContinuity {
  status: string;
}

interface EncryptionDiagnostics {
  status: string;
  globalProjectId?: string | null;
}

export interface MailMaintenanceDependencies {
  establishContinuity: () => EncryptionContinuity;
  getDiagnostics: () => EncryptionDiagnostics;
  getGlobalProjectId: () => string;
  migrateEmailAccounts: () => Promise<MailAccountMigrationResult>;
  startEngine: (projectId: string) => void;
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
}

const defaultDependencies: MailMaintenanceDependencies = {
  establishContinuity: establishEmailEncryptionKeyContinuity,
  getDiagnostics: getEmailEncryptionDiagnostics,
  getGlobalProjectId,
  migrateEmailAccounts: migrateEmailAccountsToGlobal,
  startEngine,
  info: (message, data) => logger.info("api", message, data),
  warn: (message, data) => logger.warn("api", message, data),
};

/**
 * Own the deferred mail migration as lifecycle work. Shutdown cancels a
 * migration that has not begun and awaits one already in flight, preventing a
 * late engine start or database work after the API has begun teardown.
 */
export function startMailMaintenance(
  lifecycle: ApiLifecycle,
  globalProjectId: string | null,
  dependencies: MailMaintenanceDependencies = defaultDependencies,
): void {
  let stopped = false;
  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  let startupMigration: Promise<void> | null = null;

  lifecycle.registerCleanup("mail-maintenance-startup", async () => {
    stopped = true;
    if (startupTimer) clearTimeout(startupTimer);
    startupTimer = null;

    // Do not let transactional migration work run past lifecycle teardown.
    // The migration has no interruptible API, so an in-flight operation must
    // settle before shutdown can complete.
    await startupMigration;
  });

  // If registration raced a shutdown already in progress, registerCleanup()
  // runs the cleanup immediately. Do not leave an inert startup timer behind.
  if (stopped) return;

  // Defer until WAL recovery and migration locks have settled before touching
  // email accounts. The lifecycle owns both this timer and the async work it
  // starts, so shutdown cannot race a later mail-engine startup.
  startupTimer = setTimeout(() => {
    startupTimer = null;
    if (stopped) return;

    let continuity: EncryptionContinuity;
    try {
      continuity = dependencies.establishContinuity();
    } catch {
      dependencies.warn("Mail persistence startup skipped because no global project is available");
      return;
    }

    // Continuity must be established before a legacy account can be moved.
    // Never turn an unverified key into a destructive copy/delete migration.
    if (continuity.status !== "ready") {
      dependencies.warn("Mail persistence startup deferred because encryption continuity is not ready", {
        encryptionStatus: continuity.status,
      });
      return;
    }

    const migration = Promise.resolve().then(async () => {
      // Shutdown may occur after the startup timer fires but before this
      // microtask begins. In that case, cancel without touching the database.
      if (stopped) return;

      const migrationResult = await dependencies.migrateEmailAccounts();
      if (stopped) return;

      const encryption = dependencies.getDiagnostics();
      dependencies.info("Mail persistence startup diagnostics", {
        globalProjectId: encryption.globalProjectId ?? globalProjectId,
        encryptionStatus: encryption.status,
        migration: migrationResult,
      });
      if (encryption.status !== "ready") {
        dependencies.warn("Mail sync engine not started because encryption continuity is not ready", {
          encryptionStatus: encryption.status,
          continuityStatus: continuity.status,
        });
        return;
      }

      // Start the sync engine instead of prefetch (engine owns all IMAP I/O).
      if (stopped) return;
      dependencies.startEngine(dependencies.getGlobalProjectId());
      dependencies.info("Email sync engine started for configured accounts");
    }).catch(() => {
      // Migration owns transactional rollback. Keep the startup diagnostic
      // credential-safe by never including the caught provider/DB error.
      if (!stopped) dependencies.warn("Email engine start deferred after a safe migration failure");
    });

    startupMigration = migration;
    void migration.then(() => {
      if (startupMigration === migration) startupMigration = null;
    });
  }, MAIL_MAINTENANCE_START_DELAY_MS);
}
