import { settings, projects, logger, extraction, synthesis } from "ingenium-core";

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

export function startScheduler(port: number) {
  logger.info(
    "scheduler",
    `Auto-synthesis initial default: ${SYNTHESIS_DEFAULT_MS / 1000}s (reads settings after first cycle)`,
  );
  setTimeout(() => triggerSynthesisForAllProjects(port), 30000);
  setTimeout(() => scheduleNext(port), 30000);
}
