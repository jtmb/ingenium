import { Router } from "express";
import { synthesis, logger, maintenanceLocks, runtimes } from "ingenium-core";
import { z } from "zod";
import { requireProject } from "../helpers.js";
import { createBackgroundSynthesisBrokerExecutor, type ManualSynthesisSelection } from "../opencode-client.js";
import { isAllowedChatSelection } from "../chat-provider-catalog.js";
import { getManualSynthesisModels } from "../manual-synthesis-models.js";

/** Handles /api/v1/synthesis — triggers the self-learning pipeline (per-project and cross-project). */
export const synthesisRouter = Router();

const LOCK_RESOURCE = "skills";
const SYNTHESIS_LOCK_MS = 120_000; // 2 minutes
const RENEW_INTERVAL_MS = 60_000; // Renew every 60s
export const SynthesisSessionIdSchema = z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/);
const ManualModelSchema = z.object({
  providerId: z.string().min(1).max(256),
  modelId: z.string().min(1).max(256),
}).strict();

synthesisRouter.get("/models", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const catalog = await getManualSynthesisModels(projectId);
    if (!catalog.unavailable) {
      res.json({ data: { providers: catalog.providers } });
      return;
    }
  } catch { /* Return only the sanitized dependency error below. */ }
  res.status(503).json({ error: { code: "LLM_CATALOG_UNAVAILABLE", message: "The model catalog is temporarily unavailable." } });
});

/**
 * POST /synthesis/run — trigger synthesis for a project.
 *
 * Acquires a per-project skills lock before scheduling async work.
 * The lock is held for the full async duration via renewal every 60s.
 * Returns 423 if another owner already holds the lock.
 */
synthesisRouter.post("/run", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const session = SynthesisSessionIdSchema.optional().safeParse(req.query.session_id);
  if (!session.success) {
    res.status(422).json({ error: { code: "INVALID_SESSION_ID", message: "session_id must be a valid session identifier." } });
    return;
  }
  const sessionId = session.data;
  let selection: ManualSynthesisSelection | undefined;
  if (req.body?.model !== undefined) {
    // A manual choice belongs to this browser action only. Service credentials
    // and scheduled synthesis keep their server-owned provider resolution.
    if (req.principal?.type !== "user" || !req.principal.session) {
      res.status(403).json({ error: { code: "BROWSER_SESSION_REQUIRED", message: "Choose a synthesis model from a signed-in browser session." } });
      return;
    }
    const runtime = runtimes.getReadyRuntimeForProject(projectId);
    if (!runtime || runtime.ownerUserId !== req.principal.id) {
      res.status(403).json({ error: { code: "RUNTIME_OWNER_REQUIRED", message: "Only the authorized runtime owner can choose a model for this run." } });
      return;
    }
    const parsed = ManualModelSchema.safeParse(req.body.model);
    if (!parsed.success) {
      res.status(422).json({ error: { code: "INVALID_SYNTHESIS_MODEL", message: "Choose an available provider and model." } });
      return;
    }
    try {
      const catalog = await getManualSynthesisModels(projectId);
      if (catalog.unavailable) {
        res.status(503).json({ error: { code: "LLM_CATALOG_UNAVAILABLE", message: "The model catalog is temporarily unavailable." } });
        return;
      }
      if (!isAllowedChatSelection(catalog.providers, parsed.data)) {
        res.status(422).json({ error: { code: "INVALID_SYNTHESIS_MODEL", message: "The selected provider and model are no longer available." } });
        return;
      }
    } catch {
      res.status(503).json({ error: { code: "LLM_CATALOG_UNAVAILABLE", message: "The model catalog is temporarily unavailable." } });
      return;
    }
    selection = { providerID: parsed.data.providerId, modelID: parsed.data.modelId, runtimeId: runtime.id, ownerUserId: req.principal.id };
  }

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
  scheduleAsync(pid, sid, token, selection);
});

async function scheduleAsync(projectId: string, sessionId: string | undefined, ownerToken: string, selection?: ManualSynthesisSelection): Promise<void> {
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

    const result = await synthesis.runSynthesis(projectId, sessionId, {
      llmExecutor: createBackgroundSynthesisBrokerExecutor(projectId, selection),
      ownerToken,
    });
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

function synthesisStatusResponse(status: ReturnType<typeof synthesis.getSynthesisStatus>) {
  return {
    total_observations: status.total_observations,
    pending_count: status.pending_count,
    processed_count: status.processed_count,
    trait_count: status.trait_count,
    last_synthesis_at: status.last_synthesis_at,
    incompleteBatch: status.incompleteBatch === null ? null : {
      stage: status.incompleteBatch.stage,
      observationCount: status.incompleteBatch.observationCount,
      hasStoredProposalPlan: status.incompleteBatch.hasStoredProposalPlan,
      errorCount: status.incompleteBatch.errorCount,
      lastErrorCode: status.incompleteBatch.lastErrorCode,
      createdAt: status.incompleteBatch.createdAt,
      updatedAt: status.incompleteBatch.updatedAt,
      leaseState: status.incompleteBatch.leaseState,
    },
  };
}

synthesisRouter.get("/status", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const status = synthesis.getSynthesisStatus(projectId);
  res.json({ data: synthesisStatusResponse(status) });
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
