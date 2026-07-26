import type { Server } from "node:http";
import { logger } from "ingenium-core";
import {
  getGlobalProjectId,
  listAccounts,
  stopEngine,
  stopWatcher,
} from "ingenium-email";
import { stopBackupScheduler } from "./backup-scheduler.js";
import { stopAllJobRuns } from "./job-runner.js";
import { getRegisteredMailWatcherIds } from "./mail-watchers.js";
import { stopScheduler } from "./scheduler.js";

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

export type ShutdownReason = "SIGTERM" | "SIGINT" | "uncaughtException" | "server-error" | "manual";

export interface ShutdownResult {
  status: "completed" | "timed_out";
  reason: ShutdownReason;
}

export interface LifecycleDependencies {
  stopScheduler: () => Promise<void>;
  stopBackupScheduler: () => Promise<void>;
  stopJobs: () => Promise<void>;
  stopMailWatchers: () => Promise<void>;
  stopMailEngine: () => Promise<void>;
}

export interface ApiLifecycle {
  shutdown(reason?: ShutdownReason): Promise<ShutdownResult>;
  registerCleanup(name: string, cleanup: () => void | Promise<void>): void;
}

export interface ApiLifecycleOptions {
  shutdownTimeoutMs?: number;
}

interface SignalProcess {
  exitCode?: string | number | null;
  once(event: "SIGTERM" | "SIGINT", listener: () => void): unknown;
  removeListener(event: "SIGTERM" | "SIGINT", listener: () => void): unknown;
}

async function stopMailWatchers(): Promise<void> {
  const accountIds = new Set(getRegisteredMailWatcherIds());
  try {
    const projectId = getGlobalProjectId();
    for (const account of listAccounts(projectId)) accountIds.add(account.id);
  } catch {
    // A registered watcher may still need cleanup after its account was removed.
  }

  await Promise.allSettled([...accountIds].map((accountId) => stopWatcher(accountId)));
}

const defaultDependencies: LifecycleDependencies = {
  stopScheduler,
  stopBackupScheduler,
  stopJobs: stopAllJobRuns,
  stopMailWatchers,
  stopMailEngine: stopEngine,
};

function closeListener(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function closeActiveConnections(server: Server): void {
  // Closing the listener first preserves in-flight requests. This is only used
  // after the shutdown deadline has elapsed, so a hung keep-alive connection
  // cannot keep the process alive indefinitely.
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
}

async function waitForShutdown(
  work: Promise<unknown>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const completed = await Promise.race([
    work.then(() => true),
    new Promise<false>((resolve) => {
      timeout = setTimeout(() => {
        onTimeout();
        resolve(false);
      }, timeoutMs);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
  return completed;
}

/**
 * Owns the API process lifecycle. A single instance closes the HTTP listener
 * before stopping background work, and shares one promise across duplicate
 * shutdown requests from signals, supervisor, or tests.
 */
export function createApiLifecycle(
  server: Server,
  dependencies: LifecycleDependencies = defaultDependencies,
  options: ApiLifecycleOptions = {},
): ApiLifecycle {
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  const extraCleanups = new Map<string, () => void | Promise<void>>();
  let shutdownPromise: Promise<ShutdownResult> | null = null;

  return {
    registerCleanup(name, cleanup): void {
      if (shutdownPromise) {
        void Promise.resolve(cleanup()).catch(() => {
          logger.warn("api", "Late lifecycle cleanup failed");
        });
        return;
      }
      extraCleanups.set(name, cleanup);
    },

    shutdown(reason: ShutdownReason = "manual"): Promise<ShutdownResult> {
      if (shutdownPromise) return shutdownPromise;

      shutdownPromise = (async () => {
        logger.info("api", `Graceful shutdown started (${reason})`);

        // Invoke listener close first so no new requests are accepted while the
        // maintenance subsystems finish their current work.
        const listener = closeListener(server);
        const cleanupTasks = [
          dependencies.stopScheduler(),
          dependencies.stopBackupScheduler(),
          dependencies.stopJobs(),
          dependencies.stopMailWatchers(),
          dependencies.stopMailEngine(),
          ...[...extraCleanups.values()].map((cleanup) => Promise.resolve().then(cleanup)),
        ];

        const completed = await waitForShutdown(
          Promise.allSettled([listener, ...cleanupTasks]),
          shutdownTimeoutMs,
          () => closeActiveConnections(server),
        );

        if (!completed) {
          logger.error("api", "Graceful shutdown timed out; active HTTP connections were closed");
          return { status: "timed_out", reason };
        }

        logger.info("api", "Graceful shutdown completed");
        return { status: "completed", reason };
      })();

      return shutdownPromise;
    },
  };
}

/**
 * Install one-shot signal handlers without a hard exit. The event
 * loop is allowed to drain after the lifecycle has released its resources;
 * setting exitCode preserves a non-zero outcome for a bounded-timeout stop.
 */
export function installShutdownSignalHandlers(
  lifecycle: ApiLifecycle,
  processRef: SignalProcess = process,
): () => void {
  let shuttingDown = false;

  const handleSignal = (reason: "SIGTERM" | "SIGINT") => {
    if (shuttingDown) return;
    shuttingDown = true;
    void lifecycle.shutdown(reason).then((result) => {
      processRef.exitCode = result.status === "timed_out" ? 1 : 0;
    }).catch(() => {
      // Lifecycle methods are defensive, but this final guard must not leak
      // provider or credential-bearing error details to stderr.
      processRef.exitCode = 1;
    });
  };

  const onSigterm = () => handleSignal("SIGTERM");
  const onSigint = () => handleSignal("SIGINT");
  processRef.once("SIGTERM", onSigterm);
  processRef.once("SIGINT", onSigint);

  return () => {
    processRef.removeListener("SIGTERM", onSigterm);
    processRef.removeListener("SIGINT", onSigint);
  };
}
