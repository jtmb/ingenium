import { Router } from "express";
import { logger } from "ingenium-core";

/** Handles /api/v1/logs — in-memory log querying with source/level/since/limit filters. */
export const logsRouter = Router();

/**
 * GET /api/v1/logs
 * Returns recent log entries with filters and the distinct sources list
 * (used by the dashboard to populate the source filter dropdown).
 * Default limit of 500 prevents unbounded memory from large in-memory buffers.
 */
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
