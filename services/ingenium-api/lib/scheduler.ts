import { settings, projects, logger, extraction, synthesis, jobs, maintenanceLocks, checkpointAfterWrite } from "ingenium-core";
import { executeJobRun } from "./job-runner.js";
import { listAccounts, startEngine, getEngineStatus, getGlobalProjectId } from "ingenium-email";

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

async function triggerSynthesisForAllProjects(port: number) {
  const allProjects = projects.listProjects();
  const activeProjects = allProjects.filter(p => !p.archived_at);

  for (const p of activeProjects) {
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
          if (heartbeat) clearInterval(heartbeat);
          heartbeat = null;
        }
      }, LOCK_RENEW_INTERVAL_MS);

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
      if (heartbeat) clearInterval(heartbeat);
      maintenanceLocks.releaseLock("skills", p.id, ownerToken);
    }
  }

  // Cross-project synthesis — the route OWNS the global lock internally.
  // Scheduler just calls with client timeout; does NOT acquire a second global lock.
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CROSS_PROJECT_TIMEOUT_MS);
    try {
      const res = await fetch(`http://localhost:${port}/api/v1/synthesis/cross-project`, {
        method: "POST",
        signal: controller.signal,
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
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.debug("scheduler", `Cross-project synthesis outer error: ${msg}`);
  }
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

async function triggerMailSyncForAllProjects(): Promise<void> {
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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("mail-sync", `Engine health check failed: ${msg}`);
  }
}

function scheduleMailSync(): void {
  const interval = getMailSyncInterval();
  if (interval > 0) {
    logger.info("mail-sync", `Next mail sync in ${interval / 1000}s`);
    setTimeout(() => {
      triggerMailSyncForAllProjects().finally(() => scheduleMailSync());
    }, interval);
  } else {
    logger.info("mail-sync", "Mail sync disabled (mail_sync_interval_ms = 0)");
  }
}

function scheduleNext(port: number) {
  const interval = getSynthesisInterval();
  if (interval > 0) {
    logger.info("scheduler", `Next synthesis in ${interval / 1000}s`);
    setTimeout(() => {
      triggerSynthesisForAllProjects(port).finally(() => scheduleNext(port));
    }, interval);
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

function runJobScheduler(): void {
  try {
    const allProjects = projects.listProjects();
    const activeProjects = allProjects.filter(p => !p.archived_at);
    const now = new Date();

    for (const p of activeProjects) {
      const projectJobs = jobs.listJobs(p.id);

      for (const job of projectJobs) {
        if (!job.enabled) continue;
        if (!job.schedule_cron || job.schedule_cron.trim() === "") continue;
        if (!matchesCron(job.schedule_cron, now)) continue;

        const result = jobs.startJobRun(p.id, job.id, "cron");

        if ("reason" in result) {
          logger.debug("job-scheduler", `Job "${job.name}" skipped: ${result.reason}`);
          continue;
        }

        logger.info("job-scheduler", `Triggered cron run ${result.id} for job "${job.name}"`);

        executeJobRun(result.id, job, job.prompt_template).catch((err: Error) => {
          logger.error("job-scheduler", `Fire-and-forget executeJobRun failed: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n") });
        });
      }
    }
  } catch (err: any) {
    logger.warn("job-scheduler", `Job scheduler tick failed: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n") });
  }

  scheduleJobTick();
}

function scheduleJobTick(): void {
  setTimeout(runJobScheduler, 60_000);
}

// ============================================================================
// Lock cleanup scheduler
// ============================================================================

function scheduleLockCleanup(): void {
  setTimeout(() => {
    try {
      const cleaned = maintenanceLocks.cleanupExpiredLocks();
      if (cleaned > 0) {
        logger.info("scheduler", `Cleaned up ${cleaned} expired maintenance lock(s)`);
      }
    } catch (err: any) {
      logger.warn("scheduler", `Lock cleanup failed: ${err.message}`);
    }
    scheduleLockCleanup();
  }, LOCK_CLEANUP_INTERVAL_MS);
}

// ============================================================================
// Main scheduler entry point
// ============================================================================

export function startScheduler(port: number) {
  logger.info(
    "scheduler",
    `Auto-synthesis initial default: ${SYNTHESIS_DEFAULT_MS / 1000}s (reads settings after first cycle)`,
  );

  logSynthesisHealth();

  // Start periodic expired-lock cleanup
  logger.info("scheduler", `Lock cleanup scheduler started (${LOCK_CLEANUP_INTERVAL_MS / 1000}s cycle)`);
  setTimeout(scheduleLockCleanup, 60_000);

  // Staggered startup delays
  setTimeout(() => {
    triggerSynthesisForAllProjects(port).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      const name = err instanceof Error ? err.name : "Unknown";
      const stack = err instanceof Error ? err.stack : undefined;
      logger.error("scheduler", `Initial synthesis cycle failed: ${msg}`, { error: msg, name, stack: stack?.split("\n").slice(0, 5).join("\n") });
    });
  }, 30000);
  setTimeout(() => scheduleNext(port), 30000);

  logger.info("scheduler", "Job cron scheduler started (60s cycle)");
  setTimeout(scheduleJobTick, 10_000);

  const mailInterval = getMailSyncInterval();
  if (mailInterval > 0) {
    logger.info("mail-sync", `Mail sync scheduler started (${mailInterval / 1000}s cycle)`);
    setTimeout(scheduleMailSync, 15_000);
  } else {
    logger.info("mail-sync", "Mail sync disabled (mail_sync_interval_ms = 0)");
  }
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
