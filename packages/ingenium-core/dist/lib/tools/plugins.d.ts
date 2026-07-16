import { Plugin } from "../schema.js";
/** List all plugins registered for a project. */
export declare function listPlugins(projectId: string): Plugin[];
/**
 * Enable a plugin: updates DB, writes the .ts source to disk, and adds the plugin path
 * to opencode.json's `plugin` array.
 *
 * 🔴 Per HARD RULE #16, the config sync (addPluginToConfig) is mandatory here —
 * without it, OpenCode won't load the plugin on startup.
 */
export declare function enablePlugin(projectId: string, name: string): Plugin | undefined;
/**
 * Disable a plugin: updates DB, removes the .ts file from disk, and removes the plugin path
 * from opencode.json's `plugin` array.
 */
export declare function disablePlugin(projectId: string, name: string): Plugin | undefined;
/**
 * Ensure the plugin base directory exists on disk.
 * Used during initialization and before writing plugin files.
 */
export declare function ensurePluginDir(projectId?: string): void;
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
export declare function createPlugin(projectId: string, name: string, filePath: string, sourceContent?: string): Plugin;
/**
 * Delete a plugin: removes from DB, deletes the .ts file from disk, and removes from opencode.json config.
 * Returns false if the plugin doesn't exist.
 */
export declare function deletePlugin(projectId: string, name: string): boolean;
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
export declare function updatePlugin(projectId: string, name: string, updates: {
    file_path?: string;
    source_content?: string;
}): Plugin | undefined;
/** Get a single plugin by project and name. */
export declare function getPlugin(projectId: string, name: string): Plugin | undefined;
//# sourceMappingURL=plugins.d.ts.map