import { getDb } from "../db.js";
import { resolve } from "node:path";
import {committedPluginProjectionPaths,managedPluginConfigPathIfPresent} from "./plugin-projection-transition.js";

/**
 * Resolve the project root for disk operations.
 * For installation-owned storage, returns the global OpenCode config directory.
 * For normal projects, returns the project root derived from INGENIUM_CORE_DB_PATH.
 */
export function resolveProjectBase(projectId?: string): string {
  if (projectId) {
    try {
      const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
      const project = db.prepare(
        "SELECT is_global FROM projects WHERE id = ? AND archived_at IS NULL",
      ).get(projectId) as { is_global: number } | undefined;
      if (project && isGlobal(projectId)) {
        return process.env.INGENIUM_GLOBAL_CONFIG_PATH
          ?? resolve(process.env.HOME ?? "/home/appuser", ".config", "opencode");
      }
    } catch { /* fall through to default path */ }
  }
  return resolve(process.env.INGENIUM_CORE_DB_PATH ?? "./data", "..", "..");
}

/** Stable installation role, including an archived row retained for recovery.
 * The deprecated global workspace flag never grants installation filesystem access. */
export function isInstallationStorageProject(projectId?: string): boolean {
  if (!projectId) return false;
  return Boolean(getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data").prepare(
    "SELECT 1 FROM veyra_installation_identity i JOIN veyra_installation_legacy_refs r ON r.instance_id=i.instance_id WHERE i.singleton=1 AND r.legacy_project_id=?",
  ).get(projectId));
}

/** Compatibility name for the active installation-owned storage role. */
export function isGlobal(projectId?: string): boolean {
  if (!projectId) return false;
  try {
    return isInstallationStorageProject(projectId) && Boolean(getDb().prepare(
      "SELECT 1 FROM projects WHERE id=? AND archived_at IS NULL",
    ).get(projectId));
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
    if (!isGlobal(projectId)) return resolve(project.path, ".opencode", "skills");
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
    if (!isGlobal(projectId)) return committedPluginProjectionPaths(projectId).pluginBase;
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
  if(projectId){const project=getDb().prepare("SELECT is_global FROM projects WHERE id=? AND archived_at IS NULL").get(projectId) as {is_global:number}|undefined;if(!project)throw new Error("Active config project required");if(!isGlobal(projectId)){const managed=managedPluginConfigPathIfPresent(projectId);if(managed)return managed;}}
  const base = resolveProjectBase(projectId);
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const project = projectId ? db.prepare(
    "SELECT is_global FROM projects WHERE id = ? AND archived_at IS NULL",
  ).get(projectId) as { is_global: number } | undefined : undefined;
  // Installation storage uses opencode.jsonc (comment-supporting JSONC), project uses opencode.json
  if (project && isGlobal(projectId)) {
    return resolve(base, "opencode.jsonc");
  }
  return resolve(base, "opencode.json");
}

/** Plugin config follows its registered workspace, independent of installation settings. */
export function getPluginConfigPath(projectId?:string):string {
 if(projectId){const project=getDb().prepare("SELECT path,is_global FROM projects WHERE id=? AND archived_at IS NULL").get(projectId) as {path:string;is_global:number}|undefined;
 if(!project)throw new Error("Active project required for plugin configuration");if(!isGlobal(projectId))return committedPluginProjectionPaths(projectId).configPath;}
 return getConfigPath(projectId);
}
