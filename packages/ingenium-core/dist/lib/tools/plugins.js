import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
export function listPlugins(projectId) {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    return db.prepare("SELECT * FROM plugins WHERE project_id = ?").all(projectId);
}
export function enablePlugin(projectId, name) {
    return execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const now = new Date().toISOString();
        db.prepare("UPDATE plugins SET enabled = 1, updated_at = ? WHERE project_id = ? AND name = ?")
            .run(now, projectId, name);
        const plugin = db.prepare("SELECT * FROM plugins WHERE project_id = ? AND name = ?")
            .get(projectId, name);
        // Write the .ts file to disk
        if (plugin?.source_content) {
            const filePath = resolve(process.cwd(), ".opencode/plugins", plugin.file_path);
            writeFileSync(filePath, plugin.source_content);
        }
        checkpointAfterWrite();
        return plugin;
    });
}
export function disablePlugin(projectId, name) {
    return execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const now = new Date().toISOString();
        db.prepare("UPDATE plugins SET enabled = 0, updated_at = ? WHERE project_id = ? AND name = ?")
            .run(now, projectId, name);
        const plugin = db.prepare("SELECT * FROM plugins WHERE project_id = ? AND name = ?")
            .get(projectId, name);
        // Remove the .ts file from disk
        if (plugin) {
            const filePath = resolve(process.cwd(), ".opencode/plugins", plugin.file_path);
            if (existsSync(filePath))
                unlinkSync(filePath);
        }
        checkpointAfterWrite();
        return plugin;
    });
}
