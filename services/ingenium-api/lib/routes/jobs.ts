import { Router } from "express";
import { jobs, synthesisLlm, jobSuggestLlm } from "ingenium-core";
import { requireProject } from "../helpers.js";
import { executeJobRun, killRunProcess } from "../job-runner.js";

/**
 * CRUD + execution routes for per-project scheduled jobs.
 * Jobs are agent-powered tasks with cron/event triggers.
 * Execution is fire-and-forget via executeJobRun, with run-level status tracking.
 *
 * 🔴 Route ordering matters: /runs/* and /suggest MUST be registered before
 * /:id to prevent Express from capturing "runs" or "suggest" as the :id param.
 */
export const jobsRouter = Router();

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

  const { name, description, agent, prompt_template, schedule_cron, trigger_event, timeout_minutes } = req.body;

  if (!name || !agent || !prompt_template) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "name, agent, and prompt_template are required" },
    });
    return;
  }

  const job = jobs.createJob(
    projectId,
    name,
    description,
    agent,
    prompt_template,
    schedule_cron,
    trigger_event,
    timeout_minutes,
  );
  res.status(201).json({ data: job });
});

// ============================================================================
// 2. Run-level routes — MUST be registered BEFORE /:id to avoid Express
//    capturing "runs" as the :id parameter in multi-segment paths.
// ============================================================================

// POST /runs/:runId/cancel — cancel a running job
jobsRouter.post("/runs/:runId/cancel", (req, res) => {
  const _projectId = requireProject(req, res);
  if (!_projectId) return;

  const runId = req.params.runId!;

  // Try to kill the process if it's running
  killRunProcess(runId);

  const run = jobs.cancelJobRun(runId);
  if (!run) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Run not found" } });
    return;
  }
  res.json({ data: run });
});

// GET /runs/:runId/logs — get logs for a run, supports tail polling via ?after=<seq>
// The `after` param returns only entries after that sequence number (for incremental UI updates)
jobsRouter.get("/runs/:runId/logs", (req, res) => {
  const _projectId = requireProject(req, res);
  if (!_projectId) return;

  const runId = req.params.runId!;
  const afterSeq = req.query.after ? parseInt(req.query.after as string) : undefined;

  if (afterSeq !== undefined && isNaN(afterSeq)) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "after must be a number" } });
    return;
  }

  const logs = jobs.getRunLogs(runId, afterSeq);
  res.json({ data: logs, total: logs.length });
});

// ============================================================================
// 2b. Suggest route — MUST be registered BEFORE /:id to avoid Express
//     capturing "suggest" as an :id parameter.
// ============================================================================

// POST /suggest — derive job config from description using Synthesis LLM
jobsRouter.post("/suggest", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const { description } = req.body;
  if (!description || typeof description !== "string" || description.trim().length === 0) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "description is required" } });
    return;
  }

  const llmConfig = synthesisLlm.resolveLLMConfig(projectId);
  if (!llmConfig || !llmConfig.model) {
    res.json({ data: { prompt_template: null, schedule_cron: null, trigger_event: null, configured: false } });
    return;
  }

  jobSuggestLlm.generateJobConfig(llmConfig, description.trim())
    .then((result) => {
      res.json({ data: { ...result, configured: true } });
    })
    .catch((err: Error) => {
      (async () => {
        const { logger } = await import("ingenium-core");
        logger.error("jobs-suggest", `LLM generation failed: ${err.message}`, { error: err.message });
      })();
      res.status(500).json({ error: { code: "LLM_ERROR", message: "Job suggestion generation failed" } });
    });
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

// PATCH /:id — update a job
// SECURITY: explicit field allowlist prevents mass-assignment attacks.
// Only these fields are accepted; all other body properties are silently ignored.
jobsRouter.patch("/:id", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const allowedFields = ["name", "description", "agent", "prompt_template", "schedule_cron", "trigger_event", "enabled", "timeout_minutes"];
  const fields: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (key in req.body) {
      fields[key] = req.body[key];
    }
  }

  if (Object.keys(fields).length === 0) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "No valid fields to update" } });
    return;
  }

  const updated = jobs.updateJob(projectId, req.params.id!, fields as any);
  if (!updated) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Job not found" } });
    return;
  }
  res.json({ data: updated });
});

// DELETE /:id — delete a job
jobsRouter.delete("/:id", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const deleted = jobs.deleteJob(projectId, req.params.id!);
  if (!deleted) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Job not found" } });
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
      logger.error("jobs-route", `Fire-and-forget executeJobRun failed: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
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

  const limit = parseInt(req.query.limit as string) || 50;
  const list = jobs.listJobRuns(req.params.id!, limit);
  res.json({ data: list, total: list.length });
});
