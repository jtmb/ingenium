import { getDb } from "../db.js";
import { resolve } from "node:path";

/**
 * Resolve the project root for disk operations.
 * For global (is_global=1) projects, returns the global OpenCode config directory.
 * For normal projects, returns the project root derived from INGENIUM_CORE_DB_PATH.
 */
export function resolveProjectBase(projectId?: string): string {
  if (projectId) {
    try {
      const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
      const project = db.prepare("SELECT is_global FROM projects WHERE id = ?").get(projectId) as { is_global: number } | undefined;
      if (project?.is_global) {
        return process.env.INGENIUM_GLOBAL_CONFIG_PATH
          ?? resolve(process.env.HOME ?? "/home/appuser", ".config", "opencode");
      }
    } catch { /* fall through to default path */ }
  }
  return resolve(process.env.INGENIUM_CORE_DB_PATH ?? "./data", "..", "..");
}

export function getSkillsBase(projectId?: string): string {
  return resolve(resolveProjectBase(projectId), ".opencode", "skills");
}

export function getPluginsBase(projectId?: string): string {
  return resolve(resolveProjectBase(projectId), ".opencode", "plugins");
}

export function getCommandsBase(projectId?: string): string {
  return resolve(resolveProjectBase(projectId), ".opencode", "commands");
}

export function getConfigPath(projectId?: string): string {
  const base = resolveProjectBase(projectId);
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const project = projectId ? db.prepare("SELECT is_global FROM projects WHERE id = ?").get(projectId) as { is_global: number } | undefined : undefined;
  // Global project uses opencode.jsonc (comment-supporting JSONC), project uses opencode.json
  if (project?.is_global) {
    return resolve(base, "opencode.jsonc");
  }
  return resolve(base, "opencode.json");
}
