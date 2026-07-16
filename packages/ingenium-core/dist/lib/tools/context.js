import { getDb, execTransaction, checkpointAfterWrite, sanitizeFts5Query } from "../db.js";
/**
 * Save a context/plan entry for a project.
 * Entries are used to persist working context across sessions — the task management
 * and plan surface reads from this table.
 *
 * 🔴 WAL SAFETY: checkpointAfterWrite() is called OUTSIDE execTransaction().
 * Calling a WAL checkpoint inside an active transaction causes SQLITE_LOCKED.
 */
export function saveContext(projectId, content, tags, priority) {
    const entry = execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const now = new Date().toISOString();
        const result = db.prepare(`INSERT INTO context_entries (project_id, content, tags, priority, created_at)
       VALUES (?, ?, ?, ?, ?)`).run(projectId, content, tags ?? null, priority ?? 5, now);
        return db.prepare("SELECT * FROM context_entries WHERE id = ?").get(result.lastInsertRowid);
    });
    checkpointAfterWrite();
    return entry;
}
/**
 * Full-text search across context entries using FTS5.
 * Returns results ranked by BM25 relevance. Falls back to an empty array
 * if sanitizeFts5Query rejects the input (empty or invalid FTS5 syntax).
 */
export function searchContext(projectId, query, limit = 50) {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const sanitized = sanitizeFts5Query(query);
    if (!sanitized)
        return [];
    return db.prepare(`SELECT c.* FROM context_entries c
     INNER JOIN context_fts fts ON fts.rowid = c.id
     WHERE c.project_id = ? AND context_fts MATCH ?
     ORDER BY rank
     LIMIT ?`).all(projectId, sanitized, limit);
}
/** Get the most recent context entries for a project, ordered by creation time descending. */
export function recentContext(projectId, limit = 20) {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    return db.prepare("SELECT * FROM context_entries WHERE project_id = ? ORDER BY created_at DESC LIMIT ?").all(projectId, limit);
}
