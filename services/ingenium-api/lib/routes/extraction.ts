import { Router } from "express";
import { extraction, logger } from "ingenium-core";
import { requireProject } from "../helpers.js";

export const extractionRouter = Router();

// POST /run — trigger LLM-based observation extraction
extractionRouter.post("/run", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const projectName = extraction.getProjectNameById(projectId);
  if (!projectName) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found" } });
    return;
  }

  const limit = parseInt(req.query.limit as string) || 500;

  // Fire-and-forget so the HTTP response is immediate
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
