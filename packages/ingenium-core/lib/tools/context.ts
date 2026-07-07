import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { ContextEntry } from "../schema.js";

export function saveContext(projectId: string, content: string, tags?: string, priority?: number): ContextEntry {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    const result = db.prepare(
      `INSERT INTO context_entries (project_id, content, tags, priority, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(projectId, content, tags ?? null, priority ?? 5, now);
    checkpointAfterWrite();
    return db.prepare("SELECT * FROM context_entries WHERE id = ?").get(result.lastInsertRowid) as ContextEntry;
  });
}

export function searchContext(projectId: string, query: string, limit = 50): ContextEntry[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare(
    `SELECT c.* FROM context_entries c
     INNER JOIN context_fts fts ON fts.rowid = c.id
     WHERE c.project_id = ? AND context_fts MATCH ?
     ORDER BY rank
     LIMIT ?`
  ).all(projectId, query, limit) as ContextEntry[];
}

export function recentContext(projectId: string, limit = 20): ContextEntry[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare(
    "SELECT * FROM context_entries WHERE project_id = ? ORDER BY created_at DESC LIMIT ?"
  ).all(projectId, limit) as ContextEntry[];
}
