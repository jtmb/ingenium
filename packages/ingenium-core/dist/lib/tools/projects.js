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
export function deleteProject(name) {
    return execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const existing = db.prepare("SELECT * FROM projects WHERE name = ?").get(name);
        if (!existing)
            return false;
        db.prepare("DELETE FROM projects WHERE name = ?").run(name);
        checkpointAfterWrite();
        return true;
    });
}
export function getProject(name) {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    return db.prepare("SELECT * FROM projects WHERE name = ?").get(name);
}
