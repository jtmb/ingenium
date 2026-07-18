import { Router } from "express";
import { observations, synthesisLlm, logger } from "ingenium-core";
import { requireProject } from "../helpers.js";

/** Handles /api/v1/observations — CRUD for self-learning observations with FTS5 search and LLM enrichment. */
export const observationsRouter = Router();

observationsRouter.get("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const limit = parseInt(req.query.limit as string) || 50;
  const status = req.query.status as string | undefined;
  const type = req.query.type as string | undefined;
  const list = observations.getObservations(
    projectId,
    (status as any) || undefined,
    (type as any) || undefined,
    limit,
  );
  res.json({ data: list, total: list.length });
});

// Uses SQLite FTS5 for full-text search across observation content
observationsRouter.get("/search", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const query = req.query.q as string;
  if (!query) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "query (q) is required" } });
    return;
  }
  const results = observations.searchObservations(projectId, query);
  res.json({ data: results, total: results.length });
});

observationsRouter.post("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const { observation_type, content, importance, source, context, session_id } = req.body;
  if (!observation_type || !content) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "observation_type and content are required" } });
    return;
  }
  const entry = observations.storeObservation(projectId, observation_type, content, importance, source, context, session_id);
  res.status(201).json({ data: entry });
});

// NOTE: /stats MUST be registered before /:id to avoid Express route capture
observationsRouter.get("/stats", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const pending = observations.countUnprocessed(projectId);
  const all = observations.getObservations(projectId);
  res.json({ data: { total: all.length, pending } });
});

observationsRouter.get("/:id", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: { code: "INVALID_ID", message: "Observation ID must be a number" } });
    return;
  }
  const entry = observations.getObservation(id);
  if (!entry) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Observation not found" } });
    return;
  }
  res.json({ data: entry });
});

// Supports status transitions (e.g., mark as processed) and importance adjustments
observationsRouter.patch("/:id", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: { code: "INVALID_ID", message: "Observation ID must be a number" } });
    return;
  }
  const { status, importance } = req.body;
  const update: any = {};
  if (status !== undefined) update.status = status;
  if (importance !== undefined) update.importance = importance;
  const result = observations.updateObservation(id, update);
  if (!result) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Observation not found" } });
    return;
  }
  res.json({ data: result });
});

// Enriches raw auto-observer observations via LLM — filters out noise (length < 3), falls back to no-op if no LLM configured
observationsRouter.post("/enrich", async (req, res, next) => {
  try {
    const projectId = requireProject(req, res);
    if (!projectId) return;
    
    const { observations: rawObservations } = req.body;
    if (!Array.isArray(rawObservations) || rawObservations.length === 0) {
      res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "observations array is required" } });
      return;
    }

    // Validate and normalize observations — filter out empty/short content
    const obs = rawObservations
      .filter((o: any) => o.content && String(o.content).trim().length >= 3)
      .map((o: any) => ({
        type: String(o.type || "observation"),
        content: String(o.content || ""),
        context: o.context ? String(o.context) : undefined,
      }));

    if (obs.length === 0) {
      res.json({ data: [] });
      return;
    }

    // Read LLM config from settings
    const config = synthesisLlm.getFullLLMSynthesisConfig();
    
    if (!config || !config.endpoint) {
    // No LLM endpoint configured — pass through originals unmodified with skip:false
    res.json({
        data: obs.map((o: any) => ({ ...o, enriched_content: undefined, skip: false })),
      });
      return;
    }

    const enriched = await synthesisLlm.enrichObservations(obs, config.endpoint, config.model, config.apiKey, undefined, config.allowPrivateNetwork);
    res.json({ data: enriched });
  } catch (err: any) {
    logger.error("observations", `Observation enrichment failed: ${err?.message}`, { error: err?.message, name: err?.name || "Error", stack: err?.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
    next(err);
  }
});

// Hard-deletes an observation — no soft-delete, no undo
observationsRouter.delete("/:id", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: { code: "INVALID_ID", message: "Observation ID must be a number" } });
    return;
  }
  const deleted = observations.deleteObservation(projectId, id);
  if (!deleted) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Observation not found" } });
    return;
  }
  res.status(204).send();
});

// Bulk-deletes all observations matching a source — used for cleanup after re-sync
observationsRouter.delete("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const source = req.query.source as string | undefined;
  if (!source) {
    res.status(400).json({ error: { code: "MISSING_SOURCE", message: "source query parameter is required for bulk delete" } });
    return;
  }
  const count = observations.deleteObservationsBySource(projectId, source);
  res.json({ data: { deleted: count } });
});
