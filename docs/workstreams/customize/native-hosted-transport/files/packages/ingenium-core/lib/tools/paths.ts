import { getDb } from "../db.js";
import { resolve } from "node:path";
import {committedPluginProjectionPaths,managedPluginConfigPathIfPresent} from "./plugin-projection-transition.js";

/**
 * Resolve the project root for disk operations.
 * For global (is_global=1) projects, returns the global OpenCode config directory.
 * For normal projects, returns the project root derived from INGENIUM_CORE_DB_PATH.
 */
export function resolveProjectBase(projectId?: string): string {
  if (projectId) {
    try {
      const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
      const project = db.prepare(
        "SELECT is_global FROM projects WHERE id = ? AND archived_at IS NULL",
      ).get(projectId) as { is_global: number } | undefined;
      if (project?.is_global) {
        return process.env.INGENIUM_GLOBAL_CONFIG_PATH
          ?? resolve(process.env.HOME ?? "/home/appuser", ".config", "opencode");
      }
    } catch { /* fall through to default path */ }
  }
  return resolve(process.env.INGENIUM_CORE_DB_PATH ?? "./data", "..", "..");
}

/**
 * Check whether a project ID corresponds to the global project (is_global=1).
 * Silently returns false if the project doesn't exist or DB is unavailable —
 * callers treat "not global" as the safe default for path resolution.
 */
export function isGlobal(projectId?: string): boolean {
  if (!projectId) return false;
  try {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const project = db.prepare(
      "SELECT is_global FROM projects WHERE id = ? AND archived_at IS NULL",
    ).get(projectId) as { is_global: number } | undefined;
    return project?.is_global === 1;
  } catch { return false; }
}

/**
 * Resolve the skills directory for a project.
 * Global: <config>/skills/ | Normal: <registered project path>/.opencode/skills/.
 * Skill projections belong to API-owned project data, never the packaged code
 * root inferred from the database location. Config/model paths stay separate.
 */
export function getSkillsBase(projectId?: string): string {
  if (projectId) {
    const project = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data").prepare(
      "SELECT path, is_global FROM projects WHERE id = ? AND archived_at IS NULL",
    ).get(projectId) as { path: string; is_global: number } | undefined;
    if (!project) throw new Error("Active project required for skill storage");
    if (!project.is_global) return resolve(project.path, ".opencode", "skills");
  }
  const base = resolveProjectBase(projectId);
  if (isGlobal(projectId)) return resolve(base, "skills");
  return resolve(base, ".opencode", "skills");
}

/**
 * Resolve the plugins directory for a project.
 * Global: <config>/plugins/  |  Normal: <project>/.opencode/plugins/
 */
export function getPluginsBase(projectId?: string): string {
  if (projectId) {
    const project = getDb().prepare("SELECT path,is_global FROM projects WHERE id=? AND archived_at IS NULL").get(projectId) as {path:string;is_global:number}|undefined;
    if (!project) throw new Error("Active project required for plugin storage");
    if (!project.is_global) return committedPluginProjectionPaths(projectId).pluginBase;
  }
  const base = resolveProjectBase(projectId);
  if (isGlobal(projectId)) return resolve(base, "plugins");
  return resolve(base, ".opencode", "plugins");
}

/**
 * Resolve the commands directory for a project.
 * Global: <config>/commands/  |  Normal: <project>/.opencode/commands/
 */
export function getCommandsBase(projectId?: string): string {
  const base = resolveProjectBase(projectId);
  if (isGlobal(projectId)) return resolve(base, "commands");
  return resolve(base, ".opencode", "commands");
}

export function getConfigPath(projectId?: string): string {
  if(projectId){const project=getDb().prepare("SELECT is_global FROM projects WHERE id=? AND archived_at IS NULL").get(projectId) as {is_global:number}|undefined;if(!project)throw new Error("Active config project required");if(project.is_global===0){const managed=managedPluginConfigPathIfPresent(projectId);if(managed)return managed;}}
  const base = resolveProjectBase(projectId);
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const project = projectId ? db.prepare(
    "SELECT is_global FROM projects WHERE id = ? AND archived_at IS NULL",
  ).get(projectId) as { is_global: number } | undefined : undefined;
  // Global project uses opencode.jsonc (comment-supporting JSONC), project uses opencode.json
  if (project?.is_global) {
    return resolve(base, "opencode.jsonc");
  }
  return resolve(base, "opencode.json");
}

/** Plugin config follows its registered workspace, independent of installation settings. */
export function getPluginConfigPath(projectId?:string):string {
 if(projectId){const project=getDb().prepare("SELECT path,is_global FROM projects WHERE id=? AND archived_at IS NULL").get(projectId) as {path:string;is_global:number}|undefined;
 if(!project)throw new Error("Active project required for plugin configuration");if(!project.is_global)return committedPluginProjectionPaths(projectId).configPath;}
 return getConfigPath(projectId);
}
