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
  const limit = parseInt(req.query.limit as string) || 20;
  const entries = context.recentContext(projectId, limit);
  res.json({ data: entries });
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
  const results = context.searchContext(projectId, query);
  res.json({ data: results });
});

// tags can be a comma-separated string or array; priority defaults to 5 (medium) in the core layer
contextRouter.post("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const { content, tags, priority } = req.body;
  const entry = context.saveContext(projectId, content, tags, priority);
  res.status(201).json({ data: entry });
});
