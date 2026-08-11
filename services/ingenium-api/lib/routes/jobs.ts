import { Router } from "express";
import { jobs, jobEventDeliveries, jobSuggestLlm, synthesisLlm, trustedJobEvents } from "ingenium-core";
import { requireProject } from "../helpers.js";
import { executeJobRun, killRunProcess } from "../job-runner.js";
import { executeSynthesisBroker } from "../opencode-client.js";
import { resolveSynthesisProviderSelections } from "../synthesis-provider-resolution.js";

/**
 * CRUD + execution routes for per-project scheduled jobs.
 * Jobs are agent-powered tasks with cron/event triggers.
 * Execution is fire-and-forget via executeJobRun, with run-level status tracking.
 *
 * 🔴 Route ordering matters: /runs/* and /suggest MUST be registered before
 * /:id to prevent Express from capturing "runs" or "suggest" as the :id param.
 */
export const jobsRouter = Router();

function sendUnknownTriggerEvent(res: import("express").Response): void {
  res.status(400).json({
    error: {
      code: "UNKNOWN_TRIGGER_EVENT",
      message: "trigger_event must be null or a trusted job event catalog value",
    },
  });
}

const vaultItemIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseVaultItemIds(body: unknown): string[] | undefined | null {
  if (!body || typeof body !== "object" || !Object.prototype.hasOwnProperty.call(body, "vault_item_ids")) {
    return undefined;
  }
  const value = (body as Record<string, unknown>).vault_item_ids;
  if (!Array.isArray(value) || value.length > jobs.JOB_VAULT_REFERENCE_MAX
    || !value.every((itemId) => typeof itemId === "string" && vaultItemIdPattern.test(itemId))
    || new Set(value).size !== value.length) {
    return null;
  }
  return value as string[];
}

function sendVaultItemIdsValidation(res: import("express").Response): void {
  res.status(422).json({
    error: { code: "VALIDATION_ERROR", message: "vault_item_ids must be an array of up to 16 unique UUIDs" },
  });
}

function sendVaultReferenceNotFound(res: import("express").Response): void {
  res.status(422).json({
    error: { code: "VAULT_ITEM_NOT_FOUND", message: "A vault item reference is unavailable" },
  });
}

function parseExpectedRevision(body: unknown): number | null {
  if (!body || typeof body !== "object" || !Object.prototype.hasOwnProperty.call(body, "expected_revision")) {
    return null;
  }
  const value = (body as Record<string, unknown>).expected_revision;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function sendExpectedRevisionValidation(res: import("express").Response): void {
  res.status(422).json({
    error: { code: "VALIDATION_ERROR", message: "expected_revision must be a nonnegative integer" },
  });
}

function hasValidJobTimeout(body: unknown): boolean {
  if (!body || typeof body !== "object" || !Object.prototype.hasOwnProperty.call(body, "timeout_minutes")) {
    return true;
  }
  return jobs.isValidJobTimeoutMinutes((body as Record<string, unknown>).timeout_minutes);
}

function sendJobTimeoutValidation(res: import("express").Response): void {
  res.status(422).json({
    error: {
      code: "VALIDATION_ERROR",
      message: `timeout_minutes must be an integer between ${jobs.MIN_JOB_TIMEOUT_MINUTES} and ${jobs.MAX_JOB_TIMEOUT_MINUTES}`,
    },
  });
}

function sendRevisionConflict(res: import("express").Response, currentRevision: number): void {
  res.status(409).json({
    error: {
      code: "JOB_REVISION_CONFLICT",
      message: "Job has changed. Reload before saving.",
      currentRevision,
    },
  });
}

function parseBoundedPage(req: import("express").Request, res: import("express").Response): { limit: number; cursor?: string } | null {
  const rawLimit = req.query.limit;
  const limit = rawLimit === undefined ? 20 : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "limit must be an integer between 1 and 100" } });
    return null;
  }
  if (req.query.cursor !== undefined && (typeof req.query.cursor !== "string" || req.query.cursor.length === 0 || req.query.cursor.length > 512)) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "cursor is invalid" } });
    return null;
  }
  return { limit, cursor: req.query.cursor as string | undefined };
}

// ============================================================================
// 1. Collection-level routes (no params)
// ============================================================================

// GET / — list all jobs for the project
jobsRouter.get("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const list = jobs.listJobs(projectId);
  res.json({ data: list, total: list.length });
});

// POST / — create a new job
// 422 (not 400) since the request is well-formed but semantically invalid
jobsRouter.post("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const body = req.body ?? {};
  const { name, description, agent, prompt_template, schedule_cron, trigger_event, timeout_minutes } = body;
  const vaultItemIds = parseVaultItemIds(body);

  if (!name || !agent || !prompt_template) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "name, agent, and prompt_template are required" },
    });
    return;
  }
  if (vaultItemIds === null) {
    sendVaultItemIdsValidation(res);
    return;
  }
  if (!hasValidJobTimeout(body)) {
    sendJobTimeoutValidation(res);
    return;
  }

  try {
    const job = jobs.createJob(
      projectId,
      name,
      description,
      agent,
      prompt_template,
      schedule_cron,
      trigger_event,
      timeout_minutes,
      vaultItemIds,
    );
    res.status(201).json({ data: job });
  } catch (error) {
    if (error instanceof jobs.JobTriggerEventError) {
      sendUnknownTriggerEvent(res);
      return;
    }
    if (error instanceof jobs.JobVaultReferenceError) {
      if (error.code === "INVALID_VAULT_ITEM_IDS") sendVaultItemIdsValidation(res);
      else sendVaultReferenceNotFound(res);
      return;
    }
    if (error instanceof jobs.JobTimeoutError) {
      sendJobTimeoutValidation(res);
      return;
    }
    throw error;
  }
});

// GET /events — trusted-event metadata only. Payloads are intentionally never
// exposed by this execution visibility route.
jobsRouter.get("/events", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const options = parseBoundedPage(req, res);
  if (!options) return;
  try {
    const page = trustedJobEvents.listTrustedJobEvents(projectId, options);
    res.json({
      data: page.data.map((event) => ({
        id: event.id,
        event_type: event.event_type,
        source_audit_event_id: event.source_audit_event_id,
        created_at: event.created_at,
      })),
      nextCursor: page.nextCursor,
    });
  } catch {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "cursor is invalid" } });
  }
});

// GET /event-deliveries — bounded keyset queue inspection; there is no replay
// or delivery mutation route.
jobsRouter.get("/event-deliveries", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const options = parseBoundedPage(req, res);
  if (!options) return;
  try {
    const page = jobEventDeliveries.listJobEventDeliveries(projectId, options);
    res.json({ data: page.data, nextCursor: page.nextCursor });
  } catch {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "cursor is invalid" } });
  }
});

jobsRouter.get("/event-deliveries/:deliveryId", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const delivery = jobEventDeliveries.getJobEventDelivery(projectId, req.params.deliveryId!);
  if (!delivery) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Event delivery not found" } });
    return;
  }
  res.json({ data: delivery });
});

// ============================================================================
// 2. Run-level routes — MUST be registered BEFORE /:id to avoid Express
//    capturing "runs" as the :id parameter in multi-segment paths.
// ============================================================================

// POST /runs/:runId/cancel — cancel a running job
jobsRouter.post("/runs/:runId/cancel", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const runId = req.params.runId!;

  const existing = jobs.getJobRun(projectId, runId);
  if (!existing) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Run not found" } });
    return;
  }
  // Do not signal a process until the run has been proven to belong to this project.
  killRunProcess(projectId, runId);
  const run = jobs.cancelJobRun(projectId, runId);
  if (!run) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Run not found" } });
    return;
  }
  res.json({ data: run });
});

// GET /runs/:runId/logs — get logs for a run, supports tail polling via ?after=<seq>
// The `after` param returns only entries after that sequence number (for incremental UI updates)
jobsRouter.get("/runs/:runId/logs", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const runId = req.params.runId!;
  const afterSeq = req.query.after ? parseInt(req.query.after as string) : undefined;

  if (afterSeq !== undefined && isNaN(afterSeq)) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "after must be a number" } });
    return;
  }

  if (!jobs.getJobRun(projectId, runId)) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Run not found" } });
    return;
  }
  const logs = jobs.getRunLogs(projectId, runId, afterSeq);
  res.json({ data: logs, total: logs.length });
});

// ============================================================================
// 2b. Suggest route — MUST be registered BEFORE /:id to avoid Express
//     capturing "suggest" as an :id parameter.
// ============================================================================

// POST /suggest — derive job config from description using Synthesis LLM
jobsRouter.post("/suggest", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const { description } = req.body;
  if (!description || typeof description !== "string" || description.trim().length === 0) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "description is required" } });
    return;
  }

  try {
    const directConfig = synthesisLlm.getFullLLMSynthesisConfig(projectId);
    if (directConfig) {
      const result = await jobSuggestLlm.generateJobConfig(directConfig, description.trim());
      res.json({ data: { ...result, configured: true } });
      return;
    }

    // Resolve only server-owned choices. Request bodies intentionally contain
    // no provider/model fields, so a browser cannot redirect this work away
    // from the managed primary/backup or validated Chat/Zen fallback.
    const resolution = await resolveSynthesisProviderSelections(projectId);
    if (resolution.selections.length === 0) {
      res.json({ data: { prompt_template: null, schedule_cron: null, trigger_event: null, configured: false } });
      return;
    }

    const result = await jobSuggestLlm.generateJobConfigWithExecutor(
      ({ system, user, timeoutMs }) => executeSynthesisBroker({ projectId, system, user, timeoutMs }),
      description.trim(),
    );
    res.json({ data: { ...result, configured: true } });
  } catch (error) {
    const { logger } = await import("ingenium-core");
    logger.error("jobs-suggest", "LLM generation failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    res.status(500).json({ error: { code: "LLM_ERROR", message: "Job suggestion generation failed" } });
  }
});

// ============================================================================
// 3. Per-job routes (/:id)
// ============================================================================

// GET /:id — get a single job
jobsRouter.get("/:id", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const job = jobs.getJob(projectId, req.params.id!);
  if (!job) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Job not found" } });
    return;
  }
  res.json({ data: job });
});

// GET /:id/vault-audit — bounded, metadata-only job authorization/runtime evidence.
jobsRouter.get("/:id/vault-audit", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const options = parseBoundedPage(req, res);
  if (!options) return;
  try {
    const page = jobs.listJobVaultAudit(projectId, req.params.id!, options);
    if (!page) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Job not found" } });
      return;
    }
    res.json(page);
  } catch {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "cursor is invalid" } });
  }
});

// PATCH /:id — update a job
// SECURITY: explicit field allowlist prevents mass-assignment attacks.
// Only these fields are accepted; all other body properties are silently ignored.
jobsRouter.patch("/:id", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const expectedRevision = parseExpectedRevision(body);
  if (expectedRevision === null) {
    sendExpectedRevisionValidation(res);
    return;
  }
  const allowedFields = ["name", "description", "agent", "prompt_template", "schedule_cron", "trigger_event", "enabled", "timeout_minutes", "vault_item_ids"];
  const fields: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (key in body) {
      fields[key] = body[key];
    }
  }

  if (Object.keys(fields).length === 0) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "No valid fields to update" } });
    return;
  }
  if (!hasValidJobTimeout(body)) {
    sendJobTimeoutValidation(res);
    return;
  }

  const vaultItemIds = parseVaultItemIds(body);
  if (vaultItemIds === null) {
    sendVaultItemIdsValidation(res);
    return;
  }
  if (vaultItemIds !== undefined) fields.vault_item_ids = vaultItemIds;

  let updated;
  try {
    updated = jobs.updateJob(projectId, req.params.id!, fields as any, expectedRevision);
  } catch (error) {
    if (error instanceof jobs.JobTriggerEventError) {
      sendUnknownTriggerEvent(res);
      return;
    }
    if (error instanceof jobs.JobVaultReferenceError) {
      if (error.code === "INVALID_VAULT_ITEM_IDS") sendVaultItemIdsValidation(res);
      else sendVaultReferenceNotFound(res);
      return;
    }
    if (error instanceof jobs.JobTimeoutError) {
      sendJobTimeoutValidation(res);
      return;
    }
    throw error;
  }
  if (updated.status === "not_found") {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Job not found" } });
    return;
  }
  if (updated.status === "revision_conflict") {
    sendRevisionConflict(res, updated.currentRevision);
    return;
  }
  res.json({ data: updated.job });
});

// DELETE /:id — delete a job
jobsRouter.delete("/:id", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const expectedRevision = parseExpectedRevision(req.body);
  if (expectedRevision === null) {
    sendExpectedRevisionValidation(res);
    return;
  }
  const deleted = jobs.deleteJob(projectId, req.params.id!, expectedRevision);
  if (deleted.status === "not_found") {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Job not found" } });
    return;
  }
  if (deleted.status === "active_delivery") {
    res.status(409).json({
      error: { code: "JOB_ACTIVE_DELIVERY", message: "Job has an active event delivery" },
    });
    return;
  }
  if (deleted.status === "revision_conflict") {
    sendRevisionConflict(res, deleted.currentRevision);
    return;
  }
  res.status(204).send();
});

// POST /:id/run — manually trigger a job run
jobsRouter.post("/:id/run", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const job = jobs.getJob(projectId, req.params.id!);
  if (!job) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Job not found" } });
    return;
  }

  const result = jobs.startJobRun(projectId, req.params.id!, "manual");

  if ("reason" in result) {
    res.status(409).json({ error: { code: "CONFLICT", message: result.reason } });
    return;
  }

  // NOTE: fire-and-forget — the HTTP response returns immediately. Job progress is
  // tracked via run status (GET /runs/:id) and logs (GET /runs/:id/logs).
  // The .catch() logs failures but the response has already been sent.
  executeJobRun(result.id, job, job.prompt_template).catch((err: Error) => {
    import("ingenium-core").then(({ logger }) => {
      const message = jobEventDeliveries.sanitizeJobEventText(err.message, 256);
      logger.error("jobs-route", `Fire-and-forget executeJobRun failed: ${message}`, {
        error: message,
        name: jobEventDeliveries.sanitizeJobEventText(err.name, 64),
        method: req.method,
        path: req.originalUrl,
      });
    });
  });

  res.status(202).json({ data: result });
});

// GET /:id/runs — list runs for a job
jobsRouter.get("/:id/runs", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const job = jobs.getJob(projectId, req.params.id!);
  if (!job) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Job not found" } });
    return;
  }

  const rawLimit = req.query.limit;
  const limit = rawLimit === undefined ? 50 : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "limit must be an integer between 1 and 100" } });
    return;
  }
  const list = jobs.listJobRuns(projectId, req.params.id!, limit);
  res.json({ data: list, total: list.length });
});
