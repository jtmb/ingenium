import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { randomUUID } from "node:crypto";
export function listServers(projectId) {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    return db.prepare("SELECT * FROM servers WHERE project_id = ?").all(projectId);
}
export function registerServer(projectId, name, command, args, env) {
    return execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const now = new Date().toISOString();
        const id = randomUUID();
        db.prepare(`INSERT INTO servers (id, project_id, name, command, args, env, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, projectId, name, command, args ?? null, env ?? null, now);
        checkpointAfterWrite();
        return db.prepare("SELECT * FROM servers WHERE id = ?").get(id);
    });
}
export function updateServer(projectId, name, fields) {
    execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        if (fields.running !== undefined) {
            db.prepare("UPDATE servers SET running = ? WHERE project_id = ? AND name = ?").run(fields.running, projectId, name);
        }
        checkpointAfterWrite();
    });
}
export function removeServer(projectId, name) {
    execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        db.prepare("DELETE FROM servers WHERE project_id = ? AND name = ?").run(projectId, name);
        checkpointAfterWrite();
    });
}
