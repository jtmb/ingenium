import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { randomUUID } from "node:crypto";
export function createTask(projectId, title, description, assignedTo) {
    return execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const now = new Date().toISOString();
        const id = randomUUID();
        db.prepare(`INSERT INTO tasks (id, project_id, title, description, assigned_to, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, projectId, title, description ?? null, assignedTo ?? null, now, now);
        checkpointAfterWrite();
        return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    });
}
export function listTasks(projectId, columnId) {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    if (columnId) {
        return db.prepare("SELECT * FROM tasks WHERE project_id = ? AND column_id = ? ORDER BY created_at")
            .all(projectId, columnId);
    }
    return db.prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at")
        .all(projectId);
}
export function moveTask(taskId, columnId) {
    return execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const now = new Date().toISOString();
        const completedAt = columnId === "done" ? now : null;
        db.prepare("UPDATE tasks SET column_id = ?, updated_at = ?, completed_at = ? WHERE id = ?")
            .run(columnId, now, completedAt, taskId);
        checkpointAfterWrite();
        return db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
    });
}
export function completeTask(taskId) {
    return moveTask(taskId, "done");
}
export function getNextTask(projectId) {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    return db.prepare(`SELECT * FROM tasks WHERE project_id = ? AND column_id = 'todo'
     ORDER BY created_at ASC LIMIT 1`).get(projectId);
}
