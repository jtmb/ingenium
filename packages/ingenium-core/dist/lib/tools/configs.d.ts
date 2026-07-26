import { Config } from "../schema.js";
/**
 * Get configuration content from the DB.
 * "global" configs use the opencode.jsonc path, "project" configs use opencode.json.
 */
export declare function getConfig(projectId: string, type: "project" | "global"): Config | undefined;
/**
 * Save config to both DB and disk.
 * DB write is authoritative; disk write is best-effort (failure is logged but
 * does not roll back the transaction). This ensures the config is not lost
 * even if the filesystem is read-only or the path is invalid.
 */
export declare function saveConfig(projectId: string, type: "project" | "global", content: string): Config;
/**
 * Read config from the filesystem and save it to the DB.
 * Returns undefined if the file does not exist or is unreadable
 * (e.g., the workspace hasn't been initialized yet).
 * This is the "pull from disk" direction of the sync.
 */
export declare function syncConfigFromDisk(projectId: string, type: "project" | "global"): Config | undefined;
//# sourceMappingURL=configs.d.ts.map