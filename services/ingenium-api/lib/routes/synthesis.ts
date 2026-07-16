import { Router } from "express";
import { synthesis, logger, maintenanceLocks } from "ingenium-core";
import { requireProject } from "../helpers.js";

/** Handles /api/v1/synthesis — triggers the self-learning pipeline (per-project and cross-project). */
export const synthesisRouter = Router();

const LOCK_RESOURCE = "skills";
const SYNTHESIS_LOCK_MS = 120_000; // 2 minutes
const RENEW_INTERVAL_MS = 60_000; // Renew every 60s

/**
 * POST /synthesis/run — trigger synthesis for a project.
 *
 * Acquires a per-project skills lock before scheduling async work.
 * The lock is held for the full async duration via renewal every 60s.
 * Returns 423 if another owner already holds the lock.
 */
synthesisRouter.post("/run", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const sessionId = (req.query.session_id as string) || undefined;

  // Acquire project-lifetime lock
  const ownerToken = maintenanceLocks.generateOwnerToken();
  const acquired = maintenanceLocks.acquireLock(LOCK_RESOURCE, projectId, ownerToken, SYNTHESIS_LOCK_MS);
  if (!acquired) {
    const existingLock = maintenanceLocks.getLockStatus(LOCK_RESOURCE, projectId);
    const retryAfterMs = existingLock
      ? Math.max(0, new Date(existingLock.expires_at).getTime() - Date.now())
      : SYNTHESIS_LOCK_MS;
    res.status(423).json({
      error: {
        code: "LOCKED",
        message: `Resource '${LOCK_RESOURCE}' is locked. Retry after ${Math.ceil(retryAfterMs / 1000)}s.`,
        retryAfterMs: Math.ceil(retryAfterMs),
      },
    });
    return;
  }

  // Respond immediately — lock is held, work runs async
  res.json({ data: { status: "started", message: "Synthesis pipeline triggered. Check back via GET /status." } });

  // Capture primitives, not req/res
  const pid = projectId;
  const sid = sessionId;
  const token = ownerToken;

  // Schedule async work with lock renewal
  scheduleAsync(pid, sid, token);
});

async function scheduleAsync(projectId: string, sessionId: string | undefined, ownerToken: string): Promise<void> {
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  try {
    heartbeat = setInterval(() => {
      const renewed = maintenanceLocks.renewLock(LOCK_RESOURCE, projectId, ownerToken, SYNTHESIS_LOCK_MS);
      if (!renewed) {
        logger.error("synthesis", `[HIGH] Lock renewal FAILED for project ${projectId} — lock may have expired or been stolen. Work continues WITHOUT lock protection.`);
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
      }
    }, RENEW_INTERVAL_MS);

    const result = await synthesis.runSynthesis(projectId, sessionId);
    logger.info("synthesis", `Completed: ${JSON.stringify(result)}`);
  } catch (err: any) {
    logger.error("synthesis", `Synthesis pipeline failed: ${err.message}`, {
      error: err.message, name: err.name,
      stack: err.stack?.split("\n").slice(0, 5).join("\n"),
    });
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    maintenanceLocks.releaseLock(LOCK_RESOURCE, projectId, ownerToken);
  }
}

synthesisRouter.get("/status", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const status = synthesis.getSynthesisStatus(projectId);
  res.json({ data: status });
});

/**
 * POST /synthesis/cross-project — cross-project synthesis.
 *
 * THIS ROUTE OWNS the global skills lock. Acquires it, starts a 60s heartbeat
 * renewal (120s TTL per renewal tick), awaits crossProjectSynthesis, and
 * releases in finally. If renewal returns false or throws, a HIGH severity
 * error is logged — the route does not silently continue as though protected.
 */
synthesisRouter.post("/cross-project", async (_req, res) => {
  const globalToken = maintenanceLocks.generateOwnerToken();
  const acquired = maintenanceLocks.acquireLock(LOCK_RESOURCE, "*", globalToken, SYNTHESIS_LOCK_MS);

  if (!acquired) {
    const existingLock = maintenanceLocks.getLockStatus(LOCK_RESOURCE, "*");
    const retryAfterMs = existingLock
      ? Math.max(0, new Date(existingLock.expires_at).getTime() - Date.now())
      : SYNTHESIS_LOCK_MS;
    res.status(423).json({
      error: {
        code: "LOCKED",
        message: `Global skills lock held. Retry after ${Math.ceil(retryAfterMs / 1000)}s.`,
        retryAfterMs: Math.ceil(retryAfterMs),
      },
    });
    return;
  }

  let heartbeat: ReturnType<typeof setInterval> | null = null;
  try {
    // Start heartbeat renewal — every 60s extend the TTL by another 120s.
    // If renewal ever fails, log HIGH severity but continue work.
    heartbeat = setInterval(() => {
      try {
        const renewed = maintenanceLocks.renewLock(LOCK_RESOURCE, "*", globalToken, SYNTHESIS_LOCK_MS);
        if (!renewed) {
          logger.error("synthesis", "[HIGH] Cross-project global lock renewal FAILED — lock may have expired or been stolen. Work continues WITHOUT lock protection.");
          if (heartbeat) clearInterval(heartbeat);
          heartbeat = null;
        }
      } catch (err: any) {
        logger.error("synthesis", `[HIGH] Cross-project global lock renewal THREW: ${err.message} — lock may be lost.`, {
          error: err.message, name: err.name,
        });
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
      }
    }, RENEW_INTERVAL_MS);

    await synthesis.runCrossProjectSynthesis();
    res.json({ status: "completed" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const name = e instanceof Error ? e.name : "Unknown";
    const stack = e instanceof Error ? e.stack : undefined;
    logger.error("synthesis", `Cross-project synthesis failed: ${msg}`, {
      error: msg, name,
      stack: stack?.split("\n").slice(0, 5).join("\n"),
    });
    res.status(500).json({ error: { code: "SYNTHESIS_ERROR", message: msg } });
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    maintenanceLocks.releaseLock(LOCK_RESOURCE, "*", globalToken);
  }
});
