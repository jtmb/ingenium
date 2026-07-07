import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve, isAbsolute, relative } from "node:path";
function validatePluginPath(filePath) {
    if (!/^[a-zA-Z0-9_\-./]+$/.test(filePath)) {
        throw new Error(`Invalid plugin file path: ${filePath}`);
    }
    const baseDir = resolve(process.cwd(), ".opencode/plugins");
    const resolved = resolve(baseDir, filePath);
    const rel = relative(baseDir, resolved);
    if (rel.startsWith("..") || isAbsolute(rel)) {
        throw new Error(`Plugin path escapes base directory: ${filePath}`);
    }
    return filePath;
}
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
            const filePath = validatePluginPath(plugin.file_path);
            writeFileSync(resolve(process.cwd(), ".opencode/plugins", filePath), plugin.source_content);
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
            const filePath = validatePluginPath(plugin.file_path);
            const resolvedPath = resolve(process.cwd(), ".opencode/plugins", filePath);
            if (existsSync(resolvedPath))
                unlinkSync(resolvedPath);
        }
        checkpointAfterWrite();
        return plugin;
    });
}
