import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { randomUUID } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
export function listProjects() {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    return db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all();
}
export function createProject(name) {
    return execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const now = new Date().toISOString();
        const id = randomUUID();
        const basePath = process.env.INGENIUM_HOME ?? resolve(process.cwd(), ".ingenium");
        const projectPath = resolve(basePath, "projects", name);
        if (!existsSync(projectPath)) {
            mkdirSync(projectPath, { recursive: true });
        }
        db.prepare(`INSERT INTO projects (id, name, path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`).run(id, name, projectPath, now, now);
        checkpointAfterWrite();
        return db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    });
}
export function archiveProject(name) {
    return execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const existing = db.prepare("SELECT * FROM projects WHERE name = ? AND archived_at IS NULL").get(name);
        if (!existing)
            return false;
        const now = new Date().toISOString();
        db.prepare("UPDATE projects SET archived_at = ? WHERE name = ?").run(now, name);
        checkpointAfterWrite();
        return true;
    });
}
export function unarchiveProject(name) {
    return execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const existing = db.prepare("SELECT * FROM projects WHERE name = ? AND archived_at IS NOT NULL").get(name);
        if (!existing)
            return false;
        db.prepare("UPDATE projects SET archived_at = NULL WHERE name = ?").run(name);
        checkpointAfterWrite();
        return true;
    });
}
export function listArchivedProjects() {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    return db.prepare("SELECT * FROM projects WHERE archived_at IS NOT NULL ORDER BY archived_at DESC").all();
}
export function purgeExpiredProjects(retentionDays) {
    return execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
        const result = db.prepare("DELETE FROM projects WHERE archived_at IS NOT NULL AND archived_at < ?").run(cutoff);
        checkpointAfterWrite();
        return result.changes;
    });
}
export function getProject(name) {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    return db.prepare("SELECT * FROM projects WHERE name = ?").get(name);
}
export function updateProject(currentName, newName) {
    return execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const existing = db.prepare("SELECT * FROM projects WHERE name = ?").get(currentName);
        if (!existing)
            return undefined;
        const now = new Date().toISOString();
        db.prepare("UPDATE projects SET name = ?, updated_at = ? WHERE name = ?").run(newName, now, currentName);
        checkpointAfterWrite();
        return db.prepare("SELECT * FROM projects WHERE id = ?").get(existing.id);
    });
}
