import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { writeFileSync, unlinkSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, relative, isAbsolute, dirname } from "node:path";
import { getPluginsBase, getConfigPath, isGlobal } from "./paths.js";
/**
 * Validate that a plugin file path is safe:
 * 1. Only allows alphanumeric, underscore, hyphen, dot, and forward-slash chars (no shell injection)
 * 2. Resolves relative to the plugins base directory and verifies it doesn't escape via `..`
 *
 * @throws {Error} if the path contains unsafe characters or escapes the base directory
 */
function validatePluginPath(filePath, projectId) {
    // Restrict to safe characters only — prevents shell injection via filenames
    if (!/^[a-zA-Z0-9_\-./]+$/.test(filePath)) {
        throw new Error(`Invalid plugin file path: ${filePath}`);
    }
    const baseDir = getPluginsBase(projectId);
    const resolved = resolve(baseDir, filePath);
    const rel = relative(baseDir, resolved);
    // Path traversal check: the resolved path must remain within baseDir
    if (rel.startsWith("..") || isAbsolute(rel)) {
        throw new Error(`Plugin path escapes base directory: ${filePath}`);
    }
    return filePath;
}
/**
 * 🔴 Convention Requirement: Every plugin lifecycle operation MUST sync opencode.json's
 * `plugin` array (see AGENTS.md HARD RULE #16). This function appends the plugin path to
 * the array on disk.
 *
 * The path format differs for global vs project-level configs:
 * - Global:  `plugins/<filePath>`
 * - Project: `.opencode/plugins/<filePath>`
 */
function addPluginToConfig(filePath, projectId) {
    const isGlobalProject = isGlobal(projectId);
    const rel = isGlobalProject ? `plugins/${filePath}` : `.opencode/plugins/${filePath}`;
    try {
        const configPath = getConfigPath(projectId);
        const config = JSON.parse(readFileSync(configPath, "utf-8"));
        if (!config.plugin)
            config.plugin = [];
        if (!config.plugin.includes(rel)) {
            config.plugin.push(rel);
            writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
        }
    }
    catch { /* config may not exist yet — skip silently */ }
}
/**
 * Remove a plugin entry from opencode.json's `plugin` array.
 * Mirror of addPluginToConfig — keeps the disk config in sync when a plugin is deleted or disabled.
 */
function removePluginFromConfig(filePath, projectId) {
    const isGlobalProject = isGlobal(projectId);
    const rel = isGlobalProject ? `plugins/${filePath}` : `.opencode/plugins/${filePath}`;
    try {
        const configPath = getConfigPath(projectId);
        const config = JSON.parse(readFileSync(configPath, "utf-8"));
        if (config.plugin) {
            config.plugin = config.plugin.filter((p) => p !== rel);
            writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
        }
    }
    catch { /* config may not exist — skip silently */ }
}
/** List all plugins registered for a project. */
export function listPlugins(projectId) {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    return db.prepare("SELECT * FROM plugins WHERE project_id = ?").all(projectId);
}
/**
 * Enable a plugin: updates DB, writes the .ts source to disk, and adds the plugin path
 * to opencode.json's `plugin` array.
 *
 * 🔴 Per HARD RULE #16, the config sync (addPluginToConfig) is mandatory here —
 * without it, OpenCode won't load the plugin on startup.
 */
export function enablePlugin(projectId, name) {
    return execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const now = new Date().toISOString();
        db.prepare("UPDATE plugins SET enabled = 1, updated_at = ? WHERE project_id = ? AND name = ?")
            .run(now, projectId, name);
        const plugin = db.prepare("SELECT * FROM plugins WHERE project_id = ? AND name = ?")
            .get(projectId, name);
        if (plugin?.source_content) {
            ensurePluginDir(projectId);
            const filePath = validatePluginPath(plugin.file_path, projectId);
            const fullPath = resolve(getPluginsBase(projectId), filePath);
            mkdirSync(dirname(fullPath), { recursive: true });
            writeFileSync(fullPath, plugin.source_content);
            addPluginToConfig(plugin.file_path, projectId);
        }
        checkpointAfterWrite();
        return plugin;
    });
}
/**
 * Disable a plugin: updates DB, removes the .ts file from disk, and removes the plugin path
 * from opencode.json's `plugin` array.
 */
export function disablePlugin(projectId, name) {
    return execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const now = new Date().toISOString();
        db.prepare("UPDATE plugins SET enabled = 0, updated_at = ? WHERE project_id = ? AND name = ?")
            .run(now, projectId, name);
        const plugin = db.prepare("SELECT * FROM plugins WHERE project_id = ? AND name = ?")
            .get(projectId, name);
        if (plugin) {
            const filePath = validatePluginPath(plugin.file_path, projectId);
            const resolvedPath = resolve(getPluginsBase(projectId), filePath);
            if (existsSync(resolvedPath))
                unlinkSync(resolvedPath);
            removePluginFromConfig(plugin.file_path, projectId);
        }
        checkpointAfterWrite();
        return plugin;
    });
}
/**
 * Ensure the plugin base directory exists on disk.
 * Used during initialization and before writing plugin files.
 */
export function ensurePluginDir(projectId) {
    const dir = getPluginsBase(projectId);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
}
/**
 * Create a new plugin and persist it to DB + disk.
 *
 * Auto-populates source_content from the file on disk (if it exists and no content is provided),
 * then writes the .ts file and syncs opencode.json.
 *
 * NOTE: The plugin `id` uses a timestamp+random scheme (`plugin_${Date.now()}_${random}`)
 * rather than UUID — this is a legacy pattern. The timestamp portion provides rough creation ordering
 * without needing a separate `created_at` sort query.
 */
export function createPlugin(projectId, name, filePath, sourceContent) {
    return execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        validatePluginPath(filePath, projectId);
        const now = new Date().toISOString();
        const id = `plugin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const content = sourceContent || (() => {
            try {
                const resolvedPath = resolve(getPluginsBase(projectId), filePath);
                if (existsSync(resolvedPath)) {
                    return readFileSync(resolvedPath, "utf-8");
                }
            }
            catch { /* file doesn't exist yet */ }
            return "";
        })();
        db.prepare(`INSERT INTO plugins (id, project_id, name, file_path, enabled, source_content, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`).run(id, projectId, name, filePath, content, now, now);
        ensurePluginDir(projectId);
        if (content) {
            const fullPath = resolve(getPluginsBase(projectId), filePath);
            mkdirSync(dirname(fullPath), { recursive: true });
            writeFileSync(fullPath, content);
            addPluginToConfig(filePath, projectId);
        }
        checkpointAfterWrite();
        return db.prepare("SELECT * FROM plugins WHERE id = ?").get(id);
    });
}
/**
 * Delete a plugin: removes from DB, deletes the .ts file from disk, and removes from opencode.json config.
 * Returns false if the plugin doesn't exist.
 */
export function deletePlugin(projectId, name) {
    return execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const plugin = db.prepare("SELECT * FROM plugins WHERE project_id = ? AND name = ?")
            .get(projectId, name);
        if (!plugin)
            return false;
        try {
            const resolvedPath = resolve(getPluginsBase(projectId), validatePluginPath(plugin.file_path, projectId));
            if (existsSync(resolvedPath))
                unlinkSync(resolvedPath);
            removePluginFromConfig(plugin.file_path, projectId);
        }
        catch { /* file may already be gone */ }
        db.prepare("DELETE FROM plugins WHERE id = ?").run(plugin.id);
        checkpointAfterWrite();
        return true;
    });
}
/**
 * Update a plugin's file_path and/or source_content.
 *
 * Handles three scenarios:
 * 1. Both file_path and source_content changed → remove old file, write new, update config
 * 2. Only source_content changed → overwrite existing file
 * 3. Only file_path changed → move file to new location, update config
 *
 * Always syncs opencode.json when the path changes (add/remove from `plugin` array).
 */
export function updatePlugin(projectId, name, updates) {
    return execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        const existing = db.prepare("SELECT * FROM plugins WHERE project_id = ? AND name = ?")
            .get(projectId, name);
        if (!existing)
            return undefined;
        const now = new Date().toISOString();
        const newFilePath = updates.file_path ?? existing.file_path;
        const newContent = updates.source_content !== undefined ? updates.source_content : (existing.source_content ?? "");
        if (updates.file_path)
            validatePluginPath(updates.file_path, projectId);
        db.prepare("UPDATE plugins SET file_path = ?, source_content = ?, updated_at = ? WHERE id = ?").run(newFilePath, newContent, now, existing.id);
        if (updates.source_content !== undefined) {
            ensurePluginDir(projectId);
            if (updates.file_path && updates.file_path !== existing.file_path) {
                try {
                    const oldPath = resolve(getPluginsBase(projectId), existing.file_path);
                    if (existsSync(oldPath))
                        unlinkSync(oldPath);
                }
                catch { /* ignore */ }
                removePluginFromConfig(existing.file_path, projectId);
                addPluginToConfig(newFilePath, projectId);
            }
            const writePath = resolve(getPluginsBase(projectId), newFilePath);
            mkdirSync(dirname(writePath), { recursive: true });
            writeFileSync(writePath, newContent);
        }
        else if (updates.file_path && updates.file_path !== existing.file_path) {
            // Path-only change: read old file content, write to new location, remove old
            ensurePluginDir(projectId);
            const oldPath = resolve(getPluginsBase(projectId), existing.file_path);
            const newPath = resolve(getPluginsBase(projectId), newFilePath);
            if (existsSync(oldPath)) {
                const content = readFileSync(oldPath, "utf-8");
                mkdirSync(dirname(newPath), { recursive: true });
                writeFileSync(newPath, content);
                unlinkSync(oldPath);
            }
            removePluginFromConfig(existing.file_path, projectId);
            addPluginToConfig(newFilePath, projectId);
        }
        checkpointAfterWrite();
        return db.prepare("SELECT * FROM plugins WHERE id = ?").get(existing.id);
    });
}
/** Get a single plugin by project and name. */
export function getPlugin(projectId, name) {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    return db.prepare("SELECT * FROM plugins WHERE project_id = ? AND name = ?")
        .get(projectId, name);
}
