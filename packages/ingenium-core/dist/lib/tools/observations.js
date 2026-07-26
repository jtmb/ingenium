/**
 * Observation persistence — the raw input to the self-learning pipeline.
 *
 * Observations are single statements about user behavior (corrections, preferences,
 * patterns, etc.) stored with importance and source metadata. The synthesis pipeline
 * reads pending observations and consolidates them into personality traits and skills.
 *
 * 🔴 All mutations use execTransaction() with checkpointAfterWrite() outside the txn.
 */
import { getDb, execTransaction, checkpointAfterWrite, sanitizeFts5Query } from "../db.js";
import { logEvent } from "./pipeline-events.js";
/**
 * Store a single observation and fire a pipeline event for observability.
 *
 * Default importance of 5 (mid-scale 1-10) means most observations are treated
 * neutrally — the synthesis pipeline can up-rank based on patterns. Default
 * source 'agent' distinguishes agent-reported observations from auto-extracted ones.
 *
 * Pipeline event logging is intentionally outside the transaction (and wrapped in
 * try/catch) so a pipeline-log failure never prevents the observation from persisting.
 */
export function storeObservation(projectId, observationType, content, importance, source, context, sessionId) {
    const result = execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
        const now = new Date().toISOString();
        const insertResult = db.prepare(`INSERT INTO observations (project_id, observation_type, content, importance, source, context, session_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(projectId, observationType, content, importance ?? 5, source ?? "agent", context ?? null, sessionId ?? null, now, now);
        return db.prepare("SELECT * FROM observations WHERE id = ?").get(insertResult.lastInsertRowid);
    });
    checkpointAfterWrite();
    // Fire pipeline event for observability (outside transaction to avoid nesting)
    try {
        logEvent(projectId, "observation_created", source === "agent" ? "agent" : "plugin", `Agent observed: ${content.substring(0, 80)}`, content, { observation_type: observationType, importance: importance ?? 5, source }, undefined, sessionId, importance ?? 5);
    }
    catch (_) {
        // Non-fatal — pipeline events should never block observations
    }
    return result;
}
/**
 * List observations for a project, optionally filtered by status and type.
 * Ordered newest-first. Default limit of 50 prevents unbounded result sets.
 */
export function getObservations(projectId, status, type, limit = 50) {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
    const clauses = ["project_id = ?"];
    const params = [projectId];
    if (status) {
        clauses.push("status = ?");
        params.push(status);
    }
    if (type) {
        clauses.push("observation_type = ?");
        params.push(type);
    }
    params.push(limit);
    return db.prepare(`SELECT * FROM observations WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ?`).all(...params);
}
/**
 * Full-text search across observations using FTS5.
 * Query is sanitized via sanitizeFts5Query() to avoid FTS5 syntax errors
 * from raw user input (special chars like `*`, `"`, `-` in unexpected places).
 * Returns empty array if the query is invalid after sanitization.
 */
export function searchObservations(projectId, query, limit = 50) {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
    const sanitized = sanitizeFts5Query(query);
    if (!sanitized)
        return [];
    return db.prepare(`SELECT o.* FROM observations o
     INNER JOIN observations_fts fts ON fts.rowid = o.id
     WHERE o.project_id = ? AND observations_fts MATCH ?
     ORDER BY rank
     LIMIT ?`).all(projectId, sanitized, limit);
}
/** Retrieve a single observation by its primary key ID. */
export function getObservation(id) {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
    return db.prepare("SELECT * FROM observations WHERE id = ?").get(id);
}
/**
 * Batch-fetch observations by IDs. Uses a single parameterized query with
 * dynamically built IN clause placeholders. Returns only matching rows.
 * Empty input or no matches returns an empty array.
 */
export function getObservationsByIds(ids) {
    if (!ids.length)
        return [];
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
    const placeholders = ids.map(() => "?").join(",");
    return db.prepare(`SELECT * FROM observations WHERE id IN (${placeholders})`).all(...ids);
}
/**
 * Update selected fields of an observation. Only the provided fields are changed.
 * Dynamically builds the SET clause to avoid writing unchanged columns.
 * Returns null if the observation doesn't exist (changes === 0).
 */
export function updateObservation(id, data) {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
    const now = new Date().toISOString();
    const sets = ["updated_at = ?"];
    const params = [now];
    if (data.status !== undefined) {
        sets.push("status = ?");
        params.push(data.status);
    }
    if (data.importance !== undefined) {
        sets.push("importance = ?");
        params.push(data.importance);
    }
    if (data.content !== undefined) {
        sets.push("content = ?");
        params.push(data.content);
    }
    if (data.context !== undefined) {
        sets.push("context = ?");
        params.push(data.context);
    }
    if (data.observation_type !== undefined) {
        sets.push("observation_type = ?");
        params.push(data.observation_type);
    }
    params.push(id);
    const transactionResult = execTransaction(() => {
        const result = db.prepare(`UPDATE observations SET ${sets.join(", ")} WHERE id = ?`).run(...params);
        if (result.changes === 0)
            return null;
        return db.prepare("SELECT * FROM observations WHERE id = ?").get(id);
    });
    if (transactionResult) {
        checkpointAfterWrite();
    }
    return transactionResult;
}
/**
 * Count observations still in 'pending' status — used by the synthesis pipeline
 * to decide whether processing is needed and by the dashboard to show backlogs.
 */
export function countUnprocessed(projectId) {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
    const row = db.prepare("SELECT COUNT(*) as count FROM observations WHERE project_id = ? AND status = 'pending'").get(projectId);
    return row.count;
}
/**
 * Fetch the next batch of unprocessed observations for synthesis.
 * Ordered by importance DESC (most important first) then created_at ASC (oldest first).
 * This ensures high-importance observations are processed first while maintaining
 * FIFO order within the same importance level.
 */
export function getUnprocessedBatch(projectId, limit = 50) {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
    return db.prepare(`SELECT * FROM observations
     WHERE project_id = ? AND status = 'pending'
     ORDER BY importance DESC, created_at ASC
     LIMIT ?`).all(projectId, limit);
}
/**
 * Hard-delete a single observation by ID, scoped to project.
 * Returns true if a row was actually deleted.
 */
export function deleteObservation(projectId, id) {
    const ok = execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
        const result = db.prepare("DELETE FROM observations WHERE project_id = ? AND id = ?").run(projectId, id);
        return result.changes > 0;
    });
    checkpointAfterWrite();
    return ok;
}
/**
 * Bulk-delete all observations from a given source (e.g., 'auto-observer').
 * Used to reset observations when re-running extraction after fixing the pipeline.
 * Returns the number of deleted rows.
 */
export function deleteObservationsBySource(projectId, source) {
    const result = execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
        const deleteResult = db.prepare("DELETE FROM observations WHERE project_id = ? AND source = ?").run(projectId, source);
        return deleteResult.changes;
    });
    checkpointAfterWrite();
    return result;
}
