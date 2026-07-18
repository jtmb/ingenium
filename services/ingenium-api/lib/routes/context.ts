import { Router } from "express";
import { context } from "ingenium-core";
import { requireProject } from "../helpers.js";

/**
 * Context (plan) routes for per-project working memory entries.
 * Context entries are short-lived, tagged notes the agent uses to remember
 * plans, decisions, and priorities across conversations.
 * FTS5-powered search via the /search sub-route.
 */
export const contextRouter = Router();

// Recent context entries, newest-first, with optional limit cap (default 20)
contextRouter.get("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const page = context.listContext(projectId, Number(req.query.limit) || 20, Number(req.query.offset) || 0);
  res.json(page);
});

// 422 (not 400) used deliberately — the request IS well-formed, the resource just needs a query param
contextRouter.get("/search", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const query = req.query.q as string;
  if (!query) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "query (q) is required" } });
    return;
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const results = context.searchContext(projectId, query, limit);
  res.json({ data: results, total: results.length });
});

// tags can be a comma-separated string or array; priority defaults to 5 (medium) in the core layer
contextRouter.post("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const { content, tags, priority, sessionId, source, metadata } = req.body ?? {};
    const entry = context.createContext(projectId, { content, tags, priority, sessionId, source, metadata });
    res.status(201).json({ data: entry });
  } catch (error) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: error instanceof Error ? error.message : "Invalid context entry" } });
  }
});

contextRouter.post("/batch", (req, res) => {
  const projectId = requireProject(req, res); if (!projectId) return;
  const ids = req.body?.ids;
  if (!Array.isArray(ids)) { res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "ids must be an array" } }); return; }
  res.json({ data: context.getContextBatch(projectId, ids) });
});

contextRouter.get("/:id", (req, res) => {
  const projectId = requireProject(req, res); if (!projectId) return;
  const entry = context.getContext(projectId, Number(req.params.id));
  if (!entry) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Context entry not found" } }); return; }
  res.json({ data: entry });
});

contextRouter.patch("/:id", (req, res) => {
  const projectId = requireProject(req, res); if (!projectId) return;
  try {
    const entry = context.updateContext(projectId, Number(req.params.id), req.body ?? {});
    if (!entry) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Context entry not found" } }); return; }
    res.json({ data: entry });
  } catch (error) { res.status(422).json({ error: { code: "VALIDATION_ERROR", message: error instanceof Error ? error.message : "Invalid context entry" } }); }
});

contextRouter.delete("/:id", (req, res) => {
  const projectId = requireProject(req, res); if (!projectId) return;
  if (!context.deleteContext(projectId, Number(req.params.id))) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Context entry not found" } }); return; }
  res.status(204).send();
});
