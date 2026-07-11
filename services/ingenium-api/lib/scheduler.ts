import { settings, projects } from "ingenium-core";

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
  try {
    const projectsRes = await fetch(`http://localhost:${port}/api/v1/projects`);
    if (!projectsRes.ok) {
      console.warn(`[scheduler] Failed to fetch projects: ${projectsRes.status}`);
      return;
    }
    const allProjects = (await projectsRes.json()).data || [];

    for (const p of allProjects) {
      try {
        const res = await fetch(
          `http://localhost:${port}/api/v1/synthesis/run?project=${p.name}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          },
        );
        if (res.ok) {
          const result = await res.json();
          console.log(
            `[scheduler] Synthesis for "${p.name}": ${JSON.stringify(result.data)}`,
          );
        } else {
          console.warn(
            `[scheduler] Synthesis for "${p.name}" failed: ${res.status}`,
          );
        }
      } catch (err: any) {
        console.debug(
          `[scheduler] Synthesis for "${p.name}" error: ${err.message}`,
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
            console.log(
              `[scheduler] Skill sync for "${p.name}": ${syncData.synced_to_db} from disk, ${syncData.written_to_disk} to disk`,
            );
          }
        }
      } catch (err: any) {
        console.debug(
          `[scheduler] Skill sync for "${p.name}" error: ${err.message}`,
        );
      }
    }
  } catch (err: any) {
    console.debug(`[scheduler] Error fetching projects: ${err.message}`);
  }

  // Cross-project synthesis
  try {
    await fetch(`http://localhost:${port}/api/v1/synthesis/cross-project`, {
      method: "POST",
    });
  } catch (e) {
    console.debug("Cross-project synthesis failed:", e);
  }
}

function scheduleNext(port: number) {
  const interval = getSynthesisInterval();
  if (interval > 0) {
    console.log(`[scheduler] Next synthesis in ${interval / 1000}s`);
    setTimeout(() => {
      triggerSynthesisForAllProjects(port).finally(() => scheduleNext(port));
    }, interval);
  } else {
    console.log(`[scheduler] Synthesis disabled (interval = 0)`);
  }
}

export function startScheduler(port: number) {
  console.log(
    `[scheduler] Auto-synthesis initial default: ${SYNTHESIS_DEFAULT_MS / 1000}s (reads settings after first cycle)`,
  );
  setTimeout(() => triggerSynthesisForAllProjects(port), 30000);
  setTimeout(() => scheduleNext(port), 30000);
}
