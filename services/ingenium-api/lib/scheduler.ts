import { settings, projects, logger, extraction, synthesis, jobs, maintenanceLocks, checkpointAfterWrite } from "ingenium-core";
import { executeJobRun } from "./job-runner.js";
import {
  getEmailEncryptionDiagnostics,
  listAccounts,
  startEngine,
  getEngineStatus,
  getGlobalProjectId,
  providerErrorDiagnostic,
} from "ingenium-email";
import { loadApiToken } from "./middleware/api-token.js";

/**
 * Default synthesis interval: 15 minutes (900,000ms).
 *
 * This is a deliberate trade-off between reactivity and cost:
 * - Too short (< 5 min): LLM extraction fees accumulate even when no new messages exist,
 *   and the trait confidence model needs multiple observations before meaningful changes.
 * - Too long (> 60 min): the dashboard feels stale and corrections take too long to
 *   propagate to personality traits.
 *
 * 15 minutes gives ~96 cycles/day — enough granularity for the dashboard timeline
 * without saturating the LLM provider. Operators can override via the
 * SYNTHESIS_INTERVAL_MS env var or the `synthesis_interval_ms` setting in the
 * global-default project (which takes precedence once configured via Settings UI).
 */
const SYNTHESIS_DEFAULT_MS = parseInt(process.env.SYNTHESIS_INTERVAL_MS ?? "900000", 10);

/** Read the synthesis interval from the global-default project's settings. Falls back to env var default. */
function getSynthesisInterval(): number {
  try {
    const gid = projects.getGlobalProject()?.id;
    if (gid) {
      const val = settings.getSetting(gid, "synthesis_interval_ms");
      if (val !== undefined) {
        const n = parseInt(val, 10);
        if (!isNaN(n) && n >= 0) return n;
      }
    }
  } catch {
    // fall through to default
  }
  return SYNTHESIS_DEFAULT_MS;
}

/** TTL for per-project skill locks during scheduled synthesis cycles (2 min). */
const SYNTHESIS_LOCK_TTL_MS = 120_000;
/** Interval between lock renewals during synthesis (every 60s). */
const LOCK_RENEW_INTERVAL_MS = 60_000;
/** Interval between expired-lock cleanup sweeps (every 5 minutes). */
const LOCK_CLEANUP_INTERVAL_MS = 300_000;
/** Cross-project HTTP client timeout. */
const CROSS_PROJECT_TIMEOUT_MS = 120_000;
/** Resource name for skills lock. */
const LOCK_RESOURCE = "skills";

let schedulerRunning = false;
let schedulerGeneration = 0;
const scheduledTimeouts = new Set<ReturnType<typeof setTimeout>>();
const renewalIntervals = new Set<ReturnType<typeof setInterval>>();
const activeTasks = new Set<Promise<void>>();
const activeAbortControllers = new Set<AbortController>();

function isSchedulerActive(generation: number): boolean {
  return schedulerRunning && schedulerGeneration === generation;
}

function scheduleTimeout(generation: number, delayMs: number, callback: () => void): void {
  if (!isSchedulerActive(generation)) return;

  const timeout = setTimeout(() => {
    scheduledTimeouts.delete(timeout);
    if (!isSchedulerActive(generation)) return;
    callback();
  }, delayMs);
  scheduledTimeouts.add(timeout);
}

function trackTask(task: Promise<void>): Promise<void> {
  activeTasks.add(task);
  void task.finally(() => activeTasks.delete(task)).catch(() => undefined);
  return task;
}

async function triggerSynthesisForAllProjects(port: number, generation: number): Promise<void> {
  if (!isSchedulerActive(generation)) return;
  const allProjects = projects.listProjects();
  const activeProjects = allProjects.filter(p => !p.archived_at);

  for (const p of activeProjects) {
    if (!isSchedulerActive(generation)) break;
    // 0. Acquire per-project skills lock before touching any skill mutations.
    const ownerToken = maintenanceLocks.generateOwnerToken();
    const acquired = maintenanceLocks.acquireLock("skills", p.id, ownerToken, SYNTHESIS_LOCK_TTL_MS);
    if (!acquired) {
      logger.info("scheduler", `Synthesis for "${p.name}" skipped — skills resource locked by another owner`);
      continue;
    }

    // Start renewal heartbeat: renew every 60s until work completes
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    try {
      heartbeat = setInterval(() => {
        const renewed = maintenanceLocks.renewLock(LOCK_RESOURCE, p.id, ownerToken, SYNTHESIS_LOCK_TTL_MS);
        if (!renewed) {
          logger.warn("scheduler", `Lock renewal failed for "${p.name}" — lock may have expired or been stolen`);
          if (heartbeat) {
            clearInterval(heartbeat);
            renewalIntervals.delete(heartbeat);
          }
          heartbeat = null;
        }
      }, LOCK_RENEW_INTERVAL_MS);
      renewalIntervals.add(heartbeat);

      // 1. Extraction — LLM-based observation extraction from OpenCode messages.
      try {
        const extractResult = await extraction.runExtraction(p.id, p.name);
        logger.info("scheduler", `Extraction for "${p.name}": scanned=${extractResult.scanned}, created=${extractResult.created}`);
      } catch (err: any) {
        logger.warn("scheduler", `Extraction for "${p.name}" failed: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n") });
      }

      // 2. Synthesis — processes pending observations into traits + skills
      try {
        const result = await synthesis.runSynthesis(p.id);
        logger.info(
          "scheduler",
          `Synthesis for "${p.name}": ${result.summary}`,
        );
      } catch (err: any) {
        logger.warn("scheduler", `Synthesis for "${p.name}" failed: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n") });
      }

      // Force WAL checkpoint after synthesis (no readers active)
      checkpointAfterWrite();
    } finally {
      // Always clear heartbeat and release lock
      if (heartbeat) {
        clearInterval(heartbeat);
        renewalIntervals.delete(heartbeat);
      }
      maintenanceLocks.releaseLock("skills", p.id, ownerToken);
    }
  }

  if (!isSchedulerActive(generation)) return;

  // Cross-project synthesis — the route OWNS the global lock internally.
  // Scheduler just calls with client timeout; does NOT acquire a second global lock.
  try {
    let token: string;
    try {
      token = loadApiToken();
    } catch {
      logger.error("scheduler", "Cross-project synthesis skipped because API authentication is not configured");
      return;
    }
    const controller = new AbortController();
    activeAbortControllers.add(controller);
    const timeoutId = setTimeout(() => {
      scheduledTimeouts.delete(timeoutId);
      controller.abort();
    }, CROSS_PROJECT_TIMEOUT_MS);
    scheduledTimeouts.add(timeoutId);
    try {
      const res = await fetch(`http://localhost:${port}/api/v1/synthesis/cross-project`, {
        method: "POST",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok && res.status !== 423) {
        const body = await res.json().catch(() => ({})) as any;
        logger.warn("scheduler", `Cross-project synthesis returned ${res.status}: ${body?.error?.message || "unknown error"}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const name = e instanceof Error ? e.name : "Unknown";
      const stack = e instanceof Error ? e.stack : undefined;
      if ((e as any)?.name === "AbortError") {
        logger.warn("scheduler", "Cross-project synthesis client timed out after 120s — server-side work continues with route-held lock");
      } else {
        logger.debug("scheduler", `Cross-project synthesis client error: ${msg}`, { error: msg, name, stack: stack?.split("\n").slice(0, 5).join("\n") });
      }
    } finally {
      clearTimeout(timeoutId);
      scheduledTimeouts.delete(timeoutId);
      activeAbortControllers.delete(controller);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.debug("scheduler", `Cross-project synthesis outer error: ${msg}`);
  }
}

// ============================================================================
// Usage sync scheduler — metadata-only OpenCode collection
// ============================================================================

// OpenCode usage is collected from metadata-only step-finish parts. Unlike
// mail, collection has no global-project ownership: explicit source mappings
// determine each destination project and unmapped sessions are quarantined.
const USAGE_SYNC_DEFAULT_MS = parseInt(process.env.USAGE_SYNC_INTERVAL_MS ?? "300000", 10);

function getUsageSyncInterval(): number {
  return Number.isFinite(USAGE_SYNC_DEFAULT_MS) && USAGE_SYNC_DEFAULT_MS >= 0
    ? USAGE_SYNC_DEFAULT_MS
    : 300_000;
}

async function triggerUsageSync(generation: number): Promise<void> {
  if (!isSchedulerActive(generation)) return;
  const { syncUsageFromOpenCode } = await import("./usage-sync.js");
  const result = await syncUsageFromOpenCode();
  if (result.alreadyRunning) {
    logger.debug("usage-sync", "Scheduled usage sync skipped because another sync is already running");
    return;
  }
  if (result.unavailable) {
    logger.warn("usage-sync", "Scheduled usage sync is unavailable", { code: result.errorCode });
    return;
  }
  logger.info("usage-sync", "Scheduled usage sync completed", {
    projects: result.projects.length,
    events: result.projects.reduce((total, project) => total + project.eventsUpserted, 0),
    quarantinedSessions: result.sessionsQuarantined,
  });
}

function scheduleUsageSync(generation: number): void {
  if (!isSchedulerActive(generation)) return;
  const interval = getUsageSyncInterval();
  if (interval <= 0) {
    logger.info("usage-sync", "Usage sync disabled (USAGE_SYNC_INTERVAL_MS = 0)");
    return;
  }
  scheduleTimeout(generation, interval, () => {
    void trackTask(triggerUsageSync(generation)).finally(() => {
      if (isSchedulerActive(generation)) scheduleUsageSync(generation);
    }).catch(() => undefined);
  });
}

// ============================================================================
// Mail sync scheduler — independent timer, reads "mail_sync_interval_ms"
// ============================================================================

const MAIL_SYNC_DEFAULT_MS = 300_000;

function getMailSyncInterval(): number {
  try {
    const gid = projects.getGlobalProject()?.id;
    if (gid) {
      const val = settings.getSetting(gid, "mail_sync_interval_ms");
      if (val !== undefined) {
        const n = parseInt(val, 10);
        if (!isNaN(n) && n >= 0) return n;
      }
    }
  } catch {
    // fall through to default
  }
  return MAIL_SYNC_DEFAULT_MS;
}

async function triggerMailSyncForAllProjects(generation: number): Promise<void> {
  if (!isSchedulerActive(generation)) return;
  try {
    // Guard: skip mail sync entirely if no global project exists.
    // The engine requires a global project for account storage — without it,
    // every call to getGlobalProjectId() would throw.
    let globalId: string;
    try {
      globalId = getGlobalProjectId();
    } catch {
      logger.debug("mail-sync", "Skipping mail sync — no global project configured");
      return;
    }

    const engineStatus = getEngineStatus();
    const accounts = listAccounts(globalId);
    const encryption = getEmailEncryptionDiagnostics();
    if (encryption.status !== "ready") {
      logger.debug("mail-sync", `Skipping mail sync — encryption continuity is ${encryption.status}`);
      return;
    }

    // Reconcile on every scheduler tick so a global-project reassignment does
    // not leave workers bound to account snapshots from the former global.
    if (!isSchedulerActive(generation)) return;
    startEngine(globalId);

    if (!engineStatus.running || !engineStatus.heartbeatAt) {
      logger.warn("mail-sync", `Engine not running (running=${engineStatus.running}, heartbeat=${engineStatus.heartbeatAt}), restarting`);
      startEngine(globalId);
      return;
    }

    const msSince = Date.now() - new Date(engineStatus.heartbeatAt).getTime();
    if (msSince > 120_000) {
      logger.warn("mail-sync", `Engine heartbeat stale (${Math.round(msSince / 1000)}s since last tick), restarting`);
      startEngine(globalId);
      return;
    }

    if (accounts.length > 0) {
      const engineAccounts = engineStatus.accounts.length;
      logger.info("mail-sync", `Engine healthy: ${engineAccounts}/${accounts.length} workers, heartbeat=${Math.round(msSince / 1000)}s ago`);
    }
  } catch (error: unknown) {
    logger.warn("mail-sync", "Engine health check failed", providerErrorDiagnostic(error, "sync"));
  }
}

function scheduleMailSync(generation: number): void {
  if (!isSchedulerActive(generation)) return;
  const interval = getMailSyncInterval();
  if (interval > 0) {
    logger.info("mail-sync", `Next mail sync in ${interval / 1000}s`);
    scheduleTimeout(generation, interval, () => {
      void trackTask(triggerMailSyncForAllProjects(generation)).finally(() => {
        if (isSchedulerActive(generation)) scheduleMailSync(generation);
      }).catch(() => undefined);
    });
  } else {
    logger.info("mail-sync", "Mail sync disabled (mail_sync_interval_ms = 0)");
  }
}

function scheduleNext(port: number, generation: number): void {
  if (!isSchedulerActive(generation)) return;
  const interval = getSynthesisInterval();
  if (interval > 0) {
    logger.info("scheduler", `Next synthesis in ${interval / 1000}s`);
    scheduleTimeout(generation, interval, () => {
      void trackTask(triggerSynthesisForAllProjects(port, generation)).finally(() => {
        if (isSchedulerActive(generation)) scheduleNext(port, generation);
      }).catch(() => undefined);
    });
  } else {
    logger.info("scheduler", `Synthesis disabled (interval = 0)`);
  }
}

// ============================================================================
// Job cron scheduler — runs every 60 seconds on a separate cycle
// ============================================================================

function matchesCron(cron: string, date: Date): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [min, hour, dom, month, dow] = parts;
  if (!min || !hour || !dom || !month || !dow) return false;

  return matchField(min, date.getMinutes(), 0, 59)
    && matchField(hour, date.getHours(), 0, 23)
    && matchField(dom, date.getDate(), 1, 31)
    && matchField(month, date.getMonth() + 1, 1, 12)
    && matchField(dow, date.getDay(), 0, 6);
}

function matchField(pattern: string, value: number, _min: number, _max: number): boolean {
  if (pattern === "*") return true;
  if (pattern.includes(",")) {
    return pattern.split(",").some(p => matchField(p.trim(), value, _min, _max));
  }
  if (pattern.startsWith("*/")) {
    const step = parseInt(pattern.slice(2), 10);
    if (isNaN(step) || step <= 0) return false;
    return value % step === 0;
  }
  if (pattern.includes("-")) {
    const [start, end] = pattern.split("-").map(Number);
    if (start === undefined || end === undefined || isNaN(start) || isNaN(end)) return false;
    return value >= start && value <= end;
  }
  const n = parseInt(pattern, 10);
  if (isNaN(n)) return false;
  return value === n;
}

function runJobScheduler(generation: number): void {
  if (!isSchedulerActive(generation)) return;
  try {
    const allProjects = projects.listProjects();
    const activeProjects = allProjects.filter(p => !p.archived_at);
    const now = new Date();

    for (const p of activeProjects) {
      if (!isSchedulerActive(generation)) break;
      const projectJobs = jobs.listJobs(p.id);

      for (const job of projectJobs) {
        if (!isSchedulerActive(generation)) break;
        if (!job.enabled) continue;
        if (!job.schedule_cron || job.schedule_cron.trim() === "") continue;
        if (!matchesCron(job.schedule_cron, now)) continue;

        const result = jobs.startJobRun(p.id, job.id, "cron");

        if ("reason" in result) {
          logger.debug("job-scheduler", `Job "${job.name}" skipped: ${result.reason}`);
          continue;
        }

        logger.info("job-scheduler", `Triggered cron run ${result.id} for job "${job.name}"`);

        if (!isSchedulerActive(generation)) {
          jobs.cancelJobRun(result.id);
          break;
        }

        executeJobRun(result.id, job, job.prompt_template).catch((err: Error) => {
          logger.error("job-scheduler", `Fire-and-forget executeJobRun failed: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n") });
        });
      }
    }
  } catch (err: any) {
    logger.warn("job-scheduler", `Job scheduler tick failed: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n") });
  }

  if (isSchedulerActive(generation)) scheduleJobTick(generation);
}

function scheduleJobTick(generation: number): void {
  scheduleTimeout(generation, 60_000, () => runJobScheduler(generation));
}

// ============================================================================
// Lock cleanup scheduler
// ============================================================================

function scheduleLockCleanup(generation: number): void {
  scheduleTimeout(generation, LOCK_CLEANUP_INTERVAL_MS, () => {
    try {
      const cleaned = maintenanceLocks.cleanupExpiredLocks();
      if (cleaned > 0) {
        logger.info("scheduler", `Cleaned up ${cleaned} expired maintenance lock(s)`);
      }
    } catch (err: any) {
      logger.warn("scheduler", `Lock cleanup failed: ${err.message}`);
    }
    if (isSchedulerActive(generation)) scheduleLockCleanup(generation);
  });
}

// ============================================================================
// Main scheduler entry point
// ============================================================================

export function startScheduler(port: number): void {
  if (schedulerRunning) {
    logger.warn("scheduler", "Scheduler start ignored because it is already running");
    return;
  }

  schedulerRunning = true;
  const generation = ++schedulerGeneration;
  logger.info(
    "scheduler",
    `Auto-synthesis initial default: ${SYNTHESIS_DEFAULT_MS / 1000}s (reads settings after first cycle)`,
  );

  logSynthesisHealth();

  // Start periodic expired-lock cleanup
  logger.info("scheduler", `Lock cleanup scheduler started (${LOCK_CLEANUP_INTERVAL_MS / 1000}s cycle)`);
  scheduleTimeout(generation, 60_000, () => scheduleLockCleanup(generation));

  // Staggered startup delays
  scheduleTimeout(generation, 30_000, () => {
    void trackTask(triggerSynthesisForAllProjects(port, generation)).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      const name = err instanceof Error ? err.name : "Unknown";
      const stack = err instanceof Error ? err.stack : undefined;
      logger.error("scheduler", `Initial synthesis cycle failed: ${msg}`, { error: msg, name, stack: stack?.split("\n").slice(0, 5).join("\n") });
    });
  });
  scheduleTimeout(generation, 30_000, () => scheduleNext(port, generation));

  logger.info("scheduler", "Job cron scheduler started (60s cycle)");
  scheduleTimeout(generation, 10_000, () => scheduleJobTick(generation));

  const mailInterval = getMailSyncInterval();
  if (mailInterval > 0) {
    logger.info("mail-sync", `Mail sync scheduler started (${mailInterval / 1000}s cycle)`);
    scheduleTimeout(generation, 15_000, () => scheduleMailSync(generation));
  } else {
    logger.info("mail-sync", "Mail sync disabled (mail_sync_interval_ms = 0)");
  }

  const usageInterval = getUsageSyncInterval();
  if (usageInterval > 0) {
    logger.info("usage-sync", `Usage sync scheduler started (${usageInterval / 1000}s cycle)`);
    scheduleTimeout(generation, 20_000, () => scheduleUsageSync(generation));
  } else {
    logger.info("usage-sync", "Usage sync disabled (USAGE_SYNC_INTERVAL_MS = 0)");
  }
}

/** Stop every scheduler-owned timer and abort in-flight local HTTP calls. */
export async function stopScheduler(): Promise<void> {
  if (!schedulerRunning) return;

  schedulerRunning = false;
  ++schedulerGeneration;
  for (const timeout of scheduledTimeouts) clearTimeout(timeout);
  scheduledTimeouts.clear();
  for (const interval of renewalIntervals) clearInterval(interval);
  renewalIntervals.clear();
  for (const controller of activeAbortControllers) controller.abort();
  activeAbortControllers.clear();

  await Promise.allSettled([...activeTasks]);
  logger.info("scheduler", "Background scheduler stopped");
}

export function isSchedulerRunning(): boolean {
  return schedulerRunning;
}

function logSynthesisHealth(): void {
  try {
    const globalProject = projects.getGlobalProject();
    if (globalProject) {
      const model = settings.getSetting(globalProject.id, "synthesis_model");
      const endpoint = settings.getSetting(globalProject.id, "synthesis_endpoint");
      if (model && endpoint) {
        logger.info("scheduler", `Synthesis LLM configured: model=${model}, endpoint=${endpoint.split("/v1")[0]}, project="${globalProject.name}"`);
      } else if (model && !endpoint) {
        logger.warn("scheduler", `Synthesis LLM partially configured: model=${model}, but endpoint is missing in project "${globalProject.name}"`);
      } else {
        logger.info("scheduler", `Global project "${globalProject.name}" exists but synthesis_model is not set — self-learning disabled until configured in Settings`);
      }
      return;
    }

    const allProjects = projects.listProjects();
    const activeProjects = allProjects.filter(p => !p.archived_at);
    const projectsWithSynthesis: string[] = [];

    for (const p of activeProjects) {
      const model = settings.getSetting(p.id, "synthesis_model");
      if (model) {
        projectsWithSynthesis.push(p.name);
      }
    }

    if (projectsWithSynthesis.length > 0) {
      logger.warn(
        "scheduler",
        `Synthesis LLM configured in ${projectsWithSynthesis.length} project(s) [${projectsWithSynthesis.join(", ")}] but NO project is marked global! ` +
        `Self-learning pipeline will be SILENTLY disabled for ALL projects until one is set as global. ` +
        `Fix: run /init-project or mark one project as global via Settings → save synthesis_model for "global-default".`,
      );
    } else {
      logger.info("scheduler", "Synthesis LLM not configured — self-learning disabled until configured in Settings");
    }
  } catch (err: any) {
    logger.warn("scheduler", `Synthesis health check failed: ${err.message}`, { error: err.message, name: err.name });
  }
}
