import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { Observation } from "../schema.js";
import { logEvent } from "./pipeline-events.js";

export function storeObservation(
  projectId: string,
  observationType: Observation["observation_type"],
  content: string,
  importance?: number,
  source?: Observation["source"],
  context?: string,
  sessionId?: string,
): Observation {
  const result = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
    const now = new Date().toISOString();
    const insertResult = db.prepare(
      `INSERT INTO observations (project_id, observation_type, content, importance, source, context, session_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      projectId,
      observationType,
      content,
      importance ?? 5,
      source ?? "agent",
      context ?? null,
      sessionId ?? null,
      now,
      now,
    );
    checkpointAfterWrite();
    return db.prepare("SELECT * FROM observations WHERE id = ?").get(insertResult.lastInsertRowid) as Observation;
  });

  // Fire pipeline event for observability (outside transaction to avoid nesting)
  try {
    logEvent(
      projectId,
      "observation_created",
      (source as string) === "agent" ? "agent" : "plugin",
      `Agent observed: ${content.substring(0, 80)}`,
      content,
      { observation_type: observationType, importance: importance ?? 5, source },
      undefined,
      sessionId,
      importance ?? 5,
    );
  } catch (_) {
    // Non-fatal — pipeline events should never block observations
  }

  return result;
}

export function getObservations(
  projectId: string,
  status?: Observation["status"],
  type?: Observation["observation_type"],
  limit = 50,
): Observation[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");

  const clauses: string[] = ["project_id = ?"];
  const params: any[] = [projectId];

  if (status) {
    clauses.push("status = ?");
    params.push(status);
  }
  if (type) {
    clauses.push("observation_type = ?");
    params.push(type);
  }

  params.push(limit);
  return db.prepare(
    `SELECT * FROM observations WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ?`
  ).all(...params) as Observation[];
}

export function searchObservations(projectId: string, query: string, limit = 50): Observation[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
  return db.prepare(
    `SELECT o.* FROM observations o
     INNER JOIN observations_fts fts ON fts.rowid = o.id
     WHERE o.project_id = ? AND observations_fts MATCH ?
     ORDER BY rank
     LIMIT ?`
  ).all(projectId, query, limit) as Observation[];
}

export function getObservation(id: number): Observation | undefined {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
  return db.prepare("SELECT * FROM observations WHERE id = ?").get(id) as Observation | undefined;
}

export function updateObservation(
  id: number,
  data: Partial<Pick<Observation, "status" | "importance" | "content" | "context" | "observation_type">>,
): Observation | null {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
  const now = new Date().toISOString();

  const sets: string[] = ["updated_at = ?"];
  const params: any[] = [now];

  if (data.status !== undefined) { sets.push("status = ?"); params.push(data.status); }
  if (data.importance !== undefined) { sets.push("importance = ?"); params.push(data.importance); }
  if (data.content !== undefined) { sets.push("content = ?"); params.push(data.content); }
  if (data.context !== undefined) { sets.push("context = ?"); params.push(data.context); }
  if (data.observation_type !== undefined) { sets.push("observation_type = ?"); params.push(data.observation_type); }

  params.push(id);

  return execTransaction(() => {
    const result = db.prepare(
      `UPDATE observations SET ${sets.join(", ")} WHERE id = ?`
    ).run(...params);
    if (result.changes === 0) return null;
    checkpointAfterWrite();
    return db.prepare("SELECT * FROM observations WHERE id = ?").get(id) as Observation;
  });
}

export function countUnprocessed(projectId: string): number {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
  const row = db.prepare(
    "SELECT COUNT(*) as count FROM observations WHERE project_id = ? AND status = 'pending'"
  ).get(projectId) as { count: number };
  return row.count;
}

export function getUnprocessedBatch(projectId: string, limit = 50): Observation[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
  return db.prepare(
    `SELECT * FROM observations
     WHERE project_id = ? AND status = 'pending'
     ORDER BY importance DESC, created_at ASC
     LIMIT ?`
  ).all(projectId, limit) as Observation[];
}
