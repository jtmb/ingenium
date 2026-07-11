import { Router } from "express";
import { logger } from "ingenium-core";

export const logsRouter = Router();

// GET /api/v1/logs — query recent log entries
logsRouter.get("/", (req, res) => {
  const source = req.query.source as string | undefined;
  const level = req.query.level as string | undefined;
  const since = req.query.since as string | undefined;
  const limit = parseInt(req.query.limit as string || "500", 10);
  
  const entries = logger.getLogs({ source, level, since, limit });
  const sources = logger.getSources();
  
  res.json({
    data: {
      entries,
      sources,
      total: entries.length,
    }
  });
});
