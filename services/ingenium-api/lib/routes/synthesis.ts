import { Router } from "express";
import { synthesis } from "ingenium-core";
import { requireProject } from "../helpers.js";

export const synthesisRouter = Router();

// POST /run — trigger synthesis pipeline
synthesisRouter.post("/run", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  // Fire-and-forget with immediate status return
  setImmediate(async () => {
    try {
      const result = await synthesis.runSynthesis(projectId);
      console.log(`[synthesis] Completed: ${JSON.stringify(result)}`);
    } catch (err: any) {
      console.error("[synthesis] Pipeline failed:", err.message);
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
