import { Router } from "express";
import { observations, synthesisLlm, logger } from "ingenium-core";
import { requireProject } from "../helpers.js";

export const observationsRouter = Router();

// GET / — list observations with optional filters
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

// GET /search — FTS5 search
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

// POST / — store a new observation
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

// GET /:id — fetch a single observation
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

// PATCH /:id — update observation (e.g., mark processed)
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

// GET /stats — counts for dashboard
observationsRouter.get("/stats", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const pending = observations.countUnprocessed(projectId);
  const all = observations.getObservations(projectId);
  res.json({ data: { total: all.length, pending } });
});

// POST /enrich — enrich raw auto-observer observations via LLM
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
      // No LLM configured — return originals with skip:false
      res.json({
        data: obs.map((o: any) => ({ ...o, enriched_content: undefined, skip: false })),
      });
      return;
    }

    const enriched = await synthesisLlm.enrichObservations(obs, config.endpoint, config.model, config.apiKey);
    res.json({ data: enriched });
  } catch (err: any) {
    logger.error("observations", "Observation enrichment failed", { err: String(err?.message || err) });
    next(err);
  }
});
