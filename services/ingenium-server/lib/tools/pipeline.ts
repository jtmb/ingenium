/**
 * MCP tool handlers for pipeline event observability.
 * Supports listing events, fetching grouped timelines, and logging new events.
 */
import { api } from "../client.js";

/** List pipeline events with optional filters */
export async function pipelineEvents(
  project: string,
  source?: string,
  type?: string,
  limit?: number,
  since?: string,
) {
  const params: Record<string, string> = { project };
  if (source) params.source = source;
  if (type) params.type = type;
  if (limit !== undefined) params.limit = String(limit);
  if (since) params.since = since;

  const res = await api.get("/pipeline/events", params);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get grouped timeline with children nested in parents */
export async function pipelineTimeline(
  project: string,
  source?: string,
  limit?: number,
  since?: string,
) {
  const params: Record<string, string> = { project };
  if (source) params.source = source;
  if (limit !== undefined) params.limit = String(limit);
  if (since) params.since = since;

  const res = await api.get("/pipeline/timeline", params);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Log a new pipeline event */
export async function pipelineEventLog(
  project: string,
  eventType: string,
  eventSource: string,
  title: string,
  description?: string,
  data?: object,
  parentEventId?: number,
  sessionId?: string,
  importance?: number,
) {
  const body: Record<string, unknown> = {
    event_type: eventType,
    event_source: eventSource,
    title,
  };
  if (description !== undefined) body.description = description;
  if (data !== undefined) body.data = data;
  if (parentEventId !== undefined) body.parent_event_id = parentEventId;
  if (sessionId !== undefined) body.session_id = sessionId;
  if (importance !== undefined) body.importance = importance;

  const res = await api.post("/pipeline/events", body, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}
