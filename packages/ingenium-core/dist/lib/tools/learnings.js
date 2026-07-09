import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
export function logLearning(projectId, entryType, content, tags, priority, sessionId) {
    return execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const now = new Date().toISOString();
        const result = db.prepare(`INSERT INTO learnings (project_id, entry_type, content, tags, priority, session_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(projectId, entryType, content, tags ?? null, priority ?? 5, sessionId ?? null, now, now);
        checkpointAfterWrite();
        return db.prepare("SELECT * FROM learnings WHERE id = ?").get(result.lastInsertRowid);
    });
}
export function searchLearnings(projectId, query, limit = 50) {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    return db.prepare(`SELECT l.* FROM learnings l
     INNER JOIN learnings_fts fts ON fts.rowid = l.id
     WHERE l.project_id = ? AND learnings_fts MATCH ?
     ORDER BY rank
     LIMIT ?`).all(projectId, query, limit);
}
export function recentLearnings(projectId, limit = 20) {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    return db.prepare("SELECT * FROM learnings WHERE project_id = ? ORDER BY created_at DESC LIMIT ?").all(projectId, limit);
}
export function getLearnings(projectId, status, limit = 50) {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    if (status) {
        return db.prepare("SELECT * FROM learnings WHERE project_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?").all(projectId, status, limit);
    }
    return db.prepare("SELECT * FROM learnings WHERE project_id = ? ORDER BY created_at DESC LIMIT ?").all(projectId, limit);
}
export function updateLearning(learningId, data) {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    const sets = ["updated_at = ?"];
    const params = [now];
    if (data.status !== undefined) {
        sets.push("status = ?");
        params.push(data.status);
    }
    if (data.entry_type !== undefined) {
        sets.push("entry_type = ?");
        params.push(data.entry_type);
    }
    if (data.content !== undefined) {
        sets.push("content = ?");
        params.push(data.content);
    }
    if (data.tags !== undefined) {
        sets.push("tags = ?");
        params.push(data.tags);
    }
    if (data.priority !== undefined) {
        sets.push("priority = ?");
        params.push(data.priority);
    }
    params.push(learningId);
    return execTransaction(() => {
        const result = db.prepare(`UPDATE learnings SET ${sets.join(", ")} WHERE id = ?`).run(...params);
        if (result.changes === 0)
            return null;
        checkpointAfterWrite();
        return db.prepare("SELECT * FROM learnings WHERE id = ?").get(learningId);
    });
}
