import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { randomUUID } from "node:crypto";
export function listServers(projectId) {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    return db.prepare("SELECT * FROM servers WHERE project_id = ?").all(projectId);
}
export function registerServer(projectId, name, command, args, env, source) {
    // Idempotent: return existing server on container restart
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const existing = db.prepare("SELECT * FROM servers WHERE project_id = ? AND name = ?").get(projectId, name);
    if (existing)
        return existing;
    const result = execTransaction(() => {
        const now = new Date().toISOString();
        const id = randomUUID();
        db.prepare(`INSERT INTO servers (id, project_id, name, command, args, env, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, projectId, name, command, args ?? null, env ?? null, source ?? "opencode", now);
        return db.prepare("SELECT * FROM servers WHERE id = ?").get(id);
    });
    checkpointAfterWrite();
    return result;
}
export function updateServer(projectId, name, fields) {
    execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        if (fields.running !== undefined) {
            db.prepare("UPDATE servers SET running = ? WHERE project_id = ? AND name = ?").run(fields.running, projectId, name);
        }
    });
    checkpointAfterWrite();
}
export function upsertServer(projectId, name, command, args, env, source) {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const existing = db.prepare("SELECT * FROM servers WHERE project_id = ? AND name = ?").get(projectId, name);
    if (existing) {
        execTransaction(() => {
            db.prepare(`UPDATE servers SET command = ?, args = ?, env = ?, source = ? WHERE project_id = ? AND name = ?`).run(command, args ?? null, env ?? null, source ?? "opencode", projectId, name);
        });
        checkpointAfterWrite();
        return db.prepare("SELECT * FROM servers WHERE project_id = ? AND name = ?").get(projectId, name);
    }
    const inserted = execTransaction(() => {
        const now = new Date().toISOString();
        const id = randomUUID();
        db.prepare(`INSERT INTO servers (id, project_id, name, command, args, env, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, projectId, name, command, args ?? null, env ?? null, source ?? "opencode", now);
        return db.prepare("SELECT * FROM servers WHERE id = ?").get(id);
    });
    checkpointAfterWrite();
    return inserted;
}
export function removeServer(projectId, name) {
    execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        db.prepare("DELETE FROM servers WHERE project_id = ? AND name = ?").run(projectId, name);
    });
    checkpointAfterWrite();
}
