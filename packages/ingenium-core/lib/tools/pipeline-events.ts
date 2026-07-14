import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { PipelineEvent } from "../schema.js";

/**
 * Log a pipeline event. Returns the created event.
 */
export function logEvent(
  projectId: string,
  eventType: PipelineEvent["event_type"],
  eventSource: PipelineEvent["event_source"],
  title: string,
  description?: string,
  data?: object,
  parentEventId?: number,
  sessionId?: string,
  importance?: number,
): PipelineEvent {
  const event = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
    const now = new Date().toISOString();
    const result = db.prepare(
      `INSERT INTO pipeline_events (project_id, event_type, event_source, title, description, data, parent_event_id, session_id, importance, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      projectId,
      eventType,
      eventSource,
      title,
      description ?? null,
      data ? JSON.stringify(data) : null,
      parentEventId ?? null,
      sessionId ?? null,
      importance ?? 5,
      now,
    );
    return db.prepare("SELECT * FROM pipeline_events WHERE id = ?").get(result.lastInsertRowid) as PipelineEvent;
  });
  checkpointAfterWrite();
  return event;
}

/**
 * Get pipeline events with optional filters.
 */
export function getEvents(
  projectId: string,
  options?: {
    source?: PipelineEvent["event_source"];
    type?: PipelineEvent["event_type"];
    limit?: number;
    since?: string;        // ISO timestamp — only events after this
    parentEventId?: number; // only children of a specific event
  },
): PipelineEvent[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
  const clauses: string[] = ["project_id = ?"];
  const params: any[] = [projectId];

  if (options?.source) {
    clauses.push("event_source = ?");
    params.push(options.source);
  }
  if (options?.type) {
    clauses.push("event_type = ?");
    params.push(options.type);
  }
  if (options?.since) {
    clauses.push("created_at >= ?");
    params.push(options.since);
  }
  if (options?.parentEventId !== undefined) {
    clauses.push("parent_event_id = ?");
    params.push(options.parentEventId);
  }

  const limit = options?.limit ?? 100;
  params.push(limit);

  return db.prepare(
    `SELECT * FROM pipeline_events WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ?`
  ).all(...params) as PipelineEvent[];
}

/**
 * Get a flat timeline with parent events and their children grouped.
 * Returns events ordered by created_at DESC with children nested in `data.children`.
 */
export function getTimeline(
  projectId: string,
  options?: {
    source?: PipelineEvent["event_source"];
    limit?: number;
    since?: string;
  },
): PipelineEvent[] {
  // Get top-level events (no parent)
  const parents = getEvents(projectId, {
    ...options,
    limit: options?.limit ?? 50,
  });

  // Attach children to each parent
  for (const parent of parents) {
    const children = getEvents(projectId, { parentEventId: parent.id });
    if (children.length > 0) {
      const parsed = parent.data ? JSON.parse(parent.data) : {};
      parsed.children = children;
      parent.data = JSON.stringify(parsed);
    }
  }

  return parents;
}

export { logEvent as logPipelineEvent };
