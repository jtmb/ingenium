import { getDb, execTransaction, checkpointAfterWrite, sanitizeFts5Query } from "../db.js";
export function saveContext(projectId, content, tags, priority) {
    return execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const now = new Date().toISOString();
        const result = db.prepare(`INSERT INTO context_entries (project_id, content, tags, priority, created_at)
       VALUES (?, ?, ?, ?, ?)`).run(projectId, content, tags ?? null, priority ?? 5, now);
        checkpointAfterWrite();
        return db.prepare("SELECT * FROM context_entries WHERE id = ?").get(result.lastInsertRowid);
    });
}
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
export function recentContext(projectId, limit = 20) {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    return db.prepare("SELECT * FROM context_entries WHERE project_id = ? ORDER BY created_at DESC LIMIT ?").all(projectId, limit);
}
