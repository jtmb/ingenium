import { Router } from "express";
import { pipelineEvents } from "ingenium-core";
import { requestContentActor, requireProject } from "../helpers.js";

/** Handles /api/v1/pipeline — event logging and timeline grouping used by the Pipeline dashboard page. */
export const pipelineRouter = Router();

function ownerScope(req: Parameters<typeof requestContentActor>[0], projectId: string): string | null | undefined {
  return req.authorizationPolicy ? requestContentActor(req, projectId)?.ownerUserId ?? null : undefined;
}

pipelineRouter.get("/events", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const limit = parseInt(req.query.limit as string) || 100;
  const source = req.query.source as string;
  const type = req.query.type as string;
  const since = req.query.since as string;
  const parentEventId = req.query.parent_event_id
    ? parseInt(req.query.parent_event_id as string)
    : undefined;

  const list = pipelineEvents.getEvents(projectId, {
    source: source as any,
    type: type as any,
    limit,
    since,
    parentEventId,
    ownerUserId: ownerScope(req, projectId),
  });

  res.json({ data: list, total: list.length });
});

// Returns events grouped into a timeline view — child events nested under their parent. Used by the Pipeline page's git-style timeline.
pipelineRouter.get("/timeline", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const limit = parseInt(req.query.limit as string) || 50;
  const source = req.query.source as string;
  const since = req.query.since as string;

  const timeline = pipelineEvents.getTimeline(projectId, {
    source: source as any,
    limit,
    since,
    ownerUserId: ownerScope(req, projectId),
  });

  res.json({ data: timeline, total: timeline.length });
});

pipelineRouter.post("/events", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const { event_type, event_source, title, description, data, parent_event_id, session_id, importance } = req.body;
  if (!event_type || !event_source || !title) {
    res
      .status(422)
      .json({ error: { code: "VALIDATION_ERROR", message: "event_type, event_source, and title are required" } });
    return;
  }

  const actor = requestContentActor(req, projectId);
  const visibility = req.body.visibility === "private" && actor?.ownerUserId ? "private" : "organization";
  const event = pipelineEvents.logEvent(
    projectId,
    event_type,
    event_source,
    title,
    description,
    data,
    parent_event_id,
    session_id,
    importance,
    { ownerUserId: visibility === "private" ? actor!.ownerUserId : null, visibility },
  );

  res.status(201).json({ data: event });
});
