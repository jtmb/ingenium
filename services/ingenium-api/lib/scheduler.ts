import { settings, projects, logger, extraction, synthesis, jobs } from "ingenium-core";
import { executeJobRun } from "./job-runner.js";

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

async function triggerSynthesisForAllProjects(port: number) {
  const allProjects = projects.listProjects();
  const activeProjects = allProjects.filter(p => !p.archived_at);

  for (const p of activeProjects) {
    // 1. Extraction — LLM-based observation extraction from OpenCode messages.
    //    Await completion so synthesis sees the new observations same cycle.
    try {
      const extractResult = await extraction.runExtraction(p.id, p.name);
      logger.info("scheduler", `Extraction for "${p.name}": scanned=${extractResult.scanned}, created=${extractResult.created}`);
    } catch (err: any) {
      logger.warn("scheduler", `Extraction for "${p.name}" failed: ${err.message}`);
    }

    // 2. Synthesis — processes pending observations into traits + skills
    try {
      const result = await synthesis.runSynthesis(p.id);
      logger.info(
        "scheduler",
        `Synthesis for "${p.name}": ${result.summary}`,
      );
    } catch (err: any) {
      logger.warn(
        "scheduler",
        `Synthesis for "${p.name}" failed: ${err.message}`,
      );
    }

    try {
      const syncRes = await fetch(
        `http://localhost:${port}/api/v1/skills/sync-all?project=${p.name}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      if (syncRes.ok) {
        const syncData = (await syncRes.json()).data;
        if (syncData.synced_to_db > 0 || syncData.written_to_disk > 0) {
          logger.info(
            "scheduler",
            `Skill sync for "${p.name}": ${syncData.synced_to_db} from disk, ${syncData.written_to_disk} to disk`,
          );
        }
      }
    } catch (err: any) {
      logger.debug(
        "scheduler",
        `Skill sync for "${p.name}" error: ${err.message}`,
      );
    }
  }

  // Cross-project synthesis
  try {
    await fetch(`http://localhost:${port}/api/v1/synthesis/cross-project`, {
      method: "POST",
    });
  } catch (e) {
    logger.debug("scheduler", "Cross-project synthesis failed", { error: e instanceof Error ? e.message : String(e) });
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

// Minimal 5-field cron matcher.
// Format: minute hour day-of-month month day-of-week
// Supports: *, N, step (slash N), N-M (range), N,M (list)
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

  // Handle comma-separated lists: 1,2,3
  if (pattern.includes(",")) {
    return pattern.split(",").some(p => matchField(p.trim(), value, _min, _max));
  }

  // Handle step: */5
  if (pattern.startsWith("*/")) {
    const step = parseInt(pattern.slice(2), 10);
    if (isNaN(step) || step <= 0) return false;
    return value % step === 0;
  }

  // Handle range: 1-5
  if (pattern.includes("-")) {
    const [start, end] = pattern.split("-").map(Number);
    if (start === undefined || end === undefined || isNaN(start) || isNaN(end)) return false;
    return value >= start && value <= end;
  }

  // Exact number
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
        // Skip disabled jobs
        if (!job.enabled) continue;

        // Skip jobs without a cron schedule
        if (!job.schedule_cron || job.schedule_cron.trim() === "") continue;

        // Check if this job is due to run now (current minute matches)
        if (!matchesCron(job.schedule_cron, now)) continue;

        // Start the run
        const result = jobs.startJobRun(p.id, job.id, "cron");

        if ("reason" in result) {
          // Already running or disabled — log and skip
          logger.debug("job-scheduler", `Job "${job.name}" skipped: ${result.reason}`);
          continue;
        }

        logger.info("job-scheduler", `Triggered cron run ${result.id} for job "${job.name}"`);

        // Fire-and-forget the execution
        executeJobRun(result.id, job, job.prompt_template).catch((err: Error) => {
          logger.error("job-scheduler", `Fire-and-forget executeJobRun failed: ${err.message}`);
        });
      }
    }
  } catch (err: any) {
    logger.warn("job-scheduler", `Job scheduler tick failed: ${err.message}`);
  }

  // Schedule next tick
  scheduleJobTick();
}

function scheduleJobTick(): void {
  setTimeout(runJobScheduler, 60_000);
}

// ============================================================================
// Main scheduler entry point
// ============================================================================

export function startScheduler(port: number) {
  logger.info(
    "scheduler",
    `Auto-synthesis initial default: ${SYNTHESIS_DEFAULT_MS / 1000}s (reads settings after first cycle)`,
  );
  setTimeout(() => triggerSynthesisForAllProjects(port), 30000);
  setTimeout(() => scheduleNext(port), 30000);

  // Start the job cron scheduler on a separate 60s cycle
  logger.info("scheduler", "Job cron scheduler started (60s cycle)");
  setTimeout(scheduleJobTick, 10_000); // Start after a short initial delay
}
