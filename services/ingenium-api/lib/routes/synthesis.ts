import { Router } from "express";
import { synthesis, logger } from "ingenium-core";
import { requireProject } from "../helpers.js";

export const synthesisRouter = Router();

// POST /run — trigger synthesis pipeline
synthesisRouter.post("/run", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const sessionId = (req.query.session_id as string) || undefined;
  // Fire-and-forget with immediate status return
  setImmediate(async () => {
    try {
      const result = await synthesis.runSynthesis(projectId, sessionId);
      logger.info("synthesis", `Completed: ${JSON.stringify(result)}`);
    } catch (err: any) {
      logger.error("synthesis", "Pipeline failed", { error: err.message });
    }
  });
  res.json({ data: { status: "started", message: "Synthesis pipeline triggered. Check back via GET /status." } });
});

// GET /status — synthesis status
synthesisRouter.get("/status", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const status = synthesis.getSynthesisStatus(projectId);
  res.json({ data: status });
});

// POST /cross-project — trigger cross-project synthesis
synthesisRouter.post("/cross-project", (_req, res) => {
  setImmediate(() => {
    synthesis.runCrossProjectSynthesis().catch((e) => logger.error("synthesis", "Cross-project synthesis failed", { error: e instanceof Error ? e.message : String(e) }));
  });
  res.json({ status: "started" });
});
