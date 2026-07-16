import { Router } from "express";
import { extraction, logger } from "ingenium-core";
import { requireProject } from "../helpers.js";

/**
 * Observation extraction — the thin HTTP trigger for the auto-observer pipeline.
 * The actual LLM-based extraction runs asynchronously so the caller gets an immediate 200.
 * Extraction reads OpenCode messages from the DB, classifies them as observations,
 * and stores them for the synthesis pipeline to consume.
 */
export const extractionRouter = Router();

// setImmediate fire-and-forget: extraction can take 5-30s depending on message volume.
// The caller doesn't need to block — status is observable via /api/v1/observations/stats.
extractionRouter.post("/run", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const projectName = extraction.getProjectNameById(projectId);
  if (!projectName) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found" } });
    return;
  }

  // Default 500: balances thoroughness with latency — most sessions have <500 new messages
  const limit = parseInt(req.query.limit as string) || 500;

  setImmediate(async () => {
    try {
      const result = await extraction.runExtraction(projectId, projectName, { limit });
      logger.info("extraction", `Completed: scanned=${result.scanned} candidates=${result.candidates} created=${result.created}`);
    } catch (err: any) {
      logger.error("extraction", `Extraction run failed: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n") });
    }
  });

  res.json({
    data: { status: "started", message: "Extraction triggered. Results will be logged to the pipeline." },
  });
});
