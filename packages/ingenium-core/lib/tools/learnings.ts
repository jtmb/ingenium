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
