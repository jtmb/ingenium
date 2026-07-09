import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { Learning } from "../schema.js";

export function logLearning(
  projectId: string,
  entryType: Learning["entry_type"],
  content: string,
  tags?: string,
  priority?: number,
  sessionId?: string,
): Learning {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    const result = db.prepare(
      `INSERT INTO learnings (project_id, entry_type, content, tags, priority, session_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(projectId, entryType, content, tags ?? null, priority ?? 5, sessionId ?? null, now, now);
    checkpointAfterWrite();
    return db.prepare("SELECT * FROM learnings WHERE id = ?").get(result.lastInsertRowid) as Learning;
  });
}

export function searchLearnings(projectId: string, query: string, limit = 50): Learning[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare(
    `SELECT l.* FROM learnings l
     INNER JOIN learnings_fts fts ON fts.rowid = l.id
     WHERE l.project_id = ? AND learnings_fts MATCH ?
     ORDER BY rank
     LIMIT ?`
  ).all(projectId, query, limit) as Learning[];
}

export function recentLearnings(projectId: string, limit = 20): Learning[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare(
    "SELECT * FROM learnings WHERE project_id = ? ORDER BY created_at DESC LIMIT ?"
  ).all(projectId, limit) as Learning[];
}

export function getLearnings(projectId: string, status?: string, limit = 50): Learning[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  if (status) {
    return db.prepare(
      "SELECT * FROM learnings WHERE project_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?"
    ).all(projectId, status, limit) as Learning[];
  }
  return db.prepare(
    "SELECT * FROM learnings WHERE project_id = ? ORDER BY created_at DESC LIMIT ?"
  ).all(projectId, limit) as Learning[];
}

export function updateLearning(learningId: number, data: Partial<Pick<Learning, "status" | "entry_type" | "content" | "tags" | "priority">>): Learning | null {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const now = new Date().toISOString();

  const sets: string[] = ["updated_at = ?"];
  const params: any[] = [now];

  if (data.status !== undefined) { sets.push("status = ?"); params.push(data.status); }
  if (data.entry_type !== undefined) { sets.push("entry_type = ?"); params.push(data.entry_type); }
  if (data.content !== undefined) { sets.push("content = ?"); params.push(data.content); }
  if (data.tags !== undefined) { sets.push("tags = ?"); params.push(data.tags); }
  if (data.priority !== undefined) { sets.push("priority = ?"); params.push(data.priority); }

  params.push(learningId);

  return execTransaction(() => {
    const result = db.prepare(
      `UPDATE learnings SET ${sets.join(", ")} WHERE id = ?`
    ).run(...params);
    if (result.changes === 0) return null;
    checkpointAfterWrite();
    return db.prepare("SELECT * FROM learnings WHERE id = ?").get(learningId) as Learning;
  });
}
